# Déploiement du serveur de test

Nodz est servi sous **https://paintit.click/nodz/**, sur le même VPS que paintit, par **Daphne** (ASGI, car Nodz utilise un WebSocket).

- Nodz tourne sous l'utilisateur `nodz`, dans `/home/nodz/brain`, sur `127.0.0.1:8001`.
- Seule modification de paintit : la ligne `include snippets/nodz.conf;` dans son bloc `server` HTTPS (fichier `deploy/nginx-nodz-path.conf`).
- Les cookies de Nodz s'appellent `nodz_sessionid` et `nodz_csrftoken`, limités à `/nodz/` : aucune collision avec les sessions de paintit.

## Installation en une commande

```bash
ssh root@<serveur>
curl -fsSL https://raw.githubusercontent.com/Richie6988/brain/main/deploy/install.sh -o install.sh
bash install.sh main
sudo -u nodz /home/nodz/brain/.venv/bin/python /home/nodz/brain/manage.py bootstrap --email <toi> --password <mot de passe>
```

Le script est relançable. Il installe le venv, génère `.env` (clé secrète aléatoire, `NODZ_URL_PREFIX=/nodz`), migre, installe le service systemd et la règle sudoers de redémarrage, copie le bloc nginx dans `/etc/nginx/snippets/nodz.conf` puis ajoute l'`include` au site de paintit. Avant de toucher au site de paintit, il le sauvegarde (`.bak-nodz`) et le restaure si `nginx -t` échoue. Il s'arrête si le port 8001 est déjà pris ou si le site de paintit est introuvable (`PAINTIT_SITE=...` pour un autre chemin que `/etc/nginx/sites-available/paintit`).

`.env` généré :

```
DJANGO_SECRET_KEY=<aléatoire>
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=paintit.click,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://paintit.click
NODZ_URL_PREFIX=/nodz
SQLITE_PATH=/home/nodz/brain/db.sqlite3
```

`127.0.0.1` dans `DJANGO_ALLOWED_HOSTS` sert au healthcheck local.

## Mises à jour

```bash
sudo -iu nodz /home/nodz/brain/deploy/update.sh
```

Le script fait `git pull`, installe les dépendances, migre, collecte les statiques, lance `check --deploy`, redémarre le service et interroge `/healthz`.

## IA locale (optionnelle)

Texte (Gardien et agents), avec llama-cpp-python :

```bash
# Sur CPU (fonctionne partout, lent)
sudo -iu nodz /home/nodz/brain/.venv/bin/pip install -r /home/nodz/brain/requirements-ai.txt
# Sur GPU NVIDIA : vérifier la carte (nvidia-smi), installer le CUDA Toolkit (nvcc), puis recompiler
sudo -iu nodz env CMAKE_ARGS="-DGGML_CUDA=on" CMAKE_BUILD_PARALLEL_LEVEL=2 \
    /home/nodz/brain/.venv/bin/pip install --force-reinstall --no-cache-dir llama-cpp-python
```

Ou depuis l'interface : Agents & modèles, Réglages d'un modèle, bouton « Compiler avec CUDA » (administrateur).
Il lance `deploy/cuda.sh` (vérifie la carte et nvcc, compile, contrôle que l'offload GPU est actif) et affiche
son journal ; le bouton « Redémarrer Nodz » marche si le compte `nodz` peut redémarrer le service sans mot de
passe :

```bash
echo 'nodz ALL=(root) NOPASSWD: /usr/bin/systemctl restart nodz' | sudo tee /etc/sudoers.d/nodz-restart
sudo chmod 440 /etc/sudoers.d/nodz-restart
```

Sans GPU NVIDIA, l'offload GPU des réglages n'a aucun effet. Avec peu de RAM, ajouter du swap avant de
compiler (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`).

Images (Illustrateur), avec stable-diffusion.cpp :

```bash
sudo apt install -y cmake build-essential git
git clone --recursive https://github.com/leejet/stable-diffusion.cpp /opt/stable-diffusion.cpp
cd /opt/stable-diffusion.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
# GPU NVIDIA : ajouter -DSD_CUDA=ON à la première commande cmake
echo "SD_BIN=$(find /opt/stable-diffusion.cpp/build/bin -maxdepth 1 -name 'sd*' -type f | head -1)" >> /home/nodz/brain/.env
systemctl restart nodz
```

Puis, dans Agents & modèles, bouton « Installer FLUX.1 schnell » (modèle et fichiers compagnons : VAE,
CLIP-L, T5-XXL) et choix du modèle de l'Illustrateur. FLUX demande environ 8 Go de RAM même en
quantisation légère : sur un petit serveur, préférer un modèle SD-Turbo ou SD 1.5 en GGUF.

## Tâches planifiées du Gardien

Les tâches récurrentes (`schedule_task`) se déclenchent quand une page Nodz est ouverte. Pour qu'elles
tournent aussi pages fermées, une ligne de cron :

```bash
echo '* * * * * nodz cd /home/nodz/brain && .venv/bin/python manage.py run_schedules >> var/schedules.log 2>&1' | sudo tee /etc/cron.d/nodz-schedules
```

## Outils administrateur du Gardien

Shell, environnement Python, outils forgés et serveurs MCP exécutent du code sur le serveur : ils ne sont
proposés qu'au compte administrateur, après `GUARDIAN_SHELL=1` dans `.env`, puis cochés un par un dans
Agents & modèles, onglet Outils. Serveurs MCP : `MCP_SERVERS={"nom": {"url": "https://…/mcp", "headers": {}}}`.

## Désinstallation

```bash
sed -i '/include snippets\/nodz.conf;/d' /etc/nginx/sites-available/paintit && nginx -t && systemctl reload nginx
systemctl disable --now nodz && rm /etc/systemd/system/nodz.service /etc/sudoers.d/nodz /etc/nginx/snippets/nodz.conf
```

## Limites connues du serveur de test

- Un seul processus Daphne : le channel layer est en mémoire (suffisant pour les curseurs partagés sur une instance ; Redis sera nécessaire au-delà).
- SQLite : sauvegarder `db.sqlite3` et `nodzapp/media/` (fichiers des utilisateurs, jamais exposés directement par nginx).
- `GeoLite2-Country.mmdb` absent : la géolocalisation à l'inscription est inactive.
- Stripe non configuré : les pages premium ne fonctionneront pas.
- LibreOffice non installé par le script : `apt install libreoffice-core` pour la conversion docx/pptx.
