# Nodz Next

Mind map multidimensionnel (Django + SVG), base de l'interface humain-IA spatiale. Voir `CLAUDE.md` pour la feuille de route.

## Installation locale

Prérequis : Python 3.12 ou plus (le code utilise des f-strings imbriquées, PEP 701).

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate && python manage.py bootstrap
python manage.py runserver
```

`bootstrap` crée l'utilisateur local (`local@nodz.local` par défaut, superuser) avec son layer `Home`, et affiche le mot de passe généré. Il est idempotent. Pour fixer le mot de passe : `python manage.py bootstrap --password ...` ou `NODZ_LOCAL_PASSWORD` dans `.env`.

Ouvrir ensuite http://localhost:8000/universe puis LOGIN.

## Configuration

Toute la configuration passe par `.env` (voir `.env.example`). Sans `EMAIL_HOST`, les emails sont affichés dans la console. Hors `DJANGO_DEBUG=1`, un vrai `DJANGO_SECRET_KEY` est obligatoire.

Dépendances optionnelles à l'exécution : LibreOffice (`libreoffice --headless`) pour la conversion de documents, et la base `GeoLite2-Country.mmdb` à la racine pour la géolocalisation.

## Tests

```bash
python manage.py test
```
