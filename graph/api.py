"""API JSON v1 : /api/v1/... (session Django, jeton CSRF dans l'en-tête X-CSRFToken)."""

import json
from functools import wraps

from django.db.models import Q
from django.http import JsonResponse

from .models import AIRun, Edge, Layer, Node, NodeRevision
from .services import ChangeError, Conflict, apply_changes, edge_to_dict, layer_to_dict, node_to_dict


def api(*methods):
    """Méthodes autorisées, authentification, corps JSON, erreurs du service en JSON."""

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if request.method not in methods:
                return JsonResponse({'error': 'méthode non autorisée'}, status=405)
            if not request.user.is_authenticated:
                return JsonResponse({'error': 'authentification requise'}, status=401)
            body = None
            if request.method in ('POST', 'PATCH'):
                try:
                    body = json.loads(request.body or b'{}')
                except json.JSONDecodeError:
                    return JsonResponse({'error': 'JSON invalide'}, status=400)
            try:
                return view(request, body, *args, **kwargs)
            except Conflict as e:
                return JsonResponse({'error': str(e), 'current': e.current}, status=e.status)
            except ChangeError as e:
                return JsonResponse({'error': str(e)}, status=e.status)

        return wrapper

    return decorator


@api('GET')
def layers(request, body):
    items = Layer.objects.filter(owner=request.user).exclude(kind=Layer.Kind.ARCHIVE)
    return JsonResponse({'layers': [layer_to_dict(layer) for layer in items]})


@api('GET')
def layer_graph(request, body, layer_id):
    """Nodes vivants d'un plan, leurs arêtes, et l'autre extrémité de chaque portail."""
    layer = Layer.objects.filter(id=layer_id, owner=request.user).first()
    if layer is None:
        return JsonResponse({'error': 'plan introuvable'}, status=404)
    nodes = list(layer.nodes.exclude(status=Node.Status.ARCHIVED))
    ids = [n.id for n in nodes]
    edges = list(Edge.objects.filter(Q(source_id__in=ids) | Q(target_id__in=ids)))
    far_ids = {e.source_id for e in edges} | {e.target_id for e in edges}
    far = Node.objects.filter(id__in=far_ids - set(ids)).values('id', 'layer_id')
    return JsonResponse({
        'layer': layer_to_dict(layer),
        'nodes': [node_to_dict(n) for n in nodes],
        'edges': [edge_to_dict(e) for e in edges],
        'portal_ends': [{'id': str(n['id']), 'layer': str(n['layer_id'])} for n in far],
    })


@api('POST')
def changes(request, body):
    return JsonResponse(apply_changes(request.user, body))


@api('GET')
def node_revisions(request, body, node_id):
    if not Node.objects.filter(id=node_id, layer__owner=request.user).exists():
        return JsonResponse({'error': 'node introuvable'}, status=404)
    revisions = NodeRevision.objects.filter(node_id=node_id)
    return JsonResponse({'revisions': [
        {'version': r.version, 'snapshot': r.snapshot, 'reason': r.reason, 'ai_run': str(r.ai_run_id) if r.ai_run_id else None,
         'created_at': r.created_at.isoformat()}
        for r in revisions
    ]})


RUN_FIELDS = ('status', 'tokens_in', 'tokens_out', 'duration_ms', 'error')


def run_to_dict(run):
    return {
        'id': str(run.id), 'model_id': run.model_id, 'mode': run.mode, 'prompt': run.prompt,
        'prompt_node': str(run.prompt_node_id) if run.prompt_node_id else None,
        'context_node_ids': run.context_node_ids, 'params': run.params, 'status': run.status,
        'tokens_in': run.tokens_in, 'tokens_out': run.tokens_out, 'duration_ms': run.duration_ms,
        'error': run.error, 'created_at': run.created_at.isoformat(),
    }


@api('GET', 'POST')
def runs(request, body):
    if request.method == 'GET':
        return JsonResponse({'runs': [run_to_dict(r) for r in AIRun.objects.filter(owner=request.user)[:50]]})
    if body.get('mode') not in AIRun.Mode.values or not body.get('model_id'):
        raise ChangeError('mode et model_id requis')
    prompt_node = None
    if body.get('prompt_node'):
        prompt_node = Node.objects.filter(id=body['prompt_node'], layer__owner=request.user).first()
        if prompt_node is None:
            return JsonResponse({'error': 'node introuvable'}, status=404)
    run = AIRun.objects.create(
        owner=request.user, model_id=body['model_id'], mode=body['mode'], prompt=body.get('prompt', ''),
        prompt_node=prompt_node, context_node_ids=body.get('context_node_ids', []), params=body.get('params', {}),
    )
    return JsonResponse(run_to_dict(run), status=201)


@api('GET', 'PATCH')
def run_detail(request, body, run_id):
    run = AIRun.objects.filter(id=run_id, owner=request.user).first()
    if run is None:
        return JsonResponse({'error': 'run introuvable'}, status=404)
    if request.method == 'PATCH':
        for field in RUN_FIELDS:
            if field in body:
                setattr(run, field, body[field])
        if run.status not in AIRun.Status.values:
            raise ChangeError('statut inconnu')
        run.save()
    return JsonResponse(run_to_dict(run))
