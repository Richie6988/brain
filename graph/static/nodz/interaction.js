// Souris, trackpad et clavier → actions du catalogue. Aucune écriture directe dans le DOM des nodes.
// Comportements repris de v1 : molette = pan, pinch = zoom au pointeur, glisser à vide = pan,
// Ctrl + glisser = sélection rectangle, glisser l'anneau d'un node = déplacer la sélection,
// double-clic ou Espace = créer un node sous le pointeur, Entrée = téléporter, Tab = saut de zoom,
// double-clic sur l'anneau = focus, flèches = déplacer la vue.

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

    function createAtPointer() {
        const { x, y } = viewport.toUniverse(pointer.x, pointer.y);
        const inverse = store.dispatch('create_node', { x, y });
        const id = [...store.state.nodes.keys()].at(-1);
        requestAnimationFrame(() => view.focusContent(id));
        return inverse;
    }

    svg.addEventListener('wheel', event => {
        event.preventDefault();
        // Le pinch du trackpad arrive avec event.ctrlKey : seul un vrai Ctrl enfoncé bloque le zoom (v1).
        if (event.deltaY !== Math.round(event.deltaY) && ctrlDown) return;
        viewport.wheel(event);
    }, { passive: false });

    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        const nodeId = view.nodeIdAt(event.target);
        const onRing = event.target.classList?.contains('ring-hit');
        if (ctrlDown) {
            gesture = { type: 'rect', x0: event.clientX, y0: event.clientY };
        } else if (nodeId && onRing) {
            blurEditing();
            if (!store.state.selection.includes(nodeId)) dispatch('select', { ids: [...store.state.selection, nodeId] });
            gesture = { type: 'drag', x: event.clientX, y: event.clientY, outer: store.begin() };
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
        if (gesture?.type === 'drag') store.commit(gesture.outer);
        gesture = null;
    });

    svg.addEventListener('dblclick', event => {
        // La capture du pointeur (drag) envoie le double-clic au SVG : on regarde sous le pointeur.
        const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
        const nodeId = view.nodeIdAt(target);
        if (nodeId && target.classList?.contains('ring-hit')) {
            nav.play(nav.gestures.focus(nodeId));
            return;
        }
        if (nodeId) return;
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
            createAtPointer();
        } else if (event.key === 'Enter' && selection.length) {
            event.preventDefault();
            dispatch('teleport', { id: selection.at(-1) });
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
            event.preventDefault();
            dispatch('delete_nodes', { ids: [...selection] });
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
