"""Migration des données v1 (nodzapp) vers le graphe v2, idempotente.

Chaque objet v2 garde la trace de sa source dans `legacy_ref` (`v1:<user>:<id>`) : relancer la
migration met à jour ce qui a changé côté v1 sans jamais dupliquer. Rien n'est supprimé côté v1.

Correspondances :
- plan v1 `layer_id` (1, 2, …) → index v2 `layer_id - 1` (Home = 0) ; nom conservé ;
- coordonnées : v1 stocke y vers le haut (affiché à -y) ; v2 suit SVG, y vers le bas → y = -y_v1 ;
- contenu : chaque état non vide est gardé dans `payload` (text, image, file, drawing : les opérations
  de dessin v1 telles quelles) ; les états sans équivalent v2 (rappel, likes, dessin illisible) sont
  conservés dans `payload.legacy` ;
- Link et `siblings` → arêtes `link` dédupliquées ; `quantum` → arêtes `portal` ;
- node v1 archivé → status `archived`.
"""

import json
import mimetypes

from django.db import transaction

from nodzapp import models as v1

from .models import AuditLog, Edge, Layer, Node, NodeRevision, Origin, StoredFile
from .services import node_to_dict

DEFAULT_RADIUS = 62.5
V2_TYPES = {'text': 'text', 'image': 'image', 'file': 'file', 'canvas': 'drawing'}


def _ref(user, key):
    return f'v1:{user.pk}:{key}'


def _node_key(dom_id):
    """'N-12' → 12 ; None si l'identifiant est illisible."""
    try:
        return int(str(dom_id).split('-')[-1])
    except (TypeError, ValueError):
        return None


def _json_list(text):
    try:
        value = json.loads(text or '[]')
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def _payload(old):
    payload = {}
    if old.text_content:
        payload['text'] = {'html': old.text_content}
    if old.file:
        payload['file'] = {'name': old.file_name or '', 'preview': old.preview.name if old.preview else ''}
    legacy = {}
    if old.type not in V2_TYPES:
        legacy['type'] = old.type
    if old.canvas_content and old.canvas_content != '[]':
        ops = _json_list(old.canvas_content)
        if ops:
            payload['drawing'] = {'ops': ops}
        else:
            legacy['canvas'] = old.canvas_content
    if old.notification:
        legacy['notification'] = old.notification
    if old.likes:
        legacy['likes'] = old.likes
    if legacy:
        payload['legacy'] = legacy
    return payload


class Migrator:
    def __init__(self, user):
        self.user = user
        self.stats = {'layers': 0, 'nodes': 0, 'edges': 0, 'updated': 0}
        self.layers = {}  # layer_id v1 → Layer v2
        self.nodes = {}  # node_id v1 → Node v2

    def audit(self, entity, obj, diff):
        AuditLog.objects.create(actor=None, action='import', entity=entity, entity_id=str(obj.pk), diff=diff)

    def free_index(self, wanted):
        taken = set(Layer.objects.filter(owner=self.user).values_list('index', flat=True))
        while wanted in taken:
            wanted += 1
        return wanted

    def migrate_layers(self):
        for old in v1.Layer.objects.filter(user=self.user).order_by('layer_id'):
            ref = _ref(self.user, f'layer:{old.layer_id}')
            layer = Layer.objects.filter(owner=self.user, legacy_ref=ref).first()
            if layer is None:
                layer = Layer.objects.create(
                    owner=self.user, name=old.layer_name, index=self.free_index(old.layer_id - 1), legacy_ref=ref
                )
                self.audit('layer', layer, {'from': ref})
                self.stats['layers'] += 1
            elif layer.name != old.layer_name:
                layer.name = old.layer_name
                layer.save(update_fields=['name', 'updated_at'])
                self.stats['updated'] += 1
            self.layers[old.layer_id] = layer

    def stored_file(self, field, name='', text=''):
        """Fichier v1 (image ou document) repris tel quel en StoredFile, servi par /api/v1/files."""
        if not field:
            return None
        existing = StoredFile.objects.filter(owner=self.user, file=field.name).first()
        name = name or field.name.rsplit('/', 1)[-1]
        return existing or StoredFile.objects.create(
            owner=self.user, file=field.name, name=name, mime=mimetypes.guess_type(name)[0] or '', extracted_text=text or '',
        )

    def payload(self, old):
        payload = _payload(old)
        image = self.stored_file(old.image_content)
        if image:
            payload['image'] = {'file': str(image.id), 'name': image.name}
        return payload

    def migrate_nodes(self):
        for old in v1.Node.objects.filter(user=self.user).select_related('layer'):
            values = {
                'layer': self.layers[old.layer.layer_id],
                'x': old.x_coordinate,
                'y': -old.y_coordinate,
                'radius': old.radius if old.radius > 0 else DEFAULT_RADIUS,
                'shape': old.shape if old.shape in Node.Shape.values else Node.Shape.CIRCLE,
                'color': old.color,
                'lock': old.lock,
                'content_type': V2_TYPES.get(old.type, 'text'),
                'payload': self.payload(old),
                'file': self.stored_file(old.file, old.file_name, old.file_text_content),
                'status': Node.Status.ARCHIVED if old.archive else Node.Status.ACCEPTED,
            }
            ref = _ref(self.user, f'node:{old.node_id}')
            node = Node.objects.filter(legacy_ref=ref, layer__owner=self.user).first()
            if node is None:
                node = Node.objects.create(origin=Origin.IMPORT, author=self.user, legacy_ref=ref, **values)
                self.revise(node)
                self.audit('node', node, {'from': ref})
                self.stats['nodes'] += 1
            else:
                changed = {k: v for k, v in values.items() if getattr(node, k) != v}
                if changed:
                    for k, v in changed.items():
                        setattr(node, k, v)
                    node.version += 1
                    node.save()
                    self.revise(node)
                    self.stats['updated'] += 1
            self.nodes[old.node_id] = node

    def revise(self, node):
        NodeRevision.objects.create(node=node, version=node.version, snapshot=node_to_dict(node), reason='import')

    def edge(self, a, b, kind):
        if a is None or b is None or a.pk == b.pk:
            return
        if kind == Edge.Kind.LINK:
            if a.layer_id != b.layer_id:
                kind = Edge.Kind.PORTAL
            elif Edge.objects.filter(source=b, target=a, kind=kind).exists():
                return
        if kind == Edge.Kind.PORTAL and a.layer_id == b.layer_id:
            return
        edge, created = Edge.objects.get_or_create(source=a, target=b, kind=kind, defaults={'origin': Origin.IMPORT})
        if created:
            self.audit('edge', edge, {'source': str(a.pk), 'target': str(b.pk), 'kind': kind})
            self.stats['edges'] += 1

    def migrate_edges(self):
        node = lambda dom_id: self.nodes.get(_node_key(dom_id))  # noqa: E731
        for link in v1.Link.objects.filter(user=self.user, archive=False):
            self.edge(node(link.linkA), node(link.linkB), Edge.Kind.LINK)
        for old in v1.Node.objects.filter(user=self.user, archive=False):
            source = self.nodes.get(old.node_id)
            for sibling in _json_list(old.siblings):
                self.edge(source, node(sibling), Edge.Kind.LINK)
            for portal in _json_list(old.quantum):
                if isinstance(portal, dict):
                    self.edge(source, node(portal.get('node')), Edge.Kind.PORTAL)

    def run(self):
        with transaction.atomic():
            self.migrate_layers()
            self.migrate_nodes()
            self.migrate_edges()
        return self.stats


def migrate_user(user):
    return Migrator(user).run()
