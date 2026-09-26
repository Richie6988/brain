// Souris, trackpad et clavier → actions du catalogue. Aucune écriture directe dans le DOM des nodes.
// Comportements repris de v1 : molette = pan, pinch = zoom au pointeur, glisser à vide = pan,
// Ctrl + glisser = sélection rectangle, glisser l'anneau d'un node = déplacer la sélection,
// double-clic ou Espace = créer un node sous le pointeur, Entrée = téléporter, Tab = saut de zoom,
// double-clic sur l'anneau = focus, flèches = déplacer la vue, clic droit glissé d'un node à l'autre = lien.

import { api } from './api.js';

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function bindInteractions({ svg, store, viewport, view, sync, nav }) {
    const dispatch = (name, params) => store.dispatch(name, params);
    const pointer = { x: viewport.center.x, y: viewport.center.y };
    let ctrlDown = false;
    const held = new Set();  // flèches enfoncées
    let gesture = null;  // {type: 'pan' | 'drag' | 'rect', ...}
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'selection-box');
    svg.appendChild(rect);

    const editing = () => document.activeElement?.closest?.('.node-group');
    const blurEditing = () => { if (editing()) document.activeElement.blur(); };

    function createAtPointer(color) {
        const { x, y } = viewport.toUniverse(pointer.x, pointer.y);
        const id = crypto.randomUUID();
        store.dispatch('create_node', { x, y, id, color });
        requestAnimationFrame(() => view.focusContent(id));
        return id;
    }

    // Espace (v1) : un node sélectionné = nouveau node de même couleur relié à lui ; 2 à 22 nodes
    // sélectionnés = les relier deux à deux ; sinon un node libre. Un seul pas d'annulation.
    function space() {
        const selection = store.state.selection;
        store.transaction(() => {
            if (selection.length === 1) {
                const source = store.state.nodes.get(selection[0]);
                dispatch('link_nodes', { source: source.id, target: createAtPointer(source.color) });
            } else if (selection.length > 1 && selection.length < 23) {
                selection.forEach((a, i) => selection.slice(i + 1).forEach(b => dispatch('link_nodes', { source: a, target: b })));
            } else {
                createAtPointer();
            }
        });
        if (selection.length) dispatch('select', { ids: [] });
    }

    // Copier, couper, coller (v1) : collage au pointeur autour du barycentre ; un couper-coller
    // garde les identifiants (le node revient, historique compris), un second collage fait des copies.
    let clipboard = null;
    function copy(cut) {
        const ids = new Set(store.state.selection);
        if (!ids.size) return;
        const nodes = [...ids].map(id => ({ ...store.state.nodes.get(id) }));
        const edges = [...store.state.edges.values()].filter(e => e.kind === 'link' && ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e }));
        const bx = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
        const by = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
        clipboard = { nodes, edges, bx, by, cut };
        if (cut) dispatch('delete_nodes', { ids: [...ids] });
        dispatch('select', { ids: [] });
    }
    function paste() {
        if (!clipboard) return;
        const { nodes, edges, bx, by, cut } = clipboard;
        const p = viewport.toUniverse(pointer.x, pointer.y);
        const ids = new Map(nodes.map(n => [n.id, cut ? n.id : crypto.randomUUID()]));
        const placed = nodes.map(n => ({ ...n, id: ids.get(n.id), x: p.x + n.x - bx, y: p.y + n.y - by, version: 0 }));
        dispatch('paste_nodes', {
            nodes: placed,
            edges: edges.map(e => ({ ...e, id: cut ? e.id : crypto.randomUUID(), source: ids.get(e.source), target: ids.get(e.target) })),
        });
        clipboard = { ...clipboard, cut: false };
        dispatch('select', { ids: placed.map(n => n.id) });
    }

    // Glisser près d'un bord (v1) : la vue défile et la sélection suit le pointeur.
    let scrolling = null;
    function edgeScroll() {
        scrolling = null;
        if (gesture?.type !== 'drag') return;
        const margin = 50;
        const speed = d => (d < margin ? (margin - d) / margin * 12 : 0);
        const dx = speed(pointer.x) - speed(window.innerWidth - pointer.x);
        const dy = speed(pointer.y) - speed(window.innerHeight - pointer.y);
        if (!dx && !dy) return;
        viewport.pan(dx, dy);
        dispatch('move_nodes', { ids: store.state.selection, dx: -dx / viewport.state.zoom, dy: -dy / viewport.state.zoom });
        scrolling = requestAnimationFrame(edgeScroll);
    }

    // Fichiers déposés sur le canevas : un node par fichier, du type qui lui correspond, au point de dépôt.
    const typeOf = file => (file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio' : /\.stl$/i.test(file.name) ? 'model3d' : 'file');
    svg.addEventListener('dragover', event => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    });
    svg.addEventListener('drop', async event => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        const origin = viewport.toUniverse(event.clientX, event.clientY);
        for (const [i, file] of [...event.dataTransfer.files].entries()) {
            try {
                const meta = await api.upload(file);
                const type = typeOf(file);
                dispatch('create_node', {
                    x: origin.x + i * 160, y: origin.y, content_type: type,
                    payload: { [type]: { file: meta.id, name: meta.name, mime: meta.mime, size: meta.size } },
                });
            } catch (error) {
                document.getElementById('status').textContent = `${file.name} : ${error.message}`;
            }
        }
    });

    // Liens (v1) : au survol, flèche vers l'extrémité la plus éloignée ; clic = voyage ; Suppr = supprimer.
    let hoveredEdge = null;
    function hoverEdge(id, x, y) {
        if (hoveredEdge && hoveredEdge !== id) view.edgeLine(hoveredEdge)?.classList.remove('hover');
        hoveredEdge = id;
        if (!id) return svg.style.removeProperty('cursor');
        const line = view.edgeLine(id);
        line.classList.add('hover');
        line.style.strokeWidth = viewport.state.zoom < 0.5 ? '7.5px' : '';
        const edge = store.state.edges.get(id);
        const a = view.screenCenter(edge.source);
        const b = view.screenCenter(edge.target);
        const [near, far] = Math.hypot(x - a.x, y - a.y) < Math.hypot(x - b.x, y - b.y) ? [a, b] : [b, a];
        const angle = Math.atan2(far.y - near.y, far.x - near.x) * 180 / Math.PI;
        const arrow = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#1E90FF" transform="rotate(${angle.toFixed(1)})"><polygon points="12 2, 20 12, 12 22, 10 20, 14 12, 10 4"/></svg>`;
        svg.style.cursor = `url("data:image/svg+xml;base64,${btoa(arrow)}") 16 16, pointer`;
    }
    svg.addEventListener('pointerover', event => { if (!gesture) hoverEdge(view.edgeIdAt(event.target), event.clientX, event.clientY); });
    svg.addEventListener('pointerout', event => { if (view.edgeIdAt(event.target)) hoverEdge(null); });

    svg.addEventListener('wheel', event => {
        event.preventDefault();
        // Le pinch du trackpad arrive avec event.ctrlKey : seul un vrai Ctrl enfoncé bloque le zoom (v1).
        if (event.deltaY !== Math.round(event.deltaY) && ctrlDown) return;
        viewport.wheel(event);
    }, { passive: false });

    // Clic droit glissé d'un node à un autre : lien direct (élastique pendant le geste).
    const band = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    band.setAttribute('class', 'link-band');
    svg.appendChild(band);
    svg.addEventListener('contextmenu', event => event.preventDefault());  // comme v1
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 2) return;
        const source = view.ringAt(event.clientX, event.clientY) || view.nodeIdAt(event.target);
        if (!source) return;
        const c = view.screenCenter(source);
        Object.entries({ x1: c.x, y1: c.y, x2: event.clientX, y2: event.clientY }).forEach(([k, v]) => band.setAttribute(k, v));
        band.style.stroke = store.state.nodes.get(source).color;
        gesture = { type: 'link', source };
        svg.setPointerCapture(event.pointerId);
    });

    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        const nodeId = view.nodeIdAt(event.target);
        const onRing = event.target.classList?.contains('ring-hit');
        const edgeId = view.edgeIdAt(event.target);
        if (edgeId && !ctrlDown) {
            hoverEdge(null);
            nav.play(nav.gestures.travelLink(edgeId, event.clientX, event.clientY));
            return;
        }
        if (ctrlDown) {
            gesture = { type: 'rect', x0: event.clientX, y0: event.clientY };
        } else if (nodeId && onRing) {
            blurEditing();
            if (!store.state.selection.includes(nodeId)) dispatch('select', { ids: [...store.state.selection, nodeId] });
            gesture = { type: 'drag', x: event.clientX, y: event.clientY, outer: store.begin() };
            document.body.classList.add('dragging');
        } else if (!nodeId) {
            event.preventDefault();
            blurEditing();
            dispatch('select', { ids: [] });
            gesture = { type: 'pan', x: event.clientX, y: event.clientY };
        } else {
            return;  // clic dans le contenu d'un node : édition
        }
        svg.setPointerCapture(event.pointerId);
    });

    svg.addEventListener('pointermove', event => {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        viewport.pointerMoved();
        if (!gesture) return;
        if (gesture.type === 'pan') {
            viewport.pan(event.clientX - gesture.x, event.clientY - gesture.y);
            gesture.x = event.clientX;
            gesture.y = event.clientY;
        } else if (gesture.type === 'drag') {
            const zoom = viewport.state.zoom;
            dispatch('move_nodes', { ids: store.state.selection, dx: (event.clientX - gesture.x) / zoom, dy: (event.clientY - gesture.y) / zoom });
            gesture.x = event.clientX;
            gesture.y = event.clientY;
            if (!scrolling) scrolling = requestAnimationFrame(edgeScroll);
        } else if (gesture.type === 'link') {
            band.setAttribute('x2', event.clientX);
            band.setAttribute('y2', event.clientY);
        } else if (gesture.type === 'rect') {
            const x = Math.min(gesture.x0, event.clientX);
            const y = Math.min(gesture.y0, event.clientY);
            Object.entries({ x, y, width: Math.abs(event.clientX - gesture.x0), height: Math.abs(event.clientY - gesture.y0) })
                .forEach(([k, v]) => rect.setAttribute(k, v));
        }
    });

    svg.addEventListener('pointerup', event => {
        if (gesture?.type === 'rect') {
            const [x1, x2] = [gesture.x0, event.clientX].sort((a, b) => a - b);
            const [y1, y2] = [gesture.y0, event.clientY].sort((a, b) => a - b);
            const inside = [...store.state.nodes.values()]
                .filter(n => n.layer === store.state.layerId)
                .map(n => n.id)
                .filter(id => {
                    const c = view.screenCenter(id);
                    return c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2;
                });
            dispatch('select', { ids: [...new Set([...store.state.selection, ...inside])] });
            ['width', 'height'].forEach(k => rect.setAttribute(k, 0));
        }
        if (gesture?.type === 'link') {
            ['x1', 'y1', 'x2', 'y2'].forEach(k => band.setAttribute(k, 0));
            const target = view.ringAt(event.clientX, event.clientY)
                || view.nodeIdAt(document.elementFromPoint(event.clientX, event.clientY) || svg);
            if (target && target !== gesture.source) dispatch('link_nodes', { source: gesture.source, target });
        }
        if (gesture?.type === 'drag') {
            store.commit(gesture.outer);
            document.body.classList.remove('dragging');
        }
        gesture = null;
    });

    document.addEventListener('dblclick', event => {
        if (!svg.contains(event.target) && !event.target.closest?.('#size-handle')) return;
        // Test géométrique (v1) : la capture du pointeur et la poignée de taille masquent la cible réelle.
        const ringId = view.ringAt(event.clientX, event.clientY);
        if (ringId) {
            nav.play(nav.gestures.focus(ringId));
            return;
        }
        if (view.nodeIdAt(document.elementFromPoint(event.clientX, event.clientY) || event.target)) return;
        event.preventDefault();
        createAtPointer();
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Control') ctrlDown = true;
        if (editing() || event.target.closest?.('input, textarea, select, button, [contenteditable]')) return;
        const selection = store.state.selection;
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === ' ') {
            event.preventDefault();
            space();
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && hoveredEdge) {
            event.preventDefault();
            dispatch('unlink', { id: hoveredEdge });
            hoverEdge(null);
        } else if (event.key === 'Enter' && selection.length) {
            event.preventDefault();
            dispatch('teleport', { id: selection.at(-1) });
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
            event.preventDefault();
            dispatch('delete_nodes', { ids: [...selection] });
        } else if (mod && ['c', 'x'].includes(event.key.toLowerCase())) {
            copy(event.key.toLowerCase() === 'x');
        } else if (mod && event.key.toLowerCase() === 'v') {
            event.preventDefault();
            paste();
        } else if (mod && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            dispatch('select', { ids: [...store.state.nodes.values()].filter(n => n.layer === store.state.layerId).map(n => n.id) });
        } else if (mod && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            event.shiftKey ? store.redo() : store.undo();
        } else if (mod && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            store.redo();
        } else if (event.key === 'Escape') {
            dispatch('select', { ids: [] });
        } else if (event.key === 'Tab') {
            event.preventDefault();
            nav.play(nav.gestures.zoomJump(pointer.x, pointer.y));
        } else if (event.key in ARROWS && !selection.length) {
            event.preventDefault();
            held.add(event.key);
            const v = [...held].reduce((sum, key) => [sum[0] + ARROWS[key][0], sum[1] + ARROWS[key][1]], [0, 0]);
            const k = v[0] && v[1] ? 0.7 : 1;  // diagonale (v1)
            nav.play(nav.gestures.arrows(v[0] * k, v[1] * k));
        }
    });
    document.addEventListener('keyup', event => {
        if (event.key === 'Control') ctrlDown = false;
        held.delete(event.key);
    });
    window.addEventListener('blur', () => { ctrlDown = false; held.clear(); sync.flush(); });
}
