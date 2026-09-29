import contextlib
import html
import json
import math
import shutil
from datetime import datetime, timedelta
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import connection
from django.utils import timezone
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings

from nodzapp.models import NodzUser

from . import api, hub
from .broker import AGENT, BACKGROUND, CHAT, Broker, BrokerTimeout
from .engine import Engine, EngineUnavailable
from .models import Agent, LocalModel


class FakeHfApi:
    def __init__(self, *args, **kwargs):
        self.calls = []

    def list_models(self, **kwargs):
        self.calls.append(kwargs)
        return [
            SimpleNamespace(id='org/Qwen2.5-Coder-7B-Instruct-GGUF', downloads=10, likes=2, pipeline_tag='text-generation',
                            tags=['gguf', 'tool-calling'], last_modified=datetime(2026, 9, 1), gguf={'total': 7_615_616_512},
                            siblings=[SimpleNamespace(rfilename='coder-Q4_K_M.gguf'), SimpleNamespace(rfilename='coder-Q8_0.gguf')]),
            SimpleNamespace(id='org/SmolLM-135M-GGUF', downloads=None, likes=None, pipeline_tag=None, tags=None, last_modified=None,
                            siblings=[SimpleNamespace(rfilename='smol-f16.gguf')]),
            SimpleNamespace(id='org/Big-70B-GGUF', downloads=5, likes=1, pipeline_tag='text-generation', tags=['70B'], last_modified=None,
                            siblings=[SimpleNamespace(rfilename='big-IQ2_XS.gguf'), SimpleNamespace(rfilename='README.md')]),
            SimpleNamespace(id='org/Mystery-GGUF', downloads=1, likes=0, pipeline_tag=None, tags=[], last_modified=None, siblings=[]),
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
            quant = hub.search(quant='q4')
            iq = hub.search(quant='IQ', min_b=10, limit=1)
        call = fake.calls[0]
        self.assertEqual((call['sort'], call['filter'], call['pipeline_tag'], call['limit']), ('created_at', 'gguf', 'text-generation', 5))
        self.assertIn('lastModified', call['expand'])
        self.assertNotIn('siblings', call['expand'])
        self.assertEqual((fake.calls[1]['limit'], fake.calls[2]['limit']), (hub.MAX_SCAN, hub.MAX_SCAN))  # filtre local : on examine plus
        self.assertIn('siblings', fake.calls[2]['expand'])
        coder = results[0]
        self.assertEqual((coder['role'], coder['size_b'], coder['size_hint'], coder['updated'][:10]), ('code', 7.62, '7.6B', '2026-09-01'))
        self.assertIn('tools', coder['capabilities'])
        self.assertEqual(results[1]['downloads'], 0)
        self.assertEqual([m['id'] for m in sized], ['org/Qwen2.5-Coder-7B-Instruct-GGUF', 'org/SmolLM-135M-GGUF'])  # taille inconnue écartée
        self.assertEqual([m['id'] for m in quant], ['org/Qwen2.5-Coder-7B-Instruct-GGUF'])
        self.assertEqual([m['id'] for m in iq], ['org/Big-70B-GGUF'])

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


class LoopingLlama(FakeLlama):
    """Un petit modèle qui s'emballe : la même phrase, encore et encore."""

    def create_chat_completion(self, messages, stream, **options):
        self.calls.append(options)
        yield {'choices': [{'delta': {'content': '{"plan": [], "say": "Bonjour", "actions": [{"op": "note", "text": "'}}]}
        for _ in range(500):
            yield {'choices': [{'delta': {'content': 'encore '}}]}


class EngineTests(TestCase):
    def setUp(self):
        FakeLlama.instances = []
        self.model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/models/a.gguf',
                                               status=LocalModel.Status.READY, params={'n_ctx': 2048})

    def test_prefill_reads_the_system_prompt_once(self):
        engine = Engine(Broker(), factory=FakeLlama)
        engine._watch = lambda: None
        system = [{'role': 'system', 'content': 'consignes'}, {'role': 'user', 'content': '.'}]
        self.assertTrue(engine.prefill(self.model, system))
        self.assertFalse(engine.prefill(self.model, system))  # déjà lu : rien à refaire
        engine.chat(self.model, [{'role': 'system', 'content': 'consignes'}, {'role': 'user', 'content': 'bonjour'}])
        self.assertFalse(engine.prefill(self.model, system))  # une vraie demande l'a lu aussi
        self.assertTrue(engine.prefill(self.model, [{'role': 'system', 'content': 'autres'}, {'role': 'user', 'content': '.'}]))
        llm = FakeLlama.instances[0]
        self.assertEqual([c.get('max_tokens') for c in llm.calls], [1, 1024, 1])
        engine.unload()  # le modèle rechargé devra tout relire
        self.assertTrue(engine.prefill(self.model, system))

    def test_prompt_and_answer_fit_the_context(self):
        class Windowed(FakeLlama):  # 2048 jetons de contexte, un jeton par caractère
            def n_ctx(self):
                return 2048

            def tokenize(self, data):
                return list(data)

        engine = Engine(Broker(), factory=Windowed)
        engine._watch = lambda: None
        engine.chat(self.model, [{'role': 'user', 'content': 'x' * 1500}])
        self.assertEqual(Windowed.instances[0].calls[-1]['max_tokens'], 2048 - 1500 - 64)  # réponse raccourcie pour tenir
        with self.assertRaisesMessage(EngineUnavailable, 'trop longue'):
            engine.chat(self.model, [{'role': 'user', 'content': 'x' * 1950}])

    def test_load_falls_back_when_llama_refuses_the_context(self):
        class Picky(FakeLlama):  # ce build refuse le cache quantifié, puis la flash attention
            def __init__(self, **kwargs):
                if kwargs.get('type_k') or kwargs.get('flash_attn'):
                    raise ValueError('Failed to create llama_context')
                super().__init__(**kwargs)

        engine = Engine(Broker(), factory=Picky)
        engine._watch = lambda: None
        self.model.params = {'type_k': 'q8_0', 'type_v': 'q8_0', 'flash_attn': True}
        self.model.save()
        self.assertEqual(engine.chat(self.model, [{'role': 'user', 'content': 'x'}]), 'Bonjour')
        loaded = FakeLlama.instances[-1].kwargs
        self.assertNotIn('type_k', loaded)
        self.assertFalse(loaded['flash_attn'])

    def test_stop_is_per_user_and_chat_preempts_background(self):
        from .broker import BACKGROUND
        from .engine import acting_for

        class Slow(FakeLlama):
            def create_chat_completion(self, messages, stream, **options):
                for _ in range(400):
                    time.sleep(0.01)
                    yield {'choices': [{'delta': {'content': 'mot '}}]}

        engine = Engine(Broker(), factory=Slow)
        engine._watch = lambda: None
        results = []

        def background(user):
            try:
                with acting_for(user):
                    engine.chat(self.model, [{'role': 'user', 'content': 'x'}], priority=BACKGROUND, owner='task')
                results.append('fini')
            except EngineUnavailable as e:
                results.append(str(e))

        worker = threading.Thread(target=background, args=(5,))
        worker.start()
        while engine._current is None:
            time.sleep(0.01)
        self.assertFalse(engine.interrupt(6))  # le stop d'un autre utilisateur ne la touche pas
        self.assertTrue(engine.interrupt(5))
        worker.join(5)
        self.assertEqual(results, ['arrêté'])
        worker = threading.Thread(target=background, args=(5,))
        worker.start()
        while engine._current is None:
            time.sleep(0.01)
        engine.chat(self.model, [{'role': 'user', 'content': 'vite'}], max_tokens=5)  # une demande du chat passe devant
        worker.join(5)
        self.assertEqual(results, ['arrêté', 'arrêté'])

    def test_a_looping_plan_is_stopped(self):
        engine = Engine(Broker(), factory=LoopingLlama)
        engine._watch = lambda: None
        text = engine.chat(self.model, [{'role': 'user', 'content': 'salut'}], json_schema={'type': 'object'})
        last = engine.stats[self.model.pk]['last']
        self.assertEqual(last['stopped'], 'boucle')
        self.assertLess(last['tokens'], 40)
        self.assertTrue(text.endswith('encore encore encore '))

    def test_looping_detection(self):
        from .engine import looping

        self.assertTrue(looping('{"say": "' + 'Je crée le node. ' * 3))
        self.assertFalse(looping('{"say": "' + '-' * 60 + '"}'))  # une ligne de tirets n'est pas une boucle
        self.assertFalse(looping(json.dumps({'actions': [{'op': 'create', 'ref': f'new{i}', 'text': f'Idée {i}'} for i in range(6)]})))

    def test_stream_schema_and_reuse(self):
        engine = Engine(Broker(), factory=FakeLlama)
        engine._watch = lambda: None
        pieces = []
        text = engine.chat(self.model, [{'role': 'user', 'content': 'salut'}], on_text=pieces.append,
                           json_schema={'type': 'object'}, temperature=0)
        self.assertEqual((text, pieces), ('Bonjour', ['Bon', 'jour']))
        llm = FakeLlama.instances[0]
        self.assertEqual(llm.kwargs['n_ctx'], 2048)
        # Défauts d'iAqua : batch 1024, flash attention, mmap, pas de mlock, threads = cœurs physiques
        self.assertEqual({k: llm.kwargs[k] for k in ('n_batch', 'flash_attn', 'use_mmap', 'use_mlock')},
                         {'n_batch': 1024, 'flash_attn': True, 'use_mmap': True, 'use_mlock': False})
        import os

        from . import fit

        self.assertGreaterEqual(llm.kwargs['n_threads'], min(4, os.cpu_count()))
        with mock.patch('os.cpu_count', return_value=2):
            self.assertEqual(fit.default_threads(), 2)  # petit VPS : pas plus de threads que de cœurs
        with mock.patch('os.cpu_count', return_value=16):
            self.assertEqual(fit.default_threads(), 8)
        self.assertIsInstance(llm.kwargs['n_gpu_layers'], int)  # « auto » calculé avant le chargement
        self.assertIn(self.model.pk, engine.placement)
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
        self.assertEqual((engine.stats[self.model.pk]['requests'], engine.stats[self.model.pk]['tokens']), (1, 2))
        last = engine.stats[self.model.pk]['last']  # mesure de l'appel : jetons générés, attente du premier, durée
        self.assertEqual((last['tokens'], last['prompt_tokens']), (2, None))
        self.assertGreaterEqual(last['total_s'], last['wait_s'])
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


class FitTests(SimpleTestCase):
    INFO = {'layers': 28, 'context_length': 32768, 'embedding': 3584, 'heads': 28, 'kv_heads': 4}

    def resolve(self, options, vram, ram=16000, offload=True, size_mb=4700, chosen=()):
        from . import fit

        with tempfile.NamedTemporaryFile() as f, mock.patch.object(fit.gguf, 'info', return_value=self.INFO), \
                mock.patch.object(fit, 'free_memory', return_value=(vram, ram)):
            f.truncate(size_mb * 1024 ** 2)
            return fit.resolve(f.name, options, offload, chosen)

    def test_auto_fits_the_vram_like_iaqua(self):
        from . import fit

        self.assertEqual(fit.kv_bytes_per_token(self.INFO), 2 * 28 * 512 * 2)  # Qwen2.5 7B : 56 Ko par jeton
        full, summary = self.resolve({'n_gpu_layers': 'auto', 'n_ctx': 'auto'}, vram=8000)
        self.assertEqual(full['n_gpu_layers'], -1)  # 4,7 Go tiennent dans 8 Go : tout sur GPU
        self.assertEqual(full['n_ctx'], 32768)  # plafonné au contexte d'entraînement
        self.assertEqual((summary['gpu_layers'], summary['layers']), (28, 28))
        part, _ = self.resolve({'n_gpu_layers': 'auto', 'n_ctx': 'auto'}, vram=3000)
        self.assertTrue(0 < part['n_gpu_layers'] < 28)
        self.assertGreaterEqual(part['n_ctx'], 8192)
        cpu, summary = self.resolve({'n_gpu_layers': 'auto', 'n_ctx': 'auto'}, vram=8000, offload=False)
        self.assertEqual((cpu['n_gpu_layers'], summary['gpu_offload']), (0, False))  # compilé sans CUDA
        self.assertEqual(cpu['n_ctx'], 8192)  # sur CPU, contexte auto plafonné : pas de swap
        self.assertTrue(summary['fits'])
        small, summary = self.resolve({'n_gpu_layers': 'max', 'n_ctx': 'auto', 'flash_attn': True}, vram=0, ram=3800)
        self.assertEqual((small['n_gpu_layers'], small['n_ctx']), (-1, 8192))  # plancher du Gardien (à 4096, son prompt et sa réponse débordaient)
        self.assertEqual((small['type_k'], small['n_batch'], summary['kv_q8']), (8, 512, True))  # RAM juste : cache et batch réduits
        self.assertFalse(summary['fits'])  # 4,7 Go sur 3,8 Go : il relirait le disque à chaque jeton
        tight, summary = self.resolve({'n_gpu_layers': 'auto', 'n_ctx': 'auto', 'flash_attn': True, 'n_batch': 1024}, vram=0, ram=3800, size_mb=2900)
        self.assertEqual((tight['n_ctx'], tight['type_k'], tight['n_batch'], summary['fits']), (8192, 8, 512, True))
        chosen, _ = self.resolve({'n_gpu_layers': 'auto', 'n_ctx': 'auto', 'flash_attn': True, 'n_batch': 1024}, vram=0, ram=3800,
                                 size_mb=2900, chosen={'n_batch', 'type_k'})
        self.assertEqual((chosen['n_batch'], 'type_k' in chosen), (1024, False))  # réglages choisis : jamais changés
        fixed, _ = self.resolve({'n_gpu_layers': 12, 'n_ctx': 8192}, vram=8000)
        self.assertEqual((fixed['n_gpu_layers'], fixed['n_ctx']), (12, 8192))


class ParamsTests(SimpleTestCase):
    def test_validation(self):
        from .params import ParamError, validate

        self.assertEqual(validate({'n_gpu_layers': 'MAX', 'n_ctx': 'auto', 'flash_attn': 'true', 'tensor_split': '3,1', 'top_k': '', 'type_k': 'q8_0'}),
                         {'n_gpu_layers': 'max', 'n_ctx': 'auto', 'flash_attn': True, 'tensor_split': [3.0, 1.0], 'type_k': 'q8_0'})
        self.assertEqual(validate({'n_gpu_layers': -1}), {'n_gpu_layers': 'max'})  # ancienne notation
        with self.assertRaisesMessage(ParamError, 'entre'):
            validate({'n_gpu_layers': '-5'})
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
        self.assertIn('Chargement', {p['group'] for p in self.client.get('/api/v1/toolbox/status').json()['param_spec']})
        agent = self.client.get('/api/v1/toolbox/agents').json()['agents'][0]
        r = self.client.patch(f"/api/v1/toolbox/agents/{agent['id']}", {'params': {'top_p': '0.8'}}, content_type='application/json')
        self.assertEqual(r.json()['params'], {'top_p': 0.8})
        r = self.client.patch(f"/api/v1/toolbox/agents/{agent['id']}", {'params': {'n_gpu_layers': 5}}, content_type='application/json')
        self.assertEqual(r.status_code, 400)

    def test_images_and_packs_endpoints(self):
        from . import imaging

        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root):
            name = 'b' * 32 + '.png'
            (imaging.output_dir(self.user) / name).write_bytes(b'\x89PNG')
            r = self.client.get(f'/api/v1/toolbox/images/{name}')
            self.assertEqual((r.status_code, r['Content-Type'], b''.join(r.streaming_content)), (200, 'image/png', b'\x89PNG'))
            self.client.force_login(self.admin)  # un autre utilisateur ne voit pas cette image
            self.assertEqual(self.client.get(f'/api/v1/toolbox/images/{name}').status_code, 404)
        self.client.force_login(self.user)
        self.assertEqual(self.client.post('/api/v1/toolbox/packs/flux-schnell').status_code, 403)
        status = self.client.get('/api/v1/toolbox/status').json()
        self.assertEqual(status['packs'], {'flux-schnell': 'FLUX.1 schnell'})
        self.assertIn('imaging', status)

    def test_marks_for_filters(self):
        from nodzapp.models import Layer, Node

        layer = Layer.objects.create(user=self.user, layer_id=1, layer_name='Home')
        for i in (1, 2, 3):
            Node.objects.create(user=self.user, node_id=i, layer=layer, text_content='<b>Kyoto</b> &amp; Nara' if i == 3 else '')
        r = self.client.post('/api/v1/toolbox/marks', {'nodes': ['N-1'], 'origin': 'message'}, content_type='application/json')
        self.assertEqual(r.json(), {'marked': 1})
        self.client.post('/api/v1/toolbox/marks', {'nodes': ['N-1', 'N-2', 'x'], 'origin': 'ai'}, content_type='application/json')
        nodes = self.client.get('/api/v1/toolbox/marks').json()['nodes']
        self.assertEqual({k: v['origin'] for k, v in nodes.items()}, {'N-1': 'message', 'N-2': 'ai', 'N-3': 'user'})
        self.assertGreater(nodes['N-3']['modified'], 0)
        self.assertEqual((nodes['N-3']['layer'], nodes['N-3']['text']), (1, 'Kyoto & Nara'))  # toutes les dimensions, texte brut
        data = self.client.get('/api/v1/toolbox/marks').json()
        self.assertEqual([a['key'] for a in data['authors']], ['ai', 'me'])
        self.assertEqual(data['layers'], {'1': 'Home'})
        self.assertEqual(self.client.post('/api/v1/toolbox/marks', {'nodes': ['N-3'], 'origin': 'bot'},
                                          content_type='application/json').status_code, 400)

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
        self.exclusive_owners = []

    @contextlib.contextmanager
    def exclusive(self, priority, owner):
        self.exclusive_owners.append(owner)
        yield

    def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
        self.calls.append({'model': model, 'messages': messages, 'schema': json_schema, **params})
        reply = self.replies.pop(0) if self.replies else json.dumps({'plan': [], 'say': '', 'actions': []})  # rien de plus à faire
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
        # Un objet par node (perception.py) : texte et sa mise en forme, liens, auteur, date, position, apparence si elle change
        self.assertIn('{"id": "N-1", "texte": "**Voyage** au Japon", "pos": [0, 0], "liens": ["N-2"]}', prompt)  # humain, pas sauvé : omis
        self.assertIn('{"id": "N-2", "texte": "(vide)", "couleur": "#6848A6", "liens": ["N-1"]}', prompt)  # position : nodes sélectionnés ou cités
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
        self.assertEqual([a['op'] for a in ops], ['create', 'create', 'link', 'style', 'set_type', 'create', 'cleanup'])
        kyoto, tokyo = ops[0], ops[1]
        self.assertEqual((kyoto['text'], kyoto['color'], kyoto['shape']), ('Kyoto &lt;3', '#FF6B6B', 'square'))
        points = [(0, 0), (400, 0), (kyoto['x'], kyoto['y']), (tokyo['x'], tokyo['y'])]
        self.assertTrue(all(math.dist(a, b) >= 100 for i, a in enumerate(points) for b in points[i + 1:]))
        self.assertEqual((ops[3]['radius'], ops[3]['lock'], ops[3]['shape']), (400.0, True, 'none'))
        self.assertEqual(ops[6]['refs'], ['N-2'])
        # « create N-1 » : un petit modèle confond identifiant et référence ; un nouveau node près de N-1
        self.assertEqual((ops[5]['ref'][:4], ops[5]['text']), ('auto', 'doublon'))
        self.assertLess(math.dist((ops[5]['x'], ops[5]['y']), (0, 0)), 400)
        self.assertEqual(len(self.errors()), 2)  # couleur invalide, référence inconnue

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
        self.assertIn("n'a pas de modèle", self.errors()[0])  # Illustrateur sans modèle d'image

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
        inventory = '\n'.join(m['content'] for m in engine.calls[1]['messages'] if m['role'] == 'user')
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

    def test_disabled_tools_leave_the_prompt_and_are_refused(self):
        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        data = self.client.get('/api/v1/toolbox/tools').json()
        self.assertEqual(set(data['enabled']), {t['op'] for t in data['tools'] if not t.get('admin') and t.get('default', True)})
        self.assertTrue(next(t for t in data['tools'] if t['op'] == 'execute_bash')['admin'])  # porté, réservé à l'administrateur
        self.assertEqual({t['source'] for t in data['tools']}, {'nodz', 'iaqua', 'nodz+iaqua'})
        keep = [t['op'] for t in data['tools'] if t['op'] != 'archive']
        r = self.client.patch(f'/api/v1/toolbox/agents/{guardian.id}', {'tools_allowed': keep}, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.patch(f'/api/v1/toolbox/agents/{guardian.id}', {'tools_allowed': ['rm_rf']},
                                           content_type='application/json').status_code, 400)
        engine = self.run_guardian(json.dumps({'plan': ['Supprimer'], 'say': '', 'actions': [{'op': 'archive', 'ref': 'N-2'}]}))
        self.assertNotIn('"op":"archive"', engine.calls[0]['messages'][0]['content'])
        self.assertIn('désactivé', self.errors()[0])
        self.assertNotIn('archive', [a['op'] for a in self.actions()])

    def test_guidelines_are_the_guardian_system_prompt(self):
        # Les consignes du Gardien sont son prompt système : l'écran les montre en entier (commandes, cas d'usage, ses
        # outils cochés) ; réécrites en prompt complet, elles le remplacent ; des consignes anciennes (sans commandes)
        # s'ajoutent à la fin du prompt par défaut. Le mode Automatisation garde ses règles.
        from . import prompts

        agents = {a['name']: a for a in self.client.get('/api/v1/toolbox/agents').json()['agents']}
        shown = agents['Gardien']['default_prompt']
        self.assertTrue(shown.startswith("Tu es le Gardien de l'univers Nodz. Tu as tous les pouvoirs"))
        self.assertIn('{"op":"search_nodes","query":"mots"} → [L] cherche', shown)  # ses outils, écrits en entier
        self.assertIn('types : decision, family', shown)
        self.assertNotIn('{tools}', shown)
        self.assertEqual(agents['Rédacteur']['default_prompt'], prompts.ROLES[Agent.Role.TEXT])
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Une idée'}]}))
        self.assertEqual(engine.calls[0]['messages'][0]['content'], shown)  # ce que l'écran montre, c'est ce qu'il reçoit
        self.assertEqual(agents['Gardien']['prompt'], shown)

        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        guardian.system_prompt = 'Tu es un pirate. Réponds {"calls": [...]} ; commandes : {tools}'
        guardian.save()
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Arr'}]}))
        system = engine.calls[0]['messages'][0]['content']
        self.assertTrue(system.startswith('Tu es un pirate.'))
        self.assertIn('{"op":"delete","ref":"N-4"} → supprime', system)
        guardian.system_prompt = 'Tutoie toujours.'
        guardian.save()
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Salut'}]}))
        system = engine.calls[0]['messages'][0]['content']
        self.assertTrue(system.startswith("Tu es le Gardien de l'univers Nodz."))
        self.assertTrue(system.endswith('Consignes :\nTutoie toujours.'))

        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn(prompts.AUTOMATION, system)
        self.assertNotIn('Tutoie toujours.', system)
        self.assertIn('outils/web/ : web_search [L], web_fetch [L]', system)

    def test_follow_up_plan_and_intents(self):
        self.run_guardian(json.dumps({'plan': ['Relier les idées', 'Montrer le résultat'], 'say': 'Voilà.', 'actions': [
            {'op': 'link', 'source': 'N-1', 'target': 'N-2'}, {'op': 'overview'}]}))
        kinds = [k for k, _ in self.events]
        self.assertEqual(kinds[:4], ['start', 'intent', 'thinking', 'plan'])  # le plan s'écrit en direct avant d'être lu
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

    def test_attached_nodes_are_context_for_this_request(self):
        long = 'Jour 1 : Tokyo. ' * 20  # plus long que le texte d'un node du contexte ordinaire
        context = {**self.CONTEXT, 'nodes': [*self.CONTEXT['nodes'], {'id': 'N-3', 'text': long, 'x': 900, 'y': 900, 'r': 20}],
                   'attached': ['N-3', 'N-9']}
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}), context=context)
        prompt = engine.calls[0]['messages'][1]['content']
        self.assertIn(f'"id": "N-3", "texte": "{long.strip()}"', prompt)  # texte complet, le node inconnu est ignoré
        self.assertNotIn('N-9', prompt)
        self.assertEqual(prompt.count('"id": "N-3"'), 1)  # pas deux fois
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}), context={**context, 'attached': [], 'selection': []})
        self.assertIn('"plus": ', engine.calls[0]['messages'][1]['content'])  # demande suivante : texte ordinaire, le reste compté

    def test_attached_nodes_from_other_dimensions(self):
        from nodzapp.models import Layer, Node

        far = Layer.objects.create(user=self.user, layer_id=7, layer_name='Voyage')
        Node.objects.create(user=self.user, node_id=40, layer=far, text_content='<b>Temples</b> de Kyoto, ' + 'visite. ' * 60)
        context = {**self.CONTEXT, 'attached': ['N-40', 'N-99']}  # N-99 n'existe pas
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}), context=context)
        prompt = engine.calls[0]['messages'][1]['content']
        self.assertIn("Nodes joints d'autres dimensions", prompt)
        self.assertIn('"dimension": "Voyage"', prompt)
        self.assertEqual(prompt.count('visite.'), 60)  # texte complet, lu en base
        self.assertNotIn('N-99', prompt)

    def test_build_forgives_like_an_internal_api(self):
        # ce qu'un petit modèle a vraiment écrit pour « create kanban » : pas de cols, des champs d'un autre outil
        kanban = {'op': 'build', 'layout': 'kanban', 'title': 'Kanban', 'names': ['Urgent', 'Pas urgent'],
                  'slides': [{'title': 'Important', 'body': 'Déléguer'}]}
        self.run_guardian(json.dumps({'plan': ['Créer un kanban'], 'say': 'Fait.', 'actions': [kanban]}))
        texts = [a['text'] for a in self.actions() if a['op'] == 'create']
        self.assertEqual(texts[:3], ['Kanban', 'Urgent', 'Pas urgent'])  # colonnes prises dans names
        self.events = []
        self.run_guardian(json.dumps({'plan': ['Frise'], 'say': 'Fait.', 'actions': [{'op': 'build', 'layout': 'frise', 'title': 'Projet'}]}))
        self.assertEqual(len([a for a in self.actions() if a['op'] == 'create']), 4)  # « frise » compris, étapes par défaut
        self.assertEqual(self.errors(), [])

    def test_a_repeated_failure_stops_and_says_why(self):
        bad = json.dumps({'plan': ['Relier'], 'say': 'Relié.', 'actions': [{'op': 'link', 'source': 'N-1', 'target': 'N-77'}]})
        engine = self.run_guardian(bad, bad, bad)
        self.assertEqual(len(engine.calls), 2)  # il refait ce qui a échoué : on s'arrête au lieu d'un 3e tour
        answer = [d for k, d in self.events if k == 'text'][-1]['text']
        self.assertIn("Je n'ai pas réussi", answer)
        self.assertNotIn('aucune action', answer)  # la vraie raison, pas « aucune action »

    def test_build_templates_schema_and_tour(self):
        from .layouts import STEP

        matrix = {'op': 'build', 'layout': 'matrix', 'title': 'Eisenhower', 'rows': ['Urgent', 'Pas urgent'], 'cols': ['Important', 'Secondaire'],
                  'cells': [['Faire', 'Déléguer'], ['Planifier', 'Abandonner']], 'near': 'N-1', 'save_as': 'eisenhower'}
        self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': [
            matrix, {'op': 'build', 'template': 'eisenhower', 'cells': [['a', 'b'], ['c', 'd']]},
            {'op': 'build', 'layout': 'tree', 'items': ['Recherche', '  Web', 'Écriture']},
            {'op': 'build', 'layout': 'matrix'}, {'op': 'build', 'template': 'inconnu'},
            {'op': 'schema', 'type': 'swot', 'near': 'N-1', 'title': '**Café**', 'fill': {'Forces': ['Emplacement', '*Café* maison'], 'Menaces': 'Loyer'}},
            {'op': 'schema', 'type': 'SWOT'}, {'op': 'schema', 'type': 'pdca', 'fill': {'Faire': [1, 2]}}, {'op': 'tour', 'ref': 'N-1'}]}))
        creates = [a for a in self.actions() if a['op'] == 'create']
        first = [a for a in creates if a['ref'] == 'build1' or a['ref'].startswith('build1.')]
        self.assertEqual(len(first), 9)  # titre, 2 en-têtes de colonnes, 2 de lignes, 4 cases
        cell = next(a for a in first if a['ref'] == 'build1.r2c1')
        self.assertIn('Planifier', cell['text'])
        head = next(a for a in first if a['ref'] == 'build1')
        self.assertEqual((cell['x'] - head['x'], cell['y'] - head['y'], head['shape']), (STEP, -2 * STEP, 'square'))
        second = [a for a in creates if a['ref'].startswith('build2.')]
        self.assertIn('c', next(a for a in second if a['ref'] == 'build2.r2c1')['text'])  # gabarit gardé, rempli
        spots = [(a['x'], a['y']) for a in creates] + [(0, 0), (400, 0)]  # N-1, N-2 du contexte
        self.assertTrue(all(math.dist(p, q) >= 170 for i, p in enumerate(spots) for q in spots[i + 1:]))
        tree = [a for a in self.actions() if a['op'] == 'link' and a['source'].startswith('build3')]
        self.assertEqual([(a['source'], a['target']) for a in tree], [('build3.i1', 'build3.i2')])
        schema = next(a for a in self.actions() if a['op'] == 'schema')
        self.assertEqual((schema['type'], schema['title']), ('swot', '<b>Café</b>'))  # mise en forme du Gardien convertie
        self.assertEqual(schema['fill'], {'Forces': ['Emplacement', '<i>Café</i> maison'], 'Menaces': 'Loyer'})
        self.assertEqual([a['ref'] for a in self.actions() if a['op'] == 'tour'], ['N-1'])
        self.assertEqual(len(self.errors()), 3)  # gabarit inconnu, modèle inconnu, fill sans textes (la matrice sans lignes en prend par défaut)
        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        self.assertEqual(guardian.brain['templates']['eisenhower']['layout'], 'matrix')

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
        reads = '\n'.join(m['content'] for m in engine.calls[1]['messages'] if m['role'] == 'user')
        self.assertIn('N-45 (dimension Voyage) : Budget Kyoto', reads)
        self.assertIn('Jour 1 : Kyoto', reads)
        self.assertNotIn('N-47', reads)
        goto = [a for a in self.actions() if a['op'] == 'goto']
        self.assertEqual(goto, [{'op': 'goto', 'ref': 'N-45', 'layer': 2, 'text': 'Ton budget'}])
        self.assertIn('search_nodes', self.errors()[0])

    def test_the_guardian_follows_the_conversation_and_reads_cited_nodes(self):
        # Il suit la conversation (derniers échanges du chat) et lit en entier les nodes cités, sans outil de lecture ;
        # le contexte est listé dans l'ordre des identifiants (stable d'une demande à l'autre : cache de llama.cpp).
        long = 'Jour 1 : Kyoto. ' * 30
        context = {**self.CONTEXT, 'view': {'x': 400, 'y': 0},
                   'nodes': [*self.CONTEXT['nodes'], {'id': 'N-9', 'text': long, 'x': 900, 'y': 0, 'r': 20}],
                   'history': [{'role': 'user', 'text': 'crée un plan de voyage'}, {'role': 'guardian', 'text': 'Un arbre ou une liste ?'},
                               {'role': 'notice', 'text': 'ignoré'}, {'role': 'user', 'text': 'Arbre'}]}
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Fait.', 'actions': []}), context=context)
        user = engine.calls[0]['messages'][1]['content']
        self.assertLess(user.index('"id": "N-1"'), user.index('"id": "N-2"'))  # ordre des identifiants, pas des distances
        self.assertLess(user.index('"id": "N-2"'), user.index('"id": "N-9"'))
        self.assertIn('"plus": 279', user)  # 200 caractères montrés, le reste compté
        self.assertIn('Humain : crée un plan de voyage\nToi : Un arbre ou une liste ?\nHumain : Arbre', user)
        self.assertNotIn('ignoré', user)
        self.assertLess(user.index('Échanges récents'), user.index('Demande'))
        from nodzapp.models import Layer, Node

        from .guardian import Guardian
        from .models import NodeMark

        # Un node cité hors de la page (autre dimension) arrive lui aussi en objet, lu en base ; l'auteur « moi » : le Gardien.
        trip = Layer.objects.create(user=self.user, layer_id=2, layer_name='Budget')
        Node.objects.create(user=self.user, node_id=45, layer=trip, type='file', file_name='plan.pdf', file_text_content='Jour 1 : Kyoto')
        NodeMark.objects.create(owner=self.user, node_id=45, origin=NodeMark.Origin.AI)
        g = Guardian(self.user, ScriptedEngine(), lambda k, d: None)
        g.load(context)
        prompt = g.prompt('résume N-9, N-45 et N-404')
        self.assertIn(f'"id": "N-9", "texte": "{long.strip()}"', prompt)  # cité : texte entier
        self.assertIn(r'{"id": "N-45", "type": "fichier", "texte": "plan.pdf\nJour 1 : Kyoto", "par": "moi"', prompt)
        self.assertIn('"dimension": "Budget"', prompt)
        self.assertIn('{"id": "N-404", "introuvable": true}', prompt)

    def test_the_guardian_asks_and_accepts_intuitive_forms(self):
        # ask : question et choix envoyés au chat, la demande s'arrête là (on attend l'humain) ;
        # create avec children : une carte mentale.
        engine = self.run_guardian(json.dumps({'plan': [], 'say': '', 'actions': [
            {'op': 'ask', 'text': 'Un arbre ou une matrice ?', 'choices': ['Arbre', 'Matrice', 'Arbre', '']}]}))
        self.assertEqual([d for k, d in self.events if k == 'ask'], [{'text': 'Un arbre ou une matrice ?', 'choices': ['Arbre', 'Matrice']}])
        self.assertEqual(len(engine.calls), 1)
        self.events = []
        self.run_guardian(json.dumps({'plan': ['Créer'], 'say': 'Fait.', 'actions': [
            {'op': 'create', 'ref': 'new1', 'text': 'Niveau 1', 'children': ['Niveau 2', 'Niveau 3']}]}))
        created = [a['text'] for a in self.actions() if a['op'] == 'create']
        self.assertEqual(created[:3], ['Niveau 1', 'Niveau 2', 'Niveau 3'])
        self.assertEqual(sum(a['op'] == 'link' for a in self.actions()), 2)

    def test_a_prompt_too_long_for_the_model_is_shortened(self):
        # llama-cpp-python lève ValueError quand le prompt dépasse le contexte : le Gardien montre moins de nodes et de
        # texte et réessaie, au lieu d'une « erreur interne » ; sans issue, un message clair.
        class SmallContext(ScriptedEngine):
            def __init__(self, limit, *replies):
                super().__init__(*replies)
                self.limit, self.sizes = limit, []

            def chat(self, model, messages, **kw):
                size = sum(len(m['content']) for m in messages[1:])
                self.sizes.append(size)
                if size > self.limit:
                    raise ValueError(f'Requested tokens ({size}) exceed context window of {self.limit}')
                return super().chat(model, messages, **kw)

        from .guardian import Guardian, PlanError

        nodes = [{'id': f'N-{i}', 'text': f'Idée {i} ' * 60, 'x': i * 10, 'y': 0, 'r': 20} for i in range(1, 41)]
        context = {**self.CONTEXT, 'nodes': nodes, 'links': [], 'selection': []}
        engine = SmallContext(4000, json.dumps({'plan': [], 'say': 'Fait.', 'actions': []}))
        Guardian(self.user, engine, lambda k, d: self.events.append((k, d))).handle('organise', context)
        self.assertGreater(engine.sizes[0], 4000)
        self.assertLessEqual(engine.sizes[-1], 4000)
        self.assertEqual([d['text'] for k, d in self.events if k == 'text'], ['Fait.'])
        self.assertIn('Mon contexte est plein : je regarde moins de nodes…', [d['text'] for k, d in self.events if k == 'intent'])
        with self.assertRaisesRegex(PlanError, 'trop longue pour le contexte'):
            Guardian(self.user, SmallContext(10), lambda k, d: None).handle('organise', context)

    def test_grow_a_reasoning_as_an_organic_structure(self):
        # Un plan libre (une idée par ligne, indentée) pousse en étoile : un node par idée, relié à son parent, une
        # couleur par branche, sans chevauchement ; autour d'un node existant, il le développe sans le recréer.
        plan = "Photosynthèse\n- Lumière : captée par la chlorophylle\n  - Phase claire\n- Eau et CO2\n  - Cycle de Calvin\n- Oxygène"
        self.run_guardian(json.dumps({'plan': [], 'say': 'Fait.', 'actions': [{'op': 'grow', 'text': plan, 'near': 'N-1'}]}))
        created = [a for a in self.actions() if a['op'] == 'create']
        links = [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link']
        self.assertEqual([c['text'] for c in created][:2], ['Photosynthèse', 'Lumière : captée par la chlorophylle'])
        self.assertEqual(len(created), 6)
        self.assertIn(('grow1', 'grow1.n1'), links)
        self.assertIn(('grow1.n1', 'grow1.n2'), links)  # Phase claire sous Lumière
        by_ref = {c['ref']: c for c in created}
        self.assertEqual(by_ref['grow1.n1']['color'], by_ref['grow1.n2']['color'])  # même branche, même couleur
        self.assertNotEqual(by_ref['grow1.n1']['color'], by_ref['grow1.n3']['color'])
        points = [(c['x'], c['y']) for c in created]
        self.assertTrue(all(math.dist(a, b) >= 180 for i, a in enumerate(points) for b in points[i + 1:]))
        self.events = []
        self.run_guardian(json.dumps({'plan': [], 'say': 'Fait.', 'actions': [
            {'op': 'grow', 'ref': 'N-1', 'text': 'Voyage\n- Kyoto\n- Tokyo'}, {'op': 'grow', 'text': '   '}]}))
        self.assertEqual([a['ref'] for a in self.actions() if a['op'] == 'create'], ['N-1.n1', 'N-1.n2'])  # N-1 n'est pas recréé
        self.assertIn(('N-1', 'N-1.n1'), [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link'])
        self.assertIn('grow : une structure organique demande un plan', self.errors()[0])

    def test_the_guardian_formats_text_like_the_nodz_buttons(self):
        # Sa syntaxe (**gras**, *italique*, __souligné__, [#couleur]…[/], ^^grand^^, ,,petit,,, emojis) devient le
        # HTML des boutons de Nodz ; et il relit la mise en forme d'un node dans cette même syntaxe.
        from .guardian import text_html
        from .perception import readable

        self.assertEqual(text_html('^^🌱 **Photo**^^ [#33FF99]chloro[/] *ATP* __glu__ ,,p,,'),
                         '<font size="6">🌱 <b>Photo</b></font> <font color="#33FF99">chloro</font> <i>ATP</i> <u>glu</u> <font size="2">p</font>')
        self.assertEqual(text_html('<script>x</script> 2*3*4'), '&lt;script&gt;x&lt;/script&gt; 2*3*4')
        self.assertEqual(readable('<b><font color="#FF6B6B" size="7">Kyoto</font></b><br>ligne'), '**^^^[#FF6B6B]Kyoto[/]^^^**\nligne')
        self.run_guardian(json.dumps({'plan': [], 'say': '**Fait** ✅', 'actions': [{'op': 'put', 'ref': 'new1', 'text': '[#FF6B6B]Kyoto[/] 🏯'}]}))
        self.assertEqual(self.actions()[0]['text'], '<font color="#FF6B6B">Kyoto</font> 🏯')

    def test_correspondence_notes_and_replies(self):
        # note : gardée dans son cerveau et annoncée ; posée dans Échanges (API letters) ; la réponse de l'humain,
        # un node relié à la note, revient au Gardien dans la demande suivante.
        from nodzapp.models import Layer, Link, Node

        self.run_guardian(json.dumps({'plan': [], 'say': '', 'actions': [
            {'op': 'note', 'text': "J'ai vu trois nodes vides : je les range ?", 'choices': ['Oui', 'Plus tard']}]}))
        self.assertEqual([d for k, d in self.events if k == 'note'],
                         [{'id': 1, 'text': "J'ai vu trois nodes vides : je les range ?", 'choices': ['Oui', 'Plus tard']}])
        self.client.force_login(self.user)
        data = self.client.get('/api/v1/toolbox/letters').json()
        self.assertEqual((data['unread'], data['letters'][0]['node']), (1, None))
        data = self.client.post('/api/v1/toolbox/letters', {'root': 'N-10', 'posted': {'1': 'N-11'}}, content_type='application/json').json()
        self.assertEqual((data['unread'], data['root']), (0, 'N-10'))
        layer = Layer.objects.create(user=self.user, layer_id=5, layer_name='Échanges')
        for number, text in ((10, 'Échanges'), (11, 'la note'), (12, 'Oui, range-les')):
            Node.objects.create(user=self.user, node_id=number, layer=layer, text_content=text)
        Link.objects.create(user=self.user, link_id=1, linkA='N-10', linkB='N-11', layer=layer)  # racine : pas une réponse
        Link.objects.create(user=self.user, link_id=2, linkA='N-11', linkB='N-12', layer=layer)
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        prompt = engine.calls[0]['messages'][1]['content']
        self.assertIn('Correspondance (dimension Échanges) :', prompt)
        self.assertIn("Ta note N-11 (« J'ai vu trois nodes vides : je les range ? ») → l'humain a répondu : Oui, range-les", prompt)

    def think(self, *replies, context=None, request='organise', engine=None):
        from .guardian import Guardian

        engine = engine or ScriptedEngine(*replies)
        Guardian(self.user, engine, lambda kind, data: self.events.append((kind, data))).handle(
            request, {**(context or self.CONTEXT), 'mode': 'think'})
        return engine

    def test_think_mode_grows_thoughts_then_results_from_the_source(self):
        # Mode Pensée : chaque pensée devient un petit node sans cadre, relié à la précédente depuis le node source ;
        # les résultats se rattachent à la pensée qui les a produits. Aucune réponse en chat.
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Un voyage : où, quand'}, {'op': 'think', 'text': 'Kyoto au printemps'}, {'op': 'put', 'ref': 'new1', 'text': 'Kyoto', 'near': 't2', 'links': ['t2']}]}))
        ops = [(a['op'], a.get('ref') or a.get('source'), a.get('target')) for a in self.actions()]
        self.assertEqual(ops, [('create', 't1', None), ('link', 'N-1', 't1'), ('update', 't1', None), ('create', 't2', None),
                               ('link', 't1', 't2'), ('update', 't2', None), ('create', 'new1', None), ('link', 'new1', 't2'),
                               ('frame', None, None)])
        self.assertEqual(self.actions()[-1]['refs'], ['N-1', 't1', 't2', 'new1'])  # la caméra cadre la pensée entière
        thought = self.actions()[0]
        self.assertEqual((thought['shape'], thought['color']), ('none', '#8B7FC8'))
        self.assertIn('<i>Un voyage : où, quand</i>', thought['text'])
        call = engine.calls[0]
        ops = call['schema']['properties']['calls']['items']['properties']['op']['enum']
        self.assertEqual(ops[:10], ['think', 'put', 'nodes', 'style', 'link', 'grow', 'build', 'schema', 'explore', 'portal'])
        self.assertEqual(call['max_tokens'], 4096)  # un plan de 150 calls
        self.assertTrue({'edit', 'delete', 'travel', 'search_nodes', 'web_search'} <= set(ops))  # agentique minimal, aux mots courants
        self.assertFalse({'update', 'archive'} & set(ops))
        self.assertIn('on_token', call)  # le moteur réel donne aussi les jetons envisagés
        self.assertIn('Node source : N-1', call['messages'][1]['content'])
        system = call['messages'][0]['content']
        self.assertTrue(system.startswith("Tu es le Gardien de l'univers Nodz. Tu as tous les pouvoirs"))
        self.assertIn('Tes commandes :\n{"op":"think"', system)  # la liste des commandes JSON, puis les cas d'usage
        self.assertIn('L\'écrivain : « personnages et lieux de mon roman »', system)
        self.assertNotIn('send_email', call['messages'][0]['content'])  # l'automatisation reste dans son mode
        self.assertNotIn('text', [kind for kind, _ in self.events])
        self.assertEqual(self.errors(), [])

    def test_think_mode_knows_the_dimensions_and_opens_portals_last(self):
        # L'IA sait que l'univers a des dimensions (liste avec leurs nodes, portails expliqués) ; un portail demandé
        # s'ouvre après tout le reste, et la page revient ensuite dans la dimension de la pensée (gate).
        from nodzapp.models import Layer, Node

        home = Layer.objects.create(user=self.user, layer_id=1, layer_name='Home')
        budget = Layer.objects.create(user=self.user, layer_id=2, layer_name='Budget')
        for i, layer in ((1, home), (2, home), (3, budget)):
            Node.objects.create(user=self.user, node_id=i, layer=layer, text_content='x')
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Un grand sujet'}, {'op': 'portal', 'ref': 'new1', 'name': 'Japon'}, {'op': 'put', 'ref': 'new1', 'text': 'Japon', 'near': 't1', 'links': ['t1']}]}))
        system, message = (m['content'] for m in engine.calls[0]['messages'])
        self.assertIn('voyager entre les dimensions', system)
        self.assertIn("Dimensions de l'univers : Home (ici, 2 nodes), Budget (1 nodes)", message)
        ops = [a['op'] for a in self.actions()]
        self.assertEqual(ops[-2:], ['gate', 'frame'])
        self.assertEqual(self.actions()[-2]['name'], 'Japon')
        self.assertNotIn('items', self.actions()[-2])
        # L'écrivain : le détail d'un portail est posé dans la nouvelle dimension, autour du portail.
        self.events = []
        self.think(json.dumps({'calls': [{'op': 'put', 'ref': 'new1', 'text': 'Alice'},
                                         {'op': 'portal', 'ref': 'new1', 'name': 'Alice', 'items': ['**30 ans**', 'Pilote', ' ']}]}))
        gate = next(a for a in self.actions() if a['op'] == 'gate')
        self.assertEqual((gate['name'], gate['items']), ('Alice', ['<b>30 ans</b>', 'Pilote']))

    def test_think_mode_calls_another_instance_from_where_it_stands_in_the_tree(self):
        # explore : une autre instance reçoit la branche et le chemin de la racine jusqu'à elle ; sa pensée pousse
        # depuis ce node, avec ses propres références (t1.x1), et elle ne rappelle pas au-delà de la profondeur permise.
        engine = self.think(
            json.dumps({'calls': [{'op': 'think', 'text': 'Un voyage'}, {'op': 'think', 'under': 't1', 'text': 'Le budget'}, {'op': 'explore', 'ref': 't2', 'task': 'creuser le budget'}]}),
            json.dumps({'calls': [{'op': 'think', 'text': 'Vols : 900 €'}, {'op': 'put', 'ref': 'new1', 'text': 'Total', 'near': 't1', 'links': ['t1']}]}))
        self.assertEqual(len(engine.calls), 2)
        called = engine.calls[1]['messages'][1]['content']
        self.assertIn("Où tu en es dans l'arbre : Voyage au Japon → Un voyage → Le budget (ici)", called)
        self.assertIn('creuser le budget (branche « Le budget »', called)
        self.assertIn('Node source : t2', called)
        links = [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link']
        self.assertIn(('t2', 't1.x1'), links)
        self.assertIn(('new1.x1', 't1.x1'), links)
        self.assertEqual(self.errors(), [])

    def test_the_lineage_follows_the_links_of_the_page(self):
        # Une pensée partie d'un node enfant voit le chemin depuis la racine de la page (sens Node1 → Node2).
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Une idée'}]}),
                            context={**self.CONTEXT, 'nodes': [*self.CONTEXT['nodes'][:1], {**self.CONTEXT['nodes'][1], 'text': 'Kyoto'}],
                                     'selection': ['N-2']})
        self.assertIn("Où tu en es dans l'arbre : Voyage au Japon → Kyoto (ici)", engine.calls[0]['messages'][1]['content'])

    def test_think_mode_without_a_node_makes_the_request_a_node(self):
        self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Une question ouverte'}]}),
                   context={**self.CONTEXT, 'selection': []}, request='Pourquoi le ciel est bleu ?')
        first, thought, link, _update = self.actions()[:4]
        self.assertEqual((first['op'], first['ref'], first['text']), ('create', 'ask1', 'Pourquoi le ciel est bleu ?'))
        self.assertEqual((thought['ref'], link['source'], link['target']), ('t1', 'ask1', 't1'))

    def test_think_mode_refuses_automation_tools(self):
        self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Envoyer un mail'}, {'op': 'send_email', 'to': 'a@b.c'}]}))
        self.assertEqual(self.errors(), ['send_email : outil désactivé dans Agents & modèles : send_email'])

    def test_thoughts_appear_while_the_model_writes(self):
        # Les pensées poussent pendant l'écriture : la première est posée avant que la seconde soit écrite.
        events = self.events

        class Streaming(ScriptedEngine):
            def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
                self.calls.append({'messages': messages})
                self.seen = []
                pieces = ['{"calls": [{"op": "think", "text": "Premier', ' pas qui', ' se forme"}, {"op": "think", "text": "Sec', 'ond pas"}]}']
                for piece in pieces:
                    on_text(piece)
                    self.seen.append([d.get('ref') for k, d in events if k == 'action' and d['op'] == 'create'])
                return ''.join(pieces)

        engine = self.think(engine=Streaming())
        # La pensée est posée dès son premier mot, s'écrit en direct (brouillon non sauvegardé), puis se fige.
        self.assertEqual(engine.seen, [['t1'], ['t1'], ['t1', 't2'], ['t1', 't2']])
        first = self.actions()[0]
        self.assertTrue(first['forming'])
        drafts = [a for a in self.actions() if a['op'] == 'draft']
        self.assertIn('Premier pas qui', drafts[0]['text'])
        final = next(a for a in self.actions() if a['op'] == 'update' and a['ref'] == 't1')
        self.assertIn('Premier pas qui se forme', final['text'])

    def test_calls_are_planned_then_carried_out(self):
        # Plan puis exécution : les think poussent pendant l'écriture ; les autres calls attendent la fin du plan,
        # puis s'exécutent dans l'ordre ; nodes pose un lot d'un coup, chacun relié à near.
        events = self.events

        class Streaming(ScriptedEngine):
            def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
                self.calls.append({'messages': messages})
                self.seen = []
                pieces = ['{"calls": [{"op": "think", "text": "Kyoto"}, {"op": "put", "ref": "new1", "text": "Temples {zen}", "near": "t1", "links": ["t1"]}',
                          ', {"op": "think", "kind": "decision", "under": "t1", "text": "Tok', 'yo"}, {"op": "nodes", "near": "new1", "items": ["a", "b", "c"]}]}']
                for piece in pieces:
                    on_text(piece)
                    self.seen.append([d.get('ref') for k, d in events if k == 'action' and d['op'] == 'create'])
                return ''.join(pieces)

        engine = self.think(engine=Streaming())
        self.assertEqual(engine.seen, [['t1'], ['t1', 't2'], ['t1', 't2']])  # rien d'autre avant la fin du plan
        created = [a['ref'] for a in self.actions() if a['op'] == 'create']
        self.assertEqual(created, ['t1', 't2', 'new1', 'lot1.1', 'lot1.2', 'lot1.3'])
        links = [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link']
        self.assertIn(('t1', 't2'), links)  # under : branche de t1
        self.assertIn(('new1', 'lot1.3'), links)
        self.assertIn('<b>✓ Tokyo</b>', next(a['text'] for a in self.actions() if a['op'] == 'update' and a['ref'] == 't2'))
        self.assertIn('Temples {zen}', next(a['text'] for a in self.actions() if a.get('ref') == 'new1' and a['op'] == 'create'))
        self.assertIn("J'exécute mon plan : 2 calls", [d['text'] for k, d in self.events if k == 'intent'])
        self.assertEqual(self.errors(), [])

    def test_branches_grow_together_with_a_model_by_api(self):
        # Deux branches confiées : par API elles poussent en même temps (deux appels ouverts à la fois).
        import threading

        from .guardian import Guardian

        self.model.endpoint = 'https://api.example/v1'
        self.model.save()
        both = threading.Barrier(2, timeout=5)

        class Parallel(ScriptedEngine):
            def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
                self.calls.append({'messages': messages})
                if len(self.calls) == 1:
                    reply = {'calls': [{'op': 'think', 'text': 'Deux pistes'}, {'op': 'think', 'under': 't1', 'text': 'A'}, {'op': 'think', 'under': 't1', 'text': 'B'}, {'op': 'explore', 'ref': 't2', 'task': 'creuser A'}, {'op': 'explore', 'ref': 't3', 'task': 'creuser B'}]}
                else:
                    both.wait()  # l'autre branche est ouverte en même temps, sinon BrokenBarrierError
                    reply = {'calls': [{'op': 'think', 'text': 'Une idée'}]}
                on_text(json.dumps(reply))
                return json.dumps(reply)

        Guardian(self.user, Parallel(), lambda kind, data: self.events.append((kind, data))).handle(
            'organise', {**self.CONTEXT, 'mode': 'think'})
        created = {a['ref'] for a in self.actions() if a['op'] == 'create'}
        self.assertTrue({'t1.x1', 't1.x2'} <= created)
        self.assertEqual(self.errors(), [])

    def test_a_model_by_api_sees_the_universe_in_full(self):
        # Modèle par API : pas les limites d'un petit modèle sur CPU ; il voit tous les nodes, leurs textes longs, toute
        # la conversation, et sa réponse n'est pas coupée à 1024 jetons.
        long = 'mot ' * 150
        context = {**self.CONTEXT, 'nodes': [{'id': f'N-{i}', 'text': f'Node {i} {long}', 'x': i * 10, 'y': 0} for i in range(1, 81)],
                   'links': [], 'history': [{'role': 'user', 'text': f'échange {i} ' + 'détail ' * 60} for i in range(12)]}
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Vu'}]}), context=context)
        small = engine.calls[0]['messages'][1]['content']
        self.assertNotIn('N-80', small)  # petit modèle local : 40 nodes, 200 caractères
        self.model.endpoint = 'https://api.example/v1'
        self.model.save()
        self.events = []
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Vu'}]}), context=context)
        call = engine.calls[0]
        prompt = call['messages'][1]['content']
        self.assertIn('"N-80"', prompt)
        self.assertIn(long.strip()[:500], prompt)  # texte entier d'un node non sélectionné
        self.assertIn('échange 0', prompt)  # les 12 échanges
        self.assertGreater(len(prompt), 6 * len(small))
        self.assertEqual(call['max_tokens'], 4096)
        engine = self.run_guardian(json.dumps({'plan': [], 'say': 'Ok.', 'actions': []}))
        self.assertEqual(engine.calls[0]['max_tokens'], 4096)  # mode Automatisation aussi

    def test_think_mode_builds_saved_templates_from_a_thought(self):
        # Gabarits favorisés : ceux qu'il a gardés sont listés dans son prompt ; un gabarit posé depuis une pensée pend
        # à son arbre (lien depuis la pensée).
        from .models import Agent

        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        guardian.brain = {'templates': {'eisenhower': {'layout': 'matrix', 'rows': ['Urgent', 'Pas urgent'], 'cols': ['Important', 'Secondaire']}}}
        guardian.save()
        engine = self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Trier les tâches'}, {'op': 'build', 'template': 'eisenhower', 'title': 'Priorités', 'near': 't1'}]}))
        self.assertIn('Tes gabarits gardés : eisenhower', engine.calls[0]['messages'][0]['content'])
        self.assertIn(('t1', 'build1'), [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link'])
        self.assertEqual(self.errors(), [])

    def test_think_mode_reads_then_goes_on_thinking(self):
        # Agentique minimal : une lecture [L] dans le flux ; ce qu'elle a lu revient au tour suivant, la pensée continue
        # sa numérotation ; archive supprime ; un voyage part à la fin, et la caméra y reste (pas de cadrage).
        from nodzapp.models import Layer, Node

        budget = Layer.objects.create(user=self.user, layer_id=2, layer_name='Budget')
        Node.objects.create(user=self.user, node_id=7, layer=budget, text_content='Budget Japon 2026')
        engine = self.think(
            json.dumps({'calls': [{'op': 'think', 'text': 'Chercher le budget'}, {'op': 'search_nodes', 'query': 'budget'}]}),
            json.dumps({'calls': [{'op': 'think', 'text': 'Trouvé : N-7'}, {'op': 'delete', 'ref': 'N-2'}, {'op': 'goto', 'ref': 'N-7'}, {'op': 'put', 'ref': 'new1', 'text': 'Suite', 'near': 't2', 'links': ['t2']}]}))
        self.assertEqual(len(engine.calls), 2)
        follow = engine.calls[1]['messages'][-1]['content']
        self.assertIn('Ce que tu as lu :', follow)
        self.assertIn('N-7 (dimension Budget)', follow)
        self.assertIn('tes think suivants sont t2', follow)
        ops = [(a['op'], a.get('ref')) for a in self.actions()]
        self.assertIn(('create', 't2'), ops)
        self.assertIn(('archive', 'N-2'), ops)
        self.assertEqual(ops[-1], ('goto', 'N-7'))  # en dernier, sans cadrage après
        self.assertIn('{"op":"search_nodes","query":"mots"} → [L] cherche', engine.calls[0]['messages'][0]['content'])  # une commande de plus
        self.assertEqual(self.errors(), [])

    def test_thoughts_branch_and_have_a_kind(self):
        # Deux espaces : une branche du pas d'avant ; ? doute, ✗ piste écartée, ✓ décision ; la pensée principale
        # reprend du dernier pas principal.
        self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Trois pistes'}, {'op': 'think', 'under': 't1', 'text': 'jeu de mots'}, {'op': 'think', 'under': 't1', 'text': '✗ lieu : trop banal'}, {'op': 'think', 'text': '? court ou long'}, {'op': 'think', 'text': '✓ Garder court'}]}))
        links = [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link']
        self.assertEqual(links, [('N-1', 't1'), ('t1', 't2'), ('t1', 't3'), ('t1', 't4'), ('t4', 't5')])
        final = {a['ref']: a['text'] for a in self.actions() if a['op'] == 'update'}
        color = {a['ref']: a['color'] for a in self.actions() if a['op'] == 'create'}
        self.assertIn('<s>lieu : trop banal</s>', final['t3'])
        self.assertEqual(color['t3'], '#5A5575')
        self.assertIn('<i>? court ou long</i>', final['t4'])
        self.assertIn('<b>✓ Garder court</b>', final['t5'])

    def test_thoughts_echo_the_nodes_they_recall(self):
        context = {**self.CONTEXT, 'nodes': [*self.CONTEXT['nodes'], {'id': 'N-3', 'text': 'Budget 2026', 'x': 0, 'y': 300}]}
        self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Ça rappelle N-2'}, {'op': 'think', 'text': 'Penser au budget 2026 avant tout'}]}), context=context)
        links = [(a['source'], a['target']) for a in self.actions() if a['op'] == 'link']
        self.assertIn(('t1', 'N-2'), links)
        self.assertIn(('t2', 'N-3'), links)

    def test_near_misses_whisper_around_the_thought(self):
        # Mots presque dits : quand le modèle hésitait, les mots qu'il a failli écrire flottent autour de la pensée une
        # fois celle-ci finie ; éphémères, ce ne sont pas des nodes.
        class Hesitant(ScriptedEngine):
            def chat(self, model, messages, *, json_schema=None, on_text=None, on_token=None, **params):
                self.calls.append({'messages': messages})
                pieces = [('{"calls": [{"op": "think", "text": "Kyoto au', None), (' printemps', [(' printemps', 0.4), (' automne', 0.3), (' été', 0.05)]),
                          ('"}]}', None)]
                for piece, chances in pieces:
                    on_token(piece, chances)
                return ''.join(piece for piece, _ in pieces)

        self.think(engine=Hesitant())
        self.assertIn({'op': 'whisper', 'ref': 't1', 'words': ['automne']}, self.actions())
        self.assertEqual([a['ref'] for a in self.actions() if a['op'] == 'create'], ['t1'])  # aucun node de plus

    def test_results_use_the_style_catalogue(self):
        # Catalogue de style : sans couleur, un résultat prend celle de la famille de sa pensée d'attache ; type code,
        # taille et forme passent ; style restyle un node existant.
        self.think(json.dumps({'calls': [{'op': 'think', 'text': 'Deux familles'}, {'op': 'think', 'text': 'Un code'}, {'op': 'put', 'ref': 'new1', 'text': 'A', 'near': 't1', 'links': ['t1'], 'shape': 'square', 'radius': 150}, {'op': 'put', 'ref': 'new2', 'text': 'B', 'near': 't1', 'links': ['t1']}, {'op': 'put', 'ref': 'new3', 'text': 'print(1)', 'near': 't2', 'links': ['t2'], 'content_type': 'code', 'color': '#33FF99'}, {'op': 'style', 'ref': 'N-1', 'color': '#FFD93D', 'radius': 160}]}))
        color = {a['ref']: a['color'] for a in self.actions() if a['op'] == 'create'}
        self.assertEqual(color['new1'], color['new2'])
        self.assertNotEqual(color['new1'], None)
        self.assertEqual(color['new3'], '#33FF99')
        self.assertIn({'op': 'set_type', 'ref': 'new3', 'content_type': 'code'}, self.actions())
        styles = {a['ref']: a for a in self.actions() if a['op'] == 'style'}
        self.assertEqual(styles['new1']['radius'], 150.0)
        self.assertEqual((styles['N-1']['color'], styles['N-1']['radius']), ('#FFD93D', 160.0))
        self.assertEqual(self.errors(), [])

    def test_deep_mode_muses_freely_before_thinking(self):
        # Mode Profond : réflexion libre d'abord (sans format), en étincelles depuis le source, puis la pensée en JSON
        # qui relit cette réflexion.
        from .guardian import Guardian

        engine = ScriptedEngine('Une intuition sur le voyage.\nPeut-être trop cher ?\nok',
                                json.dumps({'calls': [{'op': 'think', 'text': 'Voyage raisonnable'}]}))
        Guardian(self.user, engine, lambda kind, data: self.events.append((kind, data))).handle(
            'organise', {**self.CONTEXT, 'mode': 'deep'})
        sparks = [a for a in self.actions() if a['op'] == 'create' and a['ref'].startswith('s')]
        self.assertEqual([s['ref'] for s in sparks], ['s1', 's2'])  # « ok » : trop court pour une étincelle
        self.assertIn('Peut-être trop cher ?', sparks[1]['text'])
        self.assertIsNone(engine.calls[0]['schema'])
        self.assertIn('pense librement', engine.calls[0]['messages'][1]['content'])
        self.assertEqual(engine.calls[1]['messages'][2], {'role': 'assistant', 'content': 'Une intuition sur le voyage.\nPeut-être trop cher ?\nok'})
        self.assertEqual(engine.calls[1]['messages'][0], engine.calls[0]['messages'][0])  # même début : relu du cache

    def test_warm_reads_the_think_system_prompt(self):
        from .guardian import Guardian

        engine = ScriptedEngine(json.dumps({'calls': [{'op': 'think', 'text': 'Salut'}]}))
        engine.prefill = lambda model, messages, **kw: engine.calls.append({'prefill': messages})
        Guardian(self.user, engine, lambda kind, data: None).warm('think')
        self.think(engine=engine)
        self.assertEqual(engine.calls[0]['prefill'][0], engine.calls[1]['messages'][0])

    def test_put_writes_a_node_as_it_is_read(self):
        # put : le même objet qu'en lecture ; nouveau node avec liens et enfants, node existant restylé et relié.
        self.run_guardian(json.dumps({'plan': [], 'say': 'Fait.', 'actions': [
            {'op': 'put', 'ref': 'new1', 'near': 'N-1', 'text': 'Kyoto', 'color': '#FF6B6B', 'links': ['N-1', 'new1'], 'children': ['Temples']},
            {'op': 'put', 'ref': 'N-2', 'text': 'Budget', 'shape': 'square', 'links': ['new1']},
            {'op': 'put', 'ref': 'N-404', 'text': 'x'}]}))
        ops = [(a['op'], a.get('ref') or a.get('source'), a.get('target') or a.get('text')) for a in self.actions()]
        self.assertEqual(ops, [('create', 'new1', 'Kyoto'), ('link', 'new1', 'N-1'), ('create', 'new1.1', 'Temples'),
                               ('link', 'new1', 'new1.1'), ('update', 'N-2', 'Budget'), ('style', 'N-2', None), ('link', 'N-2', 'new1')])
        self.assertEqual(self.actions()[0]['color'], '#FF6B6B')
        self.assertEqual(self.errors(), ["put : référence inconnue : 'N-404'"])

    def test_an_unexpected_error_fails_one_action_only(self):
        # Un outil qui plante sur une action inattendue : l'action échoue seule (type d'erreur affiché), la demande
        # continue et le modèle est invité à la réécrire ; plus d'« erreur interne du Gardien » pour toute la demande.
        from .guardian import Guardian

        with mock.patch.object(Guardian, 'op_overview', side_effect=AttributeError('boom'), create=True):
            engine = self.run_guardian(
                json.dumps({'plan': [], 'say': 'Voilà.', 'actions': [{'op': 'overview'}, {'op': 'link', 'source': 'N-1', 'target': 'N-2'}]}))
        self.assertEqual(self.errors(), ['overview : erreur interne (AttributeError)'])
        self.assertIn('link', [a['op'] for a in self.actions()])
        self.assertIn('action impossible', engine.calls[-1]['messages'][-1]['content'])

    def test_cut_plan_keeps_what_was_said(self):
        # Plan coupé en route (boucle arrêtée ou longueur maximale) : say est gardé, les actions tronquées non.
        self.run_guardian('{"plan": [], "say": "Bonjour !", "actions": [{"op": "create", "ref": "new1", "text": "enc')
        self.assertEqual([d['text'] for k, d in self.events if k == 'text'], ['Bonjour !'])
        self.assertEqual(self.actions(), [])  # pas de node tronqué
        self.assertIn("s'est emballé", [d['text'] for k, d in self.events if k == 'notice'][0])
        self.events = []
        self.run_guardian('{"plan": ["Créer 22 nodes"], "say": "J\'ai créé 22 nodes.", "actions": [{"op": "create", "ref": "new1", "te')
        self.assertIn("mon modèle s'est emballé en écrivant ses actions", [d['text'] for k, d in self.events if k == 'text'][0])  # jamais « J'ai créé » quand rien n'est fait
        with self.assertRaisesRegex(Exception, "s'est emballé"):
            self.run_guardian('{"plan": ["Saluer"], "say": "Bonj')

    def test_warm_reads_the_same_system_prompt(self):
        from .guardian import Guardian

        engine = ScriptedEngine(json.dumps({'plan': [], 'say': 'Bonjour.', 'actions': []}))
        engine.prefill = lambda model, messages, **kw: engine.calls.append({'prefill': messages})
        guardian = Guardian(self.user, engine, lambda kind, data: None)
        guardian.warm()
        Guardian(self.user, engine, lambda kind, data: None).handle('salut', self.CONTEXT)
        self.assertEqual(engine.calls[0]['prefill'][0], engine.calls[1]['messages'][0])  # même début : llama.cpp le réutilise

    def test_repeated_read_is_not_redone(self):
        # Petit modèle qui relit le même node à chaque tour : la relecture est sautée, une relance lui demande de
        # répondre, puis la boucle s'arrête ; sa réponse après lecture n'est pas remplacée par un échec.
        from nodzapp.models import Layer, Node

        home = Layer.objects.create(user=self.user, layer_id=1, layer_name='Home')
        Node.objects.create(user=self.user, node_id=171, layer=home, text_content='<p>Budget Kyoto : 900 euros</p>')
        read = {'plan': ['lire le contenu du node N-171'], 'say': "J'ai lu le contenu du node N-171.",
                'actions': [{'op': 'read_file', 'ref': 'N-171'}]}
        engine = self.run_guardian(json.dumps(read), json.dumps(read), json.dumps(read), json.dumps(read))
        self.assertEqual(len(engine.calls), 3)  # lecture, relecture sautée avec relance, relecture : arrêt
        feedback = [m['content'] for m in engine.calls[-1]['messages'] if m['role'] == 'user'][1:]
        self.assertEqual(len(feedback), 2)
        self.assertIn('Budget Kyoto', feedback[0])
        self.assertIn('Tu refais read_file', feedback[1])
        self.assertEqual([d['text'] for k, d in self.events if k == 'text'], ["J'ai lu le contenu du node N-171."])
        self.assertEqual(self.errors(), [])

    def test_web_tools(self):
        from . import web

        with mock.patch.object(web, 'search', return_value=[{'title': 'Kyoto', 'url': 'https://ex.org/k', 'snippet': 'Temples'}]), \
                mock.patch.object(web, 'fetch', side_effect=web.WebError('adresse interne refusée : localhost')):
            engine = self.run_guardian(
                json.dumps({'plan': ['Chercher'], 'say': '', 'actions': [{'op': 'web_search', 'query': 'Kyoto'}, {'op': 'web_fetch', 'url': 'http://localhost/'}]}),
                json.dumps({'plan': [], 'say': 'Trouvé.', 'actions': []}),
            )
        self.assertIn('- Kyoto (https://ex.org/k) : Temples', '\n'.join(m['content'] for m in engine.calls[1]['messages'] if m['role'] == 'user'))
        self.assertIn('interne', self.errors()[0])

    def test_announced_plan_without_actions_is_relaunched(self):
        self.CONTEXT = {**self.CONTEXT, 'origin': 'N-1'}
        promise = {'plan': ['Créer les étapes du voyage'], 'say': 'Je vais créer les étapes.', 'actions': []}
        engine = self.run_guardian(json.dumps(promise), json.dumps({'plan': ['Créer les étapes du voyage'], 'say': "J'ai créé Kyoto.",
                                                                    'actions': [{'op': 'create', 'ref': 'new1', 'text': 'Kyoto'}]}))
        self.assertIn('sans aucune action', engine.calls[1]['messages'][-1]['content'])
        created = [html.unescape(a['text']) for a in self.actions() if a['op'] == 'create']
        self.assertEqual(created, ['Kyoto', "J'ai créé Kyoto."])  # le node-réponse dit ce qui a été fait

    def test_nothing_done_is_said_honestly(self):
        self.CONTEXT = {**self.CONTEXT, 'origin': 'N-1'}
        promise = json.dumps({'plan': ['Créer les étapes'], 'say': 'Je vais créer les étapes.', 'actions': []})
        engine = self.run_guardian(*[promise] * 4)
        self.assertEqual(len(engine.calls), 4)
        reply = html.unescape([a['text'] for a in self.actions() if a['op'] == 'create'][-1])
        self.assertIn("Je n'ai pas réussi", reply)
        self.assertNotIn('Je vais', reply)

    def test_failed_actions_are_sent_back_for_correction(self):
        engine = self.run_guardian(
            json.dumps({'plan': ['Relier'], 'say': '', 'actions': [{'op': 'link', 'source': 'N-1', 'target': 'N-9'}]}),
            json.dumps({'plan': ['Relier'], 'say': "J'ai relié.", 'actions': [{'op': 'link', 'source': 'N-1', 'target': 'N-2'}]}),
        )
        self.assertIn('N-9', engine.calls[1]['messages'][-1]['content'])
        self.assertIn({'op': 'link', 'source': 'N-1', 'target': 'N-2'}, self.actions())

    def test_illustrator_draws_into_a_node(self):
        from . import imaging

        flux = LocalModel.objects.create(repo='r/flux', filename='flux1-schnell-Q2_K.gguf', path='/m/f.gguf',
                                         kind=LocalModel.Kind.IMAGE, status=LocalModel.Status.READY)
        Agent.objects.filter(owner=self.user, role=Agent.Role.IMAGE).update(model=flux)
        plan = {'plan': ['Dessiner'], 'say': 'Voilà.', 'actions': [
            {'op': 'delegate', 'agent': 'Illustrateur', 'task': 'a fox under cherry blossoms', 'ref': 'new1', 'near': 'N-1'},
            {'op': 'delegate', 'agent': 'Illustrateur', 'task': 'broken', 'ref': 'new2'}]}

        def fake(model, prompt, user, on_progress, **params):
            if prompt == 'broken':
                raise imaging.ImageUnavailable('pas de VAE')
            on_progress(4, 4)
            return 'a' * 32 + '.png'

        with mock.patch.object(imaging, 'generate', side_effect=fake):
            engine = self.run_guardian(json.dumps(plan))
        self.assertEqual(engine.exclusive_owners, ['agent:Illustrateur', 'agent:Illustrateur'])
        images = [a for a in self.actions() if a['op'] == 'image']
        self.assertEqual(images, [{'op': 'image', 'ref': 'new1', 'url': f"toolbox/images/{'a' * 32}.png"}])
        self.assertIn('Illustrateur dessine…', [a.get('text', '') for a in self.actions() if a['op'] == 'create'][0])
        self.assertIn('Illustrateur dessine : étape 4/4', [d['text'] for k, d in self.events if k == 'intent'])
        self.assertIn('pas de VAE', self.errors()[-1])
        Agent.objects.filter(owner=self.user, role=Agent.Role.IMAGE).update(model=self.model)  # modèle de texte
        self.events = []
        self.run_guardian(json.dumps({'plan': [], 'say': '', 'actions': [
            {'op': 'delegate', 'agent': 'Illustrateur', 'task': 'x', 'ref': 'new1'}]}))
        self.assertIn('bon type', self.errors()[0])

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


FAKE_SD = r'''#!/bin/sh
case "$1" in --help) echo "usage: sd --diffusion-model --cfg-scale"; exit 0;; esac
out=""; prev=""
for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done
echo "$@" > "$out.args"
printf '  |=====>    | 1/4 - 2.00s/it\r  |==========> | 4/4 - 2.00s/it\n'
printf '\211PNG fake' > "$out"
'''


@override_settings(SD_BIN='')
class ImagingTests(TestCase):
    def setUp(self):
        from . import imaging

        imaging._binary.clear()
        self.addCleanup(imaging._binary.clear)
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.sd = self.root / 'sd'
        self.sd.write_text(FAKE_SD)
        self.sd.chmod(0o755)
        self.user = NodzUser.objects.create_user(email='i@nodz.local', password='x')

    def model(self, name, repo='second-state/FLUX.1-schnell-GGUF'):
        folder = self.root / 'models' / repo.replace('/', '__')
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(b'x')
        return LocalModel.objects.create(repo=repo, filename=name, path=str(folder / name), kind=LocalModel.Kind.IMAGE,
                                         status=LocalModel.Status.READY, params={'steps': 2, 'vae_tiling': True})

    def test_flux_generation_with_companions_and_progress(self):
        from . import imaging

        model = self.model('flux1-schnell-Q2_K.gguf')
        with override_settings(SD_BIN=str(self.sd), MODELS_DIR=self.root / 'models', MEDIA_ROOT=self.root / 'media'):
            with self.assertRaisesMessage(imaging.ImageUnavailable, 'compagnons'):
                imaging.generate(model, 'a red fox', self.user)
            for name in ('ae.safetensors', 'clip_l.safetensors'):
                (Path(model.path).parent / name).write_bytes(b'x')
            (self.root / 'models' / 't5xxl-Q2_K.gguf').write_bytes(b'x')  # ailleurs dans le dossier des modèles
            steps = []
            name = imaging.generate(model, 'a red fox', self.user, on_progress=lambda i, n: steps.append((i, n)))
            path = imaging.image_path(self.user, name)
            args = Path(str(path) + '.args').read_text()
        self.assertTrue(path.read_bytes().startswith(b'\x89PNG'))
        self.assertEqual(steps, [(1, 4), (4, 4)])
        self.assertIn('--diffusion-model', args)
        self.assertIn('--steps 2', args)
        self.assertIn('--cfg-scale 1.0', args)
        self.assertIn('--vae-tiling', args)
        self.assertIn('t5xxl-Q2_K.gguf', args)

    def test_missing_binary_and_safe_paths(self):
        from . import imaging

        model = self.model('sd-turbo-q8_0.gguf', repo='org/sd-turbo')
        with override_settings(SD_BIN=str(self.root / 'absent')), self.assertRaisesMessage(imaging.ImageUnavailable, 'installé'):
            imaging.generate(model, 'x', self.user)
        with override_settings(MEDIA_ROOT=self.root / 'media'):
            self.assertIsNone(imaging.image_path(self.user, '../../etc/passwd'))
            self.assertIsNone(imaging.image_path(self.user, f'{"a" * 32}.png'))

    def test_flux_pack_picks_files_for_the_machine(self):
        fake = FakeHfApi()
        names = ['flux1-schnell-Q2_K.gguf', 'flux1-schnell-Q4_0.gguf', 'ae.safetensors', 'clip_l.safetensors',
                 't5xxl-Q2_K.gguf', 't5xxl-Q4_0.gguf', 'README.md']
        fake.model_info = lambda repo, files_metadata=False: SimpleNamespace(siblings=[SimpleNamespace(rfilename=n, size=10) for n in names])
        with mock.patch.object(hub, 'api', return_value=fake), mock.patch.object(hub, 'start_download') as start, \
                mock.patch.object(hub, 'machine', return_value={'budget_mb': 2000}):
            hub.install_pack('flux-schnell')
        chosen = [(c.args[1], c.args[3]) for c in start.call_args_list]
        self.assertEqual(chosen, [('flux1-schnell-Q2_K.gguf', 'image'), ('ae.safetensors', 'component'),
                                  ('clip_l.safetensors', 'component'), ('t5xxl-Q2_K.gguf', 'component')])
        with mock.patch.object(hub, 'api', return_value=fake), mock.patch.object(hub, 'start_download') as start, \
                mock.patch.object(hub, 'machine', return_value={'budget_mb': 20000}):
            hub.install_pack('flux-schnell')
        self.assertEqual(start.call_args_list[0].args[1], 'flux1-schnell-Q4_0.gguf')
        with self.assertRaisesMessage(ValueError, 'inconnu'):
            hub.install_pack('nope')


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
        self.assertEqual(kinds, ['start', 'intent', 'thinking', 'plan', 'intent', 'action', 'text', 'end'])
        self.assertIn('"say": "Fait."', ''.join(json.loads(line[6:])['text'] for line in body.splitlines()
                                               if line.startswith('data: ') and '"round"' in line))  # réflexion = le plan écrit
        self.assertIn('Bonjour', body)
        from .models import GuardianLog

        entry = await GuardianLog.objects.filter(owner=self.user, kind='demande').alast()  # la console IA en fait le compte
        self.assertRegex(entry.detail, r'^dis bonjour → 1 actions, [\d.]+ s$')

    async def test_stop_cuts_the_model_and_ends_the_request(self):
        from .runtime import dispatcher

        user, closed = self.user, []

        class Endless(ScriptedEngine):  # écrit sans fin ; le bouton stop arrive au troisième fragment
            def chat(self, model, messages, *, json_schema=None, on_text=None, **params):
                try:
                    for i in range(10_000):
                        if i == 2:
                            dispatcher.stop(user.pk)
                        on_text('{"plan"')
                finally:
                    closed.append(i)  # le flux du modèle est fermé
                return ''

        await self.async_client.aforce_login(user)
        r = await self.async_client.post('/api/v1/toolbox/command/stop', {}, content_type='application/json')
        self.assertFalse(json.loads(r.content)['stopped'])  # rien en cours
        with mock.patch.object(api, 'engine', Endless()):
            r = await self.async_client.post('/api/v1/toolbox/command', {'prompt': 'x', 'context': {'nodes': [], 'layers': []}},
                                             content_type='application/json')
            body = ''.join([chunk.decode() async for chunk in r.streaming_content])
        kinds = [line.split(': ', 1)[1] for line in body.splitlines() if line.startswith('event: ')]
        self.assertEqual(kinds[-2:], ['stopped', 'end'])
        self.assertEqual(closed, [2])
        self.assertEqual(dispatcher.state()['running'], 0)  # l'utilisateur peut redemander

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


class CudaBuildTests(TestCase):
    def test_build_is_staff_only_and_reports_the_script(self):
        from . import cuda

        user = NodzUser.objects.create_user(email='u@nodz.local', password='pw-123456')
        admin = NodzUser.objects.create_user(email='root@nodz.local', password='pw-123456', is_staff=True)
        self.client.force_login(user)
        self.assertEqual(self.client.post('/api/v1/toolbox/cuda', {'action': 'build'}, content_type='application/json').status_code, 403)
        self.client.force_login(admin)
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'cuda.sh'
            script.write_text('echo "Pas de carte NVIDIA"\nexit 2\n')
            with mock.patch.object(cuda, 'SCRIPT', script):
                r = self.client.post('/api/v1/toolbox/cuda', {'action': 'build'}, content_type='application/json')
                self.assertEqual(r.status_code, 200)
                for _ in range(50):
                    data = self.client.get('/api/v1/toolbox/cuda').json()
                    if not data['running']:
                        break
                    time.sleep(0.1)
        self.assertEqual((data['code'], data['result'], data['log']), (2, 'pas de carte NVIDIA', ['Pas de carte NVIDIA']))
        r = self.client.post('/api/v1/toolbox/cuda', {'action': 'nimporte'}, content_type='application/json')
        self.assertEqual(r.status_code, 400)


class DimensionsTests(TestCase):
    def test_pinned_dimensions_and_counts(self):
        from nodzapp.models import Layer, Node

        user = NodzUser.objects.create_user(email='d@nodz.local', password='pw-123456')
        home, budget = Layer.objects.create(user=user, layer_name='Home'), Layer.objects.create(user=user, layer_name='Budget')
        Node.objects.create(user=user, layer=budget, node_id=1)
        Node.objects.create(user=user, layer=budget, node_id=2, archive=True)
        self.client.force_login(user)
        r = self.client.patch('/api/v1/toolbox/dimensions', {'pinned': [budget.layer_id, 99, budget.layer_id]}, content_type='application/json')
        self.assertEqual(r.json(), {'pinned': [budget.layer_id], 'counts': {str(budget.layer_id): 1}})  # dimension inconnue écartée
        self.assertEqual(self.client.get('/api/v1/toolbox/dimensions').json()['pinned'], [budget.layer_id])
        self.assertEqual(self.client.patch('/api/v1/toolbox/dimensions', {'pinned': 'x'}, content_type='application/json').status_code, 400)
        self.assertEqual(home.layer_id, 1)


class SearchTests(TestCase):
    def test_search_all_dimensions(self):
        from nodzapp.models import Layer, Node

        user = NodzUser.objects.create_user(email='s@nodz.local', password='pw-123456')
        home, budget = Layer.objects.create(user=user, layer_name='Home'), Layer.objects.create(user=user, layer_name='Budget')
        Node.objects.create(user=user, layer=home, node_id=1, text_content='<b>Voyage</b> au Japon')
        Node.objects.create(user=user, layer=budget, node_id=2, text_content='Budget voyage')
        Node.objects.create(user=user, layer=budget, node_id=3, text_content='Loyer')
        self.client.force_login(user)
        results = self.client.get('/api/v1/toolbox/search?q=voyage').json()['results']
        self.assertEqual(sorted((r['id'], r['dimension']) for r in results), [('N-1', 'Home'), ('N-2', 'Budget')])
        self.assertIn('Voyage au Japon', [r['text'] for r in results])
        self.assertEqual(self.client.get('/api/v1/toolbox/search?q=').json()['results'], [])


class ApiResponse:
    def __init__(self, status=200, lines=(), body=None):
        self.status_code, self.lines, self.body, self.closed = status, list(lines), body or {}, False
        self.text = json.dumps(self.body)

    def iter_lines(self, decode_unicode=False):
        yield from self.lines

    def json(self):
        return self.body

    def close(self):
        self.closed = True


class ApiModelTests(TestCase):
    def setUp(self):
        self.admin = NodzUser.objects.create_user(email='root@nodz.local', password='pw-123456', is_staff=True)
        self.client.force_login(self.admin)

    def sse(self, *pieces, usage=None):
        lines = [f'data: {json.dumps({"choices": [{"delta": {"content": p}}]})}' for p in pieces]
        if usage:
            lines.append(f'data: {json.dumps({"choices": [], "usage": usage})}')
        return ApiResponse(lines=[*lines, 'data: [DONE]'])

    def test_add_check_and_hide_the_key(self):
        with mock.patch('toolbox.remote.requests.post', return_value=ApiResponse(body={'choices': []})) as post:
            r = self.client.post('/api/v1/toolbox/models', {'endpoint': 'http://localhost:11434/v1/', 'name': 'qwen2.5:3b', 'api_key': 'sk-secret'},
                                 content_type='application/json')
        self.assertEqual(r.status_code, 201)
        data = r.json()
        self.assertEqual((data['endpoint'], data['filename'], data['has_key'], data['status']), ('http://localhost:11434/v1', 'qwen2.5:3b', True, 'ready'))
        self.assertNotIn('sk-secret', r.content.decode())  # la clé ne quitte jamais le serveur
        self.assertEqual(post.call_args.args[0], 'http://localhost:11434/v1/chat/completions')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer sk-secret')
        self.assertNotIn('sk-secret', self.client.get('/api/v1/toolbox/models').content.decode())
        with mock.patch('toolbox.remote.requests.post', return_value=ApiResponse(status=401, body={'error': 'bad key'})):
            r = self.client.post('/api/v1/toolbox/models', {'endpoint': 'https://api.example.com/v1', 'name': 'x'}, content_type='application/json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('401', r.json()['error'])
        user = NodzUser.objects.create_user(email='u@nodz.local', password='pw-123456')
        self.client.force_login(user)
        self.assertEqual(self.client.post('/api/v1/toolbox/models', {'endpoint': 'http://x/v1', 'name': 'x'},
                                          content_type='application/json').status_code, 403)  # administrateurs seulement

    def test_engine_streams_from_the_api(self):
        model = LocalModel.objects.create(repo='api:localhost', filename='qwen2.5:3b', endpoint='http://localhost:11434/v1',
                                          status=LocalModel.Status.READY)
        engine = Engine(Broker(), factory=lambda **kw: self.fail('pas de chargement local'))
        pieces = []
        with mock.patch('toolbox.remote.requests.post', return_value=self.sse('{"say"', ': "ok"}', usage={'prompt_tokens': 812})) as post:
            text = engine.chat(model, [{'role': 'user', 'content': 'bonjour'}], json_schema={'type': 'object'}, on_text=pieces.append)
        self.assertEqual((text, pieces), ('{"say": "ok"}', ['{"say"', ': "ok"}']))
        payload = post.call_args.kwargs['json']
        self.assertEqual((payload['model'], payload['stream'], payload['response_format']['type']), ('qwen2.5:3b', True, 'json_schema'))
        self.assertNotIn('Authorization', post.call_args.kwargs['headers'])  # pas de clé : pas d'en-tête
        self.assertEqual(engine.stats[model.pk]['last']['prompt_tokens'], 812)
        self.assertIsNone(engine.loaded)  # rien de chargé en mémoire
        self.assertFalse(engine.prefill(model, [{'role': 'system', 'content': 'consignes'}]))
        refused = ApiResponse(status=400, body={'error': 'response_format json_schema not supported'})
        with mock.patch('toolbox.remote.requests.post', side_effect=[refused, self.sse('{}')]) as post:
            engine.chat(model, [{'role': 'user', 'content': 'x'}], json_schema={'type': 'object'})
        self.assertEqual(post.call_args.kwargs['json']['response_format'], {'type': 'json_object'})  # serveur sans schéma
        from .engine import EngineUnavailable
        import requests
        with mock.patch('toolbox.remote.requests.post', side_effect=requests.ConnectionError()), self.assertRaises(EngineUnavailable):
            engine.chat(model, [{'role': 'user', 'content': 'x'}])


class RunCodeTests(TestCase):
    def setUp(self):
        self.user = NodzUser.objects.create_user(email='dev@nodz.local', password='pw-123456', is_staff=True)
        self.client.force_login(self.user)
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_code(self, **body):
        return self.client.post('/api/v1/toolbox/run', body, content_type='application/json')

    def test_server_run_is_gated_confined_and_timed(self):
        self.assertEqual(self.run_code(language='python', code='print(1)').status_code, 403)  # GUARDIAN_SHELL=0
        with self.settings(GUARDIAN_SHELL=True, WORKSPACE_DIR=self.tmp):
            r = self.run_code(language='python', code='import os\nprint(6 * 7, os.getcwd())').json()
            self.assertEqual(r['code'], 0)
            self.assertIn('42', r['stdout'])
            self.assertIn(self.tmp, r['stdout'])  # dans son espace de travail
            self.assertIn('boom', self.run_code(language='bash', code='echo boom >&2; exit 3').json()['stderr'])
            self.assertEqual(self.run_code(language='ruby', code='x').status_code, 400)
            with mock.patch('toolbox.workspace.TIMEOUT', 1):
                self.assertIn('délai', self.run_code(language='python', code='import time\ntime.sleep(5)').json()['stderr'])
            self.user.is_staff = False
            self.user.save()
            self.assertEqual(self.run_code(language='python', code='print(1)').status_code, 403)  # pas administrateur


class NodeMetaTests(TestCase):
    def test_created_modified_and_author(self):
        from nodzapp.models import Layer, Node
        from .models import NodeMark

        user = NodzUser.objects.create_user(email='ada@nodz.local', password='pw-123456', username='Ada')
        layer = Layer.objects.create(user=user, layer_name='Home')
        for n in (1, 2, 3):
            Node.objects.create(user=user, layer=layer, node_id=n)
        NodeMark.objects.create(owner=user, node_id=2, origin=NodeMark.Origin.AI)
        NodeMark.objects.create(owner=user, node_id=3, origin=NodeMark.Origin.MESSAGE)
        other = NodzUser.objects.create_user(email='x@nodz.local', password='pw-123456')
        Node.objects.create(user=other, layer=Layer.objects.create(user=other, layer_name='X'), node_id=4)
        self.client.force_login(user)
        nodes = self.client.get('/api/v1/toolbox/nodes/meta?ids=N-1,N-2,N-3,N-4,x').json()['nodes']
        self.assertEqual({k: (v['origin'], v['author']) for k, v in nodes.items()},
                         {'N-1': ('human', 'Ada'), 'N-2': ('ai', 'le Gardien'), 'N-3': ('message', 'Ada, pour le Gardien')})  # N-4 : pas à lui
        self.assertIn('T', nodes['N-1']['created'])


class SideViewTests(TestCase):
    def test_all_dimensions_links_and_portals(self):
        from nodzapp.models import Layer, Link, Node

        user = NodzUser.objects.create_user(email='side@nodz.local', password='pw-123456')
        other = NodzUser.objects.create_user(email='other@nodz.local', password='pw-123456')
        home, far = Layer.objects.create(user=user, layer_name='Home'), Layer.objects.create(user=user, layer_name='Loin')
        Node.objects.create(user=user, layer=home, node_id=1, y_coordinate=120.4, text_content='<b>Porte</b>', quantum='[{"node": "N-3", "layer": "2"}]')
        Node.objects.create(user=user, layer=home, node_id=2, text_content='Voisin', type='image', image_content='data:image/png;base64,AAAA')
        Node.objects.create(user=user, layer=far, node_id=3, quantum='[{"node": "N-1", "layer": "1"}]', type='file', file_name='rapport.pdf')
        Node.objects.create(user=user, layer=far, node_id=4, archive=True)
        Node.objects.create(user=other, layer=Layer.objects.create(user=other, layer_name='X'), node_id=5)
        Link.objects.create(user=user, link_id=1, linkA='N-1', linkB='N-2', layer=home)
        Link.objects.create(user=user, link_id=2, linkA='N-3', linkB='N-4', layer=far)  # vers un node archivé
        self.client.force_login(user)
        data = self.client.get('/api/v1/toolbox/side').json()
        self.assertEqual([(n['id'], n['layer']) for n in data['nodes']], [('N-1', 1), ('N-2', 1), ('N-3', 2)])
        self.assertEqual(data['nodes'][0]['y'], 120)
        self.assertEqual((data['nodes'][0]['text'], data['nodes'][0]['html']), ('Porte', '<b>Porte</b>'))
        self.assertNotIn('image', data['nodes'][0])  # images et documents : pour leurs seuls nodes
        self.assertEqual(data['nodes'][1]['image'], 'data:image/png;base64,AAAA')
        self.assertEqual((data['nodes'][2]['type'], data['nodes'][2]['file']), ('file', 'rapport.pdf'))
        self.assertEqual(data['links'], [['N-1', 'N-2']])
        self.assertEqual(data['portals'], [['N-1', 'N-3']])
        self.assertEqual([layer['name'] for layer in data['layers']], ['Home', 'Loin'])


class AdminConsoleTests(TestCase):
    def setUp(self):
        from .models import GuardianLog, Schedule

        self.user = NodzUser.objects.create_user(email='u@nodz.local', password='pw-123456')
        self.admin = NodzUser.objects.create_user(email='root@nodz.local', password='pw-123456', is_staff=True)
        self.guardian = Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR)
        GuardianLog.objects.create(owner=self.user, kind='demande', detail='range mes idées → 3 actions, 2.0 s')
        GuardianLog.objects.create(owner=self.user, kind='demande', detail='x → échec : pas de modèle, 0.1 s')
        self.schedule = Schedule.objects.create(owner=self.user, number=1, expr='hourly', title='veille')

    def test_staff_only(self):
        self.client.force_login(self.user)
        for url in ('overview', 'log', 'users', 'planned'):
            self.assertEqual(self.client.get(f'/api/v1/toolbox/admin/{url}').status_code, 403)

    def test_overview_log_and_planned(self):
        self.client.force_login(self.admin)
        data = self.client.get('/api/v1/toolbox/admin/overview').json()
        self.assertEqual((data['totals']['requests_today'], data['totals']['errors_week'], data['totals']['active_week']), (2, 1, 1))
        self.assertEqual(data['days'][-1]['requests'], 2)
        self.assertEqual(data['top'], [{'user': 'u@nodz.local', 'requests': 2}])
        entries = self.client.get('/api/v1/toolbox/admin/log?q=idées').json()['entries']
        self.assertEqual([e['user'] for e in entries], ['u@nodz.local'])
        planned = self.client.get('/api/v1/toolbox/admin/planned').json()
        self.assertEqual(planned['schedules'][0]['ref'], 'sched_0001')
        r = self.client.patch(f'/api/v1/toolbox/admin/schedules/{self.schedule.pk}', {'enabled': False}, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.schedule.refresh_from_db()
        self.assertFalse(self.schedule.enabled)

    def test_users_staff_and_guardian(self):
        self.client.force_login(self.admin)
        data = self.client.get('/api/v1/toolbox/admin/users').json()
        row = next(u for u in data['users'] if u['id'] == self.user.pk)
        self.assertEqual((row['requests_week'], row['guardian']['enabled'], row['staff']), (2, True, False))
        url = f'/api/v1/toolbox/admin/users/{self.user.pk}'
        row = self.client.patch(url, {'staff': True, 'guardian': False}, content_type='application/json').json()['user']
        self.assertEqual((row['staff'], row['guardian']['enabled']), (True, False))
        r = self.client.patch(f'/api/v1/toolbox/admin/users/{self.admin.pk}', {'staff': False}, content_type='application/json')
        self.assertEqual(r.status_code, 400)  # jamais son propre droit
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_staff)


@override_settings(GUARDIAN_SHELL=False)
class IaquaToolsTests(TestCase):
    """Outils portés d'iAqua : chaque famille, les garde-fous et le Gardien installé dans l'univers."""

    CONTEXT = {'layer': {'id': 1, 'name': 'Home'}, 'layers': [{'id': 1, 'name': 'Home'}],
               'nodes': [{'id': 'N-1', 'text': 'Voyage', 'x': 0, 'y': 0, 'r': 20}], 'links': [], 'view': {'x': 0, 'y': 0}, 'origin': 'N-1'}

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        override = override_settings(WORKSPACE_DIR=self.root / 'ws', GUARDIAN_PYENV=self.root / 'pyenv')
        override.enable()
        self.addCleanup(override.disable)
        self.user = NodzUser.objects.create_user(email='iaqua@nodz.local', password='pw-123456')
        self.model = LocalModel.objects.create(repo='org/m', filename='a.gguf', path='/m/a.gguf', status=LocalModel.Status.READY)
        self.client.force_login(self.user)
        self.client.get('/api/v1/toolbox/agents')
        Agent.objects.filter(owner=self.user).exclude(role=Agent.Role.IMAGE).update(model=self.model)
        self.events = []

    def run_guardian(self, *actions_per_round, request='organise', replies=()):
        from .guardian import Guardian

        rounds = [json.dumps({'plan': ['Agir'], 'say': 'Fait.', 'actions': actions}) for actions in actions_per_round]
        engine = ScriptedEngine(*rounds, *replies)
        self.events = []
        Guardian(self.user, engine, lambda kind, data: self.events.append((kind, data))).handle(request, self.CONTEXT)
        return engine

    def errors(self):
        return [d['message'] for k, d in self.events if k == 'error']

    def reads(self, engine, call=1):
        return '\n'.join(m['content'] for m in engine.calls[call]['messages'] if m['role'] == 'user')

    def test_tasks_and_schedules(self):
        from . import iaqua
        from .models import Schedule, Task

        engine = self.run_guardian(
            [{'op': 'create_task', 'title': 'Écrire le programme', 'description': 'Jour par jour', 'agent': 'Rédacteur',
              'acceptance_criteria': '3 jours', 'priority': 'high'},
             {'op': 'update_task', 'task_id': 'task_0001', 'field': 'progress', 'value': 'plan établi'},
             {'op': 'schedule_task', 'action': 'create', 'expr': 'daily@08:30', 'title': 'Revue du matin'},
             {'op': 'schedule_task', 'action': 'create', 'expr': 'toutes les heures'},
             {'op': 'list_tasks'}],
        )
        task = Task.objects.get(owner=self.user)
        self.assertEqual((task.key, task.priority, task.agent.name, len(task.progress)), ('task_0001', 'high', 'Rédacteur', 1))
        self.assertIn('task_0001 [planned, high] Écrire le programme', self.reads(engine))
        self.assertIn('expression inconnue', self.errors()[0])
        schedule = Schedule.objects.get(owner=self.user)
        morning = timezone.make_aware(datetime(2026, 9, 28, 8, 31))
        self.assertEqual([t.title for t in iaqua.fire_due_schedules(now=morning)], ['Revue du matin'])
        self.assertEqual(iaqua.fire_due_schedules(now=morning + timedelta(hours=2)), [])  # une fois par jour
        schedule.refresh_from_db()
        self.assertEqual(schedule.last_fired_at, morning)
        self.run_guardian([{'op': 'delete_task', 'task_id': 'task_0001'}])
        self.assertFalse(Task.objects.filter(number=1, owner=self.user).exists())

    def test_run_task_with_its_agent(self):
        from . import iaqua
        from .models import Task

        task = Task.objects.create(owner=self.user, number=1, title='Résumer', agent=Agent.objects.get(owner=self.user, name='Rédacteur'))
        with mock.patch('toolbox.iaqua.connection'):
            iaqua.run_task(task.pk, ScriptedEngine('Un résumé.'))
        task.refresh_from_db()
        self.assertEqual((task.status, task.result), ('completed', 'Un résumé.'))

    def test_projects_memory_and_audit(self):
        from nodzapp.models import Layer, Node

        from .models import Project

        engine = self.run_guardian([{'op': 'create_project', 'name': 'japon', 'vision': 'Deux semaines au Japon'}])
        self.assertIn({'op': 'dimension', 'name': 'JAPON'}, [d for k, d in self.events if k == 'action'])
        layer = Layer.objects.create(user=self.user, layer_id=2, layer_name='JAPON')
        Node.objects.create(user=self.user, node_id=10, layer=layer, text_content='Kyoto')
        Node.objects.create(user=self.user, node_id=11, layer=layer, text_content='')
        engine = self.run_guardian(
            [{'op': 'update_project_memory', 'project_name': 'Japon', 'kind': 'decision', 'content': 'Train JR Pass'},
             {'op': 'update_project_memory', 'project_name': 'JAPON', 'kind': 'blocker', 'content': 'Visa à vérifier'},
             {'op': 'update_project', 'project_name': 'JAPON', 'field': 'status', 'new_value': 'deleted'},
             {'op': 'audit_project', 'project_name': 'JAPON'}, {'op': 'list_projects'}, {'op': 'plan_project', 'goal': 'itinéraire', 'project': 'JAPON'}],
        )
        memory = Project.objects.get(owner=self.user).memory
        self.assertIn('Train JR Pass', memory['decisions'][0])
        text = self.reads(engine)
        self.assertIn('Dimension : 2 nodes, 1 vides, 2 sans lien', text)
        self.assertIn('Visa à vérifier', text)
        self.assertIn('JAPON [active] 0/0 tâches', text)
        self.assertIn('Agents : ', text)
        self.assertIn('suppression est laissée', self.errors()[0])
        # Sans nom de projet : une erreur que le modèle peut corriger, plus un plantage de la demande.
        self.run_guardian([{'op': 'read_project_memory'}, {'op': 'audit_project'}])
        self.assertEqual(self.errors(), ['read_project_memory : nom du projet requis (project_name) : list_projects les donne',
                                         'audit_project : nom du projet requis (project_name) : list_projects les donne'])

    def test_mission_runs_plans_and_tasks(self):
        from . import iaqua
        from .models import Mission

        self.run_guardian([{'op': 'create_project', 'name': 'NEWS'}])
        with mock.patch('toolbox.iaqua.threading.Thread') as thread:
            self.run_guardian([{'op': 'launch_mission', 'goal': 'Trois titres du jour', 'project': 'NEWS', 'budget': 2}])
        mission = Mission.objects.get(owner=self.user)
        self.assertEqual(thread.call_args.kwargs['target'], iaqua.run_mission)
        engine = ScriptedEngine(
            json.dumps({'done': False, 'summary': 'Je rédige', 'tasks': [{'title': 'Titres', 'agent': 'Rédacteur', 'task': 'Trois titres'}]}),
            'Titre 1\nTitre 2\nTitre 3',
            json.dumps({'done': True, 'summary': 'Trois titres rédigés', 'tasks': []}),
        )
        with mock.patch('toolbox.iaqua.connection'):
            iaqua.run_mission(mission.pk, engine)
        mission.refresh_from_db()
        self.assertEqual((mission.status, mission.iterations), ('done', 2))
        self.assertEqual(mission.project.tasks.get().result, 'Titre 1\nTitre 2\nTitre 3')
        self.assertIn('Mission mission_0001', mission.project.memory['achievements'][0])
        engine = self.run_guardian([{'op': 'mission_status', 'mission_id': 'mission_0001'}])
        self.assertIn('Trois titres rédigés', self.reads(engine))

    def test_skills_brain_and_logs(self):
        engine = self.run_guardian(
            [{'op': 'write_skill', 'skill_id': 'visite', 'name': 'Visite guidée', 'summary': 'Montrer un plan', 'steps': ['overview', 'focus']},
             {'op': 'write_skill', 'skill_id': 'visite', 'summary': 'Montrer un plan, v2'},
             {'op': 'record_skill_outcome', 'skill_id': 'visite', 'outcome': 'success'},
             {'op': 'update_brain_field', 'field_path': 'style.ton', 'value': '"joueur"'},
             {'op': 'update_user_context', 'text': 'Aime les cartes'},
             {'op': 'list_skills'}, {'op': 'read_my_brain', 'section_path': 'style'}, {'op': 'create_task', 'title': 'x'},
             {'op': 'get_logs', 'event_type': 'task_created'}],
        )
        text = self.reads(engine)
        self.assertIn('visite v2 : Montrer un plan, v2', text)
        self.assertIn('réussites 1', text)
        self.assertIn('"ton": "joueur"', text)
        self.assertIn('task_created : task_0001 x', text)
        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        self.assertEqual((guardian.brain['style'], guardian.memory), ({'ton': 'joueur'}, ['Aime les cartes']))

    def test_workspace_files_git_and_documents(self):
        engine = self.run_guardian(
            [{'op': 'write_file', 'path': 'notes/plan.md', 'content': 'Jour 1 : Tokyo'},
             {'op': 'edit_file', 'path': 'notes/plan.md', 'search_text': 'Tokyo', 'replace_text': 'Kyoto'},
             {'op': 'write_file', 'path': '../../etc/passwd', 'content': 'x'},
             {'op': 'read_file', 'path': 'notes/plan.md'}, {'op': 'list_files', 'path': 'notes'},
             {'op': 'git', 'action': 'commit', 'message': 'Plan'},
             {'op': 'generate_docx', 'filename': 'rapport', 'title': 'Voyage', 'markdown': '# Jour 1\n- Kyoto'},
             {'op': 'generate_pptx', 'filename': 'pitch', 'title': 'Japon', 'slides': [{'title': 'Kyoto', 'bullets': ['Temples']}]}],
        )
        text = self.reads(engine)
        self.assertIn('Jour 1 : Kyoto', text)
        self.assertIn('- plan.md (14 o)', text)
        self.assertIn('/api/v1/toolbox/workspace/exports/rapport.docx', text)
        self.assertIn('hors de l\'espace de travail', self.errors()[0])
        r = self.client.get('/api/v1/toolbox/workspace/exports/pitch.pptx')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/api/v1/toolbox/workspace/../secret').status_code, 404)
        log = self.run_guardian([{'op': 'git', 'action': 'log'}])
        self.assertIn('Plan', self.reads(log))

    def test_email_only_to_self_without_admin(self):
        from django.core import mail

        with self.settings(EMAIL_HOST='smtp.local', EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
            self.run_guardian([{'op': 'send_email', 'subject': 'Rappel', 'body': 'Kyoto'},
                               {'op': 'send_email', 'to': 'autre@x.fr', 'subject': 'Spam', 'body': '...'}])
        self.assertEqual([m.to for m in mail.outbox], [['iaqua@nodz.local']])
        self.assertIn("qu'à ton adresse", self.errors()[0])

    def test_admin_tools_are_gated(self):
        from . import tools

        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        self.assertNotIn('execute_bash', tools.enabled(guardian, self.user))
        guardian.tools_allowed = ['create', 'execute_bash']
        guardian.save()
        self.assertEqual(tools.enabled(guardian, self.user), ['create', 'open', 'tool_help', 'ask', 'put', 'note'])  # pas administrateur ; open, ask, put et note toujours permis
        self.user.is_staff = True
        self.user.save()
        self.assertEqual(tools.enabled(guardian, self.user), ['create', 'open', 'tool_help', 'ask', 'put', 'note'])  # GUARDIAN_SHELL=0
        with self.settings(GUARDIAN_SHELL=True):
            self.assertIn('execute_bash', tools.enabled(guardian, self.user))
            engine = self.run_guardian([{'op': 'execute_bash', 'command': 'echo bonjour > salut.txt && cat salut.txt'}])
            self.assertIn('bonjour', self.reads(engine))
            forge = self.run_guardian([{'op': 'forge_tool', 'action': 'create', 'name': 'double',
                                        'code': 'import json, sys\nprint(json.dumps(json.load(sys.stdin)["n"] * 2))', 'test_input': '{"n": 2}'}])
        self.assertIn('outil désactivé', self.errors()[0])  # forge_tool n'est pas coché

    def test_backdrop_checked_before_now_allows_schema(self):
        from . import tools

        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        guardian.tools_allowed = ['create', 'backdrop', 'schema']
        guardian.save()
        self.assertEqual(tools.enabled(guardian, self.user), ['create', 'schema', 'open', 'tool_help', 'ask', 'put', 'note'])

    def test_delete_agent_needs_an_explicit_request(self):
        Agent.objects.create(owner=self.user, name='Traducteur')
        self.run_guardian([{'op': 'delete_agent', 'agent': 'Traducteur'}], request='supprime Traducteur')
        self.assertIn('outil désactivé', self.errors()[0])  # coupé par défaut : il faut le cocher
        guardian = Agent.objects.get(owner=self.user, role=Agent.Role.ORCHESTRATOR)
        guardian.tools_allowed = ['delete_agent']
        guardian.save()
        self.run_guardian([{'op': 'delete_agent', 'agent': 'Rédacteur'}, {'op': 'delete_agent', 'agent': 'Traducteur'}],
                          request='range un peu')
        self.assertIn('agent de départ', self.errors()[0])
        self.assertIn('irréversible', self.errors()[1])
        self.run_guardian([{'op': 'delete_agent', 'agent': 'Traducteur'}], request='supprime Traducteur')
        self.assertFalse(Agent.objects.filter(owner=self.user, name='Traducteur').exists())

    def test_mcp_server(self):
        from . import workspace

        servers = json.dumps({'docs': {'url': 'https://mcp.example/mcp', 'description': 'Documentation'}})
        replies = [b'{"jsonrpc":"2.0","id":1,"result":{}}', b'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"42"}]}}\n\n']

        class Reply:
            def __init__(self, body):
                self.body, self.headers = body, {'Mcp-Session-Id': 's1'}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return self.body

        with self.settings(MCP_SERVERS=servers), mock.patch.object(workspace.urllib.request, 'urlopen', side_effect=[Reply(b) for b in replies]) as opened:
            self.assertEqual(workspace.mcp_call('docs', 'answer', {'q': 'vie'}), '42')
        self.assertEqual(opened.call_args.args[0].headers['Mcp-session-id'], 's1')
        with self.assertRaisesMessage(workspace.WorkspaceError, 'inconnu'):
            workspace.mcp_call('absent', 'x')

    def test_short_prompt_and_tool_help(self):
        from . import tools

        engine = self.run_guardian([{'op': 'tool_help', 'names': ['create_task', 'execute_bash']}])
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn('outils/taches/ : tâches (5 outils)', system)  # dossier rare : son sujet seul
        self.assertIn('outils/nodes/ : put, create, update', system)  # dossier courant : les noms, sans mode d'emploi
        self.assertIn('  {"op":"archive","ref":"N-4"}', system)  # outil courant : son exemple JSON
        self.assertNotIn('annulable avec Ctrl+Z', system)  # sa prose vient avec la demande qui l'appelle
        self.assertNotIn('execute_bash', system)
        self.assertIn(tools.BY_OP['create_task']['doc'], self.reads(engine))  # tool_help, ancien nom, toujours compris

    def test_the_request_brings_the_tools_it_calls_for(self):
        engine = self.run_guardian([], request='relie Kyoto à Tokyo et crée une tâche pour demain')
        messages = engine.calls[0]['messages']
        system, message = messages[0]['content'], messages[1]['content']  # la liste s'allonge aux tours suivants
        self.assertIn('Outils pour cette demande :', message)
        self.assertIn('outils/liens/link : ', message)  # « relie » → outils/liens, mode d'emploi complet
        self.assertIn('outils/taches/create_task : ', message)  # « tâche » → outils/taches
        self.assertNotIn('web_search', message)
        engine = self.run_guardian([], request='bonjour')
        self.assertNotIn('Outils pour cette demande', engine.calls[0]['messages'][1]['content'])
        self.assertEqual(engine.calls[0]['messages'][0]['content'], system)  # le prompt système ne bouge pas : relu du cache

    def test_open_reads_the_tool_directory(self):
        from . import tools

        engine = self.run_guardian([{'op': 'open', 'paths': ['outils/taches', 'outils/nodes/style', 'outils', 'outils/rien']}])
        read = self.reads(engine)
        self.assertIn('- create_task (', read)  # le dossier : ses outils et leur exemple
        self.assertIn(f"outils/nodes/style : {tools.BY_OP['style']['doc']}", read)  # l'outil : son mode d'emploi complet
        self.assertIn('outils/ : dialogue/ (2)', read)  # la racine : les dossiers
        engine = self.run_guardian([{'op': 'open', 'path': 'outils/rien'}])
        self.assertIn('adresse inconnue', self.errors()[-1])

    def test_memory_and_brain_live_in_the_universe(self):
        from nodzapp.models import Layer, Node

        layer = Layer.objects.create(user=self.user, layer_id=3, layer_name='Gardien')
        memory = Node.objects.create(user=self.user, node_id=53, layer=layer, text_content='Mémoire du Gardien<br>- Richard aime Kyoto<br>- vélo le dimanche')
        brain = Node.objects.create(user=self.user, node_id=54, layer=layer, text_content='Cerveau du Gardien')
        self.client.post('/api/v1/toolbox/brain-map', {'prompt': 'N-50', 'tools': {'create_task': 'N-51'}}, content_type='application/json')
        r = self.client.post('/api/v1/toolbox/brain-map', {'memory': 'N-53', 'brain': 'N-54'}, content_type='application/json')
        self.assertEqual(r.json()['universe'], {'prompt': 'N-50', 'memory': 'N-53', 'brain': 'N-54', 'tools': {'create_task': 'N-51'}})  # ajouté, rien d'écrasé
        engine = self.run_guardian([{'op': 'remember', 'text': 'Prépare un voyage en mai'},
                                    {'op': 'template_save', 'name': 'retro', 'layout': 'kanban', 'cols': ['Bien', 'Mieux']}])
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn('- Richard aime Kyoto', system)  # écrit à la main dans le node : c'est sa mémoire
        memory.refresh_from_db()
        brain.refresh_from_db()
        self.assertEqual(memory.text_content, 'Mémoire du Gardien<br>- Richard aime Kyoto<br>- vélo le dimanche<br>- Prépare un voyage en mai')
        self.assertIn('Gabarits gardés : retro (kanban)', brain.text_content)
        self.assertEqual(self.client.get('/api/v1/toolbox/brain-map').json()['memory'][-1], 'Prépare un voyage en mai')

    def test_guardian_reads_its_universe_nodes(self):
        from nodzapp.models import Layer, Node

        layer = Layer.objects.create(user=self.user, layer_id=3, layer_name='Gardien')
        Node.objects.create(user=self.user, node_id=50, layer=layer, text_content='Prompt système<br><br>Tu parles comme un capitaine.')
        Node.objects.create(user=self.user, node_id=51, layer=layer, text_content='create_task<br>Mon mode d&#x27;emploi à moi')
        Node.objects.create(user=self.user, node_id=52, layer=layer, text_content='archive', archive=True)
        r = self.client.post('/api/v1/toolbox/brain-map', {'prompt': 'N-50', 'tools': {'create_task': 'N-51', 'archive': 'N-52', 'nope': 'N-9'}},
                             content_type='application/json')
        self.assertEqual(r.json()['saved'], 2)
        engine = self.run_guardian([{'op': 'tool_help', 'names': ['create_task']}, {'op': 'archive', 'ref': 'N-1'}])
        system = engine.calls[0]['messages'][0]['content']
        self.assertIn('Tu parles comme un capitaine.', system)
        self.assertIn("Mon mode d'emploi à moi", self.reads(engine))
        self.assertIn('outil désactivé', self.errors()[0])  # son node a été supprimé
        self.assertTrue(self.client.get('/api/v1/toolbox/brain-map').json()['installed'])


class DoctorTests(TestCase):
    """Diagnostic du Gardien : chaque étape en clair, arrêt à la première panne."""

    def setUp(self):
        self.user = NodzUser.objects.create_user(email='doc@nodz.local', password='pw-123456')
        self.client.force_login(self.user)
        self.url = '/api/v1/toolbox/doctor'

    def labels(self):
        return [(c['label'], c['ok']) for c in self.client.post(self.url, {}, content_type='application/json').json()['checks']]

    def test_stops_at_the_first_failure(self):
        self.assertEqual(self.labels(), [('Gardien actif', False)])
        guardian = Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR)
        self.assertEqual(self.labels(), [('Gardien actif', True), ('Modèle choisi', False)])
        guardian.model = LocalModel.objects.create(repo='org/m', filename='m.gguf', path='/absent/m.gguf', status=LocalModel.Status.READY)
        guardian.save()
        self.assertEqual(self.labels()[-1], ('Fichier du modèle', False))

    def test_full_run_reports_context_and_speed(self):
        path = Path(tempfile.mkdtemp()) / 'm.gguf'
        path.write_bytes(b'x')
        self.addCleanup(shutil.rmtree, path.parent)
        model = LocalModel.objects.create(repo='org/m', filename='m.gguf', path=str(path), status=LocalModel.Status.READY)
        Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR, model=model)

        class Measured(ScriptedEngine):
            stats = {}

            def available(self):
                return True

            def gpu_offload(self):
                return False

            def chat(self, model, messages, **params):
                self.stats[model.pk] = {'last': {'prompt_tokens': 3500, 'wait_s': 30.0, 'speed': 1.2}}
                return 'OK'

        placement = {'n_ctx': 4096, 'fits': True, 'need_mb': 1500, 'ram_free_mb': 3000, 'gpu_layers': 0, 'layers': 28}
        with mock.patch.object(api, 'engine', Measured()), mock.patch.object(api.fit, 'resolve', return_value=({}, placement)):
            checks = self.client.post(self.url, {}, content_type='application/json').json()['checks']
        by = {c['label']: c for c in checks}
        self.assertTrue(by['Mémoire']['ok'])
        self.assertFalse(by['Contexte']['ok'])  # 3500 + 1024 > 4096 : sa réponse ne tiendrait pas
        self.assertIn('augmente le contexte', by['Contexte']['detail'])
        self.assertFalse(by['Vitesse']['ok'])
        self.assertIn('30.0 s', by['Essai du modèle']['detail'])
