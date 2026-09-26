import json
import math
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings

from nodzapp.models import NodzUser

from . import api, hub
from .broker import AGENT, BACKGROUND, CHAT, Broker, BrokerTimeout
from .engine import Engine
from .guardian import summary
from .models import Agent, LocalModel


class FakeHfApi:
    def __init__(self, *args, **kwargs):
        self.calls = []

    def list_models(self, **kwargs):
        self.calls.append(kwargs)
        return [
            SimpleNamespace(id='org/Qwen2.5-Coder-7B-Instruct-GGUF', downloads=10, likes=2, pipeline_tag='text-generation',
                            tags=['gguf', '7B', 'tool-calling']),
            SimpleNamespace(id='org/SmolLM-135M-GGUF', downloads=None, likes=None, pipeline_tag=None, tags=None),
        ]

    def model_info(self, repo, files_metadata=False):
        siblings = [SimpleNamespace(rfilename=name, size=size) for name, size in
                    [('m-Q8_0.gguf', 8), ('m-Q4_K_M.gguf', 4), ('m-Q2_K.gguf', 2), ('README.md', 1)]]
        return SimpleNamespace(siblings=siblings, tags=['instruct'], pipeline_tag='text-generation')


class HubTests(TestCase):
    def test_annotations(self):
        self.assertEqual(hub.detect_quant('Qwen2.5-7B-Instruct-Q4_K_M.gguf'), 'Q4_K_M')
        self.assertEqual(hub.detect_quant('model-IQ3_XS.gguf'), 'IQ3_XS')
        self.assertTrue(hub.is_recommended('x-Q5_K_M.gguf'))
        self.assertFalse(hub.is_recommended('x-Q8_0.gguf'))
        self.assertEqual(hub.role_of('bartowski/Qwen2.5-Coder-7B'), 'code')
        self.assertEqual(hub.role_of('org/Qwen2.5-1.5B-Instruct'), 'small')
        self.assertEqual(hub.size_in_billions(['gguf', '135M']), 0.135)
        self.assertIn('tools', hub.capabilities_of('m', ['function-calling'], ''))

    def test_search_and_files(self):
        fake = FakeHfApi()
        with mock.patch.object(hub, 'api', return_value=fake):
            results = hub.search('qwen', 'trending', 5)
            files = hub.repo_files('org/m')
        self.assertEqual(fake.calls[0]['sort'], 'trending_score')
        self.assertEqual(fake.calls[0]['filter'], 'gguf')
        self.assertEqual(results[0]['role'], 'code')
        self.assertEqual(results[0]['size_b'], 7.0)
        self.assertIn('tools', results[0]['capabilities'])
        self.assertEqual(results[1]['downloads'], 0)
        self.assertEqual([f['name'] for f in files['files']], ['m-Q4_K_M.gguf', 'm-Q8_0.gguf', 'm-Q2_K.gguf'])

    def test_recommendations_without_gpu(self):
        with mock.patch.object(hub, 'gpu_memory_mb', return_value=0):
            rec = hub.recommendations()
        self.assertFalse(rec['gpu'])
        self.assertEqual([m['name'] for m in rec['models']], ['Qwen2.5 1.5B Instruct Q4_K_M'])

    def test_download_success_and_error(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            model = LocalModel.objects.create(repo='org/m', filename='m-Q4_K_M.gguf', size=3)

            def fake_download(repo, filename, local_dir, token):
                path = Path(local_dir) / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'abcd')
                return str(path)

            with mock.patch.object(hub, 'hf_hub_download', fake_download), mock.patch.object(connection, 'close'):
                hub._download(model.pk)
            model.refresh_from_db()
            self.assertEqual((model.status, model.size, model.progress), (LocalModel.Status.READY, 4, 1))

            with mock.patch.object(hub, 'hf_hub_download', side_effect=OSError('disque plein')), \
                    mock.patch.object(connection, 'close'):
                hub._download(model.pk)
            model.refresh_from_db()
            self.assertEqual((model.status, model.error), (LocalModel.Status.ERROR, 'disque plein'))


class BrokerTests(TestCase):
    def test_priority_order(self):
        broker, order = Broker(), []
        holder_in = threading.Event()
        release = threading.Event()

        def hold():
            with broker.slot(BACKGROUND, 'holder'):
                holder_in.set()
                release.wait(5)

        def take(priority, name):
            with broker.slot(priority, name):
                order.append(name)

        threads = [threading.Thread(target=hold)]
        threads[0].start()
        holder_in.wait(5)
        for priority, name in [(BACKGROUND, 'fond'), (AGENT, 'agent'), (CHAT, 'chat')]:
            t = threading.Thread(target=take, args=(priority, name))
            t.start()
            threads.append(t)
            time.sleep(0.05)
        self.assertEqual(broker.state()['queued'], ['chat', 'agent', 'fond'])
        release.set()
        for t in threads:
            t.join(5)
        self.assertEqual(order, ['chat', 'agent', 'fond'])
        self.assertFalse(broker.state()['busy'])

    def test_timeout_and_expiry(self):
        broker = Broker(max_hold=0.2)
        with broker.slot(CHAT, 'a'):
            with self.assertRaises(BrokerTimeout):
                with broker.slot(CHAT, 'b', timeout=0.05):
                    pass
            self.assertEqual(broker.state()['queued'], [])
            time.sleep(0.25)
            with broker.slot(CHAT, 'c', timeout=1):  # le jeton de « a » a expiré
                self.assertEqual(broker.state()['holder'], 'c')


class FakeLlama:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.calls = []
        FakeLlama.instances.append(self)

    def create_chat_completion(self, messages, stream, **options):
        self.calls.append(options)
        for piece in ['Bon', None, 'jour']:
            yield {'choices': [{'delta': {'content': piece} if piece else {}}]}


class EngineTests(TestCase):
    def setUp(self):
        FakeLlama.instances = []
        self.model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/models/a.gguf',
                                               status=LocalModel.Status.READY, params={'n_ctx': 2048})

    def test_stream_schema_and_reuse(self):
        engine = Engine(Broker(), factory=FakeLlama)
        pieces = []
        text = engine.chat(self.model, [{'role': 'user', 'content': 'salut'}], on_text=pieces.append,
                           json_schema={'type': 'object'}, temperature=0)
        self.assertEqual((text, pieces), ('Bonjour', ['Bon', 'jour']))
        llm = FakeLlama.instances[0]
        self.assertEqual(llm.kwargs['n_ctx'], 2048)
        self.assertEqual(llm.calls[0]['response_format'], {'type': 'json_object', 'schema': {'type': 'object'}})
        self.assertEqual(llm.calls[0]['temperature'], 0)
        engine.chat(self.model, [])
        self.assertEqual(len(FakeLlama.instances), 1)
        self.assertEqual(engine.loaded, self.model.pk)

    def test_switch_model_reloads(self):
        engine = Engine(Broker(), factory=FakeLlama)
        other = LocalModel.objects.create(repo='org/m', filename='b.gguf', path='/models/b.gguf')
        engine.chat(self.model, [])
        engine.chat(other, [])
        self.assertEqual([i.kwargs['model_path'] for i in FakeLlama.instances], ['/models/a.gguf', '/models/b.gguf'])
        self.assertEqual(engine.loaded, other.pk)


class ToolboxApiTests(TestCase):
    def setUp(self):
        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        self.admin = NodzUser.objects.create_user(email='root@nodz.local', password='pw-123456', is_staff=True)
        self.client.force_login(self.user)

    def send(self, method, url, body=None):
        return getattr(self.client, method)(url, json.dumps(body or {}), content_type='application/json')

    def test_status_and_auth(self):
        r = self.client.get('/api/v1/toolbox/status')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['broker']['busy'])
        self.client.logout()
        self.assertEqual(self.client.get('/api/v1/toolbox/status').status_code, 401)

    def test_hub_errors_are_reported(self):
        with mock.patch.object(hub, 'api', side_effect=RuntimeError('hors ligne')):
            r = self.client.get('/api/v1/toolbox/hub/search?q=qwen')
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.client.get('/api/v1/toolbox/hub/files?repo=nope').status_code, 400)

    def test_download_is_staff_only(self):
        body = {'repo': 'org/m', 'filename': 'm-Q4_K_M.gguf', 'size': 10}
        self.assertEqual(self.send('post', '/api/v1/toolbox/models', body).status_code, 403)
        self.client.force_login(self.admin)
        self.assertEqual(self.send('post', '/api/v1/toolbox/models', {**body, 'filename': '../x.gguf'}).status_code, 400)
        with mock.patch.object(hub.threading, 'Thread') as thread:
            r = self.send('post', '/api/v1/toolbox/models', body)
        self.assertEqual(r.status_code, 202, r.content)
        thread.return_value.start.assert_called_once()
        self.assertEqual(r.json()['quant'], 'Q4_K_M')
        self.assertEqual(r.json()['status'], LocalModel.Status.DOWNLOADING)

    def test_delete_model_removes_file(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            path = Path(root) / 'org__m' / 'a.gguf'
            path.parent.mkdir()
            path.write_bytes(b'x')
            model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path=str(path), status=LocalModel.Status.READY)
            url = f'/api/v1/toolbox/models/{model.pk}'
            self.assertEqual(self.client.delete(url).status_code, 403)
            self.client.force_login(self.admin)
            self.assertEqual(self.client.delete(url).status_code, 200)
            self.assertFalse(path.exists())
            self.assertFalse(LocalModel.objects.exists())

    def test_agents_seeded_and_owner_scoped(self):
        r = self.client.get('/api/v1/toolbox/agents')
        names = {a['name']: a for a in r.json()['agents']}
        self.assertEqual(set(names), {'Gardien', 'Rédacteur', 'Codeur', 'Illustrateur'})
        self.assertEqual(names['Gardien']['role'], Agent.Role.ORCHESTRATOR)
        self.client.get('/api/v1/toolbox/agents')
        self.assertEqual(Agent.objects.filter(owner=self.user).count(), 4)

        model = LocalModel.objects.create(repo='org/m', filename='a.gguf')
        url = f"/api/v1/toolbox/agents/{names['Rédacteur']['id']}"
        r = self.send('patch', url, {'model': str(model.pk), 'system_prompt': 'Sois bref.'})
        self.assertEqual((r.status_code, r.json()['model']), (200, str(model.pk)))
        self.assertEqual(self.send('patch', url, {'role': 'pirate'}).status_code, 400)

        self.client.force_login(self.admin)
        self.assertEqual(self.send('patch', url, {'name': 'X'}).status_code, 404)
        self.assertEqual(self.send('post', '/api/v1/toolbox/agents', {'name': 'Traducteur', 'role': 'text'}).status_code, 201)


class ScriptedEngine:
    """Rend les réponses prévues dans l'ordre, en flux d'un seul fragment."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
        self.calls.append({'model': model, 'messages': messages, 'schema': json_schema, **params})
        reply = self.replies.pop(0)
        if on_text:
            on_text(reply)
        return reply


class GuardianTests(TestCase):
    def setUp(self):
        from graph.models import Layer, Node

        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        self.layer = Layer.objects.create(owner=self.user, name='Home')
        self.model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf', status=LocalModel.Status.READY)
        self.client.force_login(self.user)
        self.client.get('/api/v1/toolbox/agents')  # agents de départ
        Agent.objects.filter(owner=self.user).exclude(role=Agent.Role.IMAGE).update(model=self.model)
        self.idea = Node.objects.create(layer=self.layer, x=0, y=0, payload={'text': {'html': 'Voyage au Japon'}})
        self.empty = Node.objects.create(layer=self.layer, x=500, y=0)
        self.events = []

    def run_guardian(self, *replies, selection=()):
        from .guardian import Guardian

        engine = ScriptedEngine(*replies)
        Guardian(self.user, engine, lambda kind, data: self.events.append((kind, data))).handle(
            'organise', str(self.layer.id), [str(i) for i in selection], {'x': 0, 'y': 0})
        return engine

    def kinds(self):
        return [k for k, _ in self.events]

    def test_requires_guardian_model(self):
        from .engine import EngineUnavailable

        Agent.objects.filter(role=Agent.Role.ORCHESTRATOR).update(model=None)
        with self.assertRaises(EngineUnavailable):
            self.run_guardian()

    def test_create_link_update_as_drafts(self):
        from graph.models import AIRun, Edge, Node

        plan = {'say': 'Voilà.', 'actions': [
            {'op': 'create', 'ref': 'new1', 'text': 'Kyoto', 'near': 'n1'},
            {'op': 'create', 'ref': 'new2', 'text': 'Tokyo', 'near': 'n1'},
            {'op': 'link', 'source': 'n1', 'target': 'new1'},
            {'op': 'update', 'ref': 'n1', 'text': 'Japon <3'},
        ]}
        engine = self.run_guardian(json.dumps(plan), selection=[self.idea.id])
        self.assertEqual(engine.calls[0]['schema']['required'], ['say', 'actions'])
        prompt = engine.calls[0]['messages'][1]['content']
        self.assertIn('n1 : Voyage au Japon', prompt)
        self.assertIn('Sélection : n1', prompt)
        self.assertEqual(self.kinds(), ['start', 'text', 'changes'])

        created = Node.objects.filter(origin='ai')
        self.assertEqual(sorted(summary(n) for n in created), ['Kyoto', 'Tokyo'])
        self.assertTrue(all(n.status == Node.Status.DRAFT for n in created))
        points = [(n.x, n.y) for n in Node.objects.all()]
        self.assertTrue(all(math.dist(a, b) >= 2 * 62.5 for i, a in enumerate(points) for b in points[i + 1:]))
        self.assertTrue(Edge.objects.filter(source=self.idea, target__in=created).exists())
        self.idea.refresh_from_db()
        self.assertEqual(self.idea.payload['text']['html'], 'Japon &lt;3')
        run = AIRun.objects.get()
        self.assertEqual((run.status, run.mode), (AIRun.Status.DONE, AIRun.Mode.COMMAND))
        self.assertEqual(created.first().ai_run_id, run.id)

    def test_delegation_publishes_into_nodes(self):
        from graph.models import Node

        plan = {'say': 'Je délègue.', 'actions': [
            {'op': 'delegate', 'agent': 'Rédacteur', 'task': 'Itinéraire 7 jours', 'ref': 'new1', 'near': 'n1'},
            {'op': 'delegate', 'agent': 'Codeur', 'task': 'Convertisseur yen', 'ref': 'n2'},
            {'op': 'delegate', 'agent': 'Illustrateur', 'task': 'Une carte', 'ref': 'new2'},
        ]}
        self.run_guardian(json.dumps(plan), 'Jour 1 : Tokyo\nJour 2 : Kyoto', 'Voici :\n```python\nprint(1)\n```')
        self.assertIn('agent_text', self.kinds())
        self.assertIn("pas encore branchée", json.dumps([d for k, d in self.events if k == 'error'], ensure_ascii=False))
        text_node = Node.objects.get(payload__text__html__startswith='Jour 1')
        self.assertEqual(text_node.payload['text']['html'], 'Jour 1 : Tokyo<br>Jour 2 : Kyoto')
        self.empty.refresh_from_db()
        self.assertEqual(self.empty.content_type, Node.ContentType.CODE)
        self.assertEqual(self.empty.payload['code'], {'language': 'python', 'source': 'print(1)'})

    def test_archive_and_cleanup(self):
        from graph.models import Node

        self.run_guardian(json.dumps({'say': '', 'actions': [{'op': 'cleanup'}]}))
        self.empty.refresh_from_db()
        self.idea.refresh_from_db()
        self.assertEqual((self.empty.status, self.idea.status), (Node.Status.ARCHIVED, Node.Status.ACCEPTED))

    def test_invalid_output_marks_run_failed(self):
        from graph.models import AIRun
        from graph.services import ChangeError

        with self.assertRaises(ChangeError):
            self.run_guardian('pas du json')
        self.assertEqual(AIRun.objects.get().status, AIRun.Status.ERROR)

    def test_invalid_action_is_reported_and_skipped(self):
        from graph.models import Node

        self.run_guardian(json.dumps({'say': '', 'actions': [
            {'op': 'archive', 'ref': 'n99'},
            {'op': 'style', 'ref': 'n1', 'color': 'rouge'},
            {'op': 'create', 'ref': 'new1', 'text': 'ok'},
        ]}))
        errors = [d['message'] for k, d in self.events if k == 'error']
        self.assertEqual(len(errors), 2)
        self.assertIn("'n99'", errors[0])
        self.assertTrue(Node.objects.filter(origin='ai').exists())

    def test_style_type_unlink(self):
        from graph.models import Edge, Node

        Edge.objects.create(source=self.idea, target=self.empty)
        self.run_guardian(json.dumps({'say': '', 'actions': [
            {'op': 'style', 'ref': 'n1', 'color': '#FF6B6B', 'shape': 'square', 'radius': 9000, 'lock': True},
            {'op': 'set_type', 'ref': 'n2', 'content_type': 'code'},
            {'op': 'unlink', 'source': 'n2', 'target': 'n1'},
            {'op': 'create', 'ref': 'new1', 'text': 'Bleu', 'color': '#4D96FF', 'shape': 'none'},
        ]}))
        self.idea.refresh_from_db()
        self.empty.refresh_from_db()
        self.assertEqual((self.idea.color, self.idea.shape, self.idea.radius, self.idea.lock), ('#FF6B6B', 'square', 400.0, True))
        self.assertEqual(self.empty.content_type, Node.ContentType.CODE)
        self.assertFalse(Edge.objects.exists())
        self.assertEqual(Node.objects.get(origin='ai').shape, 'none')

    def test_portal_new_and_existing_layer(self):
        from graph.models import Edge, Layer, Node

        other = Layer.objects.create(owner=self.user, name='Recherche', index=1)
        Node.objects.create(layer=other, x=0, y=0)
        self.run_guardian(json.dumps({'say': '', 'actions': [
            {'op': 'portal', 'ref': 'n1', 'name': 'recherche'},
            {'op': 'portal', 'ref': 'n1', 'name': 'Budget'},
        ]}))
        portals = Edge.objects.filter(kind=Edge.Kind.PORTAL, source=self.idea).select_related('target__layer')
        self.assertEqual(sorted(e.target.layer.name for e in portals), ['Budget', 'Recherche'])
        budget = Layer.objects.get(name='Budget')
        self.assertEqual(budget.index, 2)
        entry = next(e.target for e in portals if e.target.layer_id == other.id)
        self.assertNotEqual((entry.x, entry.y), (0, 0))
        self.assertEqual(entry.payload['text']['html'], 'Voyage au Japon')
        self.assertTrue(all(e.target.status == Node.Status.DRAFT for e in portals))

    def test_plug_agent_and_inventory_loop(self):
        other = LocalModel.objects.create(repo='org/coder', filename='Qwen2.5-Coder-7B-Q4_K_M.gguf', status=LocalModel.Status.READY)
        Agent.objects.filter(name='Codeur').update(model=None)
        engine = self.run_guardian(
            json.dumps({'say': 'Je regarde.', 'actions': [{'op': 'inventory'}]}),
            json.dumps({'say': 'Je branche.', 'actions': [
                {'op': 'plug_agent', 'agent': 'codeur', 'model': 'coder'},
                {'op': 'delegate', 'agent': 'Codeur', 'task': 'hello', 'ref': 'new1'},
            ]}),
            '```js\nhi()\n```',
        )
        inventory = engine.calls[1]['messages'][-1]['content']
        self.assertIn('Codeur (code, sans modèle)', inventory)
        self.assertIn('Home (2 nodes, courant)', inventory)
        self.assertIn('Qwen2.5-Coder-7B-Q4_K_M.gguf (text)', inventory)
        self.assertEqual(Agent.objects.get(name='Codeur').model, other)
        self.assertIn('notice', self.kinds())
        self.assertEqual(len(engine.calls), 3)

    def test_free_spot(self):
        from .guardian import free_spot

        self.assertEqual(free_spot((0, 0), []), (0.0, -200.0))
        occupied = [(0, 0), (0, -200)]
        spot = free_spot((0, 0), occupied)
        self.assertTrue(all(math.dist(spot, p) >= 180 for p in occupied))


class CommandStreamTests(TransactionTestCase):
    def setUp(self):
        from graph.models import Layer

        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        self.layer = Layer.objects.create(owner=self.user, name='Home')
        model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf')
        Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR, model=model)

    async def test_stream(self):
        await self.async_client.aforce_login(self.user)
        url = '/api/v1/toolbox/command'
        r = await self.async_client.post(url, {'prompt': 'x'}, content_type='application/json')
        self.assertEqual(r.status_code, 400)
        plan = json.dumps({'say': 'Fait.', 'actions': [{'op': 'create', 'text': 'Bonjour'}]})
        with mock.patch.object(api, 'engine', ScriptedEngine(plan)):
            r = await self.async_client.post(url, {'prompt': 'dis bonjour', 'layer': str(self.layer.id)},
                                             content_type='application/json')
            body = ''.join([chunk.decode() async for chunk in r.streaming_content])
        self.assertEqual(r['Content-Type'], 'text/event-stream')
        kinds = [line.split(': ', 1)[1] for line in body.splitlines() if line.startswith('event: ')]
        self.assertEqual(kinds, ['start', 'text', 'changes', 'end'])
        self.assertIn('Bonjour', body)
