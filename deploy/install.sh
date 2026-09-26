#!/usr/bin/env bash
# Installation initiale de Nodz sur le VPS (à lancer en root), sans toucher à paintit.
#   DOMAIN=nodz.example.com bash install.sh [branche]
# Prérequis : un enregistrement DNS A de $DOMAIN vers ce serveur (pour le certificat HTTPS).
set -euo pipefail

DOMAIN=${DOMAIN:?"DOMAIN=<domaine> requis"}
BRANCH=${1:-main}
APP_USER=nodz
APP_DIR=/home/$APP_USER/brain
PORT=8001

[ "$(id -u)" = 0 ] || { echo "À lancer en root"; exit 1; }
command -v python3.12 >/dev/null || { echo "python3.12 introuvable (Ubuntu 24.04 l'inclut ; sinon : add-apt-repository ppa:deadsnakes/ppa)"; exit 1; }
if ss -ltn "sport = :$PORT" | grep -q LISTEN; then echo "Port $PORT déjà utilisé"; exit 1; fi

apt-get install -y -q python3.12-venv nginx certbot python3-certbot-nginx git curl >/dev/null
id $APP_USER >/dev/null 2>&1 || adduser --disabled-password --gecos "" $APP_USER
usermod -aG www-data $APP_USER

if [ ! -d "$APP_DIR/.git" ]; then
    sudo -u $APP_USER git clone -q -b "$BRANCH" https://github.com/Richie6988/brain "$APP_DIR"
fi
cd "$APP_DIR"
sudo -u $APP_USER python3.12 -m venv .venv
sudo -u $APP_USER .venv/bin/pip install -q -r requirements.txt

if [ ! -f .env ]; then
    SECRET=$(python3.12 -c "import secrets; print(secrets.token_urlsafe(50))")
    cat > .env <<EOF
DJANGO_SECRET_KEY=$SECRET
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=$DOMAIN,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://$DOMAIN
SQLITE_PATH=$APP_DIR/db.sqlite3
EOF
    chown $APP_USER: .env && chmod 600 .env
fi

sudo -u $APP_USER .venv/bin/python manage.py migrate --noinput -v0
sudo -u $APP_USER .venv/bin/python manage.py collectstatic --noinput -v0
sudo -u $APP_USER .venv/bin/python manage.py check --deploy --fail-level WARNING

cp deploy/nodz.service /etc/systemd/system/nodz.service
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart nodz" > /etc/sudoers.d/nodz
chmod 440 /etc/sudoers.d/nodz
systemctl daemon-reload
systemctl enable --now nodz
sleep 3
curl -fsS -H "Host: 127.0.0.1" http://127.0.0.1:$PORT/healthz && echo

# nginx : d'abord en HTTP seul pour obtenir le certificat, puis la config complète.
cat > /etc/nginx/sites-available/nodz <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:$PORT; }
}
EOF
ln -sf /etc/nginx/sites-available/nodz /etc/nginx/sites-enabled/nodz
nginx -t && systemctl reload nginx
certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
sed "s/test.nodz.example/$DOMAIN/g" deploy/nginx-nodz.conf > /etc/nginx/sites-available/nodz
nginx -t && systemctl reload nginx

echo
echo "Nodz installé : https://$DOMAIN/universe"
echo "Créer ton compte : sudo -u $APP_USER $APP_DIR/.venv/bin/python $APP_DIR/manage.py bootstrap --email <toi> --password <mot de passe>"
