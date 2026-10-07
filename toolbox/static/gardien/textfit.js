// Texte toujours entier dans son node. Nodz dimensionnait un node texte sur un carré moyen (hauteur du texte et
// largeur, divisées par deux), et seulement en le cliquant : une grande police ou un texte long débordait, rogné en
// haut et en bas (le texte est centré verticalement), et un mot plus large que le node était coupé en deux.
// Ici, dès que le texte d'un node déborde (après la frappe, au chargement, après un changement de police), le node
// grandit juste assez : la largeur garde le mot le plus long entier, puis la plus petite forme qui contient tout le
// texte (un rond : son carré inscrit ; un rectangle : plus large que haut). Jamais plus petit qu'avant : la taille
// choisie à la main reste. Un rectangle vise 1,6 de large pour 1 de haut ; un mot plus large que WORD (JSON, adresse)
// se coupe au lieu de laisser le node étroit, le texte coupé lettre à lettre et rogné. Un rectangle étiré à la main
// (ratio) garde ses proportions et grandit à proportions égales jusqu'à contenir son texte.

const STEP = 1.12;     // largeurs essayées : +12 % à chaque pas
const LIMIT = 1600;    // largeur au plus
const PAD = 8;         // marge autour du texte
const WORD = 600;      // largeur au-delà de laquelle un mot trop long se coupe

const textNode = node => node.getAttribute('type') === 'text';
const stretched = node => node.getAttribute('shape') === 'square' && parseFloat(node.getAttribute('ratio')) > 0;

const candidate = node => node.isConnected && textNode(node) && !node.classList.contains('gardien-folded')
    && Boolean(node.children[0]?.children[0]?.textContent.trim());

// Parmi `nodes`, ceux dont le texte déborde : toutes les écritures, puis toutes les lectures (un seul calcul de la page
// pour tous, au lieu d'un par node : au chargement d'une dimension chargée, c'était le goulet).
function overflowing(nodes) {
    const inputs = nodes.filter(candidate).map(node => [node, node.children[0].children[0]]);
    inputs.forEach(([, input]) => { input.style.height = 'auto'; input.style.overflowWrap = 'normal'; });
    const over = inputs.filter(([node, input]) => input.scrollWidth > input.clientWidth + 1
        || input.scrollHeight + PAD > (parseFloat(node.children[0].getAttribute('height')) || 0) + PAD).map(([node]) => node);
    inputs.forEach(([, input]) => { input.style.overflowWrap = ''; });
    return over;
}

// Vrai si le node a été agrandi.
export function fit(node) {
    if (!candidate(node)) return false;
    const fo = node.children[0], input = fo.children[0];
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
    // Un mot plus large que WORD : la recherche se fait texte coupé (retour à la ligne normal du node).
    const breaks = !measure(Math.max(width, WORD)).wide;
    input.style.overflowWrap = breaks ? '' : 'normal';
    const fits = w => { const m = measure(w); if (breaks) m.wide = true; return m; };
    if (stretched(node)) {  // à proportions égales, jusqu'à contenir le texte
        const ratio = parseFloat(node.getAttribute('ratio'));
        let area = width * height;
        for (let k = 0; k < 40 && fits(Math.sqrt(area * ratio)).h > Math.sqrt(area / ratio) + PAD; k++) area *= STEP * STEP;
        restore();
        if (area === width * height) return false;
        nodeSizing(node, Math.sqrt(area * ratio), Math.sqrt(area / ratio));
        return true;
    }
    const square = node.getAttribute('shape') === 'square';
    // Rond : le côté du carré inscrit (max de largeur et hauteur) ; rectangle : plutôt large que haut.
    const cost = m => (square ? Math.max(m.w, m.h * 1.6) : Math.max(m.w, m.h));
    let best = null;
    for (let w = Math.max(width, 40); w <= LIMIT; w *= STEP) {
        const m = fits(w);
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
    // Chargements, Gardien, collages, polices : un tour régulier, seulement les nodes qui ont changé ; parmi eux, seuls
    // ceux qui débordent se mesurent en détail.
    setInterval(() => {
        if (typeof isLoading === 'undefined' || isLoading || typeof universe === 'undefined') return;
        const changed = [...universe.querySelectorAll('.node-group')].filter(node => done.get(node) !== key(node));
        if (!changed.length) return;
        const over = new Set(overflowing(changed));
        changed.forEach(node => (over.has(node) ? check(node) : done.set(node, key(node))));
    }, 600);
    // Pendant la frappe : juste après le redimensionnement de Nodz, avant l'affichage (pas de clignement).
    document.addEventListener('input', event => {
        const node = event.target.isContentEditable && event.target.closest?.('.node-group');
        if (node) requestAnimationFrame(() => { done.delete(node); check(node, false); });
    }, true);
}
