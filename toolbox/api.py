"""API /api/v1/toolbox : bibliothèque de modèles (Hugging Face), bibliothèque d'agents, Gardien."""

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

from . import hub
from .broker import BrokerTimeout
from .engine import EngineUnavailable
from .guardian import Guardian, PlanError
from .models import Agent, LocalModel
from .runtime import broker, engine

logger = logging.getLogger(__name__)

MODEL_FIELDS = ('kind', 'capabilities', 'params')
AGENT_FIELDS = ('name', 'role', 'description', 'system_prompt', 'tools_allowed', 'params', 'enabled')

# Bibliothèque de départ : l'utilisateur choisit ensuite le modèle de chaque agent.
DEFAULT_AGENTS = [
    ('Gardien', Agent.Role.ORCHESTRATOR, "Orchestre l'univers : place, délègue, archive et nettoie les nodes."),
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


def model_to_dict(m):
    hub.refresh_progress(m)
    return {'id': str(m.id), 'repo': m.repo, 'filename': m.filename, 'kind': m.kind, 'capabilities': m.capabilities,
            'quant': m.quant, 'size': m.size, 'status': m.status, 'progress': round(m.progress, 3), 'error': m.error,
            'params': m.params, 'loaded': engine.loaded == m.id}


def agent_to_dict(a):
    return {'id': str(a.id), 'name': a.name, 'role': a.role, 'description': a.description,
            'model': str(a.model_id) if a.model_id else None, 'system_prompt': a.system_prompt,
            'tools_allowed': a.tools_allowed, 'params': a.params, 'enabled': a.enabled}


@api('GET')
def status(request, body):
    return JsonResponse({'engine': engine.available(), 'staff': request.user.is_staff,
                         'loaded': str(engine.loaded) if engine.loaded else None,
                         'broker': broker.state(), 'models_dir': str(settings.MODELS_DIR)})


@api('GET')
def hub_search(request, body):
    q = request.GET
    return JsonResponse({'models': hub_call(hub.search, q.get('q', ''), q.get('sort', 'downloads'),
                                            min(int(q.get('limit', 30)), 100), q.get('pipeline', ''))})


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
        return JsonResponse({'models': [model_to_dict(m) for m in LocalModel.objects.all()]})
    staff_only(request)
    repo, filename = body.get('repo', ''), body.get('filename', '')
    if repo.count('/') != 1 or not filename.lower().endswith('.gguf') or '..' in filename:
        raise ChangeError('repo (organisation/dépôt) et filename (.gguf) requis')
    kind = body.get('kind', LocalModel.Kind.TEXT)
    if kind not in LocalModel.Kind.values:
        raise ChangeError(f'type {kind!r} inconnu')
    model = hub.start_download(repo, filename, body.get('size', 0), kind, body.get('capabilities', []))
    return JsonResponse(model_to_dict(model), status=202)


@api('PATCH', 'DELETE')
def model_detail(request, body, model_id):
    staff_only(request)
    model = LocalModel.objects.filter(id=model_id).first()
    if model is None:
        return JsonResponse({'error': 'modèle introuvable'}, status=404)
    if request.method == 'DELETE':
        if engine.loaded == model.id:
            engine.unload()
        if model.path and Path(model.path).is_relative_to(Path(settings.MODELS_DIR)):
            Path(model.path).unlink(missing_ok=True)
        model.delete()
        return JsonResponse({'deleted': str(model_id)})
    for field in MODEL_FIELDS:
        if field in body:
            setattr(model, field, body[field])
    if model.kind not in LocalModel.Kind.values:
        raise ChangeError('type inconnu')
    model.save()
    return JsonResponse(model_to_dict(model))


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
