"""Hugging Face et fichiers de modèles : recherche filtrée, fichiers d'un dépôt, recommandations selon
la machine, téléchargements suivis (reprise, vitesse, annulation), fichiers déjà présents sur le serveur.

Annotations (rôle, capacités, quantisation, fichier recommandé, taille) reprises du ModelLoader de SquidMind.
"""

import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from django.conf import settings
from django.db import connection
from huggingface_hub import HfApi, get_session, hf_hub_url
from huggingface_hub.utils import build_hf_headers

from .models import LocalModel

SORTS = {'downloads': 'downloads', 'likes': 'likes', 'trending': 'trending_score', 'recent': 'last_modified',
         'created': 'created_at'}
EXPAND = ['downloads', 'likes', 'tags', 'pipeline_tag', 'lastModified', 'gguf']  # gguf : nombre de paramètres
MAX_SCAN = 200  # dépôts examinés au plus quand un filtre local (quantisation, taille) écarte des résultats
CHUNK = 1024 * 1024

# Un modèle par palier de mémoire, tous capables d'appeler des outils (liste SquidMind).
CATALOG = [
    {'min_mb': 10_000, 'name': 'Qwen2.5 14B Instruct Q4_K_M', 'size_gb': 9.0, 'repo': 'bartowski/Qwen2.5-14B-Instruct-GGUF',
     'filename': 'Qwen2.5-14B-Instruct-Q4_K_M.gguf', 'why': 'Meilleure qualité avec 12 Go et plus'},
    {'min_mb': 6_500, 'name': 'Qwen2.5 7B Instruct Q4_K_M', 'size_gb': 4.7, 'repo': 'bartowski/Qwen2.5-7B-Instruct-GGUF',
     'filename': 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', 'why': 'Bon équilibre pour une carte de 8 Go'},
    {'min_mb': 3_500, 'name': 'Llama 3.2 3B Instruct Q4_K_M', 'size_gb': 2.0, 'repo': 'bartowski/Llama-3.2-3B-Instruct-GGUF',
     'filename': 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', 'why': 'Léger et rapide'},
    {'min_mb': 0, 'name': 'Qwen2.5 1.5B Instruct Q4_K_M', 'size_gb': 1.0, 'repo': 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
     'filename': 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf', 'why': 'Tourne partout, y compris sur CPU'},
]


def api():
    return HfApi(token=settings.HF_TOKEN or None)


def detect_quant(name):
    match = re.search(r'[_.-]((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*|F16|BF16|F32)', name, re.I) \
        or re.search(r'((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*)', name, re.I)
    return match.group(1).upper() if match else ''


def is_recommended(name):
    return bool(re.search(r'Q[45]_K_M|Q4_K_S', name, re.I))


def role_of(model_id, pipeline=''):
    if re.search(r'smol|tiny|0\.5b|0\.4b|\b1b\b|1\.5b|135m|360m|500m|256m', model_id, re.I):
        return 'small'
    if re.search(r'code|coder|starcoder|codellama', model_id, re.I):
        return 'code'
    if re.search(r'embed|nomic|e5-|bge-|rerank|minilm', model_id, re.I):
        return 'embed'
    if re.search(r'reason|think|qwq|r1\b', model_id, re.I):
        return 'reason'
    if re.search(r'image|text-to-image|vision', pipeline, re.I):
        return 'image'
    if re.search(r'audio|speech|tts|asr', pipeline, re.I):
        return 'audio'
    return 'chat'


def capabilities_of(model_id, tags, pipeline=''):
    text = f"{model_id} {' '.join(tags)} {pipeline}"
    rules = [
        ('vision', r'vision|vlm|multimodal|image.*text'),
        ('tools', r'tool.call|function.call|\btools\b'),
        ('chat', r'instruct|chat'),
        ('code', r'code|coder'),
        ('embed', r'embed|retrieval|rerank'),
        ('image', r'text.to.image|image.gen|flux|stable.diff|sdxl'),
        ('audio', r'audio|speech|tts|asr|whisper'),
        ('reason', r'reason|think|qwq|r1\b'),
    ]
    return [cap for cap, pattern in rules if re.search(pattern, text, re.I)]


def size_tag(tags, model_id='', gguf=None):
    """('7B', 7.0) : paramètres annoncés par l'en-tête GGUF du dépôt, ses tags ou son nom ; (None, None) sinon."""
    total = (gguf or {}).get('total') if isinstance(gguf, dict) else None
    if total:
        billions = total / 1e9
        return (f'{billions:.1f}B' if billions < 10 else f'{billions:.0f}B'), round(billions, 2)
    for text in [*tags, *re.split(r'[-_/ ]', model_id)]:
        match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)([bBmM])', text)
        if match:
            value = float(match.group(1))
            return text.upper(), value if match.group(2).lower() == 'b' else value / 1000
    return None, None


def search(query='', sort='downloads', limit=30, pipeline='', quant='', min_b=None, max_b=None):
    # Quantisation et taille se filtrent ici : on examine plus de dépôts pour en rendre `limit`.
    local = bool(quant or min_b or max_b)
    models = api().list_models(
        search=query or None, filter='gguf', pipeline_tag=pipeline or None,
        sort=SORTS.get(sort, 'downloads'), limit=MAX_SCAN if local else limit,
        expand=EXPAND + (['siblings'] if quant else []),
    )
    results = []
    for m in models:
        tags = list(m.tags or [])
        hint, size_b = size_tag(tags, m.id, getattr(m, 'gguf', None))
        if (min_b or max_b) and (size_b is None or (min_b and size_b < min_b) or (max_b and size_b > max_b)):
            continue  # taille inconnue : écartée quand on filtre par taille
        if quant and not any(detect_quant(f.rfilename).startswith(quant.upper())  # famille : Q4 couvre Q4_K_M, Q4_0…
                             for f in (m.siblings or []) if f.rfilename.endswith('.gguf')):
            continue  # aucun fichier .gguf de cette quantisation dans le dépôt
        results.append({
            'id': m.id, 'downloads': m.downloads or 0, 'likes': m.likes or 0, 'pipeline': m.pipeline_tag or '',
            'role': role_of(m.id, m.pipeline_tag or ''), 'capabilities': capabilities_of(m.id, tags, m.pipeline_tag or ''),
            'size_b': size_b, 'size_hint': hint,
            'updated': m.last_modified.isoformat() if getattr(m, 'last_modified', None) else '',
        })
        if len(results) >= limit:
            break
    return results


# --- la machine : décide des recommandations et des fichiers trop lourds

def gpu_memory_mb():
    if not shutil.which('nvidia-smi'):
        return 0
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
                             capture_output=True, text=True, timeout=4).stdout
        return int(out.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return 0


def ram_mb():
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            if line.startswith('MemTotal:'):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return 0


def machine():
    vram = gpu_memory_mb()
    ram = ram_mb()
    # Budget pour les poids : 85 % de la VRAM sur GPU (SquidMind), 60 % de la RAM sur CPU.
    budget = vram * 0.85 if vram else ram * 0.6
    return {'gpu': vram > 0, 'vram_mb': vram, 'ram_mb': ram, 'budget_mb': int(budget)}


def recommendations():
    info = machine()
    if info['gpu']:
        fits = [m for m in CATALOG if info['vram_mb'] >= m['min_mb']]
    else:
        fits = [m for m in CATALOG if m['size_gb'] * 1024 <= info['budget_mb']] or CATALOG[-1:]
    return {**info, 'models': [{**m, 'recommended': i == 0} for i, m in enumerate(fits)]}


def repo_files(repo):
    info = api().model_info(repo, files_metadata=True)
    budget = machine()['budget_mb']
    files = []
    for s in info.siblings or []:
        if not s.rfilename.lower().endswith('.gguf'):
            continue
        size = s.size or 0
        files.append({'name': s.rfilename, 'size': size, 'quant': detect_quant(s.rfilename),
                      'recommended': is_recommended(s.rfilename),
                      'heavy': bool(budget and size > budget * 1024 * 1024)})
    order = ['Q8', 'Q6', 'Q5', 'Q4', 'Q3', 'Q2', 'IQ']

    def rank(f):
        if f['recommended']:
            return 0
        return next((i + 1 for i, q in enumerate(order) if f['quant'].startswith(q)), len(order) + 1)

    files.sort(key=lambda f: (rank(f), -f['size']))
    tags = list(info.tags or [])
    return {'repo': repo, 'files': files, 'capabilities': capabilities_of(repo, tags, info.pipeline_tag or ''),
            'pipeline': info.pipeline_tag or ''}


# --- packs : un modèle d'image et ses fichiers compagnons, choisis dans la liste réelle du dépôt

PACKS = {
    'flux-schnell': {
        'label': 'FLUX.1 schnell', 'repo': 'second-state/FLUX.1-schnell-GGUF',
        # (type, motifs par ordre de préférence) ; sur une petite machine, la quantisation la plus légère d'abord
        'files': [
            (LocalModel.Kind.IMAGE, [r'flux1-schnell-Q4_0\.gguf$', r'flux1-schnell-Q4_K\w*\.gguf$', r'flux1-schnell-Q[235]\w*\.gguf$'],
             [r'flux1-schnell-Q2_K\.gguf$', r'flux1-schnell-Q3\w*\.gguf$', r'flux1-schnell-Q4_0\.gguf$']),
            (LocalModel.Kind.COMPONENT, [r'^ae\.safetensors$'], None),
            (LocalModel.Kind.COMPONENT, [r'^clip_l\.safetensors$', r'^clip_l\S*\.gguf$'], None),
            (LocalModel.Kind.COMPONENT, [r't5xxl-Q4_0\.gguf$', r't5xxl-Q[3-5]\w*\.gguf$', r't5xxl\S*\.gguf$'],
             [r't5xxl-Q2_K\.gguf$', r't5xxl-Q3\w*\.gguf$', r't5xxl-Q4_0\.gguf$']),
        ],
    },
}
SMALL_MACHINE_MB = 8_000  # en dessous, le pack prend les quantisations légères


def install_pack(key):
    """Lance le téléchargement d'un pack ; lève ValueError si un fichier manque dans le dépôt."""
    pack = PACKS.get(key)
    if pack is None:
        raise ValueError(f'pack inconnu : {key}')
    info = api().model_info(pack['repo'], files_metadata=True)
    files = {s.rfilename: s.size or 0 for s in info.siblings or []}
    small = machine()['budget_mb'] < SMALL_MACHINE_MB
    chosen = []
    for kind, patterns, light in pack['files']:
        name = next((f for p in ((light or patterns) if small else patterns) + patterns for f in files if re.search(p, f, re.I)), None)
        if name is None:
            raise ValueError(f"{pack['repo']} : aucun fichier ne correspond à {patterns[0]}")
        chosen.append((name, kind))
    caps = ['image']
    return [start_download(pack['repo'], name, files[name], kind, caps if kind == LocalModel.Kind.IMAGE else ())
            for name, kind in chosen]


# --- téléchargements : suivis en mémoire (vitesse, annulation), état durable dans LocalModel

DOWNLOADS = {}  # id du LocalModel → {'cancel': Event, 'speed': octets/s}


def folder_of(model):
    return Path(settings.MODELS_DIR) / model.repo.replace('/', '__')


def start_download(repo, filename, size=0, kind=LocalModel.Kind.TEXT, capabilities=()):
    """Crée (ou relance) l'entrée et télécharge en tâche de fond ; reprend un .partial existant."""
    model, _ = LocalModel.objects.update_or_create(
        repo=repo, filename=filename,
        defaults={'status': LocalModel.Status.DOWNLOADING, 'error': '', 'size': size, 'kind': kind,
                  'quant': detect_quant(filename), 'capabilities': list(capabilities)},
    )
    if model.pk not in DOWNLOADS:
        DOWNLOADS[model.pk] = {'cancel': threading.Event(), 'speed': 0.0}
        threading.Thread(target=_download, args=(model.pk,), daemon=True).start()
    return model


def cancel_download(model):
    job = DOWNLOADS.get(model.pk)
    if job:
        job['cancel'].set()
    else:  # plus de tâche (serveur redémarré) : l'état passe simplement à annulé
        LocalModel.objects.filter(pk=model.pk, status=LocalModel.Status.DOWNLOADING).update(status=LocalModel.Status.CANCELLED)


def _download(model_id):
    job = DOWNLOADS[model_id]
    model = LocalModel.objects.get(pk=model_id)
    target = folder_of(model) / model.filename
    partial = target.with_name(target.name + '.partial')
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        done = partial.stat().st_size if partial.exists() else 0
        headers = build_hf_headers(token=settings.HF_TOKEN or None)
        if done:
            headers['Range'] = f'bytes={done}-'
        with get_session().stream('GET', hf_hub_url(model.repo, model.filename), headers=headers,
                                  follow_redirects=True, timeout=60) as response:
            if response.status_code != 416:  # 416 : le .partial est déjà complet
                response.raise_for_status()
                if response.status_code == 200:
                    done = 0  # le serveur ignore la reprise : on repart de zéro
                total = done + int(response.headers.get('content-length') or 0) or model.size
                LocalModel.objects.filter(pk=model_id).update(size=total, downloaded=done)
                window_start, window_bytes, last_save = time.monotonic(), 0, 0.0
                with partial.open('ab' if done else 'wb') as out:
                    for chunk in response.iter_bytes(CHUNK):
                        if job['cancel'].is_set():
                            LocalModel.objects.filter(pk=model_id).update(status=LocalModel.Status.CANCELLED, downloaded=done)
                            return
                        out.write(chunk)
                        done += len(chunk)
                        window_bytes += len(chunk)
                        now = time.monotonic()
                        if now - window_start >= 1:
                            job['speed'] = window_bytes / (now - window_start)
                            window_start, window_bytes = now, 0
                        if now - last_save >= 1:
                            LocalModel.objects.filter(pk=model_id).update(downloaded=done)
                            last_save = now
        partial.replace(target)
        size = target.stat().st_size
        LocalModel.objects.filter(pk=model_id).update(path=str(target), status=LocalModel.Status.READY, size=size, downloaded=size)
    except Exception as e:  # réseau, disque, dépôt privé : rapporté dans la bibliothèque, le .partial reste pour reprendre
        LocalModel.objects.filter(pk=model_id).update(status=LocalModel.Status.ERROR, error=str(e)[:2000])
    finally:
        DOWNLOADS.pop(model_id, None)
        connection.close()


def download_state(model):
    """Progression, vitesse et temps restant d'un téléchargement."""
    job = DOWNLOADS.get(model.pk)
    speed = job['speed'] if job else 0.0
    left = max(model.size - model.downloaded, 0)
    return {'progress': round(model.downloaded / model.size, 4) if model.size else 0, 'speed': round(speed),
            'eta': round(left / speed) if speed else None}


# --- fichiers .gguf déjà sur le serveur (copiés à la main dans MODELS_DIR)

def local_files():
    root = Path(settings.MODELS_DIR)
    known = {m.path: m for m in LocalModel.objects.exclude(path='')}
    files = []
    if root.exists():
        for path in sorted(root.rglob('*.gguf')):
            files.append({'path': str(path.relative_to(root)), 'name': path.name, 'size': path.stat().st_size,
                          'quant': detect_quant(path.name), 'model': str(known[str(path)].id) if str(path) in known else None})
    return files


def resolve_local(relative):
    """Chemin absolu d'un fichier .gguf de MODELS_DIR ; None s'il sort du dossier ou n'existe pas."""
    root = Path(settings.MODELS_DIR).resolve()
    path = (root / str(relative)).resolve()
    return path if path.is_relative_to(root) and path.is_file() and path.suffix.lower() == '.gguf' else None


def import_local(path):
    model, _ = LocalModel.objects.update_or_create(
        repo='local', filename=path.name,
        defaults={'path': str(path), 'status': LocalModel.Status.READY, 'size': path.stat().st_size,
                  'downloaded': path.stat().st_size, 'quant': detect_quant(path.name),
                  'capabilities': capabilities_of(path.name, [])},
    )
    return model
