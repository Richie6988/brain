# Changelog

## Phase 0 : fork propre

Ce qui a changé pour l'utilisateur : rien dans l'interface. Nodz s'installe en local en 5 commandes, avec une base vide et un utilisateur local prêt à l'emploi.

- Configuration (clé secrète, debug, hôtes, SMTP, Stripe) lue depuis `.env` ; plus aucun secret dans le code.
- Emails affichés dans la console quand aucun SMTP n'est configuré.
- `.gitignore` (caches Python, `.env`, base SQLite, médias, fichiers statiques collectés).
- `requirements.txt` complet et épinglé à partir des imports réels.
- Commande `python manage.py bootstrap` : crée l'utilisateur local, son `Param` et son layer `Home` (idempotente, testée).
- Suppression du réglage inutilisé `WKHTMLTOPDF_CMD`.
