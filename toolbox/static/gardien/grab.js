// Zone de saisie d'un node, allumée au survol. Nodz prend un node (glisser, sélectionner) là où son curseur passe à
// « grab » : selectionArea(event, currentNode, 'up') de mouseEvents.js. Rond : l'anneau de 0,7 R à R + 10, un peu
// dedans, un peu dehors ; carré ou rectangle : le rectangle élargi de 10, moins le disque du centre (la moitié de sa
// demi-diagonale + 10) rogné au rectangle intérieur (une bande le long du bord reste saisissable). La forme dessinée est
// exactement cette zone, à l'échelle du zoom (un masque : le contour extérieur moins le trou) ; le texte du node, au
// centre, reste à l'écriture.

const NS = 'http://www.w3.org/2000/svg';
const OUTSIDE = 10;  // le « + 10 » de selectionArea en mode 'up'

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const box = (x0, y0, x1, y1) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
const make = (parent, tag, attrs) => {
    const el = parent.appendChild(document.createElementNS(NS, tag));
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
};

export function createGrab() {
    const layer = document.createElementNS(NS, 'svg');
    layer.id = 'gardien-grab';
    const defs = make(layer, 'defs', {});
    const clip = make(make(defs, 'clipPath', { id: 'gardien-grab-clip' }), 'path', {});
    const mask = make(defs, 'mask', { id: 'gardien-grab-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: '100%', height: '100%' });
    const outer = make(mask, 'path', { fill: '#fff' });
    const hole = make(mask, 'path', { fill: '#000', 'clip-path': 'url(#gardien-grab-clip)' });
    const band = make(layer, 'path', { class: 'band', mask: 'url(#gardien-grab-mask)' });
    document.body.append(layer);
    let pending = 0, last = null;

    // La zone du node, en coordonnées d'écran, avec les mêmes calculs que selectionArea : [contour, trou, rognure du trou].
    function zone(node) {
        const zoom = Number(currentZoom);
        if (node.getAttribute('shape') === 'square') {
            const r = node.children[2].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const m = OUTSIDE * zoom, inset = 0.3 * Math.min(r.width, r.height) / 2;
            return [box(r.left - m, r.top - m, r.right + m, r.bottom + m), circle(cx, cy, 0.5 * (Math.SQRT2 * r.width / 2 + OUTSIDE) * zoom),
                box(r.left + inset, r.top + inset, r.right - inset, r.bottom - inset)];
        }
        const r = node.children[1].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const radius = Number(node.children[1].getAttribute('r'));
        return [circle(cx, cy, (radius + OUTSIDE) * zoom), circle(cx, cy, 0.7 * radius * zoom), box(0, 0, innerWidth, innerHeight)];
    }

    function update() {
        pending = 0;
        const node = typeof currentNode !== 'undefined' && currentNode?.isConnected ? currentNode : null;
        const on = !!(last && node && !isSizing && !document.body.matches('.gardien-side-on, .gardien-cutting')
            && selectionArea(last, node, 'up'));
        if (on) {
            const [shape, center, inner] = zone(node);
            [band, outer].forEach(el => el.setAttribute('d', shape));
            hole.setAttribute('d', center);
            clip.setAttribute('d', inner);
        }
        layer.classList.toggle('on', on);
    }
    const queue = event => {
        if (event?.clientX !== undefined) last = event;
        if (!pending) pending = requestAnimationFrame(update);
    };
    svg.addEventListener('mousemove', queue);
    svg.addEventListener('mouseleave', () => { last = null; queue(); });
    svg.addEventListener('wheel', queue, { passive: true });
}
