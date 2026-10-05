// Mode compact : une vue passagère pour lire toute une dimension d'un coup d'œil. La carte garde sa forme mais se
// resserre (chaque node se rapproche du centre, puis les textes se poussent jusqu'à ne plus se chevaucher), les formes
// des nodes s'effacent : seul leur contenu reste, en texte net. Rien n'est enregistré : un node réécrit en compact est
// sauvegardé à sa place éclatée, et le retour (bouton, touche C) rend chaque node à sa place exacte. Déplacer un node,
// changer de dimension ou une action du Gardien ramènent d'abord à l'éclaté.

const SQUEEZE = 0.1;   // les positions se rapprochent du centre de ce facteur, avant de se repousser
const MARGIN = 22;     // espace entre deux textes (unités de l'univers)
const ROUNDS = 160;    // passes de séparation
const DURATION = 380;  // ms de transition

const TRANSFORM = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;
const place = node => ({ x: parseFloat(node.getAttribute('x')), y: parseFloat(node.getAttribute('y')) });
const ease = t => 1 - (1 - t) ** 3;

// Pose un node en (x, y) de l'univers comme le glissé de Nodz (transform à l'écran, y vers le haut), sans l'enregistrer.
function put(node, x, y) {
    const now = place(node), match = (node.getAttribute('transform') || '').match(TRANSFORM);
    if (!match) return;
    const dx = x - now.x, dy = y - now.y;
    node.setAttribute('transform', `translate(${(parseFloat(match[1]) + dx).toFixed(3)}, ${(parseFloat(match[2]) - dy).toFixed(3)}) scale(${match[3]})`);
    node.setAttribute('x', x);
    node.setAttribute('y', y);
}

// Taille du contenu d'un node dans l'univers (le texte, l'image…), sans sa forme.
function size(node) {
    const content = node.children[0]?.children[0] || node.children[0] || node;
    const r = content.getBoundingClientRect();
    return { w: r.width / currentZoom + MARGIN, h: r.height / currentZoom + MARGIN };
}

// Positions compactes : rapprochées du centre, puis séparées boîte contre boîte (la plus petite pénétration d'abord).
function layout(nodes) {
    const items = nodes.map(node => ({ node, home: place(node), ...size(node) }));
    const cx = items.reduce((t, i) => t + i.home.x, 0) / items.length, cy = items.reduce((t, i) => t + i.home.y, 0) / items.length;
    items.forEach(i => { i.x = cx + (i.home.x - cx) * SQUEEZE; i.y = cy + (i.home.y - cy) * SQUEEZE; });
    for (let round = 0; round < ROUNDS; round++) {
        let moved = false;
        for (let a = 0; a < items.length; a++) {
            for (let b = a + 1; b < items.length; b++) {
                const p = items[a], q = items[b];
                const ox = (p.w + q.w) / 2 - Math.abs(p.x - q.x), oy = (p.h + q.h) / 2 - Math.abs(p.y - q.y);
                if (ox <= 0 || oy <= 0) continue;
                moved = true;
                if (ox < oy) {
                    const s = (p.x < q.x || (p.x === q.x && p.home.x <= q.home.x) ? -1 : 1) * ox / 2;
                    p.x += s;
                    q.x -= s;
                } else {
                    const s = (p.y < q.y || (p.y === q.y && p.home.y <= q.home.y) ? -1 : 1) * oy / 2;
                    p.y += s;
                    q.y -= s;
                }
            }
        }
        if (!moved) break;
    }
    return items;
}

export function createCompact({ bridge, say }) {
    let items = null;      // en compact : [{ node, home, x, y, w, h }]
    let layer = null;
    let animating = 0;

    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'compactButton', title: 'Compact (C)' });
    document.getElementById('visitButton')?.after(button);
    button.addEventListener('click', () => toggle());

    // Un node réécrit en compact s'enregistre à sa place éclatée : le compact n'est jamais sauvegardé.
    const inner = window.save;
    window.save = function (node, tunnel) {
        const item = items?.find(i => i.node === node);
        if (!item) return inner(node, tunnel);
        const shown = place(node);
        node.setAttribute('x', item.home.x);
        node.setAttribute('y', item.home.y);
        try {
            return inner(node, tunnel);
        } finally {
            node.setAttribute('x', shown.x);
            node.setAttribute('y', shown.y);
        }
    };

    // Transition : chaque node glisse de `from` à `to`, ses liens suivent ; `view` (écran) glisse la vue en même temps.
    function slide(moves, view = { x: 0, y: 0 }) {
        let done = 0;
        const run = ++animating, start = performance.now();
        const links = new Set(moves.flatMap(m => JSON.parse(m.node.getAttribute('links') || '[]')));
        return new Promise(resolve => {
            (function frame(now) {
                if (run !== animating) return resolve();
                const k = ease(Math.min(1, (now - start) / DURATION));
                if (view.x || view.y) dragUniverse(view.x * (k - done), view.y * (k - done), false);
                done = k;
                moves.forEach(m => { if (m.node.isConnected) put(m.node, m.from.x + (m.to.x - m.from.x) * k, m.from.y + (m.to.y - m.from.y) * k); });
                links.forEach(id => {
                    const link = document.getElementById(id);
                    if (!link) return;
                    updateLink(link);
                    if (linkState === 0) updateLinkColor(link);
                });
                if (k < 1) requestAnimationFrame(frame);
                else resolve();
            })(start);
        });
    }

    async function on() {
        const nodes = [...document.querySelectorAll('.node-group')];
        if (nodes.length < 2) return say('Le mode compact resserre une dimension de plusieurs nodes.', 'notice');
        layer = layerNumber;
        nodes.forEach(n => n.style.setProperty('--node-color', n.getAttribute('color') || '#33FF99'));  // liseré du texte
        document.body.classList.add('gardien-compact');  // formes effacées d'abord : les tailles mesurées sont celles du texte
        items = layout(nodes);
        button.classList.add('on');
        await slide(items.map(i => ({ node: i.node, from: i.home, to: { x: i.x, y: i.y } })));
        if (!items) return;  // déjà quitté pendant la transition
        const x0 = Math.min(...items.map(i => i.x - i.w / 2)), x1 = Math.max(...items.map(i => i.x + i.w / 2));
        const y0 = Math.min(...items.map(i => i.y - i.h / 2)), y1 = Math.max(...items.map(i => i.y + i.h / 2));
        bridge.frame({ x0, x1, y0, y1 }, 60);  // toute la dimension sous les yeux
    }

    // Retour à l'éclaté : chaque node à sa place exacte ; le node au centre de l'écran y reste (la vue suit).
    function off() {
        if (!items) return Promise.resolve();
        const back = items;
        items = null;
        button.classList.remove('on');
        document.body.classList.remove('gardien-compact');
        back.forEach(i => i.node.style.removeProperty('--node-color'));
        if (layer !== layerNumber) return Promise.resolve();  // dimension quittée : ses nodes sont déjà rechargés à leur place
        animating += 1;
        back.forEach(i => { if (i.node.isConnected) put(i.node, i.x, i.y); });
        const c = bridge.center();
        const anchor = back.reduce((best, i) => (Math.hypot(i.x - c.x, i.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? i : best));
        return slide(back.map(i => ({ node: i.node, from: { x: i.x, y: i.y }, to: i.home })),
            { x: (anchor.x - anchor.home.x) * currentZoom, y: (anchor.home.y - anchor.y) * currentZoom });
    }

    const toggle = () => (items ? off() : on());

    // C hors saisie bascule.
    document.addEventListener('keydown', event => {
        if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
        if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('.gl-modal:not([hidden])')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggle();
    }, true);

    // Déplacer un node ramène d'abord à l'éclaté (le glissé continue depuis sa vraie place).
    let press = null;
    document.addEventListener('pointerdown', event => { press = items && event.target.closest?.('.node-group') ? [event.clientX, event.clientY] : null; }, true);
    document.addEventListener('pointermove', event => {
        if (press && event.buttons && Math.hypot(event.clientX - press[0], event.clientY - press[1]) > 4) {
            press = null;
            off();
        }
    }, true);
    // Changer de dimension (ou un rechargement) quitte le compact.
    setInterval(() => { if (items && (isLoading || layerNumber !== layer)) off(); }, 300);

    return { off };
}
