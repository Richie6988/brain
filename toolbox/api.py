"""API /api/v1/toolbox : bibliothèque de modèles (Hugging Face, fichiers du serveur), agents, Gardien.

Consulter est ouvert à tout compte connecté ; ce qui change le serveur (télécharger, importer,
supprimer, régler un modèle) est réservé aux administrateurs : les modèles sont partagés.
"""

import asyncio
import html
import json
import logging
import queue
import re
import threading
import time
import uuid
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.db.models import Count
from django.http import FileResponse, JsonResponse, StreamingHttpResponse
from django.utils import timezone

from graph.api import api, unauthenticated
from graph.services import ChangeError
from nodzapp.models import Layer, Link, Node

from . import cuda, fit, gguf, hub, iaqua, imaging, monitor, params as model_params, prompts, remote, tools, workspace
from .broker import BrokerTimeout
from .dispatcher import Busy
from .engine import Engine, EngineUnavailable, acting_for
from .guardian import Guardian, PlanError, guardian_prompt
from .models import Agent, LocalModel, Mission, NodeMark, Preference
from .runtime import broker, dispatcher, engine

logger = logging.getLogger(__name__)
SCHEDULES = {'checked': 0.0}  # dernière vérification des planifications (moniteur)

AGENT_FIELDS = ('name', 'role', 'description', 'system_prompt', 'tools_allowed', 'params', 'enabled')

# Bibliothèque de départ : l'utilisateur choisit ensuite le modèle de chaque agent.
DEFAULT_AGENTS = [
    ('Gardien', Agent.Role.ORCHESTRATOR, "Répond aux nodes qu'on lui envoie (pastille Gardien ou Ctrl+Entrée) : place, relie, cherche, délègue, guide."),
    ('Rédacteur', Agent.Role.TEXT, 'Écrit, résume, reformule.'),
    ('Codeur', Agent.Role.CODE, 'Écrit et explique du code.'),
    ('Illustrateur', Agent.Role.IMAGE, 'Génère des images.'),
]


class Forbidden(ChangeError):
    status = 403


class Upstream(ChangeError):
    status = 502


class Stopped(BaseException):
    """L'utilisateur a arrêté sa demande : BaseException, pour traverser les `except Exception` du Gardien."""


def staff_only(request):
    if not request.user.is_staff:
        raise Forbidden('réservé aux administrateurs : les modèles sont partagés par tout le serveur')


def own_or_staff(request, model):
    """Un connecteur personnel se règle par son propriétaire ; le reste de la bibliothèque, par l'administrateur."""
    if model.owner_id != request.user.pk:
        staff_only(request)


def hub_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:  # réseau, dépôt introuvable, quota : renvoyé tel quel à l'interface
        raise Upstream(f'Hugging Face : {e}') from None


def model_to_dict(m, user):
    stats = engine.stats.get(m.id)
    info = gguf.info(m.path) if m.status == LocalModel.Status.READY and m.path else {}
    return {'id': str(m.id), 'repo': m.repo, 'filename': m.filename, 'label': m.label, 'kind': m.kind,
            'capabilities': m.capabilities, 'quant': m.quant, 'size': m.size, 'downloaded': m.downloaded,
            'status': m.status, 'error': m.error, 'params': m.params, 'loaded': engine.loaded == m.id,
            'stats': stats if engine.loaded == m.id else None, **hub.download_state(m),
            'agents': [a.name for a in m.agents.all() if a.owner_id == user.pk],
            'gguf': info, 'kv_bytes': fit.kv_bytes_per_token(info) if info else None,  # estimation mémoire du dialogue
            'config': Engine.config(m),  # réglages effectifs (défauts d'iAqua compris)
            'placement': engine.placement.get(m.id),  # couches GPU et contexte retenus au dernier chargement
            'endpoint': m.endpoint, 'has_key': bool(m.api_key),  # modèle par API : la clé ne quitte jamais le serveur
            'mine': m.owner_id is not None and m.owner_id == user.pk}  # connecteur personnel de cet utilisateur


def agent_to_dict(a):
    return {'id': str(a.id), 'name': a.name, 'role': a.role, 'description': a.description,
            'model': str(a.model_id) if a.model_id else None, 'system_prompt': a.system_prompt,
            # le Gardien : son prompt système en entier (commandes, cas d'usage, ses outils) ; un agent : son rôle
            'default_prompt': guardian_prompt(a, default=True) if a.role == Agent.Role.ORCHESTRATOR else prompts.default(a.role),
            **({'prompt': guardian_prompt(a)} if a.role == Agent.Role.ORCHESTRATOR else {}),  # ce qu'il reçoit, tel quel
            'tools_allowed': a.tools_allowed, 'params': a.params, 'enabled': a.enabled}


def _number(value, kind, name):
    try:
        return kind(value)
    except (TypeError, ValueError):
        raise ChangeError(f'{name} : nombre attendu') from None


@api('GET')
def status(request, body):
    return JsonResponse({'engine': engine.available(), 'staff': request.user.is_staff,
                         'loaded': str(engine.loaded) if engine.loaded else None, 'broker': broker.state(),
                         'machine': hub.machine(), 'models_dir': str(settings.MODELS_DIR), 'param_spec': model_params.SPEC,
                         'imaging': bool(imaging.binary()), 'gpu_offload': engine.gpu_offload(), 'packs': {k: p['label'] for k, p in hub.PACKS.items()}})


@api('GET')
def search(request, body):
    """Recherche du haut : nodes de toutes les dimensions, classés par le score de la recherche de Nodz,
    avec leur dimension et un extrait (carrousel précédent / suivant)."""
    from nodzapp.views import calculate_matching_score

    query = request.GET.get('q', '').strip()[:200]
    if not query:
        return JsonResponse({'results': []})
    names = dict(Layer.objects.filter(user=request.user).values_list('layer_id', 'layer_name'))
    nodes = Node.objects.filter(user=request.user, archive=False).values(
        'node_id', 'layer__layer_id', 'text_content', 'image_content', 'file_name', 'file_text_content', 'created_at', 'modified_at')
    scored = [(calculate_matching_score(n, query), n) for n in nodes]
    results = [{'id': f"N-{n['node_id']}", 'layer': n['layer__layer_id'], 'dimension': names.get(n['layer__layer_id'], ''),
                'text': ' '.join(re.sub(r'<[^>]+>', ' ', html.unescape(n['text_content'] or n['file_name'] or '')).split())[:80], 'score': score}
               for score, n in sorted(scored, key=lambda item: -item[0]) if score > 0][:200]
    return JsonResponse({'results': results})


RUNNERS = {'python': ['python3', '-c'], 'bash': ['/bin/bash', '-c'], 'javascript': ['node', '-e']}


@api('POST')
def run_code(request, body):
    """IDE des nodes de code, exécution sur le serveur : dans l'espace de travail confiné de l'utilisateur, avec un
    délai. Comme le shell du Gardien : compte administrateur et GUARDIAN_SHELL=1 seulement (sinon, le navigateur)."""
    if not (request.user.is_staff and settings.GUARDIAN_SHELL):
        return JsonResponse({'error': "exécution sur le serveur réservée à l'administrateur (GUARDIAN_SHELL=1) : "
                                      'exécute dans le navigateur'}, status=403)
    language, code = body.get('language'), str(body.get('code') or '')
    if language not in RUNNERS:
        raise ChangeError(f"langage {language!r} non exécutable sur le serveur ({', '.join(RUNNERS)})")
    if not code.strip() or len(code) > 100_000:
        raise ChangeError('code vide ou trop long (100 000 caractères au plus)')
    started = time.monotonic()
    try:
        result = workspace.run([*RUNNERS[language], code], workspace.root(request.user), workspace.TIMEOUT,
                               workspace.safe_env(request.user))
    except workspace.WorkspaceError as e:
        result = {'code': None, 'stdout': '', 'stderr': str(e)}
    return JsonResponse({**result, 'duration_ms': int((time.monotonic() - started) * 1000)})


@api('GET')
def node_meta(request, body):
    """Traçabilité des nodes (visite) : création, dernière modification, origine (main de l'utilisateur, Gardien,
    message au Gardien) et nom de l'auteur. Nodz ne garde pas l'auteur de chaque modification : seule la date."""
    from .models import NodeMark

    numbers = [int(r[2:]) for r in request.GET.get('ids', '').split(',')[:300] if r.startswith('N-') and r[2:].isdigit()]
    marks = dict(NodeMark.objects.filter(owner=request.user, node_id__in=numbers).values_list('node_id', 'origin'))
    me = request.user.username or request.user.email.split('@')[0]
    by = {NodeMark.Origin.AI: ('ai', 'le Gardien'), NodeMark.Origin.MESSAGE: ('message', f'{me}, pour le Gardien')}
    nodes = {}
    for node_id, created, modified in Node.objects.filter(user=request.user, node_id__in=numbers).values_list('node_id', 'created_at', 'modified_at'):
        origin, author = by.get(marks.get(node_id), ('human', me))
        nodes[f'N-{node_id}'] = {'created': created.isoformat(), 'modified': modified.isoformat(), 'origin': origin, 'author': author}
    return JsonResponse({'nodes': nodes})


SIDE_NODES = 4000  # nodes au plus dans la vue de côté


@api('GET')
def side(request, body):
    """Vue de côté de l'univers : tous les nodes de toutes les dimensions, en léger (dimension, position, couleur, forme,
    début du texte), les liens de chaque dimension et les portails entre nodes (champ quantum de Nodz)."""
    nodes = list(Node.objects.filter(user=request.user, archive=False).order_by('layer__layer_id', 'node_id').values(
        'node_id', 'layer__layer_id', 'x_coordinate', 'y_coordinate', 'color', 'shape', 'radius', 'type', 'text_content', 'file_name',
        'image_content', 'quantum')[:SIDE_NODES])
    ids = {f"N-{n['node_id']}" for n in nodes}
    portals = set()
    for n in nodes:
        try:
            targets = json.loads(n['quantum'] or '[]')
        except json.JSONDecodeError:
            targets = []
        for target in targets if isinstance(targets, list) else []:
            other = str(target.get('node') or '') if isinstance(target, dict) else ''
            other = other if other.startswith('N-') else f'N-{other}'
            if other in ids and other != f"N-{n['node_id']}":
                portals.add(tuple(sorted((f"N-{n['node_id']}", other))))
    links = [[a, b] for a, b in Link.objects.filter(user=request.user, archive=False).values_list('linkA', 'linkB') if a in ids and b in ids]
    return JsonResponse({
        'layers': [{'id': i, 'name': name} for i, name in Layer.objects.filter(user=request.user).order_by('layer_id').values_list('layer_id', 'layer_name')],
        'nodes': [{'id': f"N-{n['node_id']}", 'layer': n['layer__layer_id'], 'x': round(n['x_coordinate']), 'y': round(n['y_coordinate']),
                   'color': n['color'], 'shape': n['shape'], 'radius': round(n['radius'] or 0), 'type': n['type'],
                   # l'image telle que Nodz la charge (src du node) ; un fichier par son nom, comme sa carte
                   **({'image': n['image_content']} if n['type'] == 'image' and n['image_content'] else {}),
                   **({'file': n['file_name']} if n['type'] == 'file' and n['file_name'] else {}),
                   'html': (n['text_content'] or html.escape(n['file_name'] or ''))[:3000],  # son propre texte, rendu comme Nodz le rend
                   'text': ' '.join(re.sub(r'<[^>]+>', ' ', html.unescape(n['text_content'] or n['file_name'] or '')).split())[:60]} for n in nodes],
        'links': links,
        'portals': [list(p) for p in sorted(portals)],
    })


_warming = set()  # utilisateurs dont le Gardien lit déjà son prompt système en arrière-plan


@api('POST')
def warm(request, body):
    """Préchauffage du Gardien, à l'ouverture de l'univers : son modèle lit le prompt système en arrière-plan
    (plusieurs minutes sur CPU), pour que la première demande ne lise que le message."""
    user = request.user
    if user.pk in _warming or not hasattr(engine, 'prefill'):
        return JsonResponse({'warming': user.pk in _warming})

    def work():
        try:
            with acting_for(user.pk):
                Guardian(user, engine, lambda kind, data: None).warm(body.get('mode') if body.get('mode') in ('think', 'deep') else 'auto')
        except (EngineUnavailable, BrokerTimeout):
            pass  # pas de modèle, ou file trop longue : la première demande lira tout
        except Exception:
            logger.exception('préchauffage du Gardien')
        finally:
            _warming.discard(user.pk)

    _warming.add(user.pk)
    threading.Thread(target=work, daemon=True).start()
    return JsonResponse({'warming': True})


@api('GET', 'PATCH')
def dimensions(request, body):
    """Liste des dimensions : épinglées (gardées sur le serveur) et nombre de nodes de chacune."""
    prefs, _ = Preference.objects.get_or_create(owner=request.user)
    if request.method == 'PATCH':
        pinned = body.get('pinned') if isinstance(body, dict) else None
        if not isinstance(pinned, list) or not all(isinstance(i, int) for i in pinned):
            raise ChangeError('pinned : liste de numéros de dimension')
        mine = set(Layer.objects.filter(user=request.user).values_list('layer_id', flat=True))
        prefs.pinned_layers = [i for i in dict.fromkeys(pinned) if i in mine][:50]
        prefs.save(update_fields=['pinned_layers'])
    counts = dict(Node.objects.filter(user=request.user, archive=False).values_list('layer__layer_id').annotate(n=Count('id')))
    return JsonResponse({'pinned': prefs.pinned_layers, 'counts': {str(k): v for k, v in counts.items()}})


GALLERY_MAX = 60  # modèles personnels par compte
GALLERY_NODES = 200
HEX = re.compile(r'^#[0-9a-fA-F]{3,8}$')


def gallery_model(body):
    """Un modèle de la galerie fait d'une sélection : nodes (position relative, texte, couleur, forme, rayon) et liens."""
    name = str(body.get('name') or '').strip()[:60]
    nodes, links = body.get('nodes'), body.get('links') or []
    if not name:
        raise ChangeError('nom du modèle requis')
    if not isinstance(nodes, list) or not 0 < len(nodes) <= GALLERY_NODES or not isinstance(links, list):
        raise ChangeError(f'de 1 à {GALLERY_NODES} nodes')
    kept = []
    for n in nodes:
        if not isinstance(n, dict) or not all(isinstance(n.get(k), (int, float)) for k in ('x', 'y')):
            raise ChangeError('node : x et y requis')
        color = str(n.get('color') or '')
        kept.append({'x': round(float(n['x']), 1), 'y': round(float(n['y']), 1), 'text': str(n.get('text') or '')[:4000],
                     'color': color if HEX.match(color) else '', 'shape': n.get('shape') if n.get('shape') in ('square', 'none') else '',
                     'radius': min(600.0, max(20.0, float(n['radius']))) if isinstance(n.get('radius'), (int, float)) else 60.0})
    pairs = [[a, b] for a, b in (l for l in links if isinstance(l, list) and len(l) == 2)
             if isinstance(a, int) and isinstance(b, int) and 0 <= a < len(kept) and 0 <= b < len(kept) and a != b][:GALLERY_NODES * 2]
    return {'id': uuid.uuid4().hex[:12], 'name': name, 'nodes': kept, 'links': pairs}


@api('GET', 'POST', 'DELETE')
def gallery(request, body):
    """Modèles personnels de la galerie : liste, ajout (une sélection de nodes et ses liens), retrait (?id=)."""
    prefs, _ = Preference.objects.get_or_create(owner=request.user)
    if request.method == 'POST':
        if len(prefs.gallery) >= GALLERY_MAX:
            raise ChangeError(f'{GALLERY_MAX} modèles au plus : retires-en un')
        prefs.gallery = [*prefs.gallery, gallery_model(body if isinstance(body, dict) else {})]
        prefs.save(update_fields=['gallery'])
    elif request.method == 'DELETE':
        prefs.gallery = [m for m in prefs.gallery if m.get('id') != request.GET.get('id')]
        prefs.save(update_fields=['gallery'])
    return JsonResponse({'models': prefs.gallery})


@api('GET', 'POST', 'DELETE')
def documents(request, body):
    """Bibliothèque de modèles de documents du Rédacteur : liste, dépôt (multipart, champ file), retrait (?name=)."""
    try:
        if request.method == 'POST':
            upload = request.FILES.get('file')
            if upload is None:
                raise ChangeError('fichier attendu (champ file)')
            if upload.size > workspace.TEMPLATE_MAX:
                raise ChangeError('modèle : 20 Mo au plus')
            name = request.POST.get('name', '').strip()  # nom choisi, avec l'extension du fichier déposé
            workspace.save_template(request.user, f"{name}.{upload.name.rsplit('.', 1)[-1]}" if name else upload.name, upload.read())
        elif request.method == 'DELETE':
            workspace.delete_template(request.user, request.GET.get('name', ''))
    except workspace.WorkspaceError as e:
        raise ChangeError(str(e)) from None
    return JsonResponse({'templates': workspace.templates(request.user)})


@api('GET', 'POST')
def cuda_build(request, body):
    """Compilation de llama-cpp-python avec CUDA (deploy/cuda.sh) et redémarrage de Nodz : administrateur."""
    staff_only(request)
    if request.method == 'POST':
        action = (body or {}).get('action')
        if action == 'build' and not cuda.build():
            raise ChangeError('une compilation est déjà en cours')
        if action == 'restart' and not cuda.restart():
            raise ChangeError(f'le serveur ne peut pas se redémarrer seul : sudo systemctl restart {cuda.SERVICE}')
        if action not in ('build', 'restart'):
            raise ChangeError('action : build ou restart')
    return JsonResponse(cuda.state())


@api('POST')
def pack(request, body, key):
    """Installe un pack (modèle d'image et fichiers compagnons)."""
    staff_only(request)
    try:
        models = hub.install_pack(key)
    except ValueError as e:  # pack inconnu, ou fichier absent du dépôt
        raise ChangeError(str(e)) from None
    except Exception as e:
        raise Upstream(f'Hugging Face : {e}') from None
    return JsonResponse({'models': [model_to_dict(m, request.user) for m in models]}, status=202)


@api('GET')
def tool_list(request, body):
    """Catalogue des outils du Gardien (Nodz et iAqua), ceux activés pour l'utilisateur, et les non portés."""
    guardian = Agent.objects.filter(owner=request.user, role=Agent.Role.ORCHESTRATOR).first()
    return JsonResponse({'tools': [{**t, 'available': tools.available(t['op'], request.user)} for t in tools.TOOLS],
                         'enabled': tools.enabled(guardian, request.user) if guardian else [],
                         'guardian': str(guardian.id) if guardian else None, 'shell': settings.GUARDIAN_SHELL})


@api('GET', 'POST')
def marks(request, body):
    """Filtres de toutes les dimensions : origine, dates, dimension et début du texte de chaque node, auteurs à cocher et
    noms des dimensions ; POST marque des nodes (message, ai)."""
    if request.method == 'POST':
        origin = body.get('origin')
        if origin not in NodeMark.Origin.values:
            raise ChangeError('origine inconnue')
        ids = {int(str(i).removeprefix('N-')) for i in body.get('nodes') or [] if str(i).removeprefix('N-').isdigit()}
        for node_id in ids:  # un message au Gardien reste un message ; une création de l'IA, une création
            NodeMark.objects.get_or_create(owner=request.user, node_id=node_id, defaults={'origin': origin})
        return JsonResponse({'marked': len(ids)})
    origins = dict(NodeMark.objects.filter(owner=request.user).values_list('node_id', 'origin'))
    nodes = Node.objects.filter(user=request.user, archive=False).values_list(
        'node_id', 'created_at', 'modified_at', 'layer__layer_id', 'text_content', 'file_name')
    plain = lambda t: ' '.join(re.sub(r'<[^>]+>', ' ', html.unescape(t or '')).split())[:300]  # la recherche par mot-clé
    user = request.user
    return JsonResponse({
        'nodes': {f'N-{i}': {'origin': origins.get(i, 'user'), 'created': c.timestamp(), 'modified': m.timestamp(), 'layer': layer,
                             'text': plain(text or name)} for i, c, m, layer, text, name in nodes},
        'authors': [{'key': 'ai', 'label': 'IA'}, {'key': 'me', 'label': user.username or user.email.split('@')[0]}],
        'layers': dict(Layer.objects.filter(user=user).values_list('layer_id', 'layer_name')),
    })


@api('GET', 'POST')
def brain_map(request, body):
    """Le Gardien dans l'univers : GET donne ce qu'il faut poser (consignes, mémoire, cerveau, outils par famille)
    et les nodes déjà posés ; POST enregistre les nodes créés ({prompt, memory, brain: N-12, tools: {op: N-40}}),
    ajoutés à ceux déjà là, pour que le Gardien les relise."""
    from .guardian import brain_text

    guardian = Agent.objects.filter(owner=request.user, role=Agent.Role.ORCHESTRATOR).first()
    if guardian is None:
        return JsonResponse({'error': 'pas de Gardien'}, status=404)
    mapping = dict(guardian.brain.get('universe') or {})
    if request.method == 'POST':
        for key in ('prompt', 'memory', 'brain'):
            if body.get(key):
                mapping[key] = str(body[key])
        mapping['tools'] = {**mapping.get('tools', {}), **{op: str(n) for op, n in (body.get('tools') or {}).items() if op in tools.BY_OP}}
        guardian.brain = {**guardian.brain, 'universe': mapping}
        guardian.save(update_fields=['brain'])
        return JsonResponse({'saved': len(mapping['tools']), 'universe': mapping})
    ops = tools.enabled(guardian, request.user)
    return JsonResponse({'guidelines': guardian_prompt(guardian), 'installed': bool(mapping), 'universe': mapping,
                         'memory': guardian.memory, 'brain': brain_text(guardian),
                         'tools': [{'op': t['op'], 'label': t['label'], 'category': t['category'], 'usage': t['doc']}
                                   for t in tools.TOOLS if t['op'] in ops]})


@api('GET', 'POST')
def letters(request, body):
    """Correspondance du Gardien (dimension « Échanges ») : GET donne ses notes et celles à poser ; POST enregistre où
    elles ont été posées ({root: N-3, posted: {id de note: N-12}}), pour relire les réponses reliées."""
    guardian = Agent.objects.filter(owner=request.user, role=Agent.Role.ORCHESTRATOR).first()
    if guardian is None:
        return JsonResponse({'error': 'pas de Gardien'}, status=404)
    notes = list(guardian.brain.get('letters') or [])
    universe = dict(guardian.brain.get('universe') or {})
    if request.method == 'POST':
        posted = {str(k): str(v) for k, v in (body.get('posted') or {}).items() if str(v).startswith('N-')}
        notes = [{**n, 'node': posted.get(str(n['id']), n.get('node'))} for n in notes]
        if str(body.get('root') or '').startswith('N-'):
            universe['exchanges'] = str(body['root'])
        guardian.brain = {**guardian.brain, 'letters': notes, 'universe': universe}
        guardian.save(update_fields=['brain'])
    from .guardian import text_html

    return JsonResponse({'letters': [{**n, 'html': text_html(n['text'])} for n in notes], 'root': universe.get('exchanges'),
                         'unread': sum(1 for n in notes if not n.get('node'))})


@api('GET')
def workspace_file(request, body, path):
    """Fichier de l'espace de travail de l'utilisateur (documents générés, exports), en téléchargement."""
    try:
        target = workspace.resolve(request.user, path)
    except workspace.WorkspaceError:
        target = None
    if target is None or not target.is_file():
        return JsonResponse({'error': 'fichier introuvable'}, status=404)
    return FileResponse(open(target, 'rb'), as_attachment=True, filename=target.name)


@api('GET')
def image(request, body, name):
    """Image générée pour l'utilisateur (seulement les siennes)."""
    path = imaging.image_path(request.user, name)
    if path is None:
        return JsonResponse({'error': 'image introuvable'}, status=404)
    if path.suffix == '.svg':  # dessin nettoyé (drawing.py) ; ouvert seul dans un onglet, aucun script ne s'y exécute
        response = FileResponse(open(path, 'rb'), content_type='image/svg+xml')
        response['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
        response['X-Content-Type-Options'] = 'nosniff'
        return response
    return FileResponse(open(path, 'rb'), content_type='image/png')


@api('GET')
def system(request, body):
    """Moniteur du serveur : CPU, RAM, GPU, disque, modèle en mémoire, file du broker.

    Interrogé toutes les 3 s par les pages ouvertes : il déclenche aussi les tâches planifiées, une fois par minute.
    """
    now = time.monotonic()
    if now - SCHEDULES['checked'] >= 60:
        SCHEDULES['checked'] = now
        iaqua.fire_due_schedules(engine)
    loaded = LocalModel.objects.filter(id=engine.loaded).first() if engine.loaded else None
    # Un Gardien branché sur un modèle par API : c'est lui qu'on montre (il n'occupe pas la mémoire locale).
    guardian = Agent.objects.filter(owner=request.user, role=Agent.Role.ORCHESTRATOR).select_related('model').first()
    remote = guardian.model if guardian and guardian.model and guardian.model.endpoint else None
    shown = remote or loaded
    return JsonResponse({**monitor.snapshot(), 'broker': broker.state(), 'dispatch': dispatcher.state(), 'engine': engine.available(),
                         'model': {'id': str(shown.id), 'name': shown.label or shown.filename, 'api': bool(remote),
                                   'stats': engine.stats.get(shown.id)} if shown else None})


@api('GET')
def hub_search(request, body):
    q = request.GET
    size = {key: _number(q[key], float, key) if q.get(key) else None for key in ('min_b', 'max_b')}
    return JsonResponse({'models': hub_call(hub.search, q.get('q', ''), q.get('sort', 'downloads'),
                                            min(_number(q.get('limit', 30), int, 'limit'), 100), q.get('pipeline', ''),
                                            q.get('quant', ''), size['min_b'], size['max_b'])})


@api('GET')
def hub_files(request, body):
    repo = request.GET.get('repo', '')
    if repo.count('/') != 1:
        raise ChangeError('repo attendu sous la forme organisation/dépôt')
    return JsonResponse(hub_call(hub.repo_files, repo))


@api('GET')
def recommendations(request, body):
    return JsonResponse(hub.recommendations())


@api('GET', 'POST')
def models(request, body):
    if request.method == 'GET':
        return JsonResponse({'models': [model_to_dict(m, request.user) for m in LocalModel.visible_to(request.user).prefetch_related('agents')]})
    if body.get('endpoint'):  # tout compte branche son IA par API, avec sa clé ; l'administrateur, pour tout le serveur
        return JsonResponse(model_to_dict(api_model(body, owner=None if request.user.is_staff else request.user), request.user), status=201)
    staff_only(request)
    repo, filename = body.get('repo', ''), body.get('filename', '')
    if repo.count('/') != 1 or not filename.lower().endswith('.gguf') or '..' in filename:
        raise ChangeError('repo (organisation/dépôt) et filename (.gguf) requis')
    kind = body.get('kind', LocalModel.Kind.TEXT)
    if kind not in LocalModel.Kind.values:
        raise ChangeError(f'type {kind!r} inconnu')
    model = hub.start_download(repo, filename, body.get('size', 0), kind, body.get('capabilities', []))
    return JsonResponse(model_to_dict(model, request.user), status=202)


def api_model(body, model=None, owner=None):
    """Entrée « modèle par API » (URL de base compatible OpenAI, nom du modèle, clé facultative), vérifiée par un petit
    appel avant d'être gardée. `owner` : connecteur personnel (un compte non administrateur), adresse publique exigée."""
    endpoint = str(body.get('endpoint', model.endpoint if model else '')).strip().rstrip('/')
    name = str(body.get('name', model.filename if model else '')).strip()
    if not endpoint.startswith(('http://', 'https://')) or not name or len(endpoint) > 300 or len(name) > 300:
        raise ChangeError('URL de base (http:// ou https://) et nom du modèle requis')
    host = endpoint.split('/')[2]
    model = model or LocalModel(repo=f'api:{host}'[:200], status=LocalModel.Status.READY, kind=LocalModel.Kind.TEXT,
                                capabilities=['chat', 'api'], owner=owner)
    model.endpoint, model.filename = endpoint, name
    if 'api_key' in body:  # absente : on garde la clé enregistrée
        model.api_key = str(body['api_key']).strip()[:300]
    model.label = str(body.get('label') or model.label or name)[:120]
    try:
        remote.check(model)
    except remote.RemoteError as e:
        raise ChangeError(f'connexion impossible : {e}') from None
    if LocalModel.objects.filter(repo=model.repo, filename=model.filename, owner=model.owner).exclude(pk=model.pk).exists():
        raise ChangeError('ce modèle de cette API est déjà dans la bibliothèque')
    model.save()
    return model


@api('PATCH', 'DELETE')
def model_detail(request, body, model_id):
    """Réglages d'un modèle ; DELETE le retire de la bibliothèque (?file=1 supprime aussi le fichier)."""
    model = LocalModel.visible_to(request.user).filter(id=model_id).first()
    if model is None:
        return JsonResponse({'error': 'modèle introuvable'}, status=404)
    own_or_staff(request, model)
    if request.method == 'DELETE':
        hub.cancel_download(model)
        if engine.loaded == model.id:
            engine.unload()
        if request.GET.get('file') == '1' and model.path and Path(model.path).is_relative_to(Path(settings.MODELS_DIR)):
            Path(model.path).unlink(missing_ok=True)
        model.delete()
        return JsonResponse({'deleted': str(model_id)})
    if model.endpoint and any(k in body for k in ('endpoint', 'name', 'api_key')):
        model = api_model(body, model)
    if 'label' in body:
        model.label = str(body['label'])[:120]
    if 'kind' in body:
        if body['kind'] not in LocalModel.Kind.values:
            raise ChangeError('type inconnu')
        model.kind = body['kind']
    if 'params' in body:
        try:
            model.params = model_params.validate(body['params'])
        except model_params.ParamError as e:
            raise ChangeError(str(e)) from None
    model.save()
    return JsonResponse(model_to_dict(model, request.user))


@api('POST')
def model_action(request, body, model_id, action):
    """unload (libérer la mémoire), cancel (arrêter le téléchargement), retry (le reprendre)."""
    staff_only(request)
    model = LocalModel.objects.filter(id=model_id).first()
    if model is None:
        return JsonResponse({'error': 'modèle introuvable'}, status=404)
    if action == 'unload':
        if engine.loaded == model.id:
            engine.unload()
    elif action == 'cancel':
        hub.cancel_download(model)
    elif action == 'retry':
        model = hub.start_download(model.repo, model.filename, model.size, model.kind, model.capabilities)
    else:
        raise ChangeError(f'action inconnue : {action}')
    model.refresh_from_db()
    return JsonResponse(model_to_dict(model, request.user))


@api('GET', 'POST', 'DELETE')
def local_files(request, body):
    """Fichiers .gguf déjà présents dans MODELS_DIR : liste, import dans la bibliothèque, suppression."""
    if request.method == 'GET':
        return JsonResponse({'files': hub.local_files(), 'models_dir': str(settings.MODELS_DIR)})
    staff_only(request)
    path = hub.resolve_local((body or {}).get('path') if request.method == 'POST' else request.GET.get('path'))
    if path is None:
        raise ChangeError('fichier .gguf introuvable dans le dossier des modèles')
    if request.method == 'DELETE':
        LocalModel.objects.filter(path=str(path)).delete()
        path.unlink()
        return JsonResponse({'deleted': str(path.name)})
    return JsonResponse(model_to_dict(hub.import_local(path), request.user), status=201)


def _agent_model(body, user):
    if not body.get('model'):
        return None
    model = LocalModel.visible_to(user).filter(id=body['model']).first()  # jamais le connecteur (la clé) d'un autre
    if model is None:
        raise ChangeError('modèle introuvable')
    return model


@api('GET', 'POST')
def agents(request, body):
    if request.method == 'GET':
        if not Agent.objects.filter(owner=request.user).exists():
            Agent.objects.bulk_create([Agent(owner=request.user, name=n, role=r, description=d) for n, r, d in DEFAULT_AGENTS])
        return JsonResponse({'agents': [agent_to_dict(a) for a in Agent.objects.filter(owner=request.user)]})
    if not body.get('name') or body.get('role', Agent.Role.TEXT) not in Agent.Role.values:
        raise ChangeError('name et role valides requis')
    agent = Agent(owner=request.user, model=_agent_model(body, request.user))
    for field in AGENT_FIELDS:
        if field in body:
            setattr(agent, field, body[field])
    agent.save()
    return JsonResponse(agent_to_dict(agent), status=201)


@api('PATCH', 'DELETE')
def agent_detail(request, body, agent_id):
    agent = Agent.objects.filter(id=agent_id, owner=request.user).first()
    if agent is None:
        return JsonResponse({'error': 'agent introuvable'}, status=404)
    if request.method == 'DELETE':
        agent.delete()
        return JsonResponse({'deleted': str(agent_id)})
    if 'model' in body:
        agent.model = _agent_model(body, request.user)
    for field in AGENT_FIELDS:
        if field in body:
            setattr(agent, field, body[field])
    if 'tools_allowed' in body:
        unknown = set(body['tools_allowed'] or []) - set(tools.BY_OP)
        if unknown or not isinstance(body['tools_allowed'], list):
            raise ChangeError(f"outil inconnu : {', '.join(sorted(map(str, unknown)))}")
    if 'params' in body:  # réglages d'échantillonnage propres à l'agent (priment sur ceux du modèle)
        if set(body['params'] or {}) - set(model_params.SAMPLING):
            raise ChangeError("un agent ne règle que l'échantillonnage")
        try:
            agent.params = model_params.validate(body['params'])
        except model_params.ParamError as e:
            raise ChangeError(str(e)) from None
    if agent.role not in Agent.Role.values:
        raise ChangeError('rôle inconnu')
    agent.save()
    return JsonResponse(agent_to_dict(agent))


async def command(request):
    """Demande au Gardien, réponse en flux SSE : queued, start, thinking (le plan en cours d'écriture), plan, intent, text, action,
    notice, agent, agent_text, error, end.

    Le corps porte la demande et le contexte de la page Nodz (nodes, liens, dimensions, sélection) ;
    les événements `action` sont exécutés par la page avec les fonctions de Nodz.

    L'inférence tourne dans un thread : sous Daphne, les vues synchrones partagent un seul thread
    et une génération sur CPU bloquerait toutes les autres requêtes.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'méthode non autorisée'}, status=405)
    user = await request.auser()
    if not user.is_authenticated:
        return unauthenticated(request)
    try:
        body = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON invalide'}, status=400)
    if not isinstance(body, dict) or not isinstance(body.get('context'), dict):
        return JsonResponse({'error': 'contexte de la page requis'}, status=400)
    prompt = str(body.get('prompt', '')).strip()
    if not prompt:
        return JsonResponse({'error': 'prompt requis'}, status=400)

    try:
        ticket = dispatcher.admit(user.pk)  # peu de demandes à la fois, une par utilisateur
    except Busy as e:
        return JsonResponse({'error': str(e)}, status=429)
    events = queue.Queue()

    def work():
        # Chaque demande traitée entre au journal du Gardien (console d'administration) : actions, durée, échec.
        outcome = {'actions': 0, 'error': None, 'ran': False}

        def emit(kind, data):
            if ticket.cancelled and kind != 'error':  # arrêt demandé : coupe le modèle au prochain jeton (le flux se ferme), puis le tour
                raise Stopped
            if kind == 'tick':  # pouls du modèle qui écrit : seulement pour s'arrêter à temps, rien n'est envoyé
                return
            if kind == 'action':
                outcome['actions'] += 1
            elif kind == 'timing':
                outcome['timing'] = data
            events.put((kind, data))
        try:
            if not dispatcher.wait(ticket, lambda position: events.put(('queued', {'position': position}))):
                return  # la page est partie avant son tour
            outcome['ran'], started = True, time.monotonic()
            with acting_for(user.pk):
                Guardian(user, engine, emit).handle(prompt, body['context'])
            if ticket.cancelled:
                raise Stopped
        except Stopped:
            outcome['error'] = 'arrêté'
            events.put(('stopped', {}))
        except (PlanError, EngineUnavailable, BrokerTimeout) as e:
            outcome['error'] = 'arrêté' if ticket.cancelled else str(e)
            events.put(('stopped', {}) if ticket.cancelled else ('error', {'message': outcome['error']}))
        except Exception as e:
            logger.exception('Gardien')
            # La cause en clair pour l'administrateur (journal du serveur : « Gardien » avec la trace), son type pour tous.
            detail = f'{type(e).__name__} : {str(e)[:200]}' if user.is_staff else type(e).__name__
            outcome['error'] = f'erreur interne du Gardien ({detail})'
            emit('error', {'message': outcome['error']})
        finally:
            if outcome['ran']:
                result = f"échec : {outcome['error']}" if outcome['error'] else f"{outcome['actions']} actions"
                timing = outcome.get('timing')
                detail = f" ({timing['calls']} appels au modèle, premier mot après {timing['wait_s']} s)" if timing else ''
                iaqua.log(user, 'demande', f'{prompt} → {result}, {time.monotonic() - started:.1f} s{detail}')
            dispatcher.done(ticket)
            connection.close()
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    async def stream():
        try:
            while (item := await asyncio.to_thread(events.get)) is not None:
                yield f'event: {item[0]}\ndata: {json.dumps(item[1])}\n\n'
            yield 'event: end\ndata: {}\n\n'
        finally:
            dispatcher.cancel(ticket)  # connexion fermée : une demande encore en file ne sera pas traitée

    return StreamingHttpResponse(stream(), content_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@api('POST')
def doctor(request, body):
    """Diagnostic du Gardien, en clair : ce qu'une vraie demande va rencontrer (agent, modèle, moteur, mémoire, contexte
    comparé à son vrai prompt, essai de génération avec sa vitesse). Chaque ligne : {label, ok, detail}."""
    checks = []

    def check(label, ok, detail):
        checks.append({'label': label, 'ok': bool(ok), 'detail': detail})
        return ok

    user = request.user
    guardian_ = Guardian(user, engine, lambda kind, data: None)
    agents = guardian_.agents()
    orchestrator = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
    if not check('Gardien actif', orchestrator, 'activé' if orchestrator else 'le Gardien est désactivé dans Agents & modèles'):
        return JsonResponse({'checks': checks})
    model = orchestrator.model
    if not check('Modèle choisi', model, (model.label or model.filename) if model else 'aucun modèle : choisis-en un pour le Gardien'):
        return JsonResponse({'checks': checks})
    n_ctx = None
    if model.endpoint:
        try:
            remote.check(model)
            check('Modèle par API', True, model.endpoint)
        except remote.RemoteError as e:
            check('Modèle par API', False, str(e))
            return JsonResponse({'checks': checks})
    else:
        present = bool(model.path) and Path(model.path).is_file()
        if not check('Fichier du modèle', present, model.path if present else
                     f"{model.path or 'rien'} introuvable : retélécharge-le (Hugging Face) ou réimporte-le (Fichiers du serveur)"):
            return JsonResponse({'checks': checks})
        if not check('Moteur local', engine.available(), 'llama-cpp-python installé' if engine.available()
                     else 'llama-cpp-python absent : pip install -r requirements-ai.txt'):
            return JsonResponse({'checks': checks})
        _, placement = fit.resolve(model.path, Engine.options(model), engine.gpu_offload() is not False,
                                   set(model_params.load_options(model.params)))
        n_ctx = placement['n_ctx']
        go = lambda mb: f"{mb / 1024:.1f} Go".replace('.', ',')
        check('Mémoire', placement['fits'], f"besoin {go(placement['need_mb'])}, libre {go(placement['ram_free_mb'])}"
              + (f", {placement['gpu_layers']}/{placement['layers']} couches sur GPU" if placement['gpu_layers'] else ', sur CPU')
              + ('' if placement['fits'] else " : il relira le disque à chaque mot, prends un modèle plus petit"))
    # Essai réel : le prompt système du Gardien, une réponse de quelques jetons.
    try:
        system = guardian_.system(agents)
        with acting_for(user.pk):
            engine.chat(model, [{'role': 'system', 'content': system}, {'role': 'user', 'content': 'Réponds seulement : OK'}],
                        owner='diagnostic', max_tokens=8, temperature=0)
    except Exception as e:  # le diagnostic rapporte toute panne au lieu d'échouer
        check('Essai du modèle', False, f'{type(e).__name__} : {e}'[:300])
        return JsonResponse({'checks': checks})
    last = (engine.stats.get(model.pk) or {}).get('last') or {}
    prompt = last.get('prompt_tokens')
    if n_ctx and prompt:
        check('Contexte', prompt + 1024 <= n_ctx, f'{prompt} jetons de consignes, fenêtre de {n_ctx}'
              + ('' if prompt + 1024 <= n_ctx else ' : augmente le contexte du modèle (réglages) pour laisser la place à sa réponse'))
    wait, speed = last.get('wait_s'), last.get('speed')
    check('Essai du modèle', True, f'lecture des consignes {wait} s' + (f', {speed} jetons/s' if speed else ''))
    if speed:
        check('Vitesse', speed >= 2, f'{speed} jetons/s' + ('' if speed >= 2 else ' : très lent, un plan prendra plusieurs minutes'))
    return JsonResponse({'checks': checks})


@api('POST')
def command_stop(request, body):
    """Bouton stop du chat : tout ce que le modèle fait pour l'utilisateur s'arrête. Sa demande (au prochain calcul de
    llama.cpp, lecture du prompt comprise), son préchauffage, sa tâche de fond en cours et ses missions ; une demande
    encore en file n'est pas traitée."""
    user = request.user
    stopped = dispatcher.stop(user.pk)
    interrupted = engine.interrupt(user.pk) if hasattr(engine, 'interrupt') else False  # le modèle, lecture du prompt comprise
    missions = Mission.objects.filter(owner=user, status=Mission.Status.RUNNING).update(status=Mission.Status.ABORTED,
                                                                                         finished_at=timezone.now())
    return JsonResponse({'stopped': stopped or interrupted or bool(missions), 'missions': missions})
