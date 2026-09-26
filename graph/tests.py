import json
import uuid

from django.test import Client, TestCase

from nodzapp.models import NodzUser

from .models import AIRun, AuditLog, Edge, Node, NodeRevision


def uid():
    return str(uuid.uuid4())


class ApiV1Tests(TestCase):
    def setUp(self):
        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        self.other = NodzUser.objects.create_user(email='b@nodz.local', password='pw-123456')
        self.client.force_login(self.user)

    def post(self, body, client=None):
        return (client or self.client).post('/api/v1/changes', json.dumps(body), content_type='application/json')

    def seed(self):
        """Deux plans, deux nodes sur le premier reliés, un troisième node sur le second."""
        ids = {k: uid() for k in ('l1', 'l2', 'a', 'b', 'c', 'ab')}
        r = self.post({
            'layers': {'upsert': [{'id': ids['l1'], 'name': 'Home', 'index': 0}, {'id': ids['l2'], 'name': 'Dim', 'index': 1}]},
            'nodes': {'upsert': [
                {'id': ids['a'], 'layer': ids['l1'], 'x': 0, 'y': 0, 'payload': {'text': {'html': 'A'}}},
                {'id': ids['b'], 'layer': ids['l1'], 'x': 100, 'y': 0},
                {'id': ids['c'], 'layer': ids['l2'], 'x': 0, 'y': 0},
            ]},
            'edges': {'upsert': [{'id': ids['ab'], 'source': ids['a'], 'target': ids['b'], 'kind': 'link'}]},
        })
        self.assertEqual(r.status_code, 200, r.content)
        return ids

    def test_requires_authentication(self):
        self.assertEqual(Client().get('/api/v1/layers').status_code, 401)

    def test_batch_creates_everything_with_revisions_and_audit(self):
        ids = self.seed()
        self.assertEqual(Node.objects.count(), 3)
        self.assertEqual(NodeRevision.objects.filter(node_id=ids['a'], version=1, reason='create').count(), 1)
        self.assertEqual(AuditLog.objects.filter(action='create').count(), 6)
        a = Node.objects.get(id=ids['a'])
        self.assertEqual((a.origin, a.status, a.author), ('human', 'accepted', self.user))

    def test_partial_update_bumps_version_and_detects_conflicts(self):
        ids = self.seed()
        r = self.post({'nodes': {'upsert': [{'id': ids['a'], 'x': 50, 'version': 1}]}})
        self.assertEqual(r.json()['nodes'][0]['version'], 2)
        a = Node.objects.get(id=ids['a'])
        self.assertEqual((a.x, a.payload), (50, {'text': {'html': 'A'}}))
        audit = AuditLog.objects.filter(entity_id=ids['a'], action='update').get()
        self.assertEqual(audit.diff['x'], [0, 50])
        stale = self.post({'nodes': {'upsert': [{'id': ids['a'], 'x': 70, 'version': 1}]}})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['current']['x'], 50)

    def test_batch_is_atomic(self):
        ids = self.seed()
        r = self.post({'nodes': {'upsert': [
            {'id': ids['a'], 'x': 999},
            {'id': uid(), 'layer': ids['l1'], 'shape': 'hexagon'},
        ]}})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Node.objects.get(id=ids['a']).x, 0)

    def test_other_users_data_is_invisible(self):
        ids = self.seed()
        other = Client()
        other.force_login(self.other)
        self.assertEqual(self.post({'nodes': {'upsert': [{'id': ids['a'], 'x': 1}]}}, other).status_code, 404)
        self.assertEqual(other.get(f'/api/v1/layers/{ids["l1"]}/graph').status_code, 404)
        self.assertEqual(other.get('/api/v1/layers').json(), {'layers': []})

    def test_portal_rules(self):
        ids = self.seed()
        cross_link = self.post({'edges': {'upsert': [{'id': uid(), 'source': ids['a'], 'target': ids['c'], 'kind': 'link'}]}})
        self.assertEqual(cross_link.status_code, 400)
        same_portal = self.post({'edges': {'upsert': [{'id': uid(), 'source': ids['a'], 'target': ids['b'], 'kind': 'portal'}]}})
        self.assertEqual(same_portal.status_code, 400)
        portal = self.post({'edges': {'upsert': [{'id': uid(), 'source': ids['a'], 'target': ids['c'], 'kind': 'portal'}]}})
        self.assertEqual(portal.status_code, 200)
        graph = self.client.get(f'/api/v1/layers/{ids["l1"]}/graph').json()
        self.assertEqual(graph['portal_ends'], [{'id': ids['c'], 'layer': ids['l2']}])

    def test_delete_archives_node_and_removes_its_edges(self):
        ids = self.seed()
        self.assertEqual(self.post({'nodes': {'delete': [ids['a']]}}).status_code, 200)
        a = Node.objects.get(id=ids['a'])
        self.assertEqual((a.status, a.version), ('archived', 2))
        self.assertFalse(Edge.objects.exists())
        self.assertEqual(NodeRevision.objects.filter(node=a).count(), 2)
        graph = self.client.get(f'/api/v1/layers/{ids["l1"]}/graph').json()
        self.assertEqual([n['id'] for n in graph['nodes']], [ids['b']])

    def test_ai_run_nodes_are_drafts(self):
        ids = self.seed()
        run = self.client.post('/api/v1/runs', json.dumps({'mode': 'command', 'model_id': 'local', 'prompt': 'relie'}),
                               content_type='application/json').json()
        node_id = uid()
        self.post({'ai_run': run['id'], 'nodes': {'upsert': [{'id': node_id, 'layer': ids['l1']}]}})
        node = Node.objects.get(id=node_id)
        self.assertEqual((node.origin, node.status, str(node.ai_run_id)), ('ai', 'draft', run['id']))
        done = self.client.patch(f'/api/v1/runs/{run["id"]}', json.dumps({'status': 'done', 'tokens_out': 42}),
                                 content_type='application/json').json()
        self.assertEqual((done['status'], done['tokens_out']), ('done', 42))
        self.assertEqual(AIRun.objects.get().tokens_out, 42)

    def test_duplicate_layer_index_is_a_clean_error(self):
        self.seed()
        r = self.post({'layers': {'upsert': [{'id': uid(), 'index': 0}]}})
        self.assertEqual(r.status_code, 400)

    def test_revisions_endpoint(self):
        ids = self.seed()
        self.post({'nodes': {'upsert': [{'id': ids['a'], 'color': '#FF0000'}]}})
        revisions = self.client.get(f'/api/v1/nodes/{ids["a"]}/revisions').json()['revisions']
        self.assertEqual([r['version'] for r in revisions], [1, 2])
        self.assertEqual(revisions[1]['snapshot']['color'], '#FF0000')

    def test_csrf_is_enforced(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(self.post({}, client).status_code, 403)


class LegacyMigrationTests(TestCase):
    """Migration v1 → v2 sur une base v1 générée (jamais sur une base de production)."""

    def setUp(self):
        from nodzapp import models as v1

        self.v1 = v1
        self.user = NodzUser.objects.create_user(email='legacy@nodz.local', password='pw-123456')
        home = v1.Layer.objects.create(user=self.user, layer_id=1, layer_name='Home')
        dim = v1.Layer.objects.create(user=self.user, layer_id=2, layer_name='Dim-2')

        def node(node_id, layer, **kw):
            return v1.Node.objects.create(user=self.user, node_id=node_id, layer=layer, **kw)

        node(1, home, x_coordinate=10, y_coordinate=20, radius=80, text_content='<b>A</b>', siblings='["N-2"]',
             quantum='[{"node": "N-4", "layer": "2"}]')
        node(2, home, type='image', image_content='uploads/1/1/cat.png', text_content='chat', siblings='["N-1"]')
        node(3, home, type='canvas', canvas_content='[{"x": 1}]', shape='weird', notification='2026-10-01')
        node(4, dim, type='file', file='uploads/1/2/doc.pdf', file_name='doc.pdf', file_text_content='contrat')
        node(5, home, archive=True, text_content='old')
        v1.Link.objects.create(user=self.user, link_id=1, linkA='N-1', linkB='N-2', layer=home)
        v1.Link.objects.create(user=self.user, link_id=2, linkA='N-1', linkB='N-99', layer=home)

    def migrate(self):
        from django.core.management import call_command
        from io import StringIO

        out = StringIO()
        call_command('migrate_v1_to_v2', '--user', 'legacy@nodz.local', stdout=out)
        return out.getvalue()

    def v2(self, node_id):
        return Node.objects.get(legacy_ref=f'v1:{self.user.pk}:node:{node_id}')

    def test_structure_and_content(self):
        self.assertIn('2 plans, 5 nodes, 2 arêtes', self.migrate())
        from .models import Layer

        self.assertEqual(list(Layer.objects.values_list('name', 'index')), [('Home', 0), ('Dim-2', 1)])
        a = self.v2(1)
        self.assertEqual((a.x, a.y, a.radius, a.origin, a.content_type), (10, -20, 80, 'import', 'text'))
        self.assertEqual(a.payload, {'text': {'html': '<b>A</b>'}})
        self.assertEqual(self.v2(2).payload, {'text': {'html': 'chat'}, 'image': {'path': 'uploads/1/1/cat.png'}})
        c = self.v2(3)
        self.assertEqual((c.content_type, c.shape, c.radius), ('text', 'circle', 62.5))
        self.assertEqual(c.payload['legacy'], {'type': 'canvas', 'canvas': '[{"x": 1}]', 'notification': '2026-10-01'})
        d = self.v2(4)
        self.assertEqual((d.content_type, d.file.name, d.file.extracted_text), ('file', 'doc.pdf', 'contrat'))
        self.assertEqual(self.v2(5).status, 'archived')
        self.assertEqual(NodeRevision.objects.filter(reason='import').count(), 5)

    def test_edges_are_deduplicated_and_portals_cross_layers(self):
        self.migrate()
        links = Edge.objects.filter(kind='link')
        self.assertEqual(links.count(), 1)  # Link 1 et siblings 1↔2 : une seule arête ; N-99 inconnu ignoré
        portal = Edge.objects.get(kind='portal')
        self.assertEqual((portal.source, portal.target), (self.v2(1), self.v2(4)))

    def test_idempotent_and_syncs_changes(self):
        self.migrate()
        counts = (Node.objects.count(), Edge.objects.count(), NodeRevision.objects.count(), AuditLog.objects.count())
        self.assertIn('0 plans, 0 nodes, 0 arêtes créés ; 0 mis à jour', self.migrate())
        self.assertEqual(counts, (Node.objects.count(), Edge.objects.count(), NodeRevision.objects.count(), AuditLog.objects.count()))
        self.v1.Node.objects.filter(user=self.user, node_id=1).update(color='#FF0000')
        self.assertIn('1 mis à jour', self.migrate())
        a = self.v2(1)
        self.assertEqual((a.color, a.version), ('#FF0000', 2))

    def test_migrated_graph_is_served_by_the_api(self):
        self.migrate()
        self.client.force_login(self.user)
        home = self.client.get('/api/v1/layers').json()['layers'][0]
        graph = self.client.get(f'/api/v1/layers/{home["id"]}/graph').json()
        self.assertEqual(len(graph['nodes']), 3)  # le node archivé n'est pas servi
        self.assertEqual(len(graph['edges']), 2)
        self.assertEqual(len(graph['portal_ends']), 1)
