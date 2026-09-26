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
