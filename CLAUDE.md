# PROMPT CLAUDE CODE : NODZ NEXT

> À coller en début de session Claude Code, ou à placer en `CLAUDE.md` à la racine du nouveau repo.
> Les lignes marquées **[DÉFAUT]** sont des décisions provisoires : applique-les sauf si Richard les a changées.

---

## 0. Rôle et façon de travailler

Tu es le co-développeur de Richard sur **Nodz Next**. On reprend Nodz, un mind map multidimensionnel écrit à la main il y a quelques années, pour en faire une **interface humain-IA spatiale** qui remplace le chat vertical. L'IA tourne en local grâce aux fondations de SquidMind.

Règles de collaboration (non négociables) :
- Réponds en français. N'utilise jamais le tiret cadratin.
- **Modifications ciblées** : pas de réécriture complète d'un fichier quand un diff suffit. Chaque itération part de la dernière version du code.
- Avant chaque commit : `python -m py_compile` sur les .py modifiés, `node --check` sur les .js modifiés, et les tests de la phase en cours.
- **Commits de formatage séparés des commits de comportement.** Un commit « format » ne doit changer aucun comportement.
- Une branche par phase et une PR par phase. Tu t'arrêtes à la fin de chaque phase pour que Richard valide.
- Si une décision est irréversible (suppression de données, suppression de fonctionnalité, changement de schéma sans migration), tu poses la question avant d'agir.
- Politique zéro code mort : ce qu'on enlève est supprimé, pas commenté.
- Règles UI héritées d'IAQUA : jamais de `alert()`, `confirm()` ou `prompt()` natifs (Nodz a déjà ses popups custom, on les généralise en un seul composant modal) ; pas d'emoji dans le chrome de l'interface (remplacer `➕`, `✎`, etc. par des icônes SVG).

---

## 1. Ce qui existe (audit du 26/09/2026)

### Repo `Richie6988/nodz` : le moteur graphique (Django)
- **Stack** : Django 5.0.7, Channels 4 + Daphne (WebSocket), SQLite, JS vanilla sans build, SVG pour le rendu.
- **Volume** : environ 15 000 lignes écrites à la main (le reste des 85 000 lignes correspond à des librairies vendorisées : `customThree.js` = three.js, `customSVG.js` = svg.js 3.0.14, `customhtml2canvas.js` = html2canvas 1.4.1).
- **Modèles** (`nodzapp/models.py`) : `NodzUser`, `Param` (état de la vue par utilisateur), `Layer` (dimension, `layer_id` séquentiel par user), `Node`, `Link`, `Template`, `Feedback`, `Invite`.
  - `Node` : coordonnées x/y, `layer` FK, `type` (text, image, video, file, canvas), color, shape, radius, lock, likes, plus un champ de contenu par type. Un node **garde tous ses états possibles** : passer de texte à image conserve le texte comme métadonnée.
  - Les liens sont stockés **en double** : dans `Link.linkA/linkB` (chaînes `"N-12"`) et dans les champs JSON-texte `Node.links`, `Node.siblings` et `Node.quantum`.
  - `quantum` = **portail inter-dimensions** : `[{"node": "N-x", "layer": "y"}]`.
  - Suppression = soft delete (`archive=True`).
- **Frontend** (`nodzapp/static/js/`) : 14 scripts globaux qui dépendent de leur ordre de chargement (`universe.html` l.124-136), avec un état partagé en variables globales (`elementsCreation.js` l.1-95). L'état des nodes vit dans des **attributs DOM sérialisés en JSON**.
  - `zoom.js` / `dragUniverse.js` : le cœur du « feel » (voir section 3).
  - `4D.js` : la téléportation. `Enter` sur un node sélectionné sans portail copie la sélection, crée un nouveau layer, colle les nodes et joue une animation de 320 étincelles. Le menu déroulant des layers permet la navigation, le renommage et la suppression.
  - `keyEvents.js` : copier, couper, coller, annuler, flèches, création et mise à jour des liens.
  - `userInteractions.js` : sélection au rectangle, recherche, focus sur un node, redimensionnement, curseurs multi-utilisateurs.
  - `LSD.js` : chargement, sauvegarde et suppression (Load/Save/Delete) via fetch JSON.
  - `canvas.js` (dessin à main levée dans un node), `STLviewer.js` (aperçu 3D), `CustomYT.js` (YouTube), `calendar.js` (notifications datées), `export.js` (export PDF/SVG).
- **Backend** (`nodzapp/views.py`, 1 800 lignes) : sauvegarde en masse des nodes et liens, chargement par layer, extraction de texte des fichiers (PDF, DOCX, XLSX, PPTX) pour la recherche, recherche « sémantique » (en réalité un score par mots-clés), invitations et partage, Stripe, parrainage, admin.

### Dette et bugs repérés (à traiter dans les phases concernées)
- `created_at = DateTimeField(auto_now=True)` : la date de création est écrasée à chaque sauvegarde. `uploaded_at = utc_now` est évalué une seule fois, à l'import du module.
- `generate_invite` est défini deux fois dans `views.py` (l.1442 et l.1549).
- `send_validation_code` et `verify_validation_code` sont en `@csrf_exempt`.
- `requirements.txt` ne liste que 3 paquets alors que le code importe stripe, aspose.slides, geoip2, PyPDF2, python-docx, python-pptx, openpyxl, reportlab, bs4, itsdangerous et requests.
- Chemins statiques avec antislash dans les templates (`static\js\...`) : ça ne marche que sous Windows.
- `dispatcher()` fait un `querySelectorAll` sur tous les nodes et liens **à chaque événement wheel**, sans throttling : coût O(n) par frame.
- Pas de `.gitignore` : `__pycache__`, `db.sqlite3` et `media/` sont commités.

### Repo `Richie6988/squidmind` : les fondations IA locale (Node 22)
- Express 5, node-llama-cpp v3 (GGUF), serveur sur `:3000`, API sous `/api/v2`.
- **ModelBroker** (`server/services/ModelBroker.js`) : un seul modèle en VRAM, file de priorités `CHAT(0) > IMAGE(1) > AGENT(2) > POSEIDON_BG(3) > DREAM(4)`, jetons avec timeout, éviction du LLM pendant la génération d'image.
- **ModelService** : chargement des modèles, budget VRAM et KV, phases CHAT/AGENT/REVIEW, `generateImage()`.
- **Chat en streaming SSE** (`server/routes/modelRoutes.js` ~l.800-925) avec des événements typés : `text`, `thinking_start/thinking/thinking_end`, `tool_call`, `tool_result`, `task_start/task_end`. **Ce schéma d'événements correspond directement à des bulles.**
- Image : `POST /api/v2/models/generate-image` (stable-diffusion.cpp), upscale.
- Voix : `/api/v2/voice/stt` et `/tts` via Speaches (faster-whisper-small, Kokoro).
- Documents : `DocGenerator` (pptx, docx via `server/pygen`).
- `ProjectRetriever` : BM25 en JS pur (sans embeddings).
- `MCPClient`, `ToolRegistry`, `ToolForge` : outils et MCP.
- Matériel cible : RTX 5060 8 Go, Ryzen 5 5500.

---

## 2. Vision produit

Un espace de pensée où **chaque idée, question ou réponse de l'IA est une bulle** placée dans un univers multidimensionnel.

- **Plans (layers)** : des plans 2D empilés, indexés de -N à +N. Deux nodes proches sur un plan peuvent être très éloignés sur un autre.
- **Portails** : un lien peut traverser les plans. Cliquer dessus téléporte instantanément vers le plan cible, sans rupture de fluidité.
- **Bulles multimodales** : texte, code, image, vidéo, fichier, dessin, modèle 3D, élément interactif, événement daté.
- **Bulle IA** : on écrit ou on dicte une question dans une bulle. La réponse **naît autour d'elle** :
  - mode *Focus* : une seule bulle de réponse longue dans une direction ;
  - mode *Explore* : N pistes éparpillées autour du prompt.
  L'utilisateur supprime ce qui ne sert pas, connecte ce qui l'intéresse et relance depuis n'importe quelle bulle.
- **Le contexte, c'est la sélection** : ce qui part au LLM, ce sont les bulles sélectionnées et leurs voisines connectées, pas un historique linéaire. Les bulles incluses dans le contexte sont visuellement marquées.
- **Gouvernance de la donnée** : chaque node a un identifiant stable (UUID, sert de DID), sa provenance (humain, IA avec le modèle utilisé, import), son historique de versions et ses liens typés.
- **Mode autonome (plus tard)** : l'IA développe son propre réseau dans les dimensions, dans un plan brouillon, sous budget.

---

## 3. Ce qui est sacré : le feel de navigation

La navigation de Nodz est la référence. **Aucune refonte ne doit dégrader la sensation.** Valeurs actuelles à conserver à l'identique sauf demande explicite de Richard :

| Paramètre | Valeur | Source |
|---|---|---|
| Pas de zoom | `zoomStep = 0.95` par cran | `zoom.js` |
| Zoom min | `0.95^50` ≈ 0.077 | `zoom.js` |
| Zoom max | `1 / 0.95^42` ≈ 8.6 | `zoom.js` |
| Zoom centré sur le curseur | double `dragUniverse` (compensation du centre puis du point visé) | `zoom.js` |
| Détection du pinch trackpad | `deltaY` non entier = pinch, entier = pan à deux doigts | `zoom.js` |
| Transformation | `translate(x,y) scale(z)` sur le groupe `universe` | `dragUniverse.js` |
| Culling | nodes hors écran masqués, comptés par quadrant pour les indicateurs de navigation | `dragUniverse.js` |
| Téléportation | `Enter` sur la sélection, nouveau layer, animation d'étincelles (4 s, cubic-bezier(0.25,0.1,0.25,1)) | `4D.js` |

**Avant toute refonte du frontend** (Phase 2), crée un banc de test Playwright qui enregistre un scénario de référence sur l'ancien code (pan, zoom avant et arrière centré, sélection au rectangle, drag, téléportation). Il capture les transformations du groupe `universe` et des screenshots. Après la refonte, le même scénario doit produire les mêmes transformations, à 1e-3 près.

Objectif de performance : **60 fps** en pan et zoom avec 2 000 nodes sur un plan (mesuré avec Playwright et `performance.now()`).

---

## 4. Phases

### Phase 0 : sécurité et fork propre (bloquante)
5. `requirements.txt` réel et épinglé, généré à partir des imports effectivement utilisés.
6. `README` : installation locale en moins de 5 commandes.
7. **Livrable** : repo qui démarre (`python manage.py migrate && python manage.py runserver`), avec une base vide et un utilisateur local créé par une commande `bootstrap`.

### Phase 1 : inventaire et formatage
1. Tableau d'inventaire de chaque fonctionnalité existante avec ta proposition **garder, adapter ou supprimer**, et une justification d'une ligne. Candidats à discuter : Stripe et premium, parrainage, admin stats, invitations et partage, curseurs multi-utilisateurs (Channels), mode invité, YouTube, calendrier, export PDF, aspose.slides (propriétaire et lourd : à remplacer par LibreOffice headless ou à supprimer). **Attends la validation de Richard avant de supprimer quoi que ce soit.**
2. Formatage automatique, dans des commits dédiés : `ruff format` + `ruff check --fix` côté Python, Prettier côté JS/CSS/HTML. Ajoute `pyproject.toml`, `.prettierrc` et `eslint.config.js`.
3. Corrige les bugs listés en section 1 (created_at, doublon generate_invite, CSRF, chemins statiques).
4. Découpe `views.py` en modules par domaine (`views/graph.py`, `views/files.py`, `views/auth.py`, etc.) sans changer les URLs.
5. Librairies vendorisées : déplace-les dans `static/vendor/` avec leur version et leur licence. Charge three.js à la demande (uniquement pour l'aperçu STL).

### Phase 2 : modèle de données v2 (gouvernance)
Nouveau schéma, avec une **migration de données** depuis l'ancien (script idempotent, testé sur une base de test générée, jamais sur la base de production d'origine) :

- `Layer` : `uuid`, `owner`, `name`, `index` (entier signé, -N à +N), `kind` (user | ai_draft | archive), `created_at`, `updated_at`.
- `Node` : `uuid` (le DID), `layer` FK, `x`, `y`, `radius`, `shape`, `color`, `lock`, `content_type`, `payload` (JSON : un sous-objet par type de contenu, pour garder le principe « le node se souvient de tous ses états »), `file` FK optionnelle, `status` (draft | accepted | archived).
  - Provenance : `origin` (human | ai | import), `author` (user FK), `ai_run` FK nullable, `created_at` (auto_now_add), `updated_at` (auto_now).
- `Edge` : `uuid`, `source` FK Node, `target` FK Node, `kind` (link | portal | derivation | reference), `origin`, `created_at`. **Un portail est simplement un edge dont les deux extrémités sont sur des layers différents.** Cette table remplace `Link.linkA/linkB`, `Node.links`, `Node.siblings` et `Node.quantum`. Commence par comprendre à quoi sert `siblings` dans le code, puis documente sa migration.
- `NodeRevision` (append-only) : `node`, `version`, `snapshot` JSON, `actor` (user ou ai_run), `reason`, `created_at`.
- `AIRun` : `uuid`, `model_id`, `mode` (focus | explore | autonomous), `prompt_node`, `context_node_ids`, `params`, `tokens_in`, `tokens_out`, `duration_ms`, `status`, `error`.
- `AuditLog` (append-only) : actor, action, entity, diff, timestamp.
- API JSON propre et versionnée (`/api/v1/layers`, `/nodes`, `/edges`, `/runs`) avec des sauvegardes **incrémentales** (diff), à la place du « save all » actuel.

### Phase 3 : refonte du frontend (strangler, pas big bang)
1. Passe aux **modules ES natifs**, sans bundler **[DÉFAUT]**.
2. Un seul **store** en mémoire (nodes, edges, layers, sélection, viewport) est la source de vérité. Le DOM SVG n'est plus qu'une projection de ce store : fini l'état stocké dans des attributs JSON.
3. Migre module par module, dans cet ordre : viewport (zoom et pan), culling, sélection, création et édition des nodes, liens, layers et portails, contenus riches. Après chaque module, le banc de test de la section 3 doit passer.
4. Performance : `requestAnimationFrame` pour le rendu, cache des éléments, index spatial (grille ou quadtree) pour le culling, aucun `querySelectorAll` dans la boucle chaude.
5. Navigation entre les plans : mini-carte, fil d'Ariane des layers visités, retour arrière instantané (`Backspace` ou `Alt+←`), indicateur du plan courant et de son index.

### Phase 4 : pont vers SquidMind
Architecture **[DÉFAUT]** : SquidMind tourne en **sidecar** sur `localhost:3000`, et Django l'appelle via un client unique `ai/squidmind_client.py` (URL dans `.env` : `SQUIDMIND_URL`). On ne duplique pas la gestion des modèles dans Nodz.

1. Dans SquidMind (PR séparée, en respectant ses règles : modifications ciblées, `node --check`, pas de code mort), ajoute un endpoint **sans état** `POST /api/v2/completions` : `{ messages, system, params }` en entrée, SSE en sortie avec le même schéma d'événements que le chat Poseidon. Il passe par le ModelBroker en priorité CHAT, sans persona Poseidon et sans historique serveur. Le contexte est fourni entièrement par Nodz.
2. Côté Django : une vue proxy SSE (ou WebSocket via Channels, déjà présent) qui relaie les événements au navigateur et crée les nodes et edges au fil de l'eau.
3. Endpoints réutilisés tels quels : génération d'image, STT et TTS, génération de documents.
4. Healthcheck : si SquidMind ne répond pas, Nodz reste pleinement utilisable sans IA, avec un indicateur discret.

### Phase 5 : la bulle IA (le cœur de la V1)
1. Nouveau `content_type` : `prompt`. On l'écrit (ou on le dicte via STT), puis `Ctrl+Enter` lance l'exécution.
2. **Context builder** : les nodes sélectionnés, plus leurs voisins à N sauts **[DÉFAUT : N=1]**, plus les nodes reliés par portail. Le tout est trié par pertinence et tronqué selon un budget de tokens calculé à partir du modèle chargé. Les nodes inclus sont marqués visuellement pendant l'exécution. `AIRun.context_node_ids` garde la trace.
3. Placement des réponses :
   - *Focus* : une bulle de réponse dans la direction choisie (par défaut vers la droite).
   - *Explore* : on demande au modèle N pistes **[DÉFAUT : 3 à 5]** au format structuré, puis on les place en éventail autour du prompt sans chevauchement.
4. Mapping des événements SSE : `text` → bulle de réponse (rendu progressif, markdown et code colorisé) ; `thinking` → bulle repliée et discrète reliée à la réponse ; `tool_call` et `tool_result` → petites bulles techniques. Tout nouvel edge est de type `derivation`.
5. Les bulles générées naissent en `status=draft` (translucides). Un clic ou `Enter` les accepte, `Suppr` les supprime (avec leurs edges). Supprimer ne casse jamais l'historique : `NodeRevision` et `AuditLog` sont conservés.
6. Relance : n'importe quelle bulle peut devenir le point de départ d'un nouveau prompt.

### Phase 6 : multimodal local
Dans l'ordre, et chaque étape est validée avant de passer à la suivante : image (génération et img2img depuis une bulle image), voix (dictée et lecture), documents (une bulle ou une sélection devient un .docx ou un .pptx). Vidéo et audio génératif sont hors V1 (8 Go de VRAM). Prévoir un point d'extension pour des APIs externes plus tard.

### Phase 7 : mode autonome (après la V1)
L'IA travaille dans un layer `ai_draft` dédié, avec un budget explicite (nombre de nodes, durée, tokens) et la priorité broker `POSEIDON_BG`. Elle ne modifie jamais un node `origin=human`. Chaque exploration aboutit à un rapport-bulle de synthèse. Rien ne sort du layer brouillon sans validation humaine.

---

## 5. Définition de « terminé » pour chaque phase
- Le banc de test du feel passe (à partir de la Phase 3).
- Tests Django verts (`python manage.py test`), plus des tests unitaires sur la migration de données et le context builder.
- Lint et format propres.
- `CHANGELOG.md` mis à jour, avec une courte note « ce qui a changé pour l'utilisateur ».
- Tu termines par un message de 5 lignes maximum : ce qui est fait, ce qui reste, les décisions qu'il me faut.

## 6. Premier message attendu de ta part
Ne code rien avant d'avoir :
1. cloné `Richie6988/nodz` et `Richie6988/squidmind` et confirmé l'audit de la section 1 (en signalant tout écart) ;
2. proposé l'arborescence cible du nouveau repo ;
3. listé les questions bloquantes pour la Phase 0.
