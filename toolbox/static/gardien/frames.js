// Nodz recalcule les nodes à l'écran (dispatcher : parcours de tous les nodes et liens, ceux hors de la vue cachés)
// à chaque déplacement de la vue, soit jusqu'à 8 fois par cran de molette (4 pas de zoom, 2 déplacements chacun).
// Une seule fois par image suffit : les appels d'une même image sont regroupés, juste avant qu'elle soit dessinée.
export function createFrames() {
    const run = window.dispatcher;
    window.dispatcherNow = run;  // tout de suite, pour qui tourne déjà juste avant l'image (lot de pincement, zoom.js)
    let pending = 0;
    window.dispatcher = () => {
        if (!pending) pending = requestAnimationFrame(() => { pending = 0; run(); });
    };
}

// Écritures des boucles d'image (poignée, barre du node, pastilles) : seulement quand la valeur change. Réécrire
// à l'identique hidden ou un style relançait le calcul du style de toute la page à chaque image, même au repos.
const written = new WeakMap();
export function show(el, visible) {
    if (el.hidden === visible) el.hidden = !visible;
}
export function setStyle(el, prop, value) {
    const last = written.get(el) || written.set(el, {}).get(el);
    if (last[prop] === value) return;
    last[prop] = value;
    el.style.setProperty(prop, value);
}
