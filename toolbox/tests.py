import json
import math
from datetime import datetime
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import connection
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings

from nodzapp.models import NodzUser

from . import api, hub
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
                            tags=['gguf', '7B', 'tool-calling', 'Q4_K_M'], last_modified=datetime(2026, 9, 1)),
            SimpleNamespace(id='org/SmolLM-135M-GGUF', downloads=None, likes=None, pipeline_tag=None, tags=None, last_modified=None),
            SimpleNamespace(id='org/Big-70B-GGUF', downloads=5, likes=1, pipeline_tag='text-generation', tags=['70B'], last_modified=None),
        ]

    def model_info(self, repo, files_metadata=False):
        siblings = [SimpleNamespace(rfilename=name, size=size) for name, size in
                    [('m-Q8_0.gguf', 8 << 30), ('m-Q4_K_M.gguf', 4 << 30), ('m-Q2_K.gguf', 2 << 30), ('README.md', 1)]]
        return SimpleNamespace(siblings=siblings, tags=['instruct'], pipeline_tag='text-generation')


class FakeResponse:
    """Réponse HTTP en flux (interface httpx) servant `body` à partir de l'octet demandé par Range."""

    def __init__(self, body, headers, fail_after=None):
        start = int(headers.get('Range', 'bytes=0-')[6:-1] or 0)
        self.status_code = 206 if start else 200
        self.chunks = [body[i:i + 3] for i in range(start, len(body), 3)]
        self.headers = {'content-length': str(len(body) - start)}
        self.fail_after = fail_after

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self):
        pass

    def iter_bytes(self, size):
        for i, chunk in enumerate(self.chunks):
            if self.fail_after is not None and i == self.fail_after:
                raise OSError('connexion coupée')
            yield chunk


class HubTests(TestCase):
    def test_annotations(self):
        self.assertEqual(hub.detect_quant('Qwen2.5-7B-Instruct-Q4_K_M.gguf'), 'Q4_K_M')
        self.assertEqual(hub.detect_quant('model-IQ3_XS.gguf'), 'IQ3_XS')
        self.assertEqual(hub.detect_quant('model.F16.gguf'), 'F16')
        self.assertTrue(hub.is_recommended('x-Q5_K_M.gguf'))
        self.assertFalse(hub.is_recommended('x-Q8_0.gguf'))
        self.assertEqual(hub.role_of('bartowski/Qwen2.5-Coder-7B'), 'code')
        self.assertEqual(hub.role_of('org/Qwen2.5-1.5B-Instruct'), 'small')
        self.assertEqual(hub.size_tag(['gguf', '135M']), ('135M', 0.135))
        self.assertIn('tools', hub.capabilities_of('m', ['function-calling'], ''))

    def test_search_filters(self):
        fake = FakeHfApi()
        with mock.patch.object(hub, 'api', return_value=fake):
            results = hub.search('qwen', 'created', 5, pipeline='text-generation')
            sized = hub.search(max_b=9)
            quant = hub.search(quant='q4_k_m')
        call = fake.calls[0]
        self.assertEqual((call['sort'], call['filter'], call['pipeline_tag']), ('created_at', 'gguf', 'text-generation'))
        self.assertIn('lastModified', call['expand'])
        coder = results[0]
        self.assertEqual((coder['role'], coder['size_b'], coder['size_hint'], coder['updated'][:10]), ('code', 7.0, '7B', '2026-09-01'))
        self.assertIn('tools', coder['capabilities'])
        self.assertEqual(results[1]['downloads'], 0)
        self.assertEqual([m['id'] for m in sized], ['org/Qwen2.5-Coder-7B-Instruct-GGUF', 'org/SmolLM-135M-GGUF'])
        self.assertEqual([m['id'] for m in quant], ['org/Qwen2.5-Coder-7B-Instruct-GGUF'])

    def test_files_flag_heavy_for_this_machine(self):
        with mock.patch.object(hub, 'api', return_value=FakeHfApi()), \
                mock.patch.object(hub, 'gpu_memory_mb', return_value=0), mock.patch.object(hub, 'ram_mb', return_value=10_000):
            files = hub.repo_files('org/m')['files']  # budget CPU : 60 % de 10 Go
        self.assertEqual([(f['name'], f['heavy']) for f in files],
                         [('m-Q4_K_M.gguf', False), ('m-Q8_0.gguf', True), ('m-Q2_K.gguf', False)])

    def test_recommendations_follow_the_machine(self):
        with mock.patch.object(hub, 'gpu_memory_mb', return_value=0), mock.patch.object(hub, 'ram_mb', return_value=4000):
            rec = hub.recommendations()
        self.assertFalse(rec['gpu'])
        self.assertEqual([m['name'] for m in rec['models']], ['Llama 3.2 3B Instruct Q4_K_M', 'Qwen2.5 1.5B Instruct Q4_K_M'])
        self.assertTrue(rec['models'][0]['recommended'])
        with mock.patch.object(hub, 'gpu_memory_mb', return_value=8192), mock.patch.object(hub, 'ram_mb', return_value=4000):
            self.assertEqual(hub.recommendations()['models'][0]['name'], 'Qwen2.5 7B Instruct Q4_K_M')

    def download(self, model, body, fail_after=None):
        session = SimpleNamespace(stream=lambda method, url, headers, **kw: FakeResponse(body, headers, fail_after))
        hub.DOWNLOADS[model.pk] = {'cancel': threading.Event(), 'speed': 0.0}
        with mock.patch.object(hub, 'get_session', return_value=session), mock.patch.object(connection, 'close'):
            hub._download(model.pk)
        model.refresh_from_db()

    def test_download_resumes_after_failure(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            model = LocalModel.objects.create(repo='org/m', filename='m-Q4_K_M.gguf')
            body = b'abcdefghijkl'
            self.download(model, body, fail_after=2)
            self.assertEqual((model.status, model.error), (LocalModel.Status.ERROR, 'connexion coupée'))
            partial = Path(root) / 'org__m' / 'm-Q4_K_M.gguf.partial'
            self.assertEqual(partial.read_bytes(), b'abcdef')
            self.download(model, body)  # reprise avec Range : 206, on complète le .partial
            self.assertEqual((model.status, model.size, model.downloaded), (LocalModel.Status.READY, 12, 12))
            self.assertEqual(Path(model.path).read_bytes(), body)
            self.assertFalse(partial.exists())
            self.assertEqual(hub.download_state(model)['progress'], 1)

    def test_download_cancel(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            model = LocalModel.objects.create(repo='org/m', filename='a.gguf')
            hub.DOWNLOADS[model.pk] = {'cancel': threading.Event(), 'speed': 0.0}
            hub.cancel_download(model)
            session = SimpleNamespace(stream=lambda method, url, headers, **kw: FakeResponse(b'abcdef', headers))
            with mock.patch.object(hub, 'get_session', return_value=session), mock.patch.object(connection, 'close'):
                hub._download(model.pk)
            model.refresh_from_db()
            self.assertEqual(model.status, LocalModel.Status.CANCELLED)
            self.assertNotIn(model.pk, hub.DOWNLOADS)

    def test_local_files_import(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            (Path(root) / 'perso').mkdir()
            (Path(root) / 'perso' / 'mon-Q5_K_M.gguf').write_bytes(b'xy')
            self.assertIsNone(hub.resolve_local('../etc/passwd'))
            self.assertIsNone(hub.resolve_local('perso/absent.gguf'))
            path = hub.resolve_local('perso/mon-Q5_K_M.gguf')
            model = hub.import_local(path)
            self.assertEqual((model.repo, model.status, model.quant, model.size), ('local', LocalModel.Status.READY, 'Q5_K_M', 2))
            self.assertEqual(hub.local_files(), [{'path': 'perso/mon-Q5_K_M.gguf', 'name': 'mon-Q5_K_M.gguf', 'size': 2,
                                                  'quant': 'Q5_K_M', 'model': str(model.id)}])


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
        engine._watch = lambda: None
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

    def test_params_stats_and_idle_unload(self):
        now = [1000.0]
        engine = Engine(Broker(), factory=FakeLlama, clock=lambda: now[0])
        self.model.params = {'n_ctx': 1024, 'n_gpu_layers': -1, 'n_batch': 256, 'ttl': 5}
        with mock.patch.object(Engine, '_watch'):
            engine.chat(self.model, [])
        self.assertEqual({k: FakeLlama.instances[0].kwargs[k] for k in ('n_ctx', 'n_gpu_layers', 'n_batch')},
                         {'n_ctx': 1024, 'n_gpu_layers': -1, 'n_batch': 256})
        self.assertEqual((engine.stats[self.model.pk]['requests'], engine.stats[self.model.pk]['chunks']), (1, 2))
        now[0] += 4 * 60
        self.assertFalse(engine.unload_if_idle())
        now[0] += 2 * 60
        self.assertTrue(engine.unload_if_idle())
        self.assertIsNone(engine.loaded)

    def test_switch_model_reloads(self):
        engine = Engine(Broker(), factory=FakeLlama)
        engine._watch = lambda: None
        other = LocalModel.objects.create(repo='org/m', filename='b.gguf', path='/models/b.gguf')
        engine.chat(self.model, [])
        engine.chat(other, [])
        self.assertEqual([i.kwargs['model_path'] for i in FakeLlama.instances], ['/models/a.gguf', '/models/b.gguf'])
        self.assertEqual(engine.loaded, other.pk)

    def test_gpu_options_reload_and_sampling(self):
        engine = Engine(Broker(), factory=FakeLlama)
        engine._watch = lambda: None
        engine.chat(self.model, [])
        self.model.params = {'n_gpu_layers': 20, 'main_gpu': 1, 'split_mode': '1', 'tensor_split': [0.6, 0.4],
                             'flash_attn': True, 'type_k': 'q8_0', 'type_v': 'q4_0', 'offload_kqv': False,
                             'top_p': 0.9, 'min_p': 0.05, 'mirostat_mode': '2', 'seed': -1, 'temperature': 0.3}
        engine.chat(self.model, [], temperature=0.1, top_k=20)
        self.assertEqual(len(FakeLlama.instances), 2)  # réglages de chargement changés : rechargé
        kwargs = FakeLlama.instances[1].kwargs
        self.assertEqual({k: kwargs[k] for k in ('n_gpu_layers', 'main_gpu', 'split_mode', 'tensor_split', 'flash_attn', 'type_k', 'type_v', 'offload_kqv')},
                         {'n_gpu_layers': 20, 'main_gpu': 1, 'split_mode': 1, 'tensor_split': [0.6, 0.4], 'flash_attn': True,
                          'type_k': 8, 'type_v': 2, 'offload_kqv': False})
        call = FakeLlama.instances[1].calls[0]
        self.assertEqual((call['temperature'], call['top_p'], call['min_p'], call['top_k'], call['mirostat_mode']), (0.1, 0.9, 0.05, 20, 2))
        self.assertNotIn('seed', call)  # -1 = aléatoire
        engine.chat(self.model, [])
        self.assertEqual(len(FakeLlama.instances), 2)  # échantillonnage seul : pas de rechargement


class ParamsTests(SimpleTestCase):
    def test_validation(self):
        from .params import ParamError, validate

        self.assertEqual(validate({'n_gpu_layers': '-1', 'flash_attn': 'true', 'tensor_split': '3,1', 'top_k': '', 'type_k': 'q8_0'}),
                         {'n_gpu_layers': -1, 'flash_attn': True, 'tensor_split': [3.0, 1.0], 'type_k': 'q8_0'})
        for bad, message in [({'n_ctx': 10}, 'entre'), ({'temperature': 'chaud'}, 'nombre'), ({'type_v': 'q4_0'}, 'flash'),
                             ({'split_mode': '7'}, 'choix'), ({'tensor_split': 'a,b'}, 'virgules'), ({'bogus': 1}, 'inconnu')]:
            with self.assertRaisesMessage(ParamError, message):
                validate(bad)

    def test_gguf_header(self):
        import struct

        from . import gguf

        def string(value):
            data = value.encode()
            return struct.pack('<Q', len(data)) + data

        kv = [
            string('general.architecture') + struct.pack('<I', 8) + string('qwen2'),
            string('tokenizer.ggml.scores') + struct.pack('<IIQ', 9, 6, 3) + struct.pack('<3f', 0, 1, 2),
            string('tokenizer.ggml.tokens') + struct.pack('<IIQ', 9, 8, 2) + string('a') + string('b'),
            string('qwen2.block_count') + struct.pack('<II', 4, 28),
            string('qwen2.context_length') + struct.pack('<II', 4, 32768),
        ]
        with tempfile.NamedTemporaryFile(suffix='.gguf') as f:
            f.write(b'GGUF' + struct.pack('<IQQ', 3, 0, len(kv)) + b''.join(kv))
            f.flush()
            self.assertEqual(gguf.info(f.name), {'architecture': 'qwen2', 'layers': 28, 'context_length': 32768})
        self.assertEqual(gguf.info('/nulle/part.gguf'), {})


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

    def test_model_and_agent_params(self):
        model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf', status=LocalModel.Status.READY)
        url = f'/api/v1/toolbox/models/{model.id}'
        self.assertEqual(self.client.patch(url, {'params': {}}, content_type='application/json').status_code, 403)
        self.client.force_login(self.admin)
        r = self.client.patch(url, {'params': {'n_gpu_layers': 12, 'flash_attn': 'true', 'type_v': 'q8_0'}}, content_type='application/json')
        self.assertEqual(r.json()['params'], {'n_gpu_layers': 12, 'flash_attn': True, 'type_v': 'q8_0'})
        r = self.client.patch(url, {'params': {'type_v': 'q8_0'}}, content_type='application/json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('flash', r.json()['error'])
        self.assertIn('GPU', {p['group'] for p in self.client.get('/api/v1/toolbox/status').json()['param_spec']})
        agent = self.client.get('/api/v1/toolbox/agents').json()['agents'][0]
        r = self.client.patch(f"/api/v1/toolbox/agents/{agent['id']}", {'params': {'top_p': '0.8'}}, content_type='application/json')
        self.assertEqual(r.json()['params'], {'top_p': 0.8})
        r = self.client.patch(f"/api/v1/toolbox/agents/{agent['id']}", {'params': {'n_gpu_layers': 5}}, content_type='application/json')
        self.assertEqual(r.status_code, 400)

    def test_system_monitor(self):
        from . import monitor

        with mock.patch.object(monitor, 'gpu', return_value={'name': 'RTX', 'percent': 42.0, 'vram_used_mb': 2048,
                                                             'vram_total_mb': 8192, 'vram_percent': 25.0, 'temperature': 60.0}):
            data = self.client.get('/api/v1/toolbox/system').json()
        self.assertGreaterEqual(data['cpu']['percent'], 0)
        self.assertLessEqual(data['cpu']['percent'], 100)
        self.assertGreater(data['ram']['total_mb'], 0)
        self.assertEqual(data['gpu']['vram_percent'], 25.0)
        self.assertGreater(data['disk']['total_gb'], 0)
        self.assertIsNone(data['model'])
        self.assertFalse(data['broker']['busy'])
        self.assertEqual(data['dispatch'], {'running': 0, 'waiting': 0, 'workers': 1})

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

    def test_remove_keeps_file_unless_asked(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            path = Path(root) / 'org__m' / 'a.gguf'
            path.parent.mkdir()
            path.write_bytes(b'x')
            model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path=str(path), status=LocalModel.Status.READY)
            url = f'/api/v1/toolbox/models/{model.pk}'
            self.assertEqual(self.client.delete(url).status_code, 403)
            self.client.force_login(self.admin)
            self.assertEqual(self.client.delete(url).status_code, 200)
            self.assertTrue(path.exists())
            again = LocalModel.objects.create(repo='org/m', filename='a.gguf', path=str(path), status=LocalModel.Status.READY)
            self.assertEqual(self.client.delete(f'/api/v1/toolbox/models/{again.pk}?file=1').status_code, 200)
            self.assertFalse(path.exists())
            self.assertFalse(LocalModel.objects.exists())

    def test_model_settings_and_actions(self):
        model = LocalModel.objects.create(repo='org/m', filename='a-Q4_K_M.gguf', status=LocalModel.Status.READY)
        url = f'/api/v1/toolbox/models/{model.pk}'
        r = self.client.get('/api/v1/toolbox/models')
        self.assertEqual(r.json()['models'][0]['agents'], [])  # lecture ouverte à tous
        self.assertEqual(self.send('patch', url, {'label': 'Qwen'}).status_code, 403)
        self.client.force_login(self.admin)
        r = self.send('patch', url, {'label': 'Qwen', 'kind': 'image', 'params': {'n_ctx': '8192', 'ttl': 30, 'temperature': ''}})
        self.assertEqual((r.status_code, r.json()['label'], r.json()['kind'], r.json()['params']),
                         (200, 'Qwen', 'image', {'n_ctx': 8192, 'ttl': 30.0}))
        self.assertEqual(self.send('patch', url, {'params': {'pirate': 1}}).status_code, 400)
        self.assertEqual(self.send('patch', url, {'params': {'n_ctx': 'beaucoup'}}).status_code, 400)
        with mock.patch.object(api.engine, 'unload') as unload, mock.patch.object(type(api.engine), 'loaded', model.pk):
            self.assertEqual(self.send('post', f'{url}/unload').status_code, 200)
            unload.assert_called_once()
        with mock.patch.object(hub, 'cancel_download') as cancel:
            self.send('post', f'{url}/cancel')
            cancel.assert_called_once()
        with mock.patch.object(hub.threading, 'Thread'):
            self.assertEqual(self.send('post', f'{url}/retry').json()['status'], LocalModel.Status.DOWNLOADING)
        self.assertEqual(self.send('post', f'{url}/pirate').status_code, 400)

    def test_server_files(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MODELS_DIR=Path(root)):
            (Path(root) / 'b.gguf').write_bytes(b'xy')
            r = self.client.get('/api/v1/toolbox/files')
            self.assertEqual([f['name'] for f in r.json()['files']], ['b.gguf'])
            self.assertEqual(self.send('post', '/api/v1/toolbox/files', {'path': 'b.gguf'}).status_code, 403)
            self.client.force_login(self.admin)
            self.assertEqual(self.send('post', '/api/v1/toolbox/files', {'path': '../b.gguf'}).status_code, 400)
            self.assertEqual(self.send('post', '/api/v1/toolbox/files', {'path': 'b.gguf'}).status_code, 201)
            self.assertEqual(LocalModel.objects.get().repo, 'local')
            self.assertEqual(self.client.delete('/api/v1/toolbox/files?path=b.gguf').status_code, 200)
            self.assertFalse((Path(root) / 'b.gguf').exists())
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
    """Le Gardien planifie à partir du contexte de la page Nodz et émet des actions validées."""

    CONTEXT = {
        'layer': {'id': 1, 'name': 'Home'},
        'layers': [{'id': 1, 'name': 'Home'}, {'id': 2, 'name': 'Budget'}],
        'nodes': [
            {'id': 'N-1', 'text': '<b>Voyage</b> au Japon', 'color': '#33FF99', 'x': 0, 'y': 0, 'r': 20},
            {'id': 'N-2', 'text': '', 'color': '#6848A6', 'x': 400, 'y': 0, 'r': 20},
        ],
        'links': [['N-1', 'N-2']],
        'selection': ['N-1'],
        'view': {'x': 0, 'y': 0},
    }

    def setUp(self):
        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        self.model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf', status=LocalModel.Status.READY)
        self.client.force_login(self.user)
        self.client.get('/api/v1/toolbox/agents')  # agents de départ
        Agent.objects.filter(owner=self.user).exclude(role=Agent.Role.IMAGE).update(model=self.model)
        self.events = []

    def run_guardian(self, *replies, context=None):
        from .guardian import Guardian

        engine = ScriptedEngine(*replies)
        Guardian(self.user, engine, lambda kind, data: self.events.append((kind, data))).handle('organise', context or self.CONTEXT)
        return engine

    def actions(self):
        return [d for k, d in self.events if k == 'action']

    def errors(self):
        return [d['message'] for k, d in self.events if k == 'error']

    def test_requires_guardian_model(self):
        from .engine import EngineUnavailable

        Agent.objects.filter(role=Agent.Role.ORCHESTRATOR).update(model=None)
        with self.assertRaises(EngineUnavailable):
            self.run_guardian()

    def test_prompt_uses_page_context(self):
        engine = self.run_guardian(json.dumps({'say': 'Ok.', 'actions': []}))
        prompt = engine.calls[0]['messages'][1]['content']
        self.assertIn('N-1 : Voyage au Japon', prompt)
        self.assertIn('N-2 : (vide)', prompt)
        self.assertIn('Liens : N-1-N-2', prompt)
        self.assertIn('Sélection : N-1', prompt)
        self.assertEqual(engine.calls[0]['schema']['required'], ['plan', 'say', 'actions'])
        from graph.models import AIRun

        run = AIRun.objects.get()
        self.assertEqual((run.status, run.context_node_ids), (AIRun.Status.DONE, ['N-1', 'N-2']))

    def test_node_message_gets_a_linked_reply_node(self):
        engine = self.run_guardian(json.dumps({'say': 'Bonne idée : Kyoto en avril.', 'actions': []}),
                                   context={**self.CONTEXT, 'origin': 'N-2', 'selection': []})
        self.assertIn('Message écrit dans le node N-2 : organise', engine.calls[0]['messages'][1]['content'])
        reply, link = self.actions()
        self.assertEqual((reply['op'], reply['ref'], reply['text']), ('create', 'reply1', 'Bonne idée : Kyoto en avril.'))
        self.assertEqual(link, {'op': 'link', 'source': 'N-2', 'target': 'reply1'})
        self.assertGreaterEqual(math.dist((reply['x'], reply['y']), (400, 0)), 200)  # autour du node message
        self.assertLess(math.dist((reply['x'], reply['y']), (400, 0)), math.dist((reply['x'], reply['y']), (0, 0)) + 200)
        self.assertNotIn('text', [k for k, _ in self.events])

    def test_actions_are_validated_and_placed(self):
        plan = {'say': 'Voilà.', 'actions': [
            {'op': 'create', 'ref': 'new1', 'text': 'Kyoto <3', 'near': 'N-1', 'color': '#FF6B6B', 'shape': 'square'},
            {'op': 'create', 'ref': 'new2', 'text': 'Tokyo', 'near': 'N-1'},
            {'op': 'link', 'source': 'N-1', 'target': 'new1'},
            {'op': 'style', 'ref': 'N-2', 'color': 'rouge'},
            {'op': 'style', 'ref': 'N-2', 'shape': 'none', 'radius': 9000, 'lock': True},
            {'op': 'set_type', 'ref': 'N-2', 'content_type': 'canvas'},
            {'op': 'archive', 'ref': 'N-99'},
            {'op': 'create', 'ref': 'N-1', 'text': 'doublon'},
            {'op': 'cleanup'},
        ]}
        self.run_guardian(json.dumps(plan))
        ops = self.actions()
        self.assertEqual([a['op'] for a in ops], ['create', 'create', 'link', 'style', 'set_type', 'cleanup'])
        kyoto, tokyo = ops[0], ops[1]
        self.assertEqual((kyoto['text'], kyoto['color'], kyoto['shape']), ('Kyoto &lt;3', '#FF6B6B', 'square'))
        points = [(0, 0), (400, 0), (kyoto['x'], kyoto['y']), (tokyo['x'], tokyo['y'])]
        self.assertTrue(all(math.dist(a, b) >= 100 for i, a in enumerate(points) for b in points[i + 1:]))
        self.assertEqual((ops[3]['radius'], ops[3]['lock'], ops[3]['shape']), (400.0, True, 'none'))
        self.assertEqual(ops[5]['refs'], ['N-2'])
        self.assertEqual(len(self.errors()), 3)  # couleur invalide, référence inconnue, create sur un node existant

    def test_navigation_and_portal(self):
        plan = {'say': 'Visite.', 'actions': [
            {'op': 'focus', 'ref': 'N-1', 'zoom': 50, 'text': 'Ton idée'},
            {'op': 'overview'},
            {'op': 'portal', 'ref': 'N-1', 'name': 'Kyoto'},
            {'op': 'travel', 'name': 'kyoto', 'text': 'On entre.'},
            {'op': 'travel', 'name': 'budget'},
            {'op': 'travel', 'name': 'Nulle part'},
        ]}
        self.run_guardian(json.dumps(plan))
        ops = self.actions()
        self.assertEqual([a['op'] for a in ops], ['focus', 'overview', 'portal', 'travel', 'travel'])
        self.assertEqual((ops[0]['zoom'], ops[0]['text']), (8.0, 'Ton idée'))
        self.assertEqual((ops[3]['layer'], ops[3]['name']), (None, 'Kyoto'))  # dimension créée par le portail
        self.assertEqual(ops[4]['layer'], 2)
        self.assertIn('Nulle part', self.errors()[0])

    def test_delegation_publishes_into_nodes(self):
        plan = {'say': 'Je délègue.', 'actions': [
            {'op': 'delegate', 'agent': 'Rédacteur', 'task': 'Itinéraire', 'ref': 'new1', 'near': 'N-1'},
            {'op': 'delegate', 'agent': 'Codeur', 'task': 'Convertisseur', 'ref': 'N-2'},
            {'op': 'delegate', 'agent': 'Illustrateur', 'task': 'Une carte', 'ref': 'new2'},
        ]}
        self.run_guardian(json.dumps(plan), 'Jour 1 : Tokyo\nJour 2 : Kyoto', 'Voici :\n```python\nprint(1 < 2)\n```')
        ops = self.actions()
        self.assertEqual(ops[0]['op'], 'create')
        self.assertIn('Rédacteur travaille', ops[0]['text'])
        self.assertEqual(ops[1], {'op': 'update', 'ref': 'new1', 'text': 'Jour 1 : Tokyo<br>Jour 2 : Kyoto'})
        self.assertEqual(ops[2], {'op': 'update', 'ref': 'N-2', 'text': '<pre>print(1 &lt; 2)</pre>'})
        self.assertIn('agent_text', [k for k, _ in self.events])
        self.assertIn("pas encore branchée", self.errors()[0])

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
        self.assertIn('Home (courante)', inventory)
        self.assertIn('Qwen2.5-Coder-7B-Q4_K_M.gguf (text)', inventory)
        self.assertEqual(Agent.objects.get(name='Codeur').model, other)
        self.assertIn('notice', [k for k, _ in self.events])
        self.assertEqual(len(engine.calls), 3)

    def test_invalid_output_marks_run_failed(self):
        from graph.models import AIRun

        from .guardian import PlanError

        with self.assertRaises(PlanError):
            self.run_guardian('pas du json')
        self.assertEqual(AIRun.objects.get().status, AIRun.Status.ERROR)

    def test_guidelines_are_editable_but_tools_stay(self):
        from . import prompts

        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn(prompts.GUARDIAN, system)
        self.assertIn('{"op":"web_search"', system)
        Agent.objects.filter(owner=self.user, role=Agent.Role.ORCHESTRATOR).update(system_prompt='Tu parles comme un pirate.')
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn('Tu parles comme un pirate.', system)
        self.assertNotIn(prompts.GUARDIAN, system)
        self.assertIn('{"op":"mindmap"', system)  # une consigne réécrite ne retire pas les outils
        agents = {a['name']: a for a in self.client.get('/api/v1/toolbox/agents').json()['agents']}
        self.assertEqual(agents['Rédacteur']['default_prompt'], prompts.ROLES[Agent.Role.TEXT])

    def test_follow_up_plan_and_intents(self):
        self.run_guardian(json.dumps({'plan': ['Relier les idées', 'Montrer le résultat'], 'say': 'Voilà.', 'actions': [
            {'op': 'link', 'source': 'N-1', 'target': 'N-2'}, {'op': 'overview'}]}))
        kinds = [k for k, _ in self.events]
        self.assertEqual(kinds[:3], ['start', 'intent', 'plan'])
        self.assertEqual(dict(self.events)['plan']['steps'], ['Relier les idées', 'Montrer le résultat'])
        intents = [d['text'] for k, d in self.events if k == 'intent']
        self.assertIn('Je relie « Voyage au Japon » à N-2', intents)
        self.assertIn('Je prends du recul sur tout le plan', intents)
        self.assertLess(kinds.index('intent', 3), kinds.index('action'))  # l'intention précède le geste

    def test_mindmap(self):
        self.run_guardian(json.dumps({'plan': [], 'say': 'Carte.', 'actions': [
            {'op': 'mindmap', 'ref': 'new1', 'text': 'Japon', 'children': ['Kyoto', 'Tokyo'], 'near': 'N-1'}]}))
        ops = [(a['op'], a.get('ref') or (a.get('source'), a.get('target'))) for a in self.actions()]
        self.assertEqual(ops[:5], [('create', 'new1'), ('create', 'new1.1'), ('link', ('new1', 'new1.1')),
                                   ('create', 'new1.2'), ('link', ('new1', 'new1.2'))])
        spots = [(a['x'], a['y']) for a in self.actions() if a['op'] == 'create']
        self.assertTrue(all(math.dist(p, q) >= 100 for i, p in enumerate(spots) for q in spots[i + 1:]))

    def test_agents_and_memory(self):
        self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': [
            {'op': 'create_agent', 'name': 'Traducteur', 'role': 'text', 'description': 'Traduit', 'prompt': 'Traduis en japonais', 'model': 'a.gguf'},
            {'op': 'create_agent', 'name': 'traducteur'},
            {'op': 'update_agent', 'agent': 'rédacteur', 'enabled': False, 'prompt': 'Sois bref'},
            {'op': 'update_agent', 'agent': 'Gardien', 'enabled': False},
            {'op': 'remember', 'text': 'Richard prépare un voyage au Japon'},
            {'op': 'remember', 'text': 'Il aime les cartes mentales'},
            {'op': 'forget', 'text': 'cartes'},
        ]}))
        traducteur = Agent.objects.get(owner=self.user, name='Traducteur')
        self.assertEqual((traducteur.system_prompt, traducteur.model), ('Traduis en japonais', self.model))
        redacteur = Agent.objects.get(owner=self.user, name='Rédacteur')
        self.assertEqual((redacteur.enabled, redacteur.system_prompt), (False, 'Sois bref'))
        gardien = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        self.assertTrue(gardien.enabled)  # le Gardien ne se désactive pas lui-même
        self.assertEqual(gardien.memory, ['Richard prépare un voyage au Japon'])
        self.assertIn('déjà pris', self.errors()[0])
        again = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        self.assertIn('- Richard prépare un voyage au Japon', again.calls[0]['messages'][0]['content'])

    def test_search_nodes_read_file_and_goto(self):
        from nodzapp.models import Layer, Node

        home = Layer.objects.create(user=self.user, layer_id=1, layer_name='Home')
        trip = Layer.objects.create(user=self.user, layer_id=2, layer_name='Voyage')
        Node.objects.create(user=self.user, node_id=45, layer=trip, text_content='<p>Budget Kyoto</p>')
        Node.objects.create(user=self.user, node_id=46, layer=home, type='file', file_name='plan.pdf', file_text_content='Jour 1 : Kyoto')
        Node.objects.create(user=self.user, node_id=47, layer=trip, text_content='Kyoto archivé', archive=True)
        engine = self.run_guardian(
            json.dumps({'plan': [], 'say': '', 'actions': [{'op': 'search_nodes', 'query': 'kyoto'}, {'op': 'read_file', 'ref': 'N-46'}]}),
            json.dumps({'plan': [], 'say': 'Le voici.', 'actions': [{'op': 'goto', 'ref': 'N-45', 'text': 'Ton budget'}, {'op': 'goto', 'ref': 'N-99'}]}),
        )
        reads = engine.calls[1]['messages'][-1]['content']
        self.assertIn('N-45 (dimension Voyage) : Budget Kyoto', reads)
        self.assertIn('Jour 1 : Kyoto', reads)
        self.assertNotIn('N-47', reads)
        goto = [a for a in self.actions() if a['op'] == 'goto']
        self.assertEqual(goto, [{'op': 'goto', 'ref': 'N-45', 'layer': 2, 'text': 'Ton budget'}])
        self.assertIn('search_nodes', self.errors()[0])

    def test_web_tools(self):
        from . import web

        with mock.patch.object(web, 'search', return_value=[{'title': 'Kyoto', 'url': 'https://ex.org/k', 'snippet': 'Temples'}]), \
                mock.patch.object(web, 'fetch', side_effect=web.WebError('adresse interne refusée : localhost')):
            engine = self.run_guardian(
                json.dumps({'plan': ['Chercher'], 'say': '', 'actions': [{'op': 'web_search', 'query': 'Kyoto'}, {'op': 'web_fetch', 'url': 'http://localhost/'}]}),
                json.dumps({'plan': [], 'say': 'Trouvé.', 'actions': []}),
            )
        self.assertIn('- Kyoto (https://ex.org/k) : Temples', engine.calls[1]['messages'][-1]['content'])
        self.assertIn('interne', self.errors()[0])

    def test_free_spot(self):
        from .guardian import free_spot

        occupied = [(0, 0)]
        spot = free_spot((0, 0), occupied)
        self.assertGreaterEqual(math.dist(spot, (0, 0)), 100)
        occupied.append(spot)
        self.assertTrue(all(math.dist(free_spot((0, 0), occupied), p) >= 100 for p in occupied))


class DispatcherTests(SimpleTestCase):
    def test_one_at_a_time_in_order_and_one_per_user(self):
        from .dispatcher import Busy, Dispatcher

        d = Dispatcher(workers=1, max_waiting=2)
        a = d.admit('a')
        self.assertTrue(d.wait(a))
        with self.assertRaisesMessage(Busy, 'déjà'):
            d.admit('a')  # une demande par utilisateur
        b, c = d.admit('b'), d.admit('c')
        with self.assertRaisesMessage(Busy, 'très demandé'):
            d.admit('e')  # file pleine
        positions, order = [], []

        def run(ticket, name):
            if d.wait(ticket, positions.append if name == 'c' else lambda p: None):
                order.append(name)
                d.done(ticket)

        threads = [threading.Thread(target=run, args=(t, n)) for t, n in ((b, 'b'), (c, 'c'))]
        [t.start() for t in threads]
        time.sleep(0.2)
        self.assertEqual(d.state(), {'running': 1, 'waiting': 2, 'workers': 1})
        d.done(a)
        [t.join(5) for t in threads]
        self.assertEqual(order, ['b', 'c'])
        self.assertEqual(positions[0], 2)
        self.assertEqual(d.state()['running'] + d.state()['waiting'], 0)

    def test_cancelled_request_leaves_the_queue(self):
        from .dispatcher import Dispatcher

        d = Dispatcher(workers=1)
        a, b = d.admit('a'), d.admit('b')
        d.wait(a)
        d.cancel(b)
        self.assertFalse(d.wait(b))
        self.assertEqual(d.state()['waiting'], 0)
        d.admit('b')  # l'utilisateur peut redemander


class WebTests(TestCase):
    def test_internal_addresses_are_refused(self):
        from . import web

        for url in ['http://127.0.0.1/', 'http://10.0.0.8/admin', 'http://[::1]/', 'http://169.254.169.254/latest', 'file:///etc/passwd']:
            with self.assertRaises(web.WebError, msg=url):
                web.fetch(url)
        with self.settings(GUARDIAN_WEB=False), self.assertRaisesMessage(web.WebError, 'désactivé'):
            web.search('kyoto')

    def test_to_text(self):
        from . import web

        self.assertEqual(web.to_text('<head><title>x</title></head><script>a()</script><p>Kyoto &amp; <b>Nara</b></p><p>Osaka</p>'),
                         'Kyoto & Nara\nOsaka')


class CommandStreamTests(TransactionTestCase):
    def setUp(self):
        self.user = NodzUser.objects.create_user(email='a@nodz.local', password='pw-123456')
        model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf')
        Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR, model=model)

    async def test_stream(self):
        await self.async_client.aforce_login(self.user)
        url = '/api/v1/toolbox/command'
        r = await self.async_client.post(url, {'prompt': 'x'}, content_type='application/json')
        self.assertEqual(r.status_code, 400)
        plan = json.dumps({'plan': ['Créer un node'], 'say': 'Fait.', 'actions': [{'op': 'create', 'ref': 'new1', 'text': 'Bonjour'}]})
        with mock.patch.object(api, 'engine', ScriptedEngine(plan)):
            r = await self.async_client.post(url, {'prompt': 'dis bonjour', 'context': {'nodes': [], 'layers': []}},
                                             content_type='application/json')
            body = ''.join([chunk.decode() async for chunk in r.streaming_content])
        self.assertEqual(r['Content-Type'], 'text/event-stream')
        kinds = [line.split(': ', 1)[1] for line in body.splitlines() if line.startswith('event: ')]
        self.assertEqual(kinds, ['start', 'intent', 'plan', 'intent', 'action', 'text', 'end'])
        self.assertIn('Bonjour', body)

    async def test_busy_user_is_refused(self):
        from .runtime import dispatcher

        await self.async_client.aforce_login(self.user)
        ticket = dispatcher.admit(self.user.pk)
        try:
            r = await self.async_client.post('/api/v1/toolbox/command', {'prompt': 'x', 'context': {}}, content_type='application/json')
        finally:
            dispatcher.done(ticket)
        self.assertEqual(r.status_code, 429)
        self.assertIn('déjà', json.loads(r.content)['error'])
