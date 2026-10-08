# Performance à 1000 nodes

Banc : `NODZ_URL=http://127.0.0.1:8123/nodz node tests/perf/thousand.mjs [nombre de nodes]` (Chromium headless, rendu logiciel, 1300 × 900). Image = médiane du temps entre deux images pendant 60 images de déplacement (`dragUniverse`) ou de zoom (`zoom`), à trois niveaux de zoom ; « js » = temps passé dans l'appel lui-même.

| Étape | Chargement | Tas JS** | Canevas | Déplacement z=1 / 0,4 / 0,1 | Zoom z=1 / 0,4 / 0,1 |
|---|---|---|---|---|---|
| Départ (83b3712) | 13,5 s | 361 Mo | 563 Mpx | 300 / 433 / 333 ms | 400 / 433 / 317 ms |
| `body:has()` retirés | 13,5 s | 361 Mo | 563 Mpx | 117 / 117 / 150 ms | 183 / 200 / 200 ms |
| Dispatcher allégé (étape 4) | 14,3 s | 361 Mo | 563 Mpx | 100 / 117 / 133 ms | 117 / 133 / 150 ms |
| Node léger (étape 2) | 2,3 s | 10 Mo | 563 Mpx* | 67 / 117 / 83 ms | 83 / 100 / 83 ms |

À 100 nodes, toutes les images tiennent en 16,7 ms. Le coût croît avec le nombre total de nodes, pas avec ceux à l'écran : masquer canevas, iframes, images ou foreignObject ne change presque rien ; le dispatcher seul prend 41 ms par passe (deux passes par pas de zoom).

Dispatcher allégé : 41 → 30 ms par déplacement, 88 → 31 ms par pas de zoom (une passe au lieu de deux). Retirer les 1000 iframes du DOM fait encore passer l'image de déplacement de 100 à 67 ms : chaque iframe est un document qui suit le cycle de rendu à chaque image.

Node léger : 33 → 11 éléments par node, 40 000 → 19 000 éléments pour 1000 nodes, 1000 → 1 iframe, 1999 → 999 dégradés (ceux des liens, propres à chacun : direction et deux couleurs).
- L'iframe d'aperçu n'entre dans le DOM qu'au premier fichier (`previewOf`).
- L'anneau du portail (un SVG animé et son dégradé) n'est dessiné qu'au premier affichage (`showPortal`).
- Le groupe du nom de fichier n'est inséré que quand le node devient un fichier.

\* Canevas 750 × 750 gardés : sans contexte 2D (pris au premier trait), Chrome ne leur alloue pas de mémoire, et les passer à 0 × 0 ne change pas l'image.
\*\* Le tas mesuré compte celui de chaque iframe : 1000 iframes, 1000 contextes JS.

Chiffres en rendu logiciel headless : la rastérisation y pèse bien plus que sur un GPU. À 100 nodes, chaque image tient en 16,7 ms ; à 1000, le reste croît avec le nombre total de nodes (dispatcher sur tous les nodes et liens).
