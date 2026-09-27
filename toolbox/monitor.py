"""Ressources du serveur en direct (CPU, RAM, GPU, disque), comme la tour de contrôle d'iAqua.

Le CPU se mesure par différence entre deux lectures de /proc/stat ; la première lecture d'un
processus prend un court échantillon. Le GPU est lu par nvidia-smi quand il existe.
"""

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

from django.conf import settings

_last = {'cpu': None}
_lock = threading.Lock()


def _cpu_times():
    fields = [int(v) for v in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)  # idle + iowait
    return sum(fields), idle


def cpu_percent():
    try:
        with _lock:
            previous = _last['cpu']
            if previous is None:
                previous = _cpu_times()
                time.sleep(0.2)
            current = _cpu_times()
            _last['cpu'] = current
        total, idle = current[0] - previous[0], current[1] - previous[1]
        return round(100 * (1 - idle / total), 1) if total > 0 else 0.0
    except (OSError, ValueError, IndexError):
        return None


def memory():
    try:
        info = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
        total, available = info['MemTotal'] // 1024, info['MemAvailable'] // 1024
        return {'total_mb': total, 'used_mb': total - available, 'percent': round(100 * (total - available) / total, 1)}
    except (OSError, ValueError, KeyError, ZeroDivisionError):
        return None


def gpu():
    if not shutil.which('nvidia-smi'):
        return None
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
                              '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=4).stdout
        name, util, used, total, temp = [v.strip() for v in out.splitlines()[0].split(',')]
        used, total = int(used), int(total)
        return {'name': name, 'percent': float(util), 'vram_used_mb': used, 'vram_total_mb': total,
                'vram_percent': round(100 * used / total, 1) if total else 0.0, 'temperature': float(temp)}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def disk():
    folder = Path(settings.MODELS_DIR)
    while not folder.exists() and folder != folder.parent:
        folder = folder.parent
    usage = shutil.disk_usage(folder)
    return {'free_gb': round(usage.free / 1024 ** 3, 1), 'total_gb': round(usage.total / 1024 ** 3, 1),
            'percent': round(100 * usage.used / usage.total, 1)}


def snapshot():
    return {
        'cpu': {'percent': cpu_percent(), 'cores': os.cpu_count(), 'load': [round(v, 2) for v in os.getloadavg()]},
        'ram': memory(),
        'gpu': gpu(),
        'disk': disk(),
    }
