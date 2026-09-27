"""Placement d'un modèle GGUF, comme l'« auto-budget » d'iAqua (ModelService.loadModel).

Couches GPU « auto » : autant de couches que la VRAM libre en permet, en gardant la place du cache KV
pour un contexte de travail et une marge (tampons CUDA) ; « max » : toutes. Contexte « auto » : le plus
grand qui tient dans la mémoire restante, sans dépasser le contexte d'entraînement du modèle.
"""

import os
from pathlib import Path

from . import gguf, monitor

OVERHEAD_MB = 600  # contexte CUDA et tampons de calcul
WORK_CTX = 4096  # contexte réservé quand les couches GPU sont calculées
MAX_AUTO_CTX = 32768
DEFAULT_KV_BYTES = 128 * 1024  # par jeton, quand l'en-tête ne permet pas de le calculer


def default_threads():
    """Cœurs physiques (logiques / 2), au moins 4, comme iAqua."""
    return max(4, (os.cpu_count() or 8) // 2)


def kv_bytes_per_token(info, quant_factor=1.0):
    """Cache K et V en f16 : 2 × couches × dimension KV × 2 octets."""
    layers, embedding, heads = info.get('layers'), info.get('embedding'), info.get('heads')
    if not (layers and embedding and heads):
        return DEFAULT_KV_BYTES
    kv_dim = embedding * (info.get('kv_heads') or heads) / heads
    return int(2 * layers * kv_dim * 2 * quant_factor)


def free_memory():
    """(VRAM libre en Mo ou 0, RAM disponible en Mo)."""
    gpu = monitor.gpu()
    ram = monitor.memory()
    vram = (gpu['vram_total_mb'] - gpu['vram_used_mb']) if gpu else 0
    return vram, (ram['total_mb'] - ram['used_mb']) if ram else 0


def resolve(path, options, gpu_offload=True):
    """Options avec « auto » / « max » remplacés par des nombres, et le résumé du calcul."""
    info = gguf.info(path)
    layers = info.get('layers') or 0
    size_mb = Path(path).stat().st_size / 1024 ** 2 if path and Path(path).is_file() else 0
    per_layer = size_mb / (layers + 1) if layers else size_mb  # + la couche de sortie
    factor = 0.5 if options.get('type_k') == 8 else 0.25 if options.get('type_k') == 2 else 1.0
    kv_mb = kv_bytes_per_token(info, factor) / 1024 ** 2
    vram, ram = free_memory()
    if not gpu_offload:
        vram = 0  # llama-cpp-python compilé sans CUDA : tout sur CPU
    out = dict(options)
    gl = options.get('n_gpu_layers', 'auto')
    if gl == 'max':
        gl = -1
    elif gl == 'auto':
        if not vram or not layers:
            gl = 0
        else:
            ctx_reserve = options['n_ctx'] if isinstance(options.get('n_ctx'), int) else WORK_CTX
            fit = int((vram - OVERHEAD_MB - ctx_reserve * kv_mb) / per_layer) if per_layer else 0
            gl = -1 if fit >= layers else max(0, fit)
    out['n_gpu_layers'] = gl
    on_gpu = layers if gl == -1 else min(gl, layers)
    if options.get('n_ctx', 'auto') == 'auto':
        trained = info.get('context_length') or 4096
        if on_gpu and vram:  # le cache suit les couches : on budgète la VRAM restante
            budget = vram - OVERHEAD_MB - on_gpu * per_layer
        else:
            budget = ram * 0.8 - size_mb
        tokens = int(budget / kv_mb) if kv_mb else trained
        out['n_ctx'] = max(2048, min(trained, MAX_AUTO_CTX, tokens // 1024 * 1024))
    summary = {'gpu_layers': on_gpu, 'layers': layers, 'n_ctx': out['n_ctx'], 'vram_free_mb': int(vram),
               'ram_free_mb': int(ram), 'gpu_offload': gpu_offload}
    return out, summary
