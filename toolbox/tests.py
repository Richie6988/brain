import json
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import connection
from django.test import TestCase, override_settings

from nodzapp.models import NodzUser

from . import hub
from .broker import AGENT, BACKGROUND, CHAT, Broker, BrokerTimeout
from .engine import Engine
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
