// Outils du node, repris de v1 et placés comme v1 (décalages en unités du node, à l'échelle du zoom) :
// - à la sélection : type (haut), couleur (bas), forme (gauche), verrou (droite), envoi vers un plan ;
// - au survol de l'anneau d'un node libre : poignée de taille sur le bord droit ;
// - sur un node relié par portail : bouton de voyage vers l'autre plan.

const SHAPES = ['circle', 'square', 'none'];  // cycle de v1

export function bindNodeTools({ store, viewport, view, nav, icons }) {
    const dispatch = (name, params) => store.dispatch(name, params);
    const $ = id => document.getElementById(id);
    const tools = $('node-tools');
    const handle = $('size-handle');
    const portal = $('portal-handle');
    const layerMenu = $('layer-menu');
    let hovered = null;   // node dont l'anneau est survolé (poignée de taille)
    let sizing = null;    // {id, x, outer}
    let coloring = null;  // transaction en cours pendant le choix d'une couleur

    const current = () => store.state.nodes.get(store.state.selection.at(-1));
    const scale = () => Math.min(2, Math.max(0.6, viewport.state.zoom));

    function place(el, node, dx, dy, s = scale()) {
        const c = view.screenCenter(node.id);
        el.style.transform = `translate(${c.x + dx * viewport.state.zoom}px, ${c.y + dy * viewport.state.zoom}px) scale(${s})`;
    }

    function portalOf(node) {
        return [...store.state.edges.values()].find(e => e.kind === 'portal' && (e.source === node.id || e.target === node.id)
            && store.state.portalEnds.has(e.source === node.id ? e.target : e.source));
    }

    function refresh() {
        const node = current();
        const show = node && node.layer === store.state.layerId && !sizing;
        tools.hidden = !show;
        document.querySelectorAll('.node-group.tools').forEach(g => g.classList.remove('tools'));
        if (show) {
            view.viewOf(node.id)?.root.classList.add('tools');
            place(tools, node, 0, 0);
            tools.querySelector('.type').value = node.content_type;
            tools.querySelector('.type').disabled = node.lock;
            tools.querySelector('.shape img').src = icons[node.shape === 'none' ? 'hide' : node.shape];
            tools.querySelector('.lock img').src = icons[node.lock ? 'lock' : 'unlock'];
            tools.querySelector('.color input').value = /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : '#33ff99';
        } else {
            layerMenu.hidden = true;
        }
        const target = store.state.nodes.get(sizing?.id || hovered);
        handle.hidden = !(target && (sizing || (!target.lock && !store.state.selection.includes(target.id))));
        if (!handle.hidden) {
            handle.querySelector('path').style.fill = target.color;
            place(handle, target, target.radius - 4, 0, viewport.state.zoom);  // bord droit (v1)
        }
        const gate = [store.state.nodes.get(hovered), node].find(n => n && portalOf(n));
        portal.hidden = !gate;
        if (gate) {
            portal.dataset.node = gate.id;
            place(portal, gate, -0.71 * gate.radius - 14, -0.71 * gate.radius - 14, viewport.state.zoom);
        }
    }

    // Appliqué à toute la sélection, comme v1 (les nodes verrouillés ne changent pas de forme ni de type).
    function editSelection(fields, { unlockedOnly = true } = {}) {
        store.transaction(() => store.state.selection.forEach(id => {
            const node = store.state.nodes.get(id);
            if (node && !(unlockedOnly && node.lock)) dispatch('update_node', { id, ...fields(node) });
        }));
    }

    tools.querySelector('.type').addEventListener('change', event => editSelection(() => ({ content_type: event.target.value })));
    tools.querySelector('.shape').addEventListener('click', () => {
        const next = SHAPES[(SHAPES.indexOf(current().shape) + 1) % SHAPES.length];
        editSelection(() => ({ shape: next }));
    });
    tools.querySelector('.lock').addEventListener('click', () => {
        const lock = !current().lock;
        editSelection(() => ({ lock }), { unlockedOnly: false });
    });
    const colorInput = tools.querySelector('.color input');
    colorInput.addEventListener('input', () => {
        if (!coloring) coloring = { outer: store.begin() };
        store.state.selection.forEach(id => dispatch('update_node', { id, color: colorInput.value }));
    });
    colorInput.addEventListener('change', () => {
        if (coloring) store.commit(coloring.outer);
        coloring = null;
    });

    // Envoi vers un plan (bouton « plan » de v1) : liste des autres plans.
    tools.querySelector('.layer').addEventListener('click', () => {
        const layers = [...store.state.layers.values()]
            .filter(l => l.kind !== 'archive' && l.id !== store.state.layerId).sort((a, b) => a.index - b.index);
        layerMenu.replaceChildren(...(layers.length ? layers.map(layer => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = layer.name || `Dim-${layer.index + 1}`;
            item.addEventListener('click', () => {
                layerMenu.hidden = true;
                dispatch('move_to_layer', { ids: [...store.state.selection], layer: layer.id });
                dispatch('select', { ids: [] });
            });
            return item;
        }) : [Object.assign(document.createElement('span'), { textContent: 'Aucun autre plan : Entrée crée un portail' })]));
        layerMenu.style.transform = tools.style.transform;
        layerMenu.hidden = !layerMenu.hidden;
    });

    // Voyage par portail (bouton « quantum » de v1) : charge l'autre plan puis centre le node d'arrivée.
    portal.addEventListener('click', () => {
        const node = store.state.nodes.get(portal.dataset.node);
        const edge = portalOf(node);
        const far = edge.source === node.id ? edge.target : edge.source;
        store.once('store:hydrated', () => requestAnimationFrame(() => nav.play(nav.gestures.focus(far, { zoomIn: false }))));
        dispatch('go_to_layer', { id: store.state.portalEnds.get(far) });
    });

    // Poignée de taille : glisser horizontalement change le rayon (minimum 20, v1).
    handle.addEventListener('pointerdown', event => {
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        sizing = { id: hovered, x: event.clientX, outer: store.begin() };
        document.body.classList.add('sizing');
        refresh();
    });
    handle.addEventListener('pointermove', event => {
        if (!sizing) return;
        const node = store.state.nodes.get(sizing.id);
        const radius = node.radius + (event.clientX - sizing.x) / viewport.state.zoom;
        sizing.x = event.clientX;
        if (radius > 20) dispatch('update_node', { id: node.id, radius: Math.min(radius, window.innerHeight * Math.SQRT2) });
    });
    handle.addEventListener('pointerup', () => {
        if (!sizing) return;
        store.commit(sizing.outer);
        sizing = null;
        document.body.classList.remove('sizing');
        refresh();
    });

    document.getElementById('nodz').addEventListener('pointerover', event => {
        if (sizing) return;
        const id = event.target.classList?.contains('ring-hit') ? view.nodeIdAt(event.target) : null;
        if (id) hovered = id;
        else if (!event.target.closest?.('.node-group')) hovered = null;
        refresh();
    });

    ['selection:changed', 'node:changed', 'node:removed', 'store:hydrated'].forEach(e => store.on(e, refresh));
    viewport.onChange(refresh);
    return { refresh };
}
