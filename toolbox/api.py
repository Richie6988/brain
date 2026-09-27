"""API /api/v1/toolbox : bibliothèque de modèles (Hugging Face, fichiers du serveur), agents, Gardien.

Consulter est ouvert à tout compte connecté ; ce qui change le serveur (télécharger, importer,
supprimer, régler un modèle) est réservé aux administrateurs : les modèles sont partagés.
"""

import asyncio
import json
import logging
import queue
import threading
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.http import JsonResponse, StreamingHttpResponse

from graph.api import api
from graph.services import ChangeError

from . import hub, monitor
from .broker import BrokerTimeout
from .engine import LOAD_PARAMS, EngineUnavailable
from .guardian import Guardian, PlanError
from .models import Agent, LocalModel
from .runtime import broker, engine

logger = logging.getLogger(__name__)

AGENT_FIELDS = ('name', 'role', 'description', 'system_prompt', 'tools_allowed', 'params', 'enabled')
# Réglages d'un modèle : chargement (engine.LOAD_PARAMS), déchargement et génération.
MODEL_PARAMS = {**{key: int for key in LOAD_PARAMS}, 'ttl': float, 'temperature': float, 'max_tokens': int}

# Bibliothèque de départ : l'utilisateur choisit ensuite le modèle de chaque agent.
DEFAULT_AGENTS = [
    ('Gardien', Agent.Role.ORCHESTRATOR, "Lit chaque node écrit et répond dans l'univers : place, relie, délègue, archive."),
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
    return {'id': str(m.id), 'repo': m.repo, 'filename': m.filename, 'label': m.label, 'kind': m.kind,
            'capabilities': m.capabilities, 'quant': m.quant, 'size': m.size, 'downloaded': m.downloaded,
            'status': m.status, 'error': m.error, 'params': m.params, 'loaded': engine.loaded == m.id,
            'stats': stats if engine.loaded == m.id else None, **hub.download_state(m),
            'agents': [a.name for a in m.agents.all() if a.owner_id == user.pk]}


def agent_to_dict(a):
    return {'id': str(a.id), 'name': a.name, 'role': a.role, 'description': a.description,
            'model': str(a.model_id) if a.model_id else None, 'system_prompt': a.system_prompt,
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
                         'machine': hub.machine(), 'models_dir': str(settings.MODELS_DIR)})


@api('GET')
def system(request, body):
    """Moniteur du serveur : CPU, RAM, GPU, disque, modèle en mémoire, file du broker."""
    loaded = LocalModel.objects.filter(id=engine.loaded).first() if engine.loaded else None
    return JsonResponse({**monitor.snapshot(), 'broker': broker.state(), 'engine': engine.available(),
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
        params = body['params'] or {}
        unknown = set(params) - set(MODEL_PARAMS)
        if unknown:
            raise ChangeError(f'réglage inconnu : {", ".join(sorted(unknown))}')
        model.params = {key: _number(value, MODEL_PARAMS[key], key) for key, value in params.items() if value not in ('', None)}
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
    if agent.role not in Agent.Role.values:
        raise ChangeError('rôle inconnu')
    agent.save()
    return JsonResponse(agent_to_dict(agent))


async def command(request):
    """Demande au Gardien, réponse en flux SSE : start, text, action, notice, agent, agent_text, error, end.

    Le corps porte la demande et le contexte de la page Nodz (nodes, liens, dimensions, sélection) ;
    les événements `action` sont exécutés par la page avec les fonctions de Nodz.

    L'inférence tourne dans un thread : sous Daphne, les vues synchrones partagent un seul thread
    et une génération sur CPU bloquerait toutes les autres requêtes.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'méthode non autorisée'}, status=405)
    user = await request.auser()
    if not user.is_authenticated:
        return JsonResponse({'error': 'authentification requise'}, status=401)
    try:
        body = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON invalide'}, status=400)
    if not isinstance(body, dict) or not isinstance(body.get('context'), dict):
        return JsonResponse({'error': 'contexte de la page requis'}, status=400)
    prompt = str(body.get('prompt', '')).strip()
    if not prompt:
        return JsonResponse({'error': 'prompt requis'}, status=400)

    events = queue.Queue()

    def work():
        try:
            Guardian(user, engine, lambda kind, data: events.put((kind, data))).handle(prompt, body['context'])
        except (PlanError, EngineUnavailable, BrokerTimeout) as e:
            events.put(('error', {'message': str(e)}))
        except Exception:
            logger.exception('Gardien')
            events.put(('error', {'message': 'erreur interne du Gardien'}))
        finally:
            connection.close()
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    async def stream():
        while (item := await asyncio.to_thread(events.get)) is not None:
            yield f'event: {item[0]}\ndata: {json.dumps(item[1])}\n\n'
        yield 'event: end\ndata: {}\n\n'

    return StreamingHttpResponse(stream(), content_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
