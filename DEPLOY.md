# Déploiement du serveur de test

Cible : un VPS Linux (Debian/Ubuntu) avec nginx, même schéma que paintit, mais servi par **Daphne** (ASGI) car Nodz utilise un WebSocket (`/ws/`).

## Installation en une commande (même VPS que paintit)

Prérequis : un enregistrement DNS A du domaine choisi (ex. `nodz.paintit.click`) vers le serveur. Paintit n'est pas touché : Nodz tourne sous l'utilisateur `nodz`, sur le port 8001, avec son propre site nginx.

```bash
ssh root@<serveur>
curl -fsSL https://raw.githubusercontent.com/Richie6988/brain/main/deploy/install.sh -o install.sh
DOMAIN=nodz.paintit.click bash install.sh main
sudo -u nodz /home/nodz/brain/.venv/bin/python /home/nodz/brain/manage.py bootstrap --email <toi> --password <mot de passe>
```

Le script est idempotent (relançable), génère `.env` avec une clé secrète aléatoire, installe le service systemd et la règle sudoers de redémarrage, obtient le certificat Let's Encrypt puis active la config nginx complète. Il s'arrête si le port 8001 est déjà pris.

## Première installation (détail manuel)

```bash
sudo adduser --disabled-password nodz && sudo usermod -aG www-data nodz
sudo apt install python3.12-venv nginx certbot python3-certbot-nginx libreoffice-core  # libreoffice : conversion docx/pptx
sudo -iu nodz
git clone https://github.com/Richie6988/brain && cd brain
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # puis éditer, voir ci-dessous
.venv/bin/python manage.py migrate && .venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py bootstrap --email <toi> --password <mot de passe>
exit
sudo cp /home/nodz/brain/deploy/nodz.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now nodz
sudo cp /home/nodz/brain/deploy/nginx-nodz.conf /etc/nginx/sites-available/nodz   # remplacer test.nodz.example
sudo ln -s /etc/nginx/sites-available/nodz /etc/nginx/sites-enabled/ && sudo certbot --nginx -d <domaine> && sudo nginx -t && sudo systemctl reload nginx
```

`.env` de test :

```
DJANGO_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(50))">
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=<domaine>,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://<domaine>
SQLITE_PATH=/home/nodz/brain/db.sqlite3
```

`127.0.0.1` dans `DJANGO_ALLOWED_HOSTS` sert au healthcheck local du script de mise à jour.

## Mises à jour

```bash
sudo -iu nodz /home/nodz/brain/deploy/update.sh
```

Le script fait `git pull`, installe les dépendances, migre, collecte les statiques, lance `check --deploy`, redémarre le service et interroge `/healthz`. L'utilisateur `nodz` doit pouvoir lancer `sudo systemctl restart nodz` (règle sudoers dédiée).

## Limites connues du serveur de test

- Un seul processus Daphne : le channel layer est en mémoire (suffisant pour les curseurs partagés sur une instance ; Redis sera nécessaire au-delà).
- SQLite : sauvegarder `db.sqlite3` et `nodzapp/media/` (fichiers des utilisateurs, jamais exposés directement par nginx).
- `GeoLite2-Country.mmdb` absent : la géolocalisation à l'inscription est inactive.
- Stripe non configuré : les pages premium ne fonctionneront pas.
