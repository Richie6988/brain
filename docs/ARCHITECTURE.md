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

## Ordre de bascule

1. Phase 2 côté serveur : schéma v2 (`Node.payload`, `Edge`, UUID) + `/api/v1` + migration des
   données existantes (idempotente, testée sur une base générée).
2. `store` + `viewport` + `culling` + `node-view` avec le renderer texte : **le banc
   `tests/feel` doit passer** avant d'aller plus loin.
3. Sélection, drag, rectangle, liens, copier-coller, annuler, téléportation.
4. Renderers image, fichier, vidéo, audio, 3D, code ; barres d'outils uniques.
5. Recherche, export, partage, curseurs multi-utilisateurs.
6. Suppression de l'ancienne couche (`elementsCreation.js`, `LSD.js`, `keyEvents.js`,
   `mouseEvents.js`, `userInteractions.js`, `4D.js`, `canvas.js`, `calendar.js`, templates…).

Non repris : dessin (canvas), calendrier/rappels, templates, likes.
