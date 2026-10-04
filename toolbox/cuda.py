"""Compilation de llama-cpp-python avec CUDA depuis Agents & modèles (administrateur), puis redémarrage.

Le travail est celui de deploy/cuda.sh (commande fixe, aucune entrée utilisateur), lancé en tâche de fond ;
l'interface suit son journal. Le module llama_cpp déjà chargé ne change pas avant le redémarrage de Nodz.
ScriptJob sert aussi à compiler stable-diffusion.cpp (imaging.installer, deploy/sd.sh).
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

SERVICE = os.environ.get('NODZ_SERVICE', 'nodz')
EXITS = {0: 'offload GPU actif : redémarre Nodz', 2: 'pas de carte NVIDIA', 3: 'CUDA Toolkit (nvcc) absent',
         4: "compilé, mais l'offload GPU reste inactif"}


class ScriptJob:
    """Un script fixe de deploy/ (aucune entrée utilisateur), lancé en tâche de fond, une fois à la fois ; l'interface
    suit son journal et son résultat (code de sortie → phrase). `done` est appelé à la fin (code de sortie)."""

    def __init__(self, script, exits, done=lambda code: None):
        self.script, self.exits, self.done = Path(settings.BASE_DIR) / 'deploy' / script, exits, done
        self.status = {'running': False, 'code': None, 'started': None, 'finished': None}
        self.log = deque(maxlen=60)
        self.lock = threading.Lock()

    def state(self):
        with self.lock:
            code = self.status['code']
            return {**self.status, 'log': list(self.log),
                    'result': self.exits.get(code, f'échec (code {code})') if code is not None else None}

    def build(self):
        """Lance le script (une fois à la fois) ; faux s'il tourne déjà."""
        with self.lock:
            if self.status['running']:
                return False
            self.status.update(running=True, code=None, started=time.time(), finished=None)
            self.log.clear()
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def _run(self):
        code = 1
        try:
            process = subprocess.Popen(['bash', str(self.script)], cwd=settings.BASE_DIR, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, env={**os.environ, 'PYTHON': sys.executable})
            for line in process.stdout:
                with self.lock:
                    self.log.append(line.rstrip()[:300])
            code = process.wait()
        except OSError as e:
            with self.lock:
                self.log.append(str(e))
        finally:
            with self.lock:
                self.status.update(running=False, code=code, finished=time.time())
            self.done(code)


job = ScriptJob('cuda.sh', EXITS)
build = job.build


def state():
    return {**job.state(), 'nvcc': bool(shutil.which('nvcc') or Path('/usr/local/cuda/bin/nvcc').exists()), 'restart': can_restart()}


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
