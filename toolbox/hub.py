"""Hugging Face : recherche de modèles GGUF, fichiers d'un dépôt, recommandations, téléchargement.

Annotations (rôle, capacités, quantisation, fichiers recommandés) reprises de SquidMind.
"""

import re
import shutil
import subprocess
import threading
from pathlib import Path

from django.conf import settings
from huggingface_hub import HfApi, hf_hub_download

from .models import LocalModel

SORTS = {'downloads': 'downloads', 'likes': 'likes', 'trending': 'trending_score', 'recent': 'last_modified'}

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
    match = re.search(r'[_-]((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*)', name, re.I) or re.search(r'((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*)', name, re.I)
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


def size_in_billions(tags):
    for tag in tags:
        match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)([bBmM])', tag)
        if match:
            value = float(match.group(1))
            return value if match.group(2).lower() == 'b' else value / 1000
    return None


def search(query='', sort='downloads', limit=30, pipeline=''):
    models = api().list_models(
        search=query or None, filter='gguf', pipeline_tag=pipeline or None,
        sort=SORTS.get(sort, 'downloads'), limit=limit,
    )
    results = []
    for m in models:
        tags = list(m.tags or [])
        results.append({
            'id': m.id, 'downloads': m.downloads or 0, 'likes': m.likes or 0, 'pipeline': m.pipeline_tag or '',
            'role': role_of(m.id, m.pipeline_tag or ''), 'capabilities': capabilities_of(m.id, tags, m.pipeline_tag or ''),
            'size_b': size_in_billions(tags),
        })
    return results


def repo_files(repo):
    info = api().model_info(repo, files_metadata=True)
    files = [
        {'name': s.rfilename, 'size': s.size or 0, 'quant': detect_quant(s.rfilename), 'recommended': is_recommended(s.rfilename)}
        for s in info.siblings or [] if s.rfilename.lower().endswith('.gguf')
    ]
    order = ['Q8', 'Q6', 'Q5', 'Q4', 'Q3', 'Q2', 'IQ']

    def rank(f):
        if f['recommended']:
            return 0
        return next((i + 1 for i, q in enumerate(order) if f['quant'].startswith(q)), len(order) + 1)

    files.sort(key=lambda f: (rank(f), -f['size']))
    tags = list(info.tags or [])
    return {'repo': repo, 'files': files, 'capabilities': capabilities_of(repo, tags, info.pipeline_tag or ''),
            'pipeline': info.pipeline_tag or ''}


def gpu_memory_mb():
    if not shutil.which('nvidia-smi'):
        return 0
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
                             capture_output=True, text=True, timeout=4).stdout
        return int(out.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return 0


def recommendations():
    vram = gpu_memory_mb()
    fits = [m for m in CATALOG if vram >= m['min_mb']]
    return {'gpu': vram > 0, 'vram_mb': vram, 'models': [{**m, 'recommended': i == 0} for i, m in enumerate(fits)]}


def start_download(repo, filename, size=0, kind=LocalModel.Kind.TEXT, capabilities=()):
    """Crée (ou relance) l'entrée et télécharge en tâche de fond ; la progression est lue sur disque."""
    model, _ = LocalModel.objects.update_or_create(
        repo=repo, filename=filename,
        defaults={'status': LocalModel.Status.DOWNLOADING, 'progress': 0, 'error': '', 'size': size, 'kind': kind,
                  'quant': detect_quant(filename), 'capabilities': list(capabilities)},
    )
    threading.Thread(target=_download, args=(model.pk,), daemon=True).start()
    return model


def _download(model_id):
    from django.db import connection

    model = LocalModel.objects.get(pk=model_id)
    target = Path(settings.MODELS_DIR) / model.repo.replace('/', '__')
    try:
        path = hf_hub_download(model.repo, model.filename, local_dir=target, token=settings.HF_TOKEN or None)
        LocalModel.objects.filter(pk=model_id).update(
            path=str(path), status=LocalModel.Status.READY, progress=1, size=Path(path).stat().st_size,
        )
    except Exception as e:  # réseau, disque, dépôt privé : l'erreur est rapportée dans la bibliothèque
        LocalModel.objects.filter(pk=model_id).update(status=LocalModel.Status.ERROR, error=str(e)[:2000])
    finally:
        connection.close()


def refresh_progress(model):
    """Progression d'un téléchargement en cours : taille partielle sur disque / taille annoncée."""
    if model.status != LocalModel.Status.DOWNLOADING or not model.size:
        return model
    folder = Path(settings.MODELS_DIR) / model.repo.replace('/', '__')
    partial = sum(p.stat().st_size for p in folder.rglob('*') if p.is_file()) if folder.exists() else 0
    model.progress = min(partial / model.size, 0.99)
    return model
