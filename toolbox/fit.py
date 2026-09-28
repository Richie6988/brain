"""Placement d'un modèle GGUF, comme l'« auto-budget » d'iAqua (ModelService.loadModel).

Couches GPU « auto » : autant de couches que la VRAM libre en permet, en gardant la place du cache KV
pour un contexte de travail et une marge (tampons CUDA) ; « max » : toutes. Contexte « auto » : le plus
grand qui tient dans la mémoire restante, sans dépasser le contexte d'entraînement du modèle.

Sur CPU, la RAM décide de tout : un modèle qui n'y tient pas relit le disque à chaque jeton écrit (moins d'un jeton
par seconde). Le contexte se règle donc sur la RAM libre une fois le modèle chargé ; quand elle est juste, le cache
KV passe en q8_0 (moitié) et le batch à 512, et le résumé dit si le modèle tient (`fits`).
"""

import os
from pathlib import Path

from . import gguf, monitor

OVERHEAD_MB = 600  # contexte CUDA et tampons de calcul
WORK_CTX = 8192  # contexte réservé quand les couches GPU sont calculées (celui du Gardien)
MAX_AUTO_CTX = 32768
MAX_AUTO_CTX_CPU = 8192  # sur CPU : un grand cache pousse la RAM au swap et tout ralentit ; 8192 couvre le Gardien
MIN_AUTO_CTX = 4096  # plancher : le prompt du Gardien (environ 3 500 jetons) et sa réponse ; au-delà, il réduit les nodes
COMPUTE_MB = 300  # tampons de calcul sur CPU (batch 512)
DEFAULT_KV_BYTES = 128 * 1024  # par jeton, quand l'en-tête ne permet pas de le calculer


def default_threads():
    """Cœurs physiques (logiques / 2), au moins 4 comme iAqua, jamais plus que la machine n'en a (petit VPS)."""
    cpus = os.cpu_count() or 8
    return min(cpus, max(4, cpus // 2))


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


def resolve(path, options, gpu_offload=True, chosen=()):
    """Options avec « auto » / « max » remplacés par des nombres, et le résumé du calcul. `chosen` : réglages
    choisis par l'utilisateur, jamais changés (cache KV, batch)."""
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
    gpu = bool(on_gpu and vram)
    trained = info.get('context_length') or 4096
    weights_ram = size_mb - (on_gpu * per_layer if gpu else 0)  # la part du modèle qui reste en RAM
    spare = ram * 0.9 - weights_ram - COMPUTE_MB  # RAM pour le cache KV une fois le modèle chargé
    if not gpu and spare < MAX_AUTO_CTX_CPU * kv_mb:  # RAM juste : cache KV réduit de moitié, batch plus léger
        if 'type_k' not in chosen and 'type_v' not in chosen and out.get('flash_attn') and factor == 1.0:
            out['type_k'] = out['type_v'] = 8  # q8_0
            kv_mb /= 2
        if 'n_batch' not in chosen:
            out['n_batch'] = min(out.get('n_batch') or 512, 512)
    if options.get('n_ctx', 'auto') == 'auto':
        budget = vram - OVERHEAD_MB - on_gpu * per_layer if gpu else spare  # le cache suit les couches
        tokens = int(budget / kv_mb) if kv_mb else trained
        ceiling = MAX_AUTO_CTX if gpu else MAX_AUTO_CTX_CPU
        out['n_ctx'] = max(min(MIN_AUTO_CTX, trained), min(trained, ceiling, tokens // 1024 * 1024))
    need = weights_ram + COMPUTE_MB + (0 if gpu else out['n_ctx'] * kv_mb)
    summary = {'gpu_layers': on_gpu, 'layers': layers, 'n_ctx': out['n_ctx'], 'vram_free_mb': int(vram),
               'ram_free_mb': int(ram), 'gpu_offload': gpu_offload, 'model_mb': int(size_mb), 'need_mb': int(need),
               'kv_q8': out.get('type_k') == 8, 'fits': not ram or need <= ram * 0.95}
    return out, summary
