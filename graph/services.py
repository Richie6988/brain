"""Écriture du graphe : un lot de changements appliqué dans une transaction.

Format d'un lot (les identifiants sont des UUID générés par le client) :

    {
      "ai_run": null | "<uuid>",
      "layers": {"upsert": [{id, name, index, kind}], "delete": [id]},
      "nodes":  {"upsert": [{id, layer, x, y, radius, shape, color, lock, content_type,
                             payload, status, version?}], "delete": [id]},
      "edges":  {"upsert": [{id, source, target, kind}], "delete": [id]}
    }

Un upsert de node peut être partiel : seuls les champs présents sont modifiés. `version`, s'il est
fourni, doit égaler la version courante (sinon conflit). Supprimer un node ou un plan l'archive ;
supprimer un node supprime ses arêtes. Chaque écriture de node crée une `NodeRevision`, chaque
écriture une entrée d'`AuditLog`.
"""

import uuid

from django.db import IntegrityError, transaction
from django.db.models import Q

from .models import AIRun, AuditLog, Edge, Layer, Node, NodeRevision, Origin

NODE_FIELDS = ('x', 'y', 'radius', 'shape', 'color', 'lock', 'content_type', 'payload', 'status')
LAYER_FIELDS = ('name', 'index', 'kind')


class ChangeError(Exception):
    """Lot invalide : rien n'est appliqué."""

    status = 400


class NotFound(ChangeError):
    status = 404


class Conflict(ChangeError):
    status = 409

    def __init__(self, message, current):
        super().__init__(message)
        self.current = current


def layer_to_dict(layer):
    return {'id': str(layer.id), 'name': layer.name, 'index': layer.index, 'kind': layer.kind}


def node_to_dict(node):
    return {
        'id': str(node.id),
        'layer': str(node.layer_id),
        'x': node.x,
        'y': node.y,
        'radius': node.radius,
        'shape': node.shape,
        'color': node.color,
        'lock': node.lock,
        'content_type': node.content_type,
        'payload': node.payload,
        'file': str(node.file_id) if node.file_id else None,
        'status': node.status,
        'version': node.version,
        'origin': node.origin,
        'ai_run': str(node.ai_run_id) if node.ai_run_id else None,
    }


def edge_to_dict(edge):
    return {'id': str(edge.id), 'source': str(edge.source_id), 'target': str(edge.target_id), 'kind': edge.kind}


def _uuid(value, what):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        raise ChangeError(f'{what} : identifiant invalide ({value!r})') from None


def _validate(instance):
    from django.core.exceptions import ValidationError

    try:
        instance.full_clean(exclude=['owner', 'layer', 'author', 'ai_run', 'file', 'source', 'target'])
    except ValidationError as e:
        raise ChangeError(f'{type(instance).__name__} {instance.pk} : {e.message_dict}') from None


class ChangeSet:
    def __init__(self, user, ai_run=None):
        self.user = user
        self.ai_run = ai_run
        self.result = {'layers': [], 'nodes': [], 'edges': [], 'deleted': {'layers': [], 'nodes': [], 'edges': []}}

    def audit(self, action, entity, entity_id, diff):
        AuditLog.objects.create(
            actor=self.user, ai_run=self.ai_run, action=action, entity=entity, entity_id=str(entity_id), diff=diff
        )

    # --- accès avec contrôle de propriété (un objet d'un autre utilisateur est « introuvable »)

    def layer(self, layer_id):
        try:
            return Layer.objects.get(id=_uuid(layer_id, 'plan'), owner=self.user)
        except Layer.DoesNotExist:
            raise NotFound(f'plan {layer_id} introuvable') from None

    def node(self, node_id):
        try:
            return Node.objects.select_related('layer').get(id=_uuid(node_id, 'node'), layer__owner=self.user)
        except Node.DoesNotExist:
            raise NotFound(f'node {node_id} introuvable') from None

    # --- plans

    def upsert_layer(self, data):
        layer_id = _uuid(data.get('id'), 'plan')
        layer = Layer.objects.filter(id=layer_id).first()
        if layer is not None and layer.owner_id != self.user.pk:
            raise NotFound(f'plan {layer_id} introuvable')
        created = layer is None
        if created:
            layer = Layer(id=layer_id, owner=self.user)
        before = layer_to_dict(layer)
        for field in LAYER_FIELDS:
            if field in data:
                setattr(layer, field, data[field])
        _validate(layer)
        layer.save()
        after = layer_to_dict(layer)
        self.audit('create' if created else 'update', 'layer', layer.id, _diff(before, after, created))
        self.result['layers'].append(after)

    def delete_layer(self, layer_id):
        layer = self.layer(layer_id)
        layer.kind = Layer.Kind.ARCHIVE
        layer.save(update_fields=['kind', 'updated_at'])
        self.audit('archive', 'layer', layer.id, {})
        self.result['deleted']['layers'].append(str(layer.id))

    # --- nodes

    def revise(self, node, reason):
        NodeRevision.objects.create(
            node=node, version=node.version, snapshot=node_to_dict(node), actor=self.user, ai_run=self.ai_run, reason=reason
        )

    def upsert_node(self, data):
        node_id = _uuid(data.get('id'), 'node')
        node = Node.objects.select_related('layer').filter(id=node_id).first()
        if node is not None and node.layer.owner_id != self.user.pk:
            raise NotFound(f'node {node_id} introuvable')
        created = node is None
        if created:
            if 'layer' not in data:
                raise ChangeError(f'node {node_id} : plan requis à la création')
            node = Node(
                id=node_id,
                author=self.user,
                origin=Origin.AI if self.ai_run else Origin.HUMAN,
                ai_run=self.ai_run,
                status=Node.Status.DRAFT if self.ai_run else Node.Status.ACCEPTED,
            )
        elif 'version' in data and data['version'] != node.version:
            raise Conflict(f'node {node_id} : version {data["version"]} périmée', node_to_dict(node))
        before = node_to_dict(node)
        if 'layer' in data:
            node.layer = self.layer(data['layer'])
        for field in NODE_FIELDS:
            if field in data:
                setattr(node, field, data[field])
        if not isinstance(node.payload, dict):
            raise ChangeError(f'node {node_id} : payload doit être un objet')
        if not created:
            node.version += 1
        _validate(node)
        node.save()
        self.revise(node, 'create' if created else 'update')
        after = node_to_dict(node)
        self.audit('create' if created else 'update', 'node', node.id, _diff(before, after, created))
        self.result['nodes'].append(after)

    def delete_node(self, node_id):
        node = self.node(node_id)
        for edge in Edge.objects.filter(Q(source=node) | Q(target=node)):
            self._delete_edge(edge)
        node.status = Node.Status.ARCHIVED
        node.version += 1
        node.save(update_fields=['status', 'version', 'updated_at'])
        self.revise(node, 'archive')
        self.audit('archive', 'node', node.id, {})
        self.result['deleted']['nodes'].append(str(node.id))

    # --- arêtes

    def upsert_edge(self, data):
        edge_id = _uuid(data.get('id'), 'arête')
        source, target = self.node(data.get('source')), self.node(data.get('target'))
        if source.pk == target.pk:
            raise ChangeError(f'arête {edge_id} : un node ne peut pas se lier à lui-même')
        kind = data.get('kind', Edge.Kind.LINK)
        if kind not in Edge.Kind.values:
            raise ChangeError(f'arête {edge_id} : type {kind!r} inconnu')
        crosses = source.layer_id != target.layer_id
        if kind == Edge.Kind.PORTAL and not crosses:
            raise ChangeError(f'arête {edge_id} : un portail relie deux plans différents')
        if kind == Edge.Kind.LINK and crosses:
            raise ChangeError(f'arête {edge_id} : un lien entre deux plans est un portail')
        edge = Edge.objects.filter(id=edge_id).first()
        if edge is not None and edge.source.layer.owner_id != self.user.pk:
            raise NotFound(f'arête {edge_id} introuvable')
        created = edge is None
        before = edge_to_dict(edge) if edge else {}
        if created:
            edge = Edge(id=edge_id, origin=Origin.AI if self.ai_run else Origin.HUMAN)
        edge.source, edge.target, edge.kind = source, target, kind
        edge.save()
        after = edge_to_dict(edge)
        self.audit('create' if created else 'update', 'edge', edge.id, _diff(before, after, created))
        self.result['edges'].append(after)

    def delete_edge(self, edge_id):
        edge = Edge.objects.filter(id=_uuid(edge_id, 'arête'), source__layer__owner=self.user).first()
        if edge is None:
            raise NotFound(f'arête {edge_id} introuvable')
        self._delete_edge(edge)

    def _delete_edge(self, edge):
        self.audit('delete', 'edge', edge.id, edge_to_dict(edge))
        self.result['deleted']['edges'].append(str(edge.id))
        edge.delete()


def _diff(before, after, created):
    if created:
        return after
    return {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}


def apply_changes(user, changes):
    """Applique un lot complet ou rien. Retourne les objets écrits, tels que le serveur les voit."""
    if not isinstance(changes, dict):
        raise ChangeError('le lot doit être un objet JSON')
    ai_run = None
    if changes.get('ai_run'):
        ai_run = AIRun.objects.filter(id=_uuid(changes['ai_run'], 'run'), owner=user).first()
        if ai_run is None:
            raise NotFound('run introuvable')
    try:
        with transaction.atomic():
            return _apply(ChangeSet(user, ai_run), changes)
    except IntegrityError as e:
        raise ChangeError(f'contrainte violée : {e}') from None


def _apply(cs, changes):
    def section(name, op):
        return (changes.get(name) or {}).get(op) or []

    # Ordre imposé par les dépendances : plans, nodes, arêtes ; suppressions en sens inverse.
    for data in section('layers', 'upsert'):
        cs.upsert_layer(data)
    for data in section('nodes', 'upsert'):
        cs.upsert_node(data)
    for data in section('edges', 'upsert'):
        cs.upsert_edge(data)
    for edge_id in section('edges', 'delete'):
        cs.delete_edge(edge_id)
    for node_id in section('nodes', 'delete'):
        cs.delete_node(node_id)
    for layer_id in section('layers', 'delete'):
        cs.delete_layer(layer_id)
    return cs.result
