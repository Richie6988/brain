# Changelog

## Phase 1 (partielle) : version déployable en test

Ce qui a changé pour l'utilisateur : `/login/` ne plante plus, la date de création d'un node reste fixe, et Nodz fonctionne sans aucun CDN externe. Un serveur de test peut être installé en suivant `DEPLOY.md`.

- Corrections de l'audit : `Node.created_at` (auto_now_add), `uploaded_at` supprimé, doublon `generate_invite` supprimé, CSRF rétabli sur les codes de validation email, chemins statiques via `{% static %}`, redirection après connexion.
- Production : WhiteNoise pour les statiques, cookies sécurisés et en-tête proxy HTTPS hors debug, `CSRF_TRUSTED_ORIGINS` et chemin SQLite configurables, logs console, endpoint `/healthz`.
- Librairies auparavant chargées depuis des CDN non versionnés, désormais embarquées dans `static/vendor/` avec leur licence : htmx 2.0.11, jQuery 3.6.0, Chart.js 4.5.1, Velocity 1.5.2, jsPDF 2.5.1, svg2pdf.js 2.1.0.
- Déploiement : service systemd Daphne, site nginx avec WebSocket, script `deploy/update.sh`, `Procfile`.
- CI GitHub Actions : compilation, `check --deploy`, migrations, collectstatic, tests.
- Nodz peut être servi sous un chemin (`NODZ_URL_PREFIX=/nodz`) : statiques, `{% url %}`, appels `fetch` (via `static/js/base.js`), WebSocket et CSS relatifs. Déploiement de test sous `https://paintit.click/nodz/`.
- Cookies renommés `nodz_sessionid` / `nodz_csrftoken` (limités au préfixe) pour cohabiter avec paintit sur le même domaine. Les sessions existantes sont déconnectées une fois.
- WebSocket multi-utilisateurs : ne pointe plus sur `ws://localhost:8000`.
- Tutoriel supprimé (fenêtre d'aide et parcours guidé) ; ses nodes de démonstration provoquaient les erreurs de sélection, de glisser et de copier-coller. Il reviendra sous forme d'aide par l'IA.
- Intégration YouTube supprimée : type de node Video, lecteur, recherche, colonnes `video_content` / `video_link` (migration 0015). Les dépendances `requests` et `beautifulsoup4` disparaissent avec elle.

## Phase 0 : fork propre

Ce qui a changé pour l'utilisateur : rien dans l'interface. Nodz s'installe en local en 5 commandes, avec une base vide et un utilisateur local prêt à l'emploi.

- Configuration (clé secrète, debug, hôtes, SMTP, Stripe) lue depuis `.env` ; plus aucun secret dans le code.
- Emails affichés dans la console quand aucun SMTP n'est configuré.
- `.gitignore` (caches Python, `.env`, base SQLite, médias, fichiers statiques collectés).
- `requirements.txt` complet et épinglé à partir des imports réels.
- Commande `python manage.py bootstrap` : crée l'utilisateur local, son `Param` et son layer `Home` (idempotente, testée).
- Suppression du réglage inutilisé `WKHTMLTOPDF_CMD`.
