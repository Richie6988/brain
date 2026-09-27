"""Compilation de llama-cpp-python avec CUDA depuis Agents & modèles (administrateur), puis redémarrage.

Le travail est celui de deploy/cuda.sh (commande fixe, aucune entrée utilisateur), lancé en tâche de fond ;
l'interface suit son journal. Le module llama_cpp déjà chargé ne change pas avant le redémarrage de Nodz.
"""

import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

from django.conf import settings

SCRIPT = Path(settings.BASE_DIR) / 'deploy' / 'cuda.sh'
SERVICE = os.environ.get('NODZ_SERVICE', 'nodz')
EXITS = {0: 'offload GPU actif : redémarre Nodz', 2: 'pas de carte NVIDIA', 3: 'CUDA Toolkit (nvcc) absent',
         4: "compilé, mais l'offload GPU reste inactif"}

_state = {'running': False, 'code': None, 'started': None, 'finished': None}
_log = deque(maxlen=60)
_lock = threading.Lock()


def state():
    with _lock:
        return {**_state, 'log': list(_log), 'result': EXITS.get(_state['code'], f"échec (code {_state['code']})") if _state['code'] is not None else None,
                'nvcc': bool(shutil.which('nvcc') or Path('/usr/local/cuda/bin/nvcc').exists()), 'restart': can_restart()}


def build():
    """Lance la compilation (une à la fois)."""
    with _lock:
        if _state['running']:
            return False
        _state.update(running=True, code=None, started=time.time(), finished=None)
        _log.clear()
    threading.Thread(target=_run, daemon=True).start()
    return True


def _run():
    code = 1
    try:
        process = subprocess.Popen(['bash', str(SCRIPT)], cwd=settings.BASE_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, env={**os.environ, 'PYTHON': sys.executable})
        for line in process.stdout:
            with _lock:
                _log.append(line.rstrip()[:300])
        code = process.wait()
    except OSError as e:
        with _lock:
            _log.append(str(e))
    finally:
        with _lock:
            _state.update(running=False, code=code, finished=time.time())


def can_restart():
    """Le compte du serveur peut-il redémarrer le service sans mot de passe (sudoers) ?"""
    if not shutil.which('sudo') or not shutil.which('systemctl'):
        return False
    try:
        return subprocess.run(['sudo', '-n', '-l', shutil.which('systemctl'), 'restart', SERVICE], capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def restart():
    """Redémarre le service une seconde après la réponse (le processus actuel s'arrête avec lui)."""
    if not can_restart():
        return False
    subprocess.Popen(['sh', '-c', f'sleep 1; sudo -n {shutil.which("systemctl")} restart {SERVICE}'], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True
