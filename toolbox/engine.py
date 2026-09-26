"""Inférence locale GGUF via llama-cpp-python (optionnel : sans lui, Nodz fonctionne sans IA).

Un modèle chargé à la fois (le broker sérialise), sortie en flux, JSON contraint par grammaire
quand un schéma est fourni (fiabilise l'orchestrateur, même avec un petit modèle sur CPU).
"""

import threading

from django.conf import settings

from . import broker as priorities


class EngineUnavailable(Exception):
    pass


def default_factory(**kwargs):
    try:
        from llama_cpp import Llama
    except ImportError:
        raise EngineUnavailable('llama-cpp-python n\'est pas installé (pip install -r requirements-ai.txt)') from None
    return Llama(**kwargs)


class Engine:
    def __init__(self, broker, factory=default_factory):
        self.broker = broker
        self.factory = factory
        self._llm = None
        self._loaded = None  # id du LocalModel chargé
        self._lock = threading.Lock()

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
        self._llm = self.factory(
            model_path=model.path,
            n_ctx=model.params.get('n_ctx', settings.LLM_CTX),
            n_gpu_layers=settings.LLM_GPU_LAYERS,
            n_threads=settings.LLM_THREADS or None,
            verbose=False,
        )
        self._loaded = model.pk
        return self._llm

    def unload(self):
        self._llm = None
        self._loaded = None

    def chat(self, model, messages, *, json_schema=None, on_text=None, priority=priorities.CHAT, owner='chat', **params):
        """Complétion de chat en flux. Renvoie le texte complet ; on_text reçoit chaque fragment."""
        with self.broker.slot(priority, owner), self._lock:
            llm = self._ensure(model)
            options = {
                'temperature': params.get('temperature', model.params.get('temperature', 0.7)),
                'max_tokens': params.get('max_tokens', model.params.get('max_tokens', 1024)),
            }
            if json_schema:
                options['response_format'] = {'type': 'json_object', 'schema': json_schema}
            text = []
            for chunk in llm.create_chat_completion(messages=messages, stream=True, **options):
                piece = chunk['choices'][0]['delta'].get('content') or ''
                if piece:
                    text.append(piece)
                    if on_text:
                        on_text(piece)
            return ''.join(text)
