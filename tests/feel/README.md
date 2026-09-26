# Banc de test du feel

Scénario Playwright fixe, en invité (compte neuf et vide à chaque exécution), fenêtre 1280×800 :
création de 3 nodes, pan à la molette, zoom avant puis arrière centrés sur le curseur (pinch),
glisser de l'univers, sélection au rectangle, drag de la sélection, téléportation (Entrée).

Après chaque étape il relève la transformation de `#universe`, le zoom, le plan courant,
la transformation de chaque node et la sélection. `reference.json` a été enregistré sur l'ancien
code (avant la refonte de la couche node) : toute refonte doit le reproduire à 1e-3 près.

```bash
npm install                       # playwright, une fois
python manage.py runserver 8001   # ou daphne, sans NODZ_URL_PREFIX
npm run feel                      # compare à reference.json
npm run feel:record               # réenregistre la référence (seulement sur demande explicite)
```

`NODZ_URL` change l'adresse du serveur, `CHROMIUM_PATH` le navigateur.
