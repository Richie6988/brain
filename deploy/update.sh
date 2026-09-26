#!/usr/bin/env bash
# Mise à jour du serveur de test, à lancer en tant qu'utilisateur nodz depuis /home/nodz/brain.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py collectstatic --noinput -v0
.venv/bin/python manage.py check --deploy --fail-level WARNING
sudo systemctl restart nodz
sleep 2
curl -fsS http://127.0.0.1:8001/healthz
echo
