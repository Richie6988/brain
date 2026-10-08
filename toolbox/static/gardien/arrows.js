// Flèches de navigation (visite, tour.js ; liens, linkjump.js) : un chevron fin dans une pastille de verre, à la
// couleur du node d'arrivée (--c). Jamais par-dessus l'interface : dock, overview de la visite, barre du compact, chat, jauges.

export const ARROW = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M20 14l10 10-10 10"/></svg>';

const CHROME = ['#button-container', '#gardien-tour', '#gardien-compact-bar', '#gardien-chat', '.gm-hud', '#gardien-context-button', '.gl-modal:not([hidden])'];

// Rectangles de l'interface, relus une fois par image au plus (une flèche demande souvent plusieurs fois par image).
let cache = null, stamp = -1;
function chrome() {
    const now = performance.now();
    if (now - stamp > 16) {
        cache = CHROME.flatMap(s => [...document.querySelectorAll(s)]).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
        stamp = now;
    }
    return cache;
}

// Vrai si une flèche posée en (x, y) toucherait l'interface (marge : la moitié d'une flèche).
export function overChrome(x, y, pad = 26) {
    return chrome().some(r => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
}
