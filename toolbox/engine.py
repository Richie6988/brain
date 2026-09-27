"""Inférence locale GGUF via llama-cpp-python (optionnel : sans lui, Nodz fonctionne sans IA).

Un modèle chargé à la fois (le broker sérialise), sortie en flux, JSON contraint par grammaire
quand un schéma est fourni (fiabilise l'orchestrateur, même avec un petit modèle sur CPU).
Réglages par modèle (params.py : GPU, cache, contexte, threads, échantillonnage), statistiques
d'usage et déchargement après inactivité, comme le ModelService de SquidMind.
"""

import threading
import time
from contextlib import contextmanager

from django.conf import settings

from . import broker as priorities
from . import fit
from .params import clean, load_options, sampling_options

DEFAULT_TTL = 720  # minutes d'inactivité avant de libérer la mémoire (iAqua)
FIXED_SEED = 42


class EngineUnavailable(Exception):
    pass


def default_factory(**kwargs):
    try:
        from llama_cpp import Llama
    except ImportError:
        raise EngineUnavailable('llama-cpp-python n\'est pas installé (pip install -r requirements-ai.txt)') from None
    return Llama(**kwargs)


class Engine:
    def __init__(self, broker, factory=default_factory, clock=time.time):
        self.broker = broker
        self.factory = factory
        self.clock = clock
        self._llm = None
        self._loaded = None  # id du LocalModel chargé
        self._options = None  # options de chargement demandées (avant calcul des « auto »)
        self.placement = {}  # id du LocalModel → résumé du dernier calcul (couches GPU, contexte, mémoire libre)
        self._ttl = DEFAULT_TTL
        self._lock = threading.Lock()
        self.stats = {}  # id du LocalModel → {loaded_at, last_used, requests, tokens}
        self._watcher = None

    @property
    def loaded(self):
        return self._loaded

    def available(self):
        if self.factory is not default_factory:
            return True
        try:
            import llama_cpp  # noqa: F401
        except ImportError:
            return False
        return True

    @staticmethod
    def options(model):
        """Options de chargement demandées : défauts d'iAqua (et du .env), puis réglages du modèle."""
        defaults = {'n_ctx': clean('n_ctx', settings.LLM_CTX), 'n_gpu_layers': clean('n_gpu_layers', settings.LLM_GPU_LAYERS),
                    'n_threads': settings.LLM_THREADS or fit.default_threads(), 'n_batch': 1024,
                    'flash_attn': True, 'use_mmap': True, 'use_mlock': False}
        return {**defaults, **load_options(model.params)}

    @classmethod
    def config(cls, model):
        """Réglages effectifs affichés sur la fiche (comme iAqua) : chargement, libération, graine."""
        return {**cls.options(model), 'ttl': model.params.get('ttl', DEFAULT_TTL), 'random_seed': model.params.get('random_seed', True)}

    def gpu_offload(self):
        """llama-cpp-python compilé avec un backend GPU (CUDA, Metal, Vulkan) ; None s'il est absent."""
        if self.factory is not default_factory:
            return True
        try:
            import llama_cpp
        except ImportError:
            return None
        check = getattr(llama_cpp, 'llama_supports_gpu_offload', None)
        return bool(check()) if check else None

    def _ensure(self, model):
        options = self.options(model)
        if self._loaded == model.pk and options == self._options:
            return self._llm
        self.unload()  # autre modèle, ou réglages de chargement changés : on recharge
        if not model.path:
            raise EngineUnavailable(f'{model} n\'est pas téléchargé')
        resolved, self.placement[model.pk] = fit.resolve(model.path, options, self.gpu_offload() is not False)
        self._llm = self.factory(model_path=model.path, verbose=False, **resolved)
        self._loaded, self._options = model.pk, options
        self._ttl = float(model.params.get('ttl', DEFAULT_TTL))
        now = self.clock()
        self.stats[model.pk] = {'loaded_at': now, 'last_used': now, 'requests': 0, 'tokens': 0}
        self._watch()
        return self._llm

    def unload(self):
        self._llm = None
        self._loaded = self._options = None

    @contextmanager
    def exclusive(self, priority, owner):
        """Le broker pour un autre usage (génération d'image) : le modèle de texte est libéré avant."""
        with self.broker.slot(priority, owner), self._lock:
            self.unload()
            yield

    # Libère la mémoire quand le modèle n'a pas servi depuis `ttl` minutes (vérifié chaque minute).
    def _watch(self):
        if self._watcher and self._watcher.is_alive():
            return
        self._watcher = threading.Thread(target=self._idle_loop, daemon=True)
        self._watcher.start()

    def _idle_loop(self):
        while self._loaded is not None:
            time.sleep(60)
            self.unload_if_idle()

    def unload_if_idle(self):
        loaded = self._loaded
        if loaded is None or not self._lock.acquire(blocking=False):
            return False
        try:
            idle = self.clock() - self.stats[loaded]['last_used']
            if self._ttl and idle > self._ttl * 60:
                self.unload()
                return True
            return False
        finally:
            self._lock.release()

    def chat(self, model, messages, *, json_schema=None, on_text=None, priority=priorities.CHAT, owner='chat', **params):
        """Complétion de chat en flux. Renvoie le texte complet ; on_text reçoit chaque fragment."""
        with self.broker.slot(priority, owner), self._lock:
            llm = self._ensure(model)
            stats = self.stats[model.pk]
            stats['requests'] += 1
            # Réglages du modèle, puis ceux de l'appel (agent, Gardien) qui priment.
            options = {'temperature': 0.7, 'max_tokens': 1024, **sampling_options(model.params), **sampling_options(params)}
            if model.params.get('random_seed') is False and 'seed' not in options:
                options['seed'] = FIXED_SEED  # graine aléatoire coupée : réponses reproductibles
            if json_schema:
                options['response_format'] = {'type': 'json_object', 'schema': json_schema}
            text = []
            try:
                for chunk in llm.create_chat_completion(messages=messages, stream=True, **options):
                    piece = chunk['choices'][0]['delta'].get('content') or ''
                    if piece:
                        text.append(piece)
                        stats['tokens'] += 1  # un fragment du flux = un jeton
                        if on_text:
                            on_text(piece)
            finally:
                stats['last_used'] = self.clock()
            return ''.join(text)
