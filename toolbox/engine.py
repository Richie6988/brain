"""Inférence locale GGUF via llama-cpp-python (optionnel : sans lui, Nodz fonctionne sans IA), ou par API (remote.py).

Un modèle chargé à la fois (le broker sérialise), sortie en flux, JSON contraint par grammaire
quand un schéma est fourni (fiabilise l'orchestrateur, même avec un petit modèle sur CPU).
Réglages par modèle (params.py : GPU, cache, contexte, threads, échantillonnage), statistiques
d'usage et déchargement après inactivité, comme le ModelService de SquidMind.
"""

import collections
import gc
import threading
import time
from contextlib import contextmanager

from django.conf import settings

from . import broker as priorities
from . import fit, remote
from .params import clean, load_options, sampling_options

DEFAULT_TTL = 720  # minutes d'inactivité avant de libérer la mémoire (iAqua)
FIXED_SEED = 42


def looping(text, tail=600):
    """Le texte finit par un même bloc répété trois fois de suite (8 à 150 caractères, pas une simple ligne de
    tirets) : un petit modèle qui s'emballe, sans quoi il répète jusqu'à la longueur maximale."""
    text = text[-tail:]
    for p in range(8, 151):
        if len(text) < 3 * p:
            break
        block = text[-p:]
        if len(set(block)) >= 4 and text[-2 * p:-p] == block and text[-3 * p:-2 * p] == block:
            return True
    return False


CHECKPOINTS = 3  # prompts système dont l'état est gardé (Gardien, ses modes, un agent)


ANY = {'anyOf': [{'type': t} for t in ('string', 'number', 'boolean', 'array', 'object', 'null')]}


def lean(schema):
    """Le schéma, allégé pour la grammaire de llama.cpp. La grammaire s'applique sur le CPU à tout le vocabulaire
    (150 000 jetons et plus) à chaque jeton : un schéma détaillé (champs facultatifs dans n'importe quel ordre, maxItems
    déroulé en 150 répétitions imbriquées) la rend énorme, et le GPU attend le CPU. On garde la structure et les champs
    requis (avec leurs énumérations, comme `op`) ; le reste est un JSON libre, que le Gardien valide de toute façon."""
    if not isinstance(schema, dict):
        return schema
    if schema.get('type') == 'object' and 'properties' in schema:
        required = schema.get('required', [])
        return {'type': 'object', 'required': required, 'additionalProperties': ANY,
                'properties': {k: lean(v) for k, v in schema['properties'].items() if k in required}}
    if schema.get('type') == 'array':
        return {'type': 'array', 'items': lean(schema.get('items', ANY))}
    return {k: v for k, v in schema.items() if k not in ('maxItems', 'minItems', 'maxLength', 'minLength')}


class EngineUnavailable(Exception):
    pass


_acting = threading.local()


@contextmanager
def acting_for(user_id):
    """Les appels au modèle faits dans ce bloc (ce thread) sont ceux de cet utilisateur : son bouton stop les coupe."""
    previous = getattr(_acting, 'user', None)
    _acting.user = user_id
    try:
        yield
    finally:
        _acting.user = previous


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
        self.prefixes = {}  # id du LocalModel chargé → empreinte du dernier prompt système lu (réutilisé par llama.cpp)
        self.checkpoints = collections.OrderedDict()  # empreinte d'un prompt système → état du modèle juste après l'avoir lu
        self._watcher = None
        # Arrêt dur : llama.cpp consulte ce drapeau entre deux calculs (lecture du prompt comprise), le flux entre deux jetons.
        self._abort = threading.Event()
        self._current = None  # (utilisateur, priorité) de l'appel en cours
        self._abort_callback = None  # gardé en vie tant que le modèle l'est

    def interrupt(self, user_id=None, background=False):
        """Coupe l'appel en cours s'il est à cet utilisateur (ou, avec background, si c'est une tâche de fond)."""
        current = self._current
        if current and ((user_id is not None and current[0] == user_id) or (background and current[1] == priorities.BACKGROUND)):
            self._abort.set()
            return True
        return False

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
        resolved, self.placement[model.pk] = fit.resolve(model.path, options, self.gpu_offload() is not False, set(load_options(model.params)))
        self._llm = self._load(model, resolved)
        self._install_abort(self._llm)
        self._loaded, self._options = model.pk, options
        self._ttl = float(model.params.get('ttl', DEFAULT_TTL))
        now = self.clock()
        self.stats[model.pk] = {'loaded_at': now, 'last_used': now, 'requests': 0, 'tokens': 0}
        self._watch()
        return self._llm

    def _load(self, model, resolved):
        """Charge le modèle ; si llama.cpp refuse le contexte (cache quantifié incompatible avec ce modèle, flash
        attention absente de ce build), réessaie sans ces options au lieu de laisser le Gardien sans modèle."""
        tries = [resolved]
        plain = {k: v for k, v in resolved.items() if k not in ('type_k', 'type_v')}
        if plain != resolved:
            tries.append(plain)
        if plain.get('flash_attn'):
            tries.append({**plain, 'flash_attn': False})
        for options in tries:
            try:
                llm = self.factory(model_path=model.path, verbose=False, **options)
            except ValueError as e:  # « Failed to create llama_context »
                error = e
                continue
            self.placement[model.pk]['kv_q8'] = options.get('type_k') == 8
            return llm
        raise EngineUnavailable(f'{model} ne se charge pas ({error}) : réduis le contexte dans ses réglages') from None

    def _install_abort(self, llm):
        try:
            import llama_cpp
            ctx = llm._ctx.ctx
        except (ImportError, AttributeError):
            return  # autre moteur (tests) : l'arrêt se fait entre deux jetons
        self._abort_callback = llama_cpp.ggml_abort_callback(lambda _: self._abort.is_set())
        llama_cpp.llama_set_abort_callback(ctx, self._abort_callback, None)

    def unload(self):
        """Libère le modèle tout de suite (VRAM comprise) : le suivant mesure la mémoire libre juste après, et une
        VRAM encore tenue par l'ancien le ferait charger en partie sur CPU."""
        close = getattr(self._llm, 'close', None)
        self._llm = None
        if close:
            close()
        gc.collect()
        self.prefixes.clear()
        self.checkpoints.clear()
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

    def prefill(self, model, messages, *, priority=priorities.BACKGROUND, owner='préchauffage'):
        """Fait lire au modèle le début d'une conversation (prompt système) sans rien générer : llama.cpp le garde
        en cache et une demande qui commence pareil ne relit que la suite. Faux s'il l'avait déjà lu (ou par API)."""
        if model.endpoint:
            return False
        if self._loaded == model.pk and self.prefixes.get(model.pk) == hash(messages[0]['content']):
            return False
        self.chat(model, messages, priority=priority, owner=owner, max_tokens=1, temperature=0)
        return True

    def chat(self, model, messages, *, json_schema=None, on_text=None, on_token=None, priority=priorities.CHAT, owner='chat', **params):
        """Complétion de chat en flux. Renvoie le texte complet ; on_text reçoit chaque fragment. Une réponse JSON
        (plan) qui se met à boucler est arrêtée net (stats['last']['stopped']). Un modèle par API n'occupe ni le broker
        ni la mémoire locale.
        on_token(fragment, chances), à la place d'on_text : avec chaque fragment, les jetons que le modèle envisageait à
        cet instant et leur probabilité, [(texte, p), ...] du plus probable au moins probable (ou None si inconnu)."""
        # Réglages du modèle, puis ceux de l'appel (agent, Gardien) qui priment.
        options = {'temperature': 0.7, 'max_tokens': 1024, **sampling_options(model.params), **sampling_options(params)}
        if model.params.get('random_seed') is False and 'seed' not in options:
            options['seed'] = FIXED_SEED  # graine aléatoire coupée : réponses reproductibles
        if priority < priorities.BACKGROUND:
            self.interrupt(background=True)  # une demande interactive passe devant : la tâche de fond en cours cède
        if model.endpoint:
            self._abort.clear()
            self.stats.setdefault(model.pk, {'loaded_at': self.clock(), 'last_used': self.clock(), 'requests': 0, 'tokens': 0})
            started = time.monotonic()
            try:
                stream = remote.Stream(model, messages, options, json_schema, chances=bool(on_token))
            except remote.RemoteError as e:
                raise EngineUnavailable(str(e)) from None
            return self._collect(model, stream, iter(stream), messages, json_schema, on_text, None, started, on_token)
        with self.broker.slot(priority, owner), self._lock:
            self._abort.clear()
            self._current = (getattr(_acting, 'user', None), priority)
            try:
                return self._local(model, messages, json_schema, on_text, options, on_token)
            finally:
                self._current = None

    def _local(self, model, messages, json_schema, on_text, options, on_token=None):
        llm = self._ensure(model)
        if json_schema:
            options['response_format'] = {'type': 'json_object', 'schema': lean(json_schema)}
        # Mesure de l'appel : taille du prompt, attente du premier jeton (lecture du prompt), vitesse ensuite.
        tokenize = getattr(llm, 'tokenize', None)
        prompt_tokens = len(tokenize(''.join(m['content'] for m in messages).encode())) if tokenize else None
        # Le prompt et la réponse doivent tenir dans la fenêtre : sinon llama.cpp refuse (ou coupe le plan en plein
        # JSON). La réponse se raccourcit pour tenir ; un prompt qui la remplit seul est refusé en clair.
        n_ctx = llm.n_ctx() if callable(getattr(llm, 'n_ctx', None)) else None
        if prompt_tokens and n_ctx:
            room = n_ctx - prompt_tokens - 64  # marge : le gabarit de chat ajoute ses balises
            if room < 128:
                raise EngineUnavailable(f'demande trop longue pour le contexte du modèle ({prompt_tokens} jetons sur {n_ctx}) : '
                                        'augmente le contexte dans les réglages du modèle, ou réduis la conversation')
            wanted = options.get('max_tokens')
            options['max_tokens'] = room if not wanted or wanted < 0 else min(wanted, room)
        # Les jetons envisagés (mots presque dits) ne sont lus que par API, où ils arrivent avec la réponse : en local, ce
        # serait un passage en Python sur tout le vocabulaire à chaque jeton, pendant lequel le GPU attend.
        self._resume(llm, messages)
        started = time.monotonic()
        stream = llm.create_chat_completion(messages=messages, stream=True, **options)

        def pieces():
            for chunk in stream:
                piece = chunk['choices'][0]['delta'].get('content') or ''
                yield (piece, None) if on_token else piece

        return self._collect(model, stream, pieces(), messages, json_schema, on_text, prompt_tokens, started, on_token)

    def _prefix_tokens(self, llm, system):
        """Les jetons du prompt formaté jusqu'au début du message de l'humain, comme llama-cpp-python les produira (même
        gabarit de chat, même découpage) ; None si le gabarit est inconnu."""
        template = (getattr(llm, 'metadata', None) or {}).get('tokenizer.chat_template')
        if not template:
            return None
        from llama_cpp.llama_chat_format import Jinja2ChatFormatter

        text = lambda token: llm._model.token_get_text(token) if token != -1 else ''
        mark = '\u2063NODZ\u2063'
        result = Jinja2ChatFormatter(template=template, eos_token=text(llm.token_eos()), bos_token=text(llm.token_bos()))(
            messages=[system, {'role': 'user', 'content': mark}])
        if mark not in result.prompt:
            return None
        return llm.tokenize(result.prompt.split(mark)[0].encode('utf-8'), add_bos=not result.added_special, special=True)

    def _resume(self, llm, messages):
        """Point de reprise des modèles hybrides et récurrents (Qwen3.5, Qwen3-Next, Mamba…) : leur état ne se tronque pas,
        llama.cpp relirait donc tout le prompt à chaque demande. On garde l'état juste après le prompt système et on le
        recharge : seule la suite (univers, demande) est lue. Un prompt qui ne commence pas pareil est relu en entier."""
        if not (getattr(llm, '_is_hybrid', False) or getattr(llm, '_is_recurrent', False)):
            return  # les autres modèles : llama.cpp réutilise déjà le début commun
        if not messages or messages[0].get('role') != 'system':
            return
        key = hash(messages[0]['content'])
        state = self.checkpoints.get(key)
        if state is None:
            tokens = self._prefix_tokens(llm, messages[0])
            if not tokens:
                return
            llm.reset()
            llm.eval(tokens)
            state = self.checkpoints[key] = llm.save_state()
            while len(self.checkpoints) > CHECKPOINTS:
                self.checkpoints.popitem(last=False)
        self.checkpoints.move_to_end(key)
        llm.load_state(state)

    def _collect(self, model, stream, pieces, messages, json_schema, on_text, prompt_tokens, started, on_token=None):
        """Lit le flux (local ou distant) : fragments vers on_text (ou on_token, avec les jetons envisagés), arrêt
        d'une boucle, mesures de l'appel."""
        stats = self.stats[model.pk]
        stats['requests'] += 1
        text, first, count, stopped = [], None, 0, None
        try:
            for item in pieces:
                piece, chances = item if isinstance(item, tuple) else (item, None)
                if self._abort.is_set():
                    raise EngineUnavailable('arrêté')
                if piece:
                    if first is None:
                        first = time.monotonic()
                    text.append(piece)
                    count += 1
                    stats['tokens'] += 1  # un fragment du flux = un jeton
                    if on_token:
                        on_token(piece, chances)
                    elif on_text:
                        on_text(piece)
                    if json_schema and count % 8 == 0 and looping(''.join(text[-200:])):
                        stopped = 'boucle'
                        break
            if messages and messages[0]['role'] == 'system' and not model.endpoint:
                self.prefixes[model.pk] = hash(messages[0]['content'])
        except RuntimeError:  # llama_decode interrompu par le drapeau d'arrêt
            if self._abort.is_set():
                raise EngineUnavailable('arrêté') from None
            raise
        finally:
            getattr(stream, 'close', lambda: None)()  # arrête la génération en cours
            end = time.monotonic()
            usage = getattr(stream, 'usage', None) or {}  # par API : jetons du prompt comptés par le serveur
            stats['last_used'] = self.clock()
            stats['last'] = {'prompt_tokens': prompt_tokens or usage.get('prompt_tokens'), 'wait_s': round((first or end) - started, 2),
                             'tokens': count, 'speed': round(count / (end - first), 1) if first and end > first else None,
                             'total_s': round(end - started, 2), 'stopped': stopped}
        return ''.join(text)
