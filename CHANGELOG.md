# Changelog

## Phase 4 (en cours) : boîte à outils IA intégrée

**Le Gardien vit sur `/universe`**, par-dessus Nodz, sans rien changer à ses sensations (bancs du feel identiques). Pas de chat : **un node écrit est un message**. Quand l'utilisateur quitte un node qu'il vient d'écrire, son texte part au Gardien (le node pulse pendant la réflexion), qui répond dans l'univers : un node-réponse relié au message, plus ses actions exécutées avec les fonctions de Nodz (`createNode`, `checkExistingLinks`, `deleteNode`, `nodeSizing`, boutons forme et verrou, téléportation par Entrée, `load`), donc avec la sauvegarde et l'annulation de Nodz ; ses travellings rejouent les gestes de l'utilisateur (crans de molette, `dragUniverse`). Messages courts (légendes, erreurs) dans un toast au style de Nodz.

**Agents & modèles** : un bouton dans la barre de boutons de Nodz ouvre le ModelLoader de SquidMind porté dans Nodz. Onglet Agents (modèle, activation, consignes) ; Bibliothèque en colonnes Gardien / Agents / Image avec glisser-déposer, fiches modèles (capacités, quantisation, en mémoire, réglages contexte / couches GPU / threads / batch / libération après inactivité / température / longueur, renommer, décharger, retirer), assistant de premier démarrage selon la machine ; Fichiers du serveur (import des .gguf copiés dans le dossier des modèles) ; Hugging Face (recherche par type, tri, quantisation et taille, fichiers classés avec la quantisation recommandée et l'alerte « trop lourd ici », téléchargements avec progression, vitesse, temps restant, annulation et reprise). Consultation ouverte à tout compte ; télécharger, importer, supprimer et régler sont réservés aux administrateurs.

Ce qui a changé pour l'utilisateur : sur `/next`, une barre en bas de l'écran permet de parler au Gardien, qui agit directement dans l'univers (création, liens, archivage) et confie le contenu aux agents ; tout ce qu'il fait s'annule d'un seul Ctrl+Z. Le bouton Agents ouvre la bibliothèque : choix du modèle de chaque agent, modèles installés, recherche et téléchargement sur Hugging Face (administrateurs).

**L'humain déclenche l'IA** : Ctrl+Entrée (Cmd+Entrée) dans un node l'envoie au Gardien ; écrire, déplacer ou quitter un node ne lance plus rien. Une astuce le rappelle au premier node écrit.

**Dispatcher** : les demandes au Gardien passent une à une (`GUARDIAN_WORKERS`, 1 par défaut), en file bornée (`GUARDIAN_QUEUE`, 8), une seule par utilisateur ; au-delà, refus immédiat (429) avec un message clair. La page affiche sa place dans la file ; une demande abandonnée quitte la file. La tour de contrôle montre les demandes en attente.

**Fil de suivi** : le Gardien annonce son plan (étapes à venir), puis chaque étape au moment où la page l'exécute (« Je relie… », « Je cherche sur le web… », « Rédacteur écrit… ») ; les étapes faites se barrent, le fil s'efface après la réponse.

**Outils d'iAqua portés au Gardien** : recherche web et lecture de page (`web_search`, `web_fetch`, adresses internes du serveur refusées, `GUARDIAN_WEB=0` pour couper), recherche dans tous les nodes de l'utilisateur (`search_nodes`) et voyage jusqu'au node trouvé (`goto`), lecture des documents (`read_file`), carte mentale (`mindmap`), création et réglage d'agents (`create_agent`, `update_agent`), mémoire durable (`remember`, `forget`), en plus de l'inventaire et de la délégation. Non portés, par sécurité sur un serveur partagé : bash, git, écriture de fichiers serveur, e-mail, MCP, suppression d'agent.

**Consignes** : consignes par défaut écrites pour le Gardien (méthode, ton, règles) et pour chaque agent (Rédacteur, Codeur, Illustrateur, outils), visibles et modifiables dans Agents & modèles, avec retour aux consignes par défaut. Le format et les outils du Gardien restent fixes : une consigne réécrite ne les retire pas.

**Tous les outils d'iAqua portés** (`toolbox/iaqua.py`, 68 outils au catalogue) : tâches (création, suivi, exécution par un agent en fond) et tâches récurrentes (`daily@HH:MM`, `weekly:mon@HH:MM`, `hourly`, `every:Nm`), projets (une dimension et sa mémoire vivante : décisions, réussites, bloquants, suite ; audit des nodes vides ou isolés), missions autonomes (planifier, confier, auditer, recommencer dans un budget de tours), compétences (recettes et taux de réussite), cerveau (`read_my_brain`, `update_brain_field`) et journal, espace de travail par utilisateur (fichiers, git), documents Word et PowerPoint téléchargeables, e-mail (à sa propre adresse), génération et retouche d'images (img2img), et pour l'administrateur (`GUARDIAN_SHELL=1`, coupés par défaut) shell, environnement Python, outils forgés et serveurs MCP. Suppression d'agent : coupée par défaut, et seulement sur demande explicite nommant l'agent.

**Prompt système réduit, le Gardien dans l'univers** : le prompt décrit en entier les outils essentiels et donne une ligne pour les autres, détaillés à la demande (`tool_help`). Le bouton « Installer le Gardien dans l'univers » crée la dimension Gardien : node Prompt système, node Outils, un node par famille et un node par outil avec son mode d'emploi. Le Gardien les relit à chaque demande : réécrire le Prompt système change ses consignes, réécrire le node d'un outil change son mode d'emploi, supprimer ce node coupe l'outil.

**Chargement des modèles comme iAqua** : contexte et couches GPU « auto » par défaut (couches selon la VRAM libre en gardant la place du cache KV, contexte le plus grand qui tient, plafonné au contexte d'entraînement), « max » pour tout mettre sur GPU, threads = cœurs physiques, batch 1024, flash attention, mmap, pas de mlock, libération après 720 min. Avant, `LLM_GPU_LAYERS=0` forçait tout sur CPU. La fiche montre le placement retenu au dernier chargement et dit pourquoi l'offload n'agit pas (pas de GPU NVIDIA, ou llama-cpp-python compilé sans CUDA, avec la commande pour le recompiler). Options avancées (multi-GPU, cache KV quantifié, RoPE) repliées.

**Outils du Gardien** : un catalogue unique (`toolbox/tools.py`) fusionne les outils de Nodz et ceux portés d'iAqua, avec leur origine ; onglet Outils pour les activer un par un (un outil coupé sort des consignes du Gardien et lui est refusé) et liste des outils d'iAqua non portés, avec la raison.

**Profil** en cartes (identité, activité, parrainage, Premium, avis), coches dessinées au lieu d'emoji ; nouvelle icône du bouton Agents.

**Session conservée** : ouvrir `/universe` ne déconnecte plus. Un autre onglet, un rechargement ou un préchargement déconnectait la page ouverte (sauvegardes, profil, modèles et Gardien refusés). La fenêtre LOGIN / GUEST s'affiche toujours ; la déconnexion se fait par le profil. Un refus 401 dit s'il manque le cookie ou si la session est inconnue.

**Filtres globaux** (haut centre) : origine des nodes (Moi, Messages envoyés au Gardien, IA) et période de dernière modification (24 h, 7 j, 30 j) ; les nodes écartés et leurs liens s'estompent et ne captent plus la souris, rien n'est modifié dans Nodz. Les origines sont notées côté serveur (`NodeMark`, migration 0005) quand un message part au Gardien et quand l'IA crée un node.

**Le Gardien fait ce qu'il annonce** : un plan annoncé sans aucune action relance aussitôt le modèle (« rien n'a été fait, donne les actions ») ; les actions invalides lui sont renvoyées pour correction ; le node-réponse dit ce qui a été fait, au passé, et avoue l'échec quand rien n'a pu être fait. Le type d'un node (texte, image…) est de nouveau changé par le bon menu (le pont prenait le menu des polices).

**Images : FLUX.1 schnell** avec stable-diffusion.cpp (`SD_BIN`, voir DEPLOY.md) : pack en un clic (modèle et fichiers compagnons VAE, CLIP-L, T5-XXL, quantisation légère sur petite machine), l'Illustrateur dessine dans un node image (progression dans le fil de suivi), le modèle de texte est libéré pendant le dessin, réglages d'image par modèle (taille, étapes, guidage, échantillonneur, graine, threads, VAE par tuiles, tout sur CPU). Les images générées ne sont servies qu'à leur auteur.

**`/next` supprimé** : l'interface parallèle (`graph/static/nodz/`, `next.html`, route `/next`) est retirée ; `/universe` est l'unique interface. Le Gardien garde son petit client d'API (`toolbox/static/gardien/api.js`). Le modèle de données v2 et l'API `/api/v1` restent.

**Réglages fins des modèles** : panneau pleine largeur par modèle, en trois groupes décrits par le serveur (`toolbox/params.py`). GPU : offload par curseur de 0 à toutes les couches (lues dans l'en-tête GGUF) avec VRAM estimée et boutons CPU / Ce qui tient / Tout sur GPU, GPU principal, répartition multi-GPU et part de chaque carte, cache KV sur GPU, flash attention, cache K et V quantifiés (q8_0, q4_0). Mémoire et vitesse : contexte, batch, micro-batch, threads, threads du prompt, mmap, mlock, RoPE, libération. Échantillonnage : température, top P, top K, min P, typical P, pénalités de répétition, présence et fréquence, Mirostat, longueur, graine. Chaque agent peut avoir son propre échantillonnage. Un réglage de chargement modifié recharge le modèle à la demande suivante ; seuls les réglages choisis partent à llama-cpp-python.

**Tour de contrôle** (comme dans iAqua) : en haut à gauche de l'univers, CPU, RAM, GPU et VRAM (si NVIDIA), disque des modèles en barres vertes, ambres ou rouges, et le modèle en mémoire (pastille verte, bleue quand il travaille, file d'attente). Relue toutes les 3 s, traversée par les gestes (sélection, glissé) ; son en-tête ouvre Agents & modèles, qui l'affiche aussi.

**Barre de boutons permanente** : toujours visible en bas, dans le style de la tour de contrôle (verre sombre, coins de 14 px) ; la poignée qui l'annonçait disparaît.

**Interface modernisée** (`css/modern.css`, chargée en dernier, chrome seulement) : barre de boutons en dock de verre dépoli aux icônes claires, dimension courante et recherche en pilules, liste des dimensions en carte avec icônes dessinées (plus de ➕ ni de ✎), fenêtres et boutons arrondis (accueil, profil, renommage), variantes du mode clair. Les boutons Son et Export gardent enfin leur icône quand Nodz change leur état. Nodes, liens, roue de couleurs et navigation inchangés.

- `manage.py bootstrap` rend le compte local administrateur, même s'il existait déjà (installer des modèles demande un compte administrateur ; les invités consultent, et la fenêtre Agents leur explique comment passer administrateur).
- `GET /api/v1/toolbox/system` : ressources du serveur (`/proc`, `nvidia-smi`, disque de `MODELS_DIR`), modèle chargé et file du broker.
- App `toolbox`, portée de SquidMind (qui n'est plus un service à part) : modèles locaux (`LocalModel`), agents (`Agent`), broker à priorités, moteur llama-cpp-python optionnel (`requirements-ai.txt`).
- API `/api/v1/toolbox` : état du moteur, recherche et fichiers Hugging Face, recommandations, téléchargement et suppression de modèles (staff), agents par utilisateur (quatre agents de départ : Gardien, Rédacteur, Codeur, Illustrateur).
- Le Gardien (`POST /api/v1/toolbox/command`, flux SSE) : lit la demande et le plan courant, répond par un plan d'actions JSON contraint (créer, modifier, relier, archiver, nettoyer, déléguer), place les nodes sans chevauchement, délègue aux agents (texte, code) qui publient leur résultat dans le node visé. Tout naît en brouillon, rattaché à un `AIRun`.
- Outils du Gardien : créer, modifier le texte, apparence (couleur, forme, taille, verrou), mode d'affichage (texte, code, image…), lier et délier, portail vers un plan nouveau ou existant, supprimer (archiver), nettoyer, déléguer à un agent, brancher un modèle sur un agent, inventaire (plans, agents, modèles) suivi d'un nouveau tour de réflexion (3 tours au plus). Une action invalide est signalée et sautée, les autres s'appliquent.
- Navigation du Gardien : `focus` (travelling vers un node avec légende), `overview` (recul sur tout le plan), `travel` (voyage vers un autre plan) ; enchaînés, ils font une visite guidée ou un tutoriel. Le Gardien est un réalisateur qui navigue avec les gestes de l'humain (`navigation.js` : crans de molette, glissés, focus), joués avec un tempo de cinéma : départ en douceur, prise de hauteur pour les longs trajets, pinch ancré sur la cible, lent recul pendant la réflexion, cadrage des nodes créés. L'utilisateur reprend la main au premier geste.
- Parité avec Nodz v1 sur `/next` : Tab (saut de zoom), double-clic sur l'anneau (focus), flèches, drapeau et origine, liste des plans (Maj), recherche (Ctrl+F), plein écran ; liens de bord à bord en dégradé, trois styles, flèche au survol, clic = voyage, Suppr ; Espace chaîné (node relié de même couleur, ou liaison de la sélection) ; forme carrée ; poignée de taille ; outils du node à la sélection (type, couleur, forme, verrou, envoi vers un plan) ; bouton portail ; Ctrl+C/X/V ; défilement au bord pendant un glisser. Banc du feel : nouveau scénario `navigation` enregistré sur `/universe`, identique à 1e-3.
- Contenus sur `/next` : image, vidéo, audio, document (aperçu PDF, téléchargement, remplacement), 3D (visualiseur STL de v1 avec three.js, chargé à la demande), code, dessin (nouveau type `drawing`, format vectoriel de v1 : crayon, ligne, cercle, gomme, annuler/refaire, couleur, épaisseur) ; barre de mise en forme du texte (taille, gras, italique, souligné, couleur, emoji). Fichiers envoyés via `/api/v1/files` (12 Mo, réservés au propriétaire, texte extrait des PDF, Word, Excel, PowerPoint et TXT). Déposer des fichiers sur le canevas crée un node du bon type. La migration v1 → v2 reprend les dessins (`drawing`) et les images (`StoredFile`).
- Lien direct : clic droit glissé d'un node à un autre (en plus de l'Espace de v1).
- nginx : les statiques sont revalidés à chaque chargement (l'ancien `expires 7d` gardait d'anciens CSS et modules JS).
- Interface : `command.js` (barre de commande, flux SSE, réponse appliquée au store sans renvoi au serveur et annulable en un pas via `store.applyRemote` / `store.record`), `library.js` (bibliothèque, en bottom sheet sur mobile, suppression confirmée en deux temps), clavier virtuel pris en compte (`visualViewport`).
- nginx : bloc sans tampon et délai de 15 min pour le flux du Gardien.
- Réglages `.env` : `MODELS_DIR`, `HF_TOKEN`, `LLM_CTX` et `LLM_GPU_LAYERS` (auto par défaut), `LLM_THREADS`, `GUARDIAN_WORKERS`, `GUARDIAN_QUEUE`, `GUARDIAN_WEB`, `SD_BIN`.

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
