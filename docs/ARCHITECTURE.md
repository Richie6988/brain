# Architecture de la couche node (Phase 3)

## Problème actuel

Chaque node crée à sa naissance ~40 éléments DOM : 5 contenus superposés (texte, image, fichier,
dessin, et le lecteur YouTube désormais supprimé), 4 barres d'outils (paramètres, style de texte, fichier, dessin),
anneau, carré, portail. Les états inactifs sont masqués, l'état vit dans des attributs DOM
(`textcontent`, `canvascontent`, `links`, `siblings`, `quantum` en JSON) et le code y accède par
position (~300 `children[N]` dans 12 fichiers). 2 000 nodes ≈ 80 000 éléments.

## Principes

1. **Une seule source de vérité : le store.** Le DOM n'est qu'une projection. Aucun état dans
   les attributs, aucun `children[N]`.
2. **Le node se souvient de tous ses états dans les données**, pas dans le DOM :
   `content` garde un sous-objet par type ; seul le type actif est rendu.
3. **Rendu à la demande.** Un node rendu = un anneau + un conteneur de contenu. Changer de type
   remplace le contenu. Un node hors écran n'a pas de contenu rendu (seulement son anneau, ou rien).
4. **Barres d'outils uniques.** Une instance de chaque barre pour toute l'application, attachée
   au node actif, jamais une par node.
5. **Modules ES natifs, sans bundler, sans variables globales implicites.**

## Données (`store.js`)

```js
Node = {
  id,              // UUID (DID) côté serveur ; id local temporaire avant sauvegarde
  layer,           // id du plan
  x, y, radius,    // coordonnées univers
  shape,           // 'circle' | 'square' | 'none'
  color, lock,
  type,            // 'text' | 'image' | 'file' | 'video' | 'audio' | 'model3d' | 'code'
  content: {       // mémoire de tous les états ; seul content[type] est rendu
    text:    { html },
    image:   { url },
    file:    { url, name, mime, preview, extractedText },
    video:   { url, name },          // fichier vidéo local (pas de plateforme externe)
    audio:   { url, name },
    model3d: { url, name },          // STL / glTF, three.js chargé à la demande
    code:    { source, language },
  },
}
Edge  = { id, source, target, kind }   // 'link' | 'portal' (extrémités sur deux plans)
Layer = { id, index, name }
Store = { nodes: Map, edges: Map, layers: Map, layerId, selection: Set, viewport: {x, y, zoom} }
```

`links`, `siblings` et `quantum` disparaissent : une arête suffit, un portail est une arête
dont les deux nodes sont sur des plans différents.

Le store expose des **actions** (`addNode`, `updateNode(id, patch)`, `setType`, `move`,
`select`, `addEdge`, `removeNodes`…) et émet des **événements** (`node:changed`, `selection:changed`,
`viewport:changed`…). Chaque action produit un patch inverse : l'annuler/refaire devient une
pile de patchs, au lieu des clones DOM actuels.

## Rendu (`render/`)

- `viewport.js` : transform `translate(x,y) scale(z)` de `#universe`, maths de zoom et de pan
  **identiques** à `zoom.js` / `dragUniverse.js` (pas 0,95 ; bornes 0,95^50 et 1/0,95^42 ;
  arrondi à 3 décimales ; double compensation du centre ; pinch si `deltaY` non entier).
  Rendu groupé par `requestAnimationFrame`.
- `culling.js` : index spatial (grille) sur le store ; seuls les nodes visibles sont montés ;
  comptage par quadrant pour les indicateurs de navigation. Plus de `querySelectorAll` par frame.
- `node-view.js` : crée / met à jour / démonte la vue d'un node. Références nommées :
  `view = { root, ring, content }`, rangées dans une `Map(id → view)`.
- `renderers/` : un module par type, même interface :
  ```js
  export default { mount(container, data, api), update(el, data), unmount(el), defaultSize }
  ```
  `text.js`, `image.js`, `file.js`, `video.js`, `audio.js`, `model3d.js` (import dynamique de
  three.js), `code.js` (coloration à la demande).
- `edges-view.js` : liens et portails dessinés depuis les arêtes du store.

## Interaction (`interaction/`)

`pointer.js` (sélection, drag, rectangle, survol), `keyboard.js` (raccourcis), `clipboard.js`,
`teleport.js` (4D + étincelles), `toolbars/` (paramètres, texte, fichier, média : une instance
chacune, positionnée sur le node actif). Toutes passent par les actions du store ; aucune ne touche
directement au DOM d'un node.

## Persistance (`api.js`)

Sauvegarde **incrémentale** : le store accumule les nodes/arêtes modifiés et les envoie groupés
(débounce), au lieu d'un `save(node)` DOM → JSON par événement. Cible : l'API `/api/v1` de la
Phase 2 (`/layers`, `/nodes`, `/edges`), avec `content` stocké dans le `payload` JSON du node.

## Interface hybride : une barre de commande, l'IA agit sur l'univers

Une grande zone de saisie en bas de l'écran (texte ou voix via STT) devient l'entrée principale.
L'utilisateur décrit ce qu'il veut (« relie ces trois idées », « éclate cette note en 5 pistes à
droite », « emmène la sélection dans un nouveau plan nommé Recherche », « transforme ce node en
code Python ») et l'IA l'exécute avec les mêmes actions que la souris. La souris et le clavier
restent disponibles : c'est une interface hybride, pas un remplacement.

### Le catalogue d'actions est l'unique API

Chaque action du store est déclarée une seule fois dans `actions/` :

```js
export default {
  name: 'link_nodes',
  description: 'Crée un lien entre deux nodes du plan courant.',
  params: { source: 'node_id', target: 'node_id' },   // converti en JSON Schema pour le LLM
  destructive: false,
  run(store, { source, target }) { ... return inversePatch; },
}
```

Les clics, les raccourcis clavier et l'IA appellent tous `dispatch(action, params)`. Une action
n'existe donc qu'à un seul endroit, et tout ce que l'utilisateur peut faire, l'IA peut le faire.

Catalogue initial, tiré des fonctions existantes : `create_node`, `update_node` (texte, couleur,
forme, taille, verrou), `set_type`, `move_nodes`, `delete_nodes`, `link_nodes`, `unlink`,
`select`, `copy` / `paste`, `teleport` (nouveau plan avec portail), `go_to_layer`,
`rename_layer`, `delete_layer`, `focus` (centrer et zoomer), `search`, `attach_file`, `export`.

### Boucle d'exécution

1. La barre envoie la demande et un **contexte compact** : sélection, nodes visibles (id, type,
   résumé du contenu, position), plan courant, liens entre eux, liste des plans.
2. Le Gardien (agent orchestrateur, app `toolbox`) reçoit la demande et le catalogue ; sa sortie est
   du JSON contraint par grammaire (fiable même avec un petit modèle sur CPU). Il délègue la
   production aux agents de la bibliothèque et place les résultats dans l'univers.
3. Chaque événement SSE `tool_call` est validé contre le schéma puis appliqué via `dispatch` ;
   le résultat repart en `tool_result`. `text` s'affiche au-dessus de la barre ; `thinking` reste replié.
4. Toute la réponse forme **une seule transaction** : un Ctrl+Z annule tout ce que l'IA vient de faire.
5. Les actions `destructive: true` (suppression de plan, de nodes nombreux, partage) passent par une
   confirmation dans la barre avant exécution (jamais de `confirm()` natif).
6. Les nodes créés par l'IA naissent en `status=draft` (translucides), avec `origin=ai` et
   l'`AIRun` associé : l'utilisateur accepte ou supprime.

### Rendu des actions de l'IA

Les changements sont animés (apparition, déplacement, caméra qui suit via `focus`) pour que
l'utilisateur voie l'IA « agir » dans l'espace, au lieu d'un résultat qui apparaît d'un coup.

L'utilisateur est dans un vaisseau que le Gardien pilote : `focus`, `overview` et `travel` sont des
étapes de caméra jouées dans l'ordre après les écritures (`camera.js`), avec une légende à l'arrivée.
Pendant la réflexion la caméra recule lentement ; sans travelling prévu, elle cadre les nodes créés.
Tout geste de l'utilisateur annule la file : il garde toujours la main.

## Boîte à outils IA (app `toolbox`)

La boîte à outils de SquidMind est portée dans Nodz ; plus de service séparé.

- **Bibliothèque de modèles** : recherche Hugging Face (GGUF, tri, rôle et capacités déduits),
  fichiers d'un dépôt classés par quantisation, recommandations selon la VRAM, téléchargement en
  tâche de fond vers `MODELS_DIR`. Les modèles sont partagés par le serveur (gestion réservée au staff).
- **Broker** : un seul modèle en mémoire, un consommateur à la fois, par priorité
  (chat > image > agent > fond), jeton expiré s'il est tenu trop longtemps.
- **Moteur** : llama-cpp-python, optionnel (`requirements-ai.txt`) ; sans lui Nodz marche sans IA.
- **Bibliothèque d'agents** (par utilisateur) : rôle (texte, code, image, outils, orchestrateur),
  modèle, prompt système, outils autorisés. Le Gardien choisit l'agent et le node où publier ;
  l'agent publie son résultat en brouillon (`origin=ai`, `AIRun`).

## Mobile

L'ancien Nodz était pensé souris et molette uniquement. La nouvelle couche vise le mobile dès le départ :

- **Pointer Events unifiés** (`pointer.js`) : souris, stylet et doigts passent par le même code.
  Pinch à deux doigts = zoom centré entre les doigts, glisser à deux doigts = pan, avec **les mêmes
  maths** que la molette (pas de 0,95 par cran équivalent, mêmes bornes) pour garder le feel.
  Appui long = sélection, double tap = création de node.
- **La barre de commande est l'entrée principale sur mobile** : le clavier du téléphone et la
  dictée (STT) remplacent les raccourcis clavier et les menus contextuels. C'est l'écran où
  l'interface hybride apporte le plus.
- **Barres d'outils en bottom sheet** sur petit écran (au lieu d'être accrochées au node), cibles
  tactiles de 44 px minimum, aucun survol nécessaire pour accéder à une fonction.
- **Viewport** : `width=device-width`, `touch-action: none` sur le canevas (le navigateur ne
  zoome plus la page), gestion de la zone sûre (`env(safe-area-inset-*)`) et du clavier virtuel
  (la barre reste au-dessus via `visualViewport`).
- **Performance** : le culling et le rendu à la demande rendent 2 000 nodes tenables sur mobile ;
  objectif 60 fps en pan/zoom tactile sur un téléphone milieu de gamme.
- **Banc de test** : `tests/feel` gagne un scénario tactile (viewport 390×844, pinch et pan
  synthétiques) dès que la nouvelle couche existe ; l'ancien code n'a pas de référence tactile.
- Plus tard : manifeste PWA (installation sur l'écran d'accueil, mode hors ligne en lecture).

## Ordre de bascule

1. Phase 2 côté serveur : schéma v2 (`Node.payload`, `Edge`, UUID) + `/api/v1` + migration des
   données existantes (idempotente, testée sur une base générée).
2. `store` + catalogue d'actions + `dispatch` + `viewport` + `culling` + `node-view` avec le
   renderer texte : **le banc `tests/feel` doit passer** avant d'aller plus loin.
3. Sélection, drag, rectangle, liens, copier-coller, annuler, téléportation.
4. Renderers image, fichier, vidéo, audio, 3D, code ; barres d'outils uniques.
5. Barre de commande + Gardien (Phase 4) : l'IA pilote le catalogue d'actions.
6. Recherche, export, partage, curseurs multi-utilisateurs.
7. Suppression de l'ancienne couche (`elementsCreation.js`, `LSD.js`, `keyEvents.js`,
   `mouseEvents.js`, `userInteractions.js`, `4D.js`, `canvas.js`, `calendar.js`, templates…).

Non repris : dessin (canvas), calendrier/rappels, templates, likes.
