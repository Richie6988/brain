// Un glissé est en cours (nodes, sélection ou univers) : bouton appuyé et pointeur qui a bougé. Les éléments HTML qui
// suivent un node (barre d'outils, poignée de taille, pastille) se cachent alors au lieu de le mesurer à chaque image :
// une mesure force tout le calcul de mise en page pendant que Nodz déplace les nodes, et le glissé rame.

let held = false, moved = false;
// une liste déroulante ouverte garde le pointerup pour elle : un appui sur un champ n'est jamais un glissé
document.addEventListener('pointerdown', event => { held = event.button === 0 && !event.target.closest?.('select, input, textarea'); moved = false; }, true);
document.addEventListener('pointermove', () => { if (held) moved = true; }, true);
['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, () => { held = moved = false; }, true));

export const dragging = () => held && moved;
