"""Le vrai moteur, de bout en bout : llama-cpp-python charge un mini-modèle (poids aléatoires, vocabulaire de llama.cpp
dans fixtures/), le Gardien lui envoie son vrai prompt, l'arrêt dur le coupe en pleine lecture. Le modèle écrit du
charabia : on vérifie la mécanique (chargement, contexte, grammaire, arrêt), pas le contenu. Ignoré sans
llama-cpp-python et gguf (pip install -r requirements-ai.txt).

C'est ce test qui aurait pris le contexte trop court (4096) : llama.cpp refusait la demande du Gardien.
"""

import tempfile
import threading
import time
from pathlib import Path
from unittest import mock, skipUnless

from django.test import TransactionTestCase

try:
    import gguf
    import llama_cpp  # noqa: F401
    import numpy as np
    REAL = True
except ImportError:
    REAL = False

VOCAB = Path(__file__).parent / 'fixtures' / 'ggml-vocab-llama-spm.gguf'
TEMPLATE = "{% for m in messages %}<|{{ m['role'] }}|>\n{{ m['content'] }}\n{% endfor %}<|assistant|>\n"


def tiny_model(path, context=8192):
    """Un llama minuscule (2 couches, 64 dimensions) sur le vrai vocabulaire : quelques Mo, chargé en un instant."""
    source = gguf.GGUFReader(str(VOCAB))
    writer = gguf.GGUFWriter(str(path), 'llama')
    E, H, L, FF = 64, 4, 2, 128
    writer.add_name('tiny'); writer.add_context_length(context); writer.add_embedding_length(E); writer.add_block_count(L)
    writer.add_feed_forward_length(FF); writer.add_head_count(H); writer.add_head_count_kv(H); writer.add_rope_dimension_count(E // H)
    writer.add_layer_norm_rms_eps(1e-5); writer.add_file_type(1)
    for name, field in source.fields.items():
        if not name.startswith('tokenizer.'):
            continue
        kind = field.types[0]
        if kind == gguf.GGUFValueType.ARRAY:
            strings = field.types[-1] == gguf.GGUFValueType.STRING
            writer.add_array(name, [bytes(field.parts[i]).decode('utf-8', 'replace') if strings else field.parts[i].tolist()[0] for i in field.data])
        elif kind == gguf.GGUFValueType.STRING:
            writer.add_string(name, bytes(field.parts[-1]).decode())
        elif kind == gguf.GGUFValueType.UINT32:
            writer.add_uint32(name, int(field.parts[-1][0]))
        elif kind == gguf.GGUFValueType.BOOL:
            writer.add_bool(name, bool(field.parts[-1][0]))
    writer.add_string('tokenizer.chat_template', TEMPLATE)
    vocab = len(source.fields['tokenizer.ggml.tokens'].data)
    rng = np.random.default_rng(0)
    weights = lambda *shape: (rng.standard_normal(shape) * 0.02).astype(np.float16)
    ones = lambda n: np.ones(n, np.float32)
    writer.add_tensor('token_embd.weight', weights(vocab, E))
    writer.add_tensor('output_norm.weight', ones(E))
    writer.add_tensor('output.weight', weights(vocab, E))
    for i in range(L):
        block = f'blk.{i}.'
        for part in ('attn_q', 'attn_k', 'attn_v', 'attn_output'):
            writer.add_tensor(f'{block}{part}.weight', weights(E, E))
        writer.add_tensor(block + 'attn_norm.weight', ones(E))
        writer.add_tensor(block + 'ffn_norm.weight', ones(E))
        writer.add_tensor(block + 'ffn_gate.weight', weights(FF, E))
        writer.add_tensor(block + 'ffn_up.weight', weights(FF, E))
        writer.add_tensor(block + 'ffn_down.weight', weights(E, FF))
    writer.write_header_to_file(); writer.write_kv_data_to_file(); writer.write_tensors_to_file(); writer.close()


@skipUnless(REAL, 'llama-cpp-python et gguf absents')
class RealEngineTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.folder = tempfile.TemporaryDirectory()
        cls.path = Path(cls.folder.name) / 'tiny.gguf'
        tiny_model(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()
        super().tearDownClass()

    def setUp(self):
        from nodzapp.models import NodzUser

        from .broker import Broker
        from .engine import Engine
        from .models import Agent, LocalModel

        self.user = NodzUser.objects.create_user(email='real@nodz.local', password='pw-123456', premium=True)
        self.model = LocalModel.objects.create(repo='test/tiny', filename='tiny.gguf', path=str(self.path),
                                               status=LocalModel.Status.READY, params={'max_tokens': 40})
        Agent.objects.create(owner=self.user, name='Gardien', role=Agent.Role.ORCHESTRATOR, model=self.model)
        self.engine = Engine(Broker())
        self.engine._watch = lambda: None

    def test_the_guardian_prompt_runs_on_the_real_engine(self):
        from . import fit
        from .errors import PlanError
        from .guardian import Guardian

        nodes = [{'id': f'N-{i}', 'text': f'Idée {i} sur le voyage au Japon, Kyoto et Tokyo', 'x': i * 10, 'y': i * 5} for i in range(80)]
        try:  # RAM presque pleine, sans GPU : le contexte tombe au plancher (sur 4 Go, avec un 1.5B, c'était 4096)
            with mock.patch.object(fit, 'free_memory', return_value=(0, 100)):
                Guardian(self.user, self.engine, lambda kind, data: None).handle(
                    'crée un node Bonjour', {'layer': {'id': 1, 'name': 'Home'}, 'nodes': nodes, 'links': [], 'layers': [{'id': 1, 'name': 'Home'}]})
        except PlanError:
            pass  # poids aléatoires : le plan est du charabia, refusé proprement (ce n'est pas une panne du moteur)
        last = self.engine.stats[self.model.pk]['last']
        placement = self.engine.placement[self.model.pk]
        self.assertGreaterEqual(placement['n_ctx'], 8192)  # plancher : le prompt du Gardien et sa réponse tiennent
        self.assertGreater(last['prompt_tokens'], 1000)
        self.assertLessEqual(last['prompt_tokens'] + last['tokens'], placement['n_ctx'])
        self.assertGreater(last['tokens'], 0)  # le modèle a bien écrit (grammaire JSON comprise)

    def test_think_mode_grammar_runs_on_the_real_engine(self):
        # Mode Pensée : llama.cpp accepte la grammaire de son schéma, le flux passe par la lecture des pensées.
        from .errors import PlanError
        from .guardian import Guardian

        self.model.params = {'max_tokens': 120}
        self.model.save()
        events = []
        try:
            Guardian(self.user, self.engine, lambda kind, data: events.append((kind, data))).handle(
                'pense au voyage', {'mode': 'think', 'layer': {'id': 1, 'name': 'Home'}, 'links': [], 'layers': [{'id': 1, 'name': 'Home'}],
                                    'nodes': [{'id': 'N-1', 'text': 'Voyage au Japon', 'x': 0, 'y': 0}], 'selection': ['N-1']})
        except PlanError:
            pass  # poids aléatoires : pensées et résultats peuvent être du charabia refusé proprement
        self.assertGreater(sum(1 for kind, _ in events if kind == 'tick'), 0)  # le modèle a écrit, sous la grammaire
        self.assertGreater(self.engine.stats[self.model.pk]['last']['tokens'], 0)

    def test_hard_stop_cuts_the_prompt_reading(self):
        from .broker import BACKGROUND
        from .engine import EngineUnavailable, acting_for

        self.model.params = {'n_batch': 8, 'n_threads': 1, 'max_tokens': 5}
        self.model.save()
        outcome = {}

        def work():
            try:
                with acting_for(self.user):
                    self.engine.chat(self.model, [{'role': 'system', 'content': 'mot ' * 3800}, {'role': 'user', 'content': 'x'}],
                                     priority=BACKGROUND)
                outcome['result'] = 'fini'
            except EngineUnavailable as e:
                outcome['result'] = str(e)

        worker = threading.Thread(target=work)
        worker.start()
        while self.engine._current is None and worker.is_alive():
            time.sleep(0.01)
        time.sleep(0.2)
        self.assertFalse(self.engine.interrupt(self.user.pk + 1))  # un autre utilisateur n'arrête rien
        self.assertTrue(self.engine.interrupt(self.user.pk))
        started = time.monotonic()
        worker.join(30)
        self.assertEqual(outcome['result'], 'arrêté')
        self.assertLess(time.monotonic() - started, 2)
        text = self.engine.chat(self.model, [{'role': 'user', 'content': 'bonjour'}], max_tokens=5)  # le modèle resservit
        self.assertTrue(text)
