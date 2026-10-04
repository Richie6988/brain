// Texte toujours entier dans son node. Nodz dimensionnait un node texte sur un carré moyen (hauteur du texte et
// largeur, divisées par deux), et seulement en le cliquant : une grande police ou un texte long débordait, rogné en
// haut et en bas (le texte est centré verticalement), et un mot plus large que le node était coupé en deux.
// Ici, dès que le texte d'un node déborde (après la frappe, au chargement, après un changement de police), le node
// grandit juste assez : la largeur garde le mot le plus long entier, puis la plus petite forme qui contient tout le
// texte (un rond : son carré inscrit ; un rectangle : plus large que haut). Jamais plus petit qu'avant : la taille
// choisie à la main reste. Un rectangle étiré à la main (ratio) garde ses proportions.

const STEP = 1.12;     // largeurs essayées : +12 % à chaque pas
const LIMIT = 1600;    // largeur au plus
const PAD = 8;         // marge autour du texte

const textNode = node => node.getAttribute('type') === 'text' && !(node.getAttribute('shape') === 'square' && parseFloat(node.getAttribute('ratio')) > 0);

// Vrai si le node a été agrandi.
export function fit(node) {
    if (!node.isConnected || !textNode(node) || node.classList.contains('gardien-folded')) return false;
    const fo = node.children[0], input = fo?.children[0];
    if (!input || !input.textContent.trim()) return false;
    const width = parseFloat(fo.getAttribute('width')) || 0, height = parseFloat(fo.getAttribute('height')) || 0;
    // Mesures sans coupure de mot : un mot plus large que le node déborde (scrollWidth) au lieu d'être coupé.
    const measure = w => {
        fo.setAttribute('width', w);
        return { w, h: input.scrollHeight + PAD, wide: input.scrollWidth <= input.clientWidth + 1 };
    };
    input.style.height = 'auto';
    input.style.overflowWrap = 'normal';
    const restore = () => { fo.setAttribute('width', width); input.style.overflowWrap = ''; };
    const now = measure(width);
    restore();
    input.style.overflowWrap = 'normal';
    if (now.wide && now.h <= height + PAD) {
        input.style.overflowWrap = '';
        return false;
    }
    const square = node.getAttribute('shape') === 'square';
    // Rond : le côté du carré inscrit (max de largeur et hauteur) ; rectangle : plutôt large que haut.
    const cost = m => (square ? Math.max(m.w, m.h * 1.6) : Math.max(m.w, m.h));
    let best = null;
    for (let w = Math.max(width, 40); w <= LIMIT; w *= STEP) {
        const m = measure(w);
        if (m.wide && (!best || cost(m) < cost(best))) best = m;
        if (m.wide && m.h <= m.w * (square ? 0.62 : 1)) break;  // au-delà, la forme ne fait que s'élargir
    }
    restore();
    if (!best) return false;
    if (square) nodeSizing(node, Math.max(best.w, width), Math.max(best.h, height));
    else {
        const side = Math.max(best.w, best.h, width, height);
        nodeSizing(node, side, side);
    }
    return true;
}

export function createTextFit() {
    const done = new WeakMap();  // node → ce qui a été mesuré (texte, taille, forme)
    const key = node => {
        const fo = node.children[0];
        return `${fo?.children[0]?.innerHTML.length}|${fo?.getAttribute('width')}|${fo?.getAttribute('height')}|${node.getAttribute('shape')}|${node.getAttribute('type')}`;
    };
    function check(node, keep = true) {
        if (done.get(node) === key(node)) return;
        const grown = fit(node);
        done.set(node, key(node));
        if (grown && keep && !node.contains(document.activeElement)) save(node);  // en frappe : Nodz enregistre à la pause
    }
    // Chargements, Gardien, collages, polices : un tour régulier, seulement les nodes qui ont changé.
    setInterval(() => {
        if (typeof isLoading === 'undefined' || isLoading || typeof universe === 'undefined') return;
        universe.querySelectorAll('.node-group').forEach(node => check(node));
    }, 600);
    // Pendant la frappe : juste après le redimensionnement de Nodz, avant l'affichage (pas de clignement).
    document.addEventListener('input', event => {
        const node = event.target.isContentEditable && event.target.closest?.('.node-group');
        if (node) requestAnimationFrame(() => { done.delete(node); check(node, false); });
    }, true);
}
