// Zone de saisie d'un node, allumée au survol. Nodz prend un node (glisser, sélectionner) là où son curseur passe à
// « grab » : selectionArea(event, currentNode, 'up') de mouseEvents.js. Rond : l'anneau de 0,7 R à R + 10, un peu
// dedans, un peu dehors ; carré : le carré moins le disque du centre (la moitié de sa demi-diagonale + 10). L'anneau
// dessiné est exactement cette zone, à l'échelle du zoom ; le texte du node, au centre, reste à l'écriture.

const NS = 'http://www.w3.org/2000/svg';
const OUTSIDE = 10;  // le « + 10 » de selectionArea en mode 'up'

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

export function createGrab() {
    const layer = document.createElementNS(NS, 'svg');
    layer.id = 'gardien-grab';
    const band = layer.appendChild(document.createElementNS(NS, 'path'));
    document.body.append(layer);
    let pending = 0, last = null;

    // La zone du node, en coordonnées d'écran (selectionArea compare des distances divisées par le zoom à r).
    function zone(node) {
        const zoom = Number(currentZoom);
        if (node.getAttribute('shape') === 'square') {
            const r = node.children[2].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const hole = 0.5 * (Math.SQRT2 * r.width / 2 + OUTSIDE) * zoom;
            return `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z${circle(cx, cy, hole)}`;
        }
        const r = node.children[1].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const radius = Number(node.children[1].getAttribute('r'));
        return circle(cx, cy, (radius + OUTSIDE) * zoom) + circle(cx, cy, 0.7 * radius * zoom);
    }

    function update() {
        pending = 0;
        const node = typeof currentNode !== 'undefined' && currentNode?.isConnected ? currentNode : null;
        const on = !!(last && node && !isSizing && !document.body.matches('.gardien-side-on, .gardien-cutting')
            && selectionArea(last, node, 'up'));
        if (on) band.setAttribute('d', zone(node));
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
