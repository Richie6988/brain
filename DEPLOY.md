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
