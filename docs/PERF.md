# Performance à 1000 nodes

Banc : `NODZ_URL=http://127.0.0.1:8123/nodz node tests/perf/thousand.mjs [nombre de nodes]` (Chromium headless, rendu logiciel, 1300 × 900). Image = médiane du temps entre deux images pendant 60 images de déplacement (`dragUniverse`) ou de zoom (`zoom`), à trois niveaux de zoom ; « js » = temps passé dans l'appel lui-même.

| Étape | Chargement | Tas JS | Canevas | Déplacement z=1 / 0,4 / 0,1 | Zoom z=1 / 0,4 / 0,1 |
|---|---|---|---|---|---|
| Départ (83b3712) | 13,5 s | 361 Mo | 563 Mpx | 300 / 433 / 333 ms | 400 / 433 / 317 ms |
| `body:has()` retirés | 13,5 s | 361 Mo | 563 Mpx | 117 / 117 / 150 ms | 183 / 200 / 200 ms |

À 100 nodes, toutes les images tiennent en 16,7 ms. Le coût croît avec le nombre total de nodes, pas avec ceux à l'écran : masquer canevas, iframes, images ou foreignObject ne change presque rien ; le dispatcher seul prend 41 ms par passe (deux passes par pas de zoom).
