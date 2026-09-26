#!/usr/bin/env bash
# Installation initiale de Nodz sur le VPS de paintit (à lancer en root), servi sous https://$DOMAIN$PREFIX/.
#   bash install.sh [branche]
# Seule modification de paintit : une ligne `include snippets/nodz.conf;` dans son site nginx
# (sauvegarde préalable, retour arrière automatique si `nginx -t` échoue).
set -euo pipefail

DOMAIN=${DOMAIN:-paintit.click}
PREFIX=${PREFIX:-/nodz}
PAINTIT_SITE=${PAINTIT_SITE:-/etc/nginx/sites-available/paintit}
BRANCH=${1:-main}
APP_USER=nodz
APP_DIR=/home/$APP_USER/brain
PORT=8001

[ "$(id -u)" = 0 ] || { echo "À lancer en root"; exit 1; }
[ -f "$PAINTIT_SITE" ] || { echo "Site nginx de paintit introuvable : $PAINTIT_SITE (PAINTIT_SITE=...)"; exit 1; }
command -v python3.12 >/dev/null || { echo "python3.12 introuvable (Ubuntu 24.04 l'inclut ; sinon : add-apt-repository ppa:deadsnakes/ppa)"; exit 1; }
if ss -ltn "sport = :$PORT" | grep -q LISTEN; then echo "Port $PORT déjà utilisé"; exit 1; fi

apt-get install -y -q python3.12-venv git curl >/dev/null
id $APP_USER >/dev/null 2>&1 || adduser --disabled-password --gecos "" $APP_USER
# Ubuntu 24.04 crée les home en 750 : nginx (www-data) doit pouvoir traverser /home/nodz pour /nodz/static/.
chmod o+x /home/$APP_USER
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
NODZ_URL_PREFIX=$PREFIX
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

# nginx : bloc /nodz/ inclus dans le site HTTPS de paintit.
cp deploy/nginx-nodz-path.conf /etc/nginx/snippets/nodz.conf
if ! grep -q "include snippets/nodz.conf;" "$PAINTIT_SITE"; then
    cp "$PAINTIT_SITE" "$PAINTIT_SITE.bak-nodz"
    python3 - "$PAINTIT_SITE" "$DOMAIN" <<'PY'
import re, sys
path, domain = sys.argv[1], sys.argv[2]
conf = open(path).read()
# Bloc server qui écoute en 443 et sert exactement le domaine (pas la variante www).
for m in re.finditer(r'server\s*\{', conf):
    start = m.end()
    depth, i = 1, start
    while depth:
        depth += {'{': 1, '}': -1}.get(conf[i], 0)
        i += 1
    block = conf[start:i]
    name = re.search(r'server_name\s+' + re.escape(domain) + r'\s*;', block)
    if re.search(r'listen\s+443', block) and name:
        at = start + name.end()
        conf = conf[:at] + '\n    include snippets/nodz.conf;' + conf[at:]
        open(path, 'w').write(conf)
        break
else:
    sys.exit('Bloc server HTTPS de ' + domain + ' introuvable')
PY
    if ! nginx -t; then
        mv "$PAINTIT_SITE.bak-nodz" "$PAINTIT_SITE"
        echo "nginx -t en échec : site paintit restauré"; exit 1
    fi
fi
systemctl reload nginx
curl -fsS "https://$DOMAIN$PREFIX/healthz" && echo

echo
echo "Nodz installé : https://$DOMAIN$PREFIX/universe"
echo "Créer ton compte : sudo -u $APP_USER $APP_DIR/.venv/bin/python $APP_DIR/manage.py bootstrap --email <toi> --password <mot de passe>"
