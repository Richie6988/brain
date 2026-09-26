// Projection du store dans le SVG. Un node rendu = un anneau + une zone de contenu ; le contenu
// n'est monté que si le node est à l'écran (rendu à la demande) et seul le type actif est construit.
// Géométrie héritée de v1 (banc tests/feel) : chaque node est dessiné autour du centre de l'écran
// capturé au chargement, et positionné par translate(x, y).

import { renderers } from './renderers.js';

const SVG = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
    const node = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
}

export function createRenderer({ svg, universe, store, viewport, dispatch }) {
    const { center } = viewport;
    const defs = el('defs', {}, universe);
    const edgeLayer = el('g', { class: 'edges' }, universe);
    const nodeLayer = el('g', { class: 'nodes' }, universe);
    const views = new Map();      // id node → {root, ring, hit, content, mounted}
    const edgeViews = new Map();  // id arête → {line, hit, gradient}
    let frame = null;

    function nodeTransform(node) {
        return `translate(${node.x}, ${node.y}) scale(1)`;
    }

    function createView(node) {
        const root = el('g', { class: 'node-group', 'data-id': node.id }, nodeLayer);
        const ring = el('circle', { class: 'ring', cx: center.x, cy: center.y }, root);
        const square = el('rect', { class: 'square' }, root);
        const hit = el('circle', { class: 'ring-hit', cx: center.x, cy: center.y }, root);
        const squareHit = el('rect', { class: 'ring-hit' }, root);
        const content = el('foreignObject', { class: 'content' }, root);
        const view = { root, ring, square, hit, squareHit, content, mounted: null };
        views.set(node.id, view);
        return view;
    }

    function updateView(node) {
        const view = views.get(node.id) || createView(node);
        const r = node.radius;
        view.root.setAttribute('transform', nodeTransform(node));
        view.root.classList.toggle('draft', node.status === 'draft');
        view.root.classList.toggle('locked', node.lock);
        view.root.dataset.shape = node.shape;
        [view.ring, view.hit].forEach(c => c.setAttribute('r', r));
        // Carré de v1 : même centre, côté 2r (le cercle y est inscrit).
        [view.square, view.squareHit].forEach(q => Object.entries({ x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r })
            .forEach(([k, v]) => q.setAttribute(k, v)));
        view.ring.style.stroke = node.shape === 'none' ? 'transparent' : node.color;
        view.square.style.stroke = node.color;
        const side = r * Math.SQRT2;
        Object.entries({ x: center.x - side / 2, y: center.y - side / 2, width: side, height: side })
            .forEach(([k, v]) => view.content.setAttribute(k, v));
        if (view.mounted) mountContent(node, view, true);
        schedule();
        return view;
    }

    // Monte (ou remplace si le type a changé) le contenu du type actif, et lui seul.
    function mountContent(node, view, refresh = false) {
        const renderer = renderers[node.content_type] || renderers.fallback;
        if (view.mounted && view.mounted.type === node.content_type) {
            if (refresh) renderer.update(view.mounted.el, node);
            return;
        }
        view.content.replaceChildren();
        const content = renderer.mount(node, { dispatch, viewport });
        view.content.appendChild(content);
        view.mounted = { type: node.content_type, el: content };
    }

    function unmountContent(view) {
        if (!view.mounted || view.content.contains(document.activeElement)) return;
        view.content.replaceChildren();
        view.mounted = null;
    }

    function removeView(id) {
        views.get(id)?.root.remove();
        views.delete(id);
        schedule();
    }

    function nodeCenter(node) {
        return { x: node.x + center.x, y: node.y + center.y };
    }

    // Point du bord d'un node dans la direction `angle` (cercle, ou carré de côté 2r), comme v1.
    function border(node, angle) {
        const c = nodeCenter(node);
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const t = node.shape === 'square'
            ? Math.min(dx ? node.radius / Math.abs(dx) : Infinity, dy ? node.radius / Math.abs(dy) : Infinity)
            : node.radius;
        return { x: c.x + t * dx, y: c.y + t * dy };
    }

    function removeEdgeView(id) {
        const edgeView = edgeViews.get(id);
        if (!edgeView) return;
        [edgeView.line, edgeView.hit, edgeView.gradient].forEach(e => e.remove());
        edgeViews.delete(id);
    }

    // Lien de bord à bord, en dégradé de la couleur d'un node à l'autre (arrêts à 11 % et 88 %, v1).
    function updateEdge(edge) {
        const a = store.state.nodes.get(edge.source);
        const b = store.state.nodes.get(edge.target);
        if (!a || !b) {  // portail : l'autre extrémité est sur un autre plan
            removeEdgeView(edge.id);
            [a, b].filter(Boolean).forEach(n => views.get(n.id)?.root.classList.add('portal'));
            return;
        }
        let edgeView = edgeViews.get(edge.id);
        if (!edgeView) {
            const gradient = el('linearGradient', { id: `g-${edge.id}`, gradientUnits: 'userSpaceOnUse' }, defs);
            el('stop', { offset: '11%' }, gradient);
            el('stop', { offset: '88%' }, gradient);
            const line = el('line', { class: `edge ${edge.kind}` }, edgeLayer);
            line.style.stroke = `url(#g-${edge.id})`;
            const hit = el('line', { class: 'edge-hit', 'data-edge': edge.id }, edgeLayer);
            edgeView = { line, hit, gradient };
            edgeViews.set(edge.id, edgeView);
        }
        const p = nodeCenter(a);
        const q = nodeCenter(b);
        const angle = Math.atan2(q.y - p.y, q.x - p.x);
        const start = border(a, angle);
        const end = border(b, angle + Math.PI);
        const ends = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        [edgeView.line, edgeView.hit, edgeView.gradient].forEach(e => Object.entries(ends).forEach(([k, v]) => e.setAttribute(k, v)));
        edgeView.gradient.children[0].style.stopColor = a.color;
        edgeView.gradient.children[1].style.stopColor = b.color;
    }

    // Culling : une passe par frame, sans requête DOM ; les nodes hors écran n'ont pas de contenu.
    function cull() {
        frame = null;
        const { zoom, tx, ty } = viewport.state;
        const w = window.innerWidth;
        const h = window.innerHeight;
        store.state.nodes.forEach(node => {
            const view = views.get(node.id);
            if (!view) return;
            const c = nodeCenter(node);
            const sx = c.x * zoom + tx;
            const sy = c.y * zoom + ty;
            const r = node.radius * zoom;
            const visible = sx + r > 0 && sx - r < w && sy + r > 0 && sy - r < h;
            view.root.style.display = visible ? '' : 'none';
            if (visible) mountContent(node, view);
            else unmountContent(view);
        });
    }

    function schedule() {
        if (!frame) frame = requestAnimationFrame(cull);
    }

    function renderAll() {
        views.forEach((_, id) => removeView(id));
        [...edgeViews.keys()].forEach(removeEdgeView);
        store.state.nodes.forEach(updateView);
        store.state.edges.forEach(updateEdge);
        renderSelection(store.state.selection);
    }

    function renderSelection(ids) {
        views.forEach((view, id) => view.root.classList.toggle('selected', ids.includes(id)));
    }

    function edgesOf(nodeId) {
        store.state.edges.forEach(edge => { if (edge.source === nodeId || edge.target === nodeId) updateEdge(edge); });
    }

    store.on('node:changed', node => {
        if (node.layer !== store.state.layerId) return removeView(node.id);
        updateView(node);
        edgesOf(node.id);
    });
    store.on('node:removed', node => node && removeView(node.id));
    store.on('edge:changed', updateEdge);
    store.on('edge:removed', edge => edge && removeEdgeView(edge.id));
    store.on('selection:changed', renderSelection);
    store.on('store:hydrated', renderAll);
    viewport.onChange(schedule);
    window.addEventListener('resize', schedule);

    return {
        viewOf: id => views.get(id),
        nodeIdAt: target => target.closest?.('.node-group')?.dataset.id,
        edgeIdAt: target => target.closest?.('.edge-hit')?.dataset.edge,
        // Zone de l'anneau au point écran (x, y), géométrique comme selectionArea de v1 :
        // entre 0,7 r et r + 10 du centre (carré : même bande sur le bord du carré).
        ringAt(x, y) {
            const { zoom } = viewport.state;
            const hit = [...store.state.nodes.values()].reverse().find(node => {
                if (node.layer !== store.state.layerId) return false;
                const c = this.screenCenter(node.id);
                const dx = Math.abs(x - c.x) / zoom;
                const dy = Math.abs(y - c.y) / zoom;
                const d = node.shape === 'square' ? Math.max(dx, dy) : Math.hypot(dx, dy);
                return d >= 0.7 * node.radius && d <= node.radius + 10;
            });
            return hit?.id;
        },
        edgeLine: id => edgeViews.get(id)?.line,
        // Point de l'anneau (bord droit) en coordonnées écran : cible pour sélectionner et glisser.
        ringPoint(id) {
            const v = views.get(id);
            const rect = (store.state.nodes.get(id).shape === 'square' ? v.square : v.ring).getBoundingClientRect();
            return { x: rect.right - 3, y: rect.top + rect.height / 2 };
        },
        screenCenter(id) {
            const node = store.state.nodes.get(id);
            const c = nodeCenter(node);
            return { x: c.x * viewport.state.zoom + viewport.state.tx, y: c.y * viewport.state.zoom + viewport.state.ty };
        },
        focusContent(id) {
            const view = views.get(id);
            if (!view) return;
            const node = store.state.nodes.get(id);
            mountContent(node, view);
            const renderer = renderers[node.content_type] || renderers.fallback;
            if (renderer.focus) renderer.focus(view.mounted.el);
        },
        transformOf: id => views.get(id)?.root.getAttribute('transform'),
    };
}
