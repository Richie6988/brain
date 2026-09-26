"""Inférence locale GGUF via llama-cpp-python (optionnel : sans lui, Nodz fonctionne sans IA).

Un modèle chargé à la fois (le broker sérialise), sortie en flux, JSON contraint par grammaire
quand un schéma est fourni (fiabilise l'orchestrateur, même avec un petit modèle sur CPU).
Paramètres par modèle (contexte, couches GPU, threads, batch), statistiques d'usage et
déchargement après inactivité, comme le ModelService de SquidMind.
"""

import threading
import time

from django.conf import settings

from . import broker as priorities

# Paramètres de chargement modifiables par modèle (LocalModel.params), avec leur valeur par défaut.
LOAD_PARAMS = {'n_ctx': lambda: settings.LLM_CTX, 'n_gpu_layers': lambda: settings.LLM_GPU_LAYERS,
               'n_threads': lambda: settings.LLM_THREADS or None, 'n_batch': lambda: 512}
DEFAULT_TTL = 15  # minutes d'inactivité avant de libérer la mémoire


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
        self._ttl = DEFAULT_TTL
        self._lock = threading.Lock()
        self.stats = {}  # id du LocalModel → {loaded_at, last_used, requests, chunks}
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

    def _ensure(self, model):
        if self._loaded == model.pk:
            return self._llm
        self.unload()
        if not model.path:
            raise EngineUnavailable(f'{model} n\'est pas téléchargé')
        options = {key: model.params.get(key, default()) for key, default in LOAD_PARAMS.items()}
        self._llm = self.factory(model_path=model.path, verbose=False, **options)
        self._loaded = model.pk
        self._ttl = float(model.params.get('ttl', DEFAULT_TTL))
        now = self.clock()
        self.stats[model.pk] = {'loaded_at': now, 'last_used': now, 'requests': 0, 'chunks': 0}
        self._watch()
        return self._llm

    def unload(self):
        self._llm = None
        self._loaded = None

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
            options = {
                'temperature': params.get('temperature', model.params.get('temperature', 0.7)),
                'max_tokens': params.get('max_tokens', model.params.get('max_tokens', 1024)),
            }
            if json_schema:
                options['response_format'] = {'type': 'json_object', 'schema': json_schema}
            text = []
            try:
                for chunk in llm.create_chat_completion(messages=messages, stream=True, **options):
                    piece = chunk['choices'][0]['delta'].get('content') or ''
                    if piece:
                        text.append(piece)
                        stats['chunks'] += 1
                        if on_text:
                            on_text(piece)
            finally:
                stats['last_used'] = self.clock()
            return ''.join(text)
