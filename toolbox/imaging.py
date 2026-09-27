"""Génération d'images locale avec stable-diffusion.cpp (binaire `sd`), comme l'ImageGenerationService
de SquidMind.

FLUX (schnell, dev) est un transformeur de diffusion seul : il lui faut trois fichiers compagnons,
cherchés à côté du modèle puis dans tout le dossier des modèles : le VAE (ae.safetensors), l'encodeur
CLIP-L et l'encodeur T5-XXL. Les modèles Stable Diffusion (SD 1.5, SD-Turbo, SDXL) sont autonomes.
Une génération tient le broker (priorité IMAGE) : le modèle de texte est déchargé pendant ce temps.
"""

import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from django.conf import settings

from . import hub

CANDIDATES = ['sd', 'sd-cli', 'sd-diffusion', 'sdcpp', 'stable-diffusion']
COMPANIONS = {
    'vae': [r'^ae\.(safetensors|sft)$', r'^flux.*vae.*\.safetensors$'],
    'clip_l': [r'^clip_l.*\.(safetensors|gguf)$'],
    't5xxl': [r'^t5.*xxl.*\.(gguf|safetensors)$', r'^t5.*encoder.*\.gguf$'],
}
TIMEOUT = 45 * 60
_binary = {}


class ImageUnavailable(Exception):
    """Génération impossible : le message dit quoi installer ou télécharger."""


def binary():
    """Chemin du binaire stable-diffusion.cpp, ou None (SD_BIN, sinon cherché dans le PATH)."""
    if 'path' not in _binary:
        found = None
        for name in ([settings.SD_BIN] if settings.SD_BIN else CANDIDATES):
            path = shutil.which(name) or (name if Path(name).is_file() else None)
            if not path:
                continue
            try:  # « sd » est aussi le nom d'un outil Rust de remplacement de texte
                out = subprocess.run([path, '--help'], capture_output=True, text=True, timeout=5)
            except (OSError, subprocess.SubprocessError):
                continue
            if re.search(r'diffusion|--diffusion-model|--cfg-scale', out.stdout + out.stderr, re.I):
                found = path
                break
        _binary['path'] = found
    return _binary['path']


def is_flux(model):
    return 'flux' in f'{model.repo} {model.filename}'.lower()


def companions(model):
    """{vae, clip_l, t5xxl} trouvés près du modèle, puis dans tout le dossier des modèles."""
    folders = [Path(model.path).parent, Path(settings.MODELS_DIR)]
    found = {}
    for role, patterns in COMPANIONS.items():
        for folder, deep in ((folders[0], False), (folders[1], True)):
            files = sorted(folder.rglob('*') if deep else folder.glob('*')) if folder.is_dir() else []
            match = next((f for p in patterns for f in files
                          if f.is_file() and not f.name.endswith('.partial') and re.search(p, f.name, re.I)), None)
            if match:
                found[role] = str(match)
                break
    return found


def output_dir(user):
    folder = Path(settings.MEDIA_ROOT) / 'generated' / str(user.pk)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def image_path(user, name):
    """Fichier généré pour cet utilisateur, ou None (pas de chemin arbitraire)."""
    if not re.fullmatch(r'[0-9a-f]{32}\.png', name or ''):
        return None
    path = output_dir(user) / name
    return path if path.is_file() else None


def generate(model, prompt, user, on_progress=lambda step, total: None, **overrides):
    """Génère une image PNG ; renvoie son nom de fichier (dans le dossier de l'utilisateur)."""
    sd = binary()
    if sd is None:
        raise ImageUnavailable("stable-diffusion.cpp (sd) n'est pas installé sur le serveur : voir DEPLOY.md")
    if not model.path or not Path(model.path).is_file():
        raise ImageUnavailable(f"{model.filename} n'est pas téléchargé")
    flux = is_flux(model)
    p = {'width': 512, 'height': 512, 'steps': 4 if flux else 20, 'cfg_scale': 1.0 if flux else 7.0,
         'sampling_method': 'euler' if flux else 'euler_a', **model.params, **overrides}
    name = f'{uuid.uuid4().hex}.png'
    out = output_dir(user) / name
    args = [sd, '--diffusion-model' if flux else '--model', model.path, '--prompt', prompt, '--output', str(out),
            '--width', str(p['width']), '--height', str(p['height']), '--steps', str(p['steps']),
            '--cfg-scale', str(p['cfg_scale']), '--sampling-method', p['sampling_method'],
            '--seed', str(p.get('img_seed', -1))]
    if flux:
        found = companions(model)
        missing = [role for role in COMPANIONS if role not in found]
        if missing:
            raise ImageUnavailable(f"FLUX a besoin de ses fichiers compagnons ({', '.join(missing)}) : "
                                   'installe le pack FLUX depuis Agents & modèles')
        args += ['--vae', found['vae'], '--clip_l', found['clip_l'], '--t5xxl', found['t5xxl'], '--clip-on-cpu']
    if p.get('sd_threads'):
        args += ['--threads', str(p['sd_threads'])]
    if p.get('vae_tiling'):
        args.append('--vae-tiling')
    env = dict(os.environ)
    if p.get('cpu_only') or not hub.gpu_memory_mb():
        env['CUDA_VISIBLE_DEVICES'] = ''  # tout sur CPU, sans risque de manque de VRAM
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    started, tail, shown, line = time.monotonic(), [], None, b''
    while True:
        byte = process.stdout.read(1)  # sd écrit sa progression sur une ligne réécrite (\r)
        if not byte:
            break
        if byte not in (b'\r', b'\n'):
            line += byte
            continue
        text, line = line.decode('utf-8', 'replace'), b''
        tail = (tail + [text])[-20:]
        step = re.search(r'(\d+)/(\d+)', text)
        if step and '|' in text and step.groups() != shown:
            shown = step.groups()
            on_progress(int(shown[0]), int(shown[1]))
        if time.monotonic() - started > TIMEOUT:
            process.kill()
            raise ImageUnavailable('génération trop longue : interrompue')
    if process.wait() != 0 or not out.is_file():
        detail = next((t for t in reversed(tail) if re.search(r'error|fail', t, re.I)), tail[-1] if tail else '')
        raise ImageUnavailable(f'stable-diffusion.cpp a échoué : {detail.strip()[:200]}')
    return name
