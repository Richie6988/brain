"""Catalogue des réglages d'un modèle : chargement (GPU, mémoire, contexte) et échantillonnage.

Une seule source pour la validation (API), le moteur (ce qui part à llama-cpp-python) et le
formulaire de la fiche modèle (envoyé tel quel à la page). Seuls les réglages choisis par
l'utilisateur partent au moteur : une version de llama-cpp-python qui ignore une option n'est
pas gênée tant qu'on ne la règle pas.
"""

# Types de cache KV de ggml (llama_cpp.GGML_TYPE_*) : quantifier le cache économise de la VRAM.
KV_TYPES = {'f16': 1, 'q8_0': 8, 'q4_0': 2}

SPEC = [
    # --- GPU
    {'key': 'n_gpu_layers', 'group': 'GPU', 'label': 'Couches sur GPU', 'kind': 'int', 'min': -1, 'max': 999, 'load': True,
     'hint': '-1 = toutes, 0 = tout sur CPU'},
    {'key': 'main_gpu', 'group': 'GPU', 'label': 'GPU principal', 'kind': 'int', 'min': 0, 'max': 15, 'load': True,
     'hint': 'index de la carte (0 = première)'},
    {'key': 'split_mode', 'group': 'GPU', 'label': 'Répartition multi-GPU', 'kind': 'choice', 'load': True,
     'choices': [['0', 'aucune (un seul GPU)'], ['1', 'par couches'], ['2', 'par lignes']]},
    {'key': 'tensor_split', 'group': 'GPU', 'label': 'Part de chaque GPU', 'kind': 'list', 'load': True,
     'hint': 'ex. 0.6,0.4'},
    {'key': 'offload_kqv', 'group': 'GPU', 'label': 'Cache KV sur GPU', 'kind': 'bool', 'load': True,
     'hint': 'plus rapide, consomme de la VRAM'},
    {'key': 'flash_attn', 'group': 'GPU', 'label': 'Flash attention', 'kind': 'bool', 'load': True,
     'hint': 'moins de mémoire, requis pour quantifier le cache V'},
    {'key': 'type_k', 'group': 'GPU', 'label': 'Cache K', 'kind': 'choice', 'load': True,
     'choices': [['f16', 'f16 (défaut)'], ['q8_0', 'q8_0 (moitié)'], ['q4_0', 'q4_0 (quart)']]},
    {'key': 'type_v', 'group': 'GPU', 'label': 'Cache V', 'kind': 'choice', 'load': True,
     'choices': [['f16', 'f16 (défaut)'], ['q8_0', 'q8_0 (moitié)'], ['q4_0', 'q4_0 (quart)']]},
    # --- Mémoire et vitesse
    {'key': 'n_ctx', 'group': 'Mémoire et vitesse', 'label': 'Contexte', 'kind': 'int', 'min': 256, 'max': 262144, 'load': True,
     'hint': 'jetons'},
    {'key': 'n_batch', 'group': 'Mémoire et vitesse', 'label': 'Batch', 'kind': 'int', 'min': 1, 'max': 8192, 'load': True,
     'hint': '512'},
    {'key': 'n_ubatch', 'group': 'Mémoire et vitesse', 'label': 'Micro-batch', 'kind': 'int', 'min': 1, 'max': 8192, 'load': True,
     'hint': '512'},
    {'key': 'n_threads', 'group': 'Mémoire et vitesse', 'label': 'Threads', 'kind': 'int', 'min': 1, 'max': 256, 'load': True,
     'hint': 'vide = auto'},
    {'key': 'n_threads_batch', 'group': 'Mémoire et vitesse', 'label': 'Threads du prompt', 'kind': 'int', 'min': 1, 'max': 256,
     'load': True, 'hint': 'vide = auto'},
    {'key': 'use_mmap', 'group': 'Mémoire et vitesse', 'label': 'Lecture mmap', 'kind': 'bool', 'load': True,
     'hint': 'charge à la demande'},
    {'key': 'use_mlock', 'group': 'Mémoire et vitesse', 'label': 'Verrouiller en RAM', 'kind': 'bool', 'load': True,
     'hint': 'jamais en swap'},
    {'key': 'rope_freq_base', 'group': 'Mémoire et vitesse', 'label': 'RoPE base', 'kind': 'float', 'min': 0, 'max': 10_000_000,
     'load': True, 'hint': '0 = celle du modèle'},
    {'key': 'rope_freq_scale', 'group': 'Mémoire et vitesse', 'label': 'RoPE échelle', 'kind': 'float', 'min': 0, 'max': 1,
     'load': True, 'hint': '0 = celle du modèle'},
    {'key': 'ttl', 'group': 'Mémoire et vitesse', 'label': 'Libérer après', 'kind': 'float', 'min': 0, 'max': 1440,
     'hint': 'minutes, 0 = jamais'},
    # --- Échantillonnage
    {'key': 'temperature', 'group': 'Échantillonnage', 'label': 'Température', 'kind': 'float', 'min': 0, 'max': 2, 'hint': '0.7'},
    {'key': 'top_p', 'group': 'Échantillonnage', 'label': 'Top P', 'kind': 'float', 'min': 0, 'max': 1, 'hint': '0.95'},
    {'key': 'top_k', 'group': 'Échantillonnage', 'label': 'Top K', 'kind': 'int', 'min': 0, 'max': 1000, 'hint': '40'},
    {'key': 'min_p', 'group': 'Échantillonnage', 'label': 'Min P', 'kind': 'float', 'min': 0, 'max': 1, 'hint': '0.05'},
    {'key': 'typical_p', 'group': 'Échantillonnage', 'label': 'Typical P', 'kind': 'float', 'min': 0, 'max': 1, 'hint': '1'},
    {'key': 'repeat_penalty', 'group': 'Échantillonnage', 'label': 'Pénalité de répétition', 'kind': 'float', 'min': 0, 'max': 3,
     'hint': '1.1'},
    {'key': 'presence_penalty', 'group': 'Échantillonnage', 'label': 'Pénalité de présence', 'kind': 'float', 'min': -2, 'max': 2,
     'hint': '0'},
    {'key': 'frequency_penalty', 'group': 'Échantillonnage', 'label': 'Pénalité de fréquence', 'kind': 'float', 'min': -2, 'max': 2,
     'hint': '0'},
    {'key': 'mirostat_mode', 'group': 'Échantillonnage', 'label': 'Mirostat', 'kind': 'choice',
     'choices': [['0', 'désactivé'], ['1', 'v1'], ['2', 'v2']]},
    {'key': 'mirostat_tau', 'group': 'Échantillonnage', 'label': 'Mirostat tau', 'kind': 'float', 'min': 0, 'max': 10, 'hint': '5'},
    {'key': 'mirostat_eta', 'group': 'Échantillonnage', 'label': 'Mirostat eta', 'kind': 'float', 'min': 0, 'max': 1, 'hint': '0.1'},
    {'key': 'max_tokens', 'group': 'Échantillonnage', 'label': 'Longueur max', 'kind': 'int', 'min': 1, 'max': 32768, 'hint': 'jetons'},
    {'key': 'seed', 'group': 'Échantillonnage', 'label': 'Graine', 'kind': 'int', 'min': -1, 'max': 2**31 - 1,
     'hint': '-1 = aléatoire'},
    # --- Image (stable-diffusion.cpp)
    {'key': 'width', 'group': 'Image', 'label': 'Largeur', 'kind': 'int', 'min': 128, 'max': 2048, 'hint': '512'},
    {'key': 'height', 'group': 'Image', 'label': 'Hauteur', 'kind': 'int', 'min': 128, 'max': 2048, 'hint': '512'},
    {'key': 'steps', 'group': 'Image', 'label': 'Étapes', 'kind': 'int', 'min': 1, 'max': 150, 'hint': '4 (schnell), 20 (SD)'},
    {'key': 'cfg_scale', 'group': 'Image', 'label': 'Guidage (CFG)', 'kind': 'float', 'min': 0, 'max': 30, 'hint': '1 (FLUX), 7 (SD)'},
    {'key': 'sampling_method', 'group': 'Image', 'label': 'Échantillonneur', 'kind': 'choice',
     'choices': [['euler', 'euler'], ['euler_a', 'euler a'], ['dpm++2m', 'dpm++ 2m'], ['lcm', 'lcm']]},
    {'key': 'img_seed', 'group': 'Image', 'label': 'Graine', 'kind': 'int', 'min': -1, 'max': 2**31 - 1, 'hint': '-1 = aléatoire'},
    {'key': 'sd_threads', 'group': 'Image', 'label': 'Threads', 'kind': 'int', 'min': 1, 'max': 256, 'hint': 'vide = auto'},
    {'key': 'vae_tiling', 'group': 'Image', 'label': 'VAE par tuiles', 'kind': 'bool', 'hint': 'moins de mémoire'},
    {'key': 'cpu_only', 'group': 'Image', 'label': 'Tout sur CPU', 'kind': 'bool', 'hint': 'si la VRAM manque'},
]
BY_KEY = {p['key']: p for p in SPEC}
LOAD = [p['key'] for p in SPEC if p.get('load')]
SAMPLING = [p['key'] for p in SPEC if p['group'] == 'Échantillonnage']


class ParamError(ValueError):
    pass


def clean(key, value):
    """Valeur validée d'un réglage (lève ParamError avec un message lisible)."""
    spec = BY_KEY.get(key)
    if spec is None:
        raise ParamError(f'réglage inconnu : {key}')
    kind, label = spec['kind'], spec['label']
    if kind == 'bool':
        if isinstance(value, bool):
            return value
        if str(value).lower() in ('1', 'true', 'oui'):
            return True
        if str(value).lower() in ('0', 'false', 'non'):
            return False
        raise ParamError(f'{label} : oui ou non')
    if kind == 'choice':
        if str(value) not in [c[0] for c in spec['choices']]:
            raise ParamError(f'{label} : choix inconnu')
        return str(value)
    if kind == 'list':
        try:
            parts = [float(v) for v in (value if isinstance(value, list) else str(value).split(','))]
        except ValueError:
            raise ParamError(f'{label} : nombres séparés par des virgules') from None
        if not parts or any(p < 0 for p in parts) or sum(parts) <= 0:
            raise ParamError(f'{label} : parts positives')
        return parts
    try:
        number = int(value) if kind == 'int' else float(value)
    except (TypeError, ValueError):
        raise ParamError(f'{label} : nombre attendu') from None
    if not spec['min'] <= number <= spec['max']:
        raise ParamError(f"{label} : entre {spec['min']} et {spec['max']}")
    return number


def validate(params):
    cleaned = {key: clean(key, value) for key, value in (params or {}).items() if value not in ('', None)}
    if cleaned.get('type_v', 'f16') != 'f16' and not cleaned.get('flash_attn'):
        raise ParamError('Cache V quantifié : active la flash attention')
    return cleaned


def load_options(params):
    """Options de chargement pour llama_cpp.Llama (celles que l'utilisateur a réglées)."""
    options = {}
    for key in LOAD:
        if key not in params:
            continue
        value = params[key]
        if key in ('type_k', 'type_v'):
            value = KV_TYPES[value]
        elif key in ('split_mode',):
            value = int(value)
        options[key] = value
    return options


def sampling_options(params):
    options = {key: params[key] for key in SAMPLING if key in params}
    if 'mirostat_mode' in options:
        options['mirostat_mode'] = int(options['mirostat_mode'])
    if options.get('seed') == -1:
        del options['seed']
    return options
