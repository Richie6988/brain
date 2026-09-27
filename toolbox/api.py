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
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.db.models import Count
from django.http import FileResponse, JsonResponse, StreamingHttpResponse

from graph.api import api, unauthenticated
from graph.services import ChangeError
from nodzapp.models import Layer, Node

from . import cuda, fit, gguf, hub, iaqua, imaging, monitor, params as model_params, prompts, tools, workspace
from .broker import BrokerTimeout
from .dispatcher import Busy
from .engine import Engine, EngineUnavailable
from .guardian import Guardian, PlanError
from .models import Agent, LocalModel, NodeMark, Preference
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


def staff_only(request):
    if not request.user.is_staff:
        raise Forbidden('réservé aux administrateurs : les modèles sont partagés par tout le serveur')


def hub_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:  # réseau, dépôt introuvable, quota : renvoyé tel quel à l'interface
        raise Upstream(f'Hugging Face : {e}') from None


def model_to_dict(m, user):
    stats = engine.stats.get(m.id)
    info = gguf.info(m.path) if m.status == LocalModel.Status.READY else {}
    return {'id': str(m.id), 'repo': m.repo, 'filename': m.filename, 'label': m.label, 'kind': m.kind,
            'capabilities': m.capabilities, 'quant': m.quant, 'size': m.size, 'downloaded': m.downloaded,
            'status': m.status, 'error': m.error, 'params': m.params, 'loaded': engine.loaded == m.id,
            'stats': stats if engine.loaded == m.id else None, **hub.download_state(m),
            'agents': [a.name for a in m.agents.all() if a.owner_id == user.pk],
            'gguf': info, 'kv_bytes': fit.kv_bytes_per_token(info) if info else None,  # estimation mémoire du dialogue
            'config': Engine.config(m),  # réglages effectifs (défauts d'iAqua compris)
            'placement': engine.placement.get(m.id)}  # couches GPU et contexte retenus au dernier chargement


def agent_to_dict(a):
    return {'id': str(a.id), 'name': a.name, 'role': a.role, 'description': a.description,
            'model': str(a.model_id) if a.model_id else None, 'system_prompt': a.system_prompt, 'default_prompt': prompts.default(a.role),
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
            Guardian(user, engine, lambda kind, data: None).warm()
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
    """Origine et dates des nodes de l'utilisateur (filtres) ; POST marque des nodes (message, ai)."""
    if request.method == 'POST':
        origin = body.get('origin')
        if origin not in NodeMark.Origin.values:
            raise ChangeError('origine inconnue')
        ids = {int(str(i).removeprefix('N-')) for i in body.get('nodes') or [] if str(i).removeprefix('N-').isdigit()}
        for node_id in ids:  # un message au Gardien reste un message ; une création de l'IA, une création
            NodeMark.objects.get_or_create(owner=request.user, node_id=node_id, defaults={'origin': origin})
        return JsonResponse({'marked': len(ids)})
    origins = dict(NodeMark.objects.filter(owner=request.user).values_list('node_id', 'origin'))
    nodes = Node.objects.filter(user=request.user, archive=False).values_list('node_id', 'created_at', 'modified_at')
    return JsonResponse({'nodes': {f'N-{i}': {'origin': origins.get(i, 'user'), 'created': c.timestamp(), 'modified': m.timestamp()}
                                   for i, c, m in nodes}})


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
    return JsonResponse({'guidelines': guardian.system_prompt or prompts.GUARDIAN, 'installed': bool(mapping), 'universe': mapping,
                         'memory': guardian.memory, 'brain': brain_text(guardian),
                         'tools': [{'op': t['op'], 'label': t['label'], 'category': t['category'], 'usage': t['doc']}
                                   for t in tools.TOOLS if t['op'] in ops]})


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
    return JsonResponse({**monitor.snapshot(), 'broker': broker.state(), 'dispatch': dispatcher.state(), 'engine': engine.available(),
                         'model': {'id': str(loaded.id), 'name': loaded.label or loaded.filename,
                                   'stats': engine.stats.get(loaded.id)} if loaded else None})


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
        return JsonResponse({'models': [model_to_dict(m, request.user) for m in LocalModel.objects.prefetch_related('agents')]})
    staff_only(request)
    repo, filename = body.get('repo', ''), body.get('filename', '')
    if repo.count('/') != 1 or not filename.lower().endswith('.gguf') or '..' in filename:
        raise ChangeError('repo (organisation/dépôt) et filename (.gguf) requis')
    kind = body.get('kind', LocalModel.Kind.TEXT)
    if kind not in LocalModel.Kind.values:
        raise ChangeError(f'type {kind!r} inconnu')
    model = hub.start_download(repo, filename, body.get('size', 0), kind, body.get('capabilities', []))
    return JsonResponse(model_to_dict(model, request.user), status=202)


@api('PATCH', 'DELETE')
def model_detail(request, body, model_id):
    """Réglages d'un modèle ; DELETE le retire de la bibliothèque (?file=1 supprime aussi le fichier)."""
    staff_only(request)
    model = LocalModel.objects.filter(id=model_id).first()
    if model is None:
        return JsonResponse({'error': 'modèle introuvable'}, status=404)
    if request.method == 'DELETE':
        hub.cancel_download(model)
        if engine.loaded == model.id:
            engine.unload()
        if request.GET.get('file') == '1' and model.path and Path(model.path).is_relative_to(Path(settings.MODELS_DIR)):
            Path(model.path).unlink(missing_ok=True)
        model.delete()
        return JsonResponse({'deleted': str(model_id)})
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


def _agent_model(body):
    if not body.get('model'):
        return None
    model = LocalModel.objects.filter(id=body['model']).first()
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
    agent = Agent(owner=request.user, model=_agent_model(body))
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
        agent.model = _agent_model(body)
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
            if kind == 'action':
                outcome['actions'] += 1
            elif kind == 'timing':
                outcome['timing'] = data
            events.put((kind, data))
        try:
            if not dispatcher.wait(ticket, lambda position: events.put(('queued', {'position': position}))):
                return  # la page est partie avant son tour
            outcome['ran'], started = True, time.monotonic()
            Guardian(user, engine, emit).handle(prompt, body['context'])
        except (PlanError, EngineUnavailable, BrokerTimeout) as e:
            outcome['error'] = str(e)
            emit('error', {'message': outcome['error']})
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
