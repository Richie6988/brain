# Changelog

## Phase 4 (en cours) : boîte à outils IA intégrée

Ce qui a changé pour l'utilisateur : sur `/next`, une barre en bas de l'écran permet de parler au Gardien, qui agit directement dans l'univers (création, liens, archivage) et confie le contenu aux agents ; tout ce qu'il fait s'annule d'un seul Ctrl+Z. Le bouton Agents ouvre la bibliothèque : choix du modèle de chaque agent, modèles installés, recherche et téléchargement sur Hugging Face (administrateurs).

- App `toolbox`, portée de SquidMind (qui n'est plus un service à part) : modèles locaux (`LocalModel`), agents (`Agent`), broker à priorités, moteur llama-cpp-python optionnel (`requirements-ai.txt`).
- API `/api/v1/toolbox` : état du moteur, recherche et fichiers Hugging Face, recommandations, téléchargement et suppression de modèles (staff), agents par utilisateur (quatre agents de départ : Gardien, Rédacteur, Codeur, Illustrateur).
- Le Gardien (`POST /api/v1/toolbox/command`, flux SSE) : lit la demande et le plan courant, répond par un plan d'actions JSON contraint (créer, modifier, relier, archiver, nettoyer, déléguer), place les nodes sans chevauchement, délègue aux agents (texte, code) qui publient leur résultat dans le node visé. Tout naît en brouillon, rattaché à un `AIRun`.
- Interface : `command.js` (barre de commande, flux SSE, réponse appliquée au store sans renvoi au serveur et annulable en un pas via `store.applyRemote` / `store.record`), `library.js` (bibliothèque, en bottom sheet sur mobile, suppression confirmée en deux temps), clavier virtuel pris en compte (`visualViewport`).
- nginx : bloc sans tampon et délai de 15 min pour le flux du Gardien.
- Réglages `.env` : `MODELS_DIR`, `HF_TOKEN`, `LLM_CTX`, `LLM_GPU_LAYERS`, `LLM_THREADS`.

## Phase 3 (en cours) : nouvelle interface

Ce qui a changé pour l'utilisateur : une nouvelle interface est disponible sur `/next`, à côté de `/universe`. Même navigation au pixel près (zoom, pan, glisser, sélection, téléportation), mais construite sur le nouveau modèle : nodes texte, liens, portails, annuler/refaire (Ctrl+Z / Ctrl+Y), sauvegarde automatique.

- Modules ES sans build (`graph/static/nodz/`) : store unique, catalogue d'actions (`create_node`, `update_node`, `move_nodes`, `delete_nodes`, `link_nodes`, `teleport`, `go_to_layer`, `select`) partagé par la souris, le clavier et bientôt l'IA ; transactions (un drag = un seul pas d'annulation).
- Caméra (`viewport.js`) reprenant exactement les maths de v1 ; le banc `tests/feel` passe sur `/next` (`NODZ_PAGE=/next npm run feel`).
- Rendu à la demande : un node rendu = un anneau + le contenu du type actif, monté seulement s'il est à l'écran ; plus aucun `children[N]`.
- Sauvegarde incrémentale groupée vers `/api/v1/changes`.

## Phase 2 : modèle de données v2 (gouvernance)

Ce qui a changé pour l'utilisateur : rien à l'écran pour l'instant. Le nouveau modèle de données et son API existent à côté de l'ancien ; la nouvelle interface s'appuiera dessus.

- App `graph` : plans, nodes à identifiant stable (UUID), contenu par type dans `payload`, provenance (humain, IA, import), statut brouillon/accepté/archivé, arêtes typées (lien, portail, dérivation, référence), historique append-only des versions (`NodeRevision`) et journal d'audit.
- API JSON `/api/v1` : plans, graphe d'un plan (avec l'autre extrémité des portails), écriture par lots transactionnels avec détection de conflit de version, historique d'un node, exécutions IA (`AIRun`).
- `python manage.py migrate_v1_to_v2` : copie idempotente des données existantes (plans, nodes, liens dédupliqués, portails) ; rien n'est supprimé côté v1, les contenus sans équivalent (dessin, rappels) sont conservés dans `payload.legacy`.
- Architecture : prise en compte du mobile (tactile, barre de commande, bottom sheets).

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
