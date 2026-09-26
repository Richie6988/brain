// Source de vérité unique : plans, nodes, arêtes, sélection. Le DOM n'en est qu'une projection.
// Toute modification passe par dispatch(action, params) : clics, clavier et IA utilisent le même
// catalogue (actions.js). Chaque action renvoie son inverse, ce qui donne l'annuler/refaire.

export function createStore() {
    const state = {
        layers: new Map(),   // id → {id, name, index, kind}
        layerId: null,       // plan courant
        nodes: new Map(),    // id → {id, layer, x, y, radius, shape, color, lock, content_type, payload, status, version}
        edges: new Map(),    // id → {id, source, target, kind}
        selection: [],       // ids, dans l'ordre de sélection
    };
    const listeners = new Map();
    const dirty = { nodes: new Set(), edges: new Set(), layers: new Set(), deletedNodes: new Set(), deletedEdges: new Set() };
    const undoStack = [];
    const redoStack = [];
    let actions = {};
    let transaction = null;

    function emit(event, detail) {
        (listeners.get(event) || []).forEach(fn => fn(detail));
        (listeners.get('*') || []).forEach(fn => fn(event, detail));
    }

    // Primitives d'écriture : elles tiennent à jour la liste des changements à envoyer au serveur.
    const write = {
        putNode(node) {
            state.nodes.set(node.id, node);
            dirty.nodes.add(node.id);
            dirty.deletedNodes.delete(node.id);
            emit('node:changed', node);
        },
        removeNode(id) {
            const node = state.nodes.get(id);
            state.nodes.delete(id);
            dirty.nodes.delete(id);
            dirty.deletedNodes.add(id);
            state.selection = state.selection.filter(s => s !== id);
            emit('node:removed', node);
        },
        putEdge(edge) {
            state.edges.set(edge.id, edge);
            dirty.edges.add(edge.id);
            dirty.deletedEdges.delete(edge.id);
            emit('edge:changed', edge);
        },
        removeEdge(id) {
            const edge = state.edges.get(id);
            state.edges.delete(id);
            dirty.edges.delete(id);
            dirty.deletedEdges.add(id);
            emit('edge:removed', edge);
        },
        putLayer(layer) {
            state.layers.set(layer.id, layer);
            dirty.layers.add(layer.id);
            emit('layer:changed', layer);
        },
        setLayer(id) {
            state.layerId = id;
            state.selection = [];
            emit('layer:current', id);
        },
        select(ids) {
            state.selection = ids.filter(id => state.nodes.has(id));
            emit('selection:changed', state.selection);
        },
    };

    return {
        state,
        write,
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(fn);
        },
        register(catalog) { actions = catalog; },
        catalog: () => actions,
        // Exécute une action du catalogue. `record: false` pour les actions sans historique (sélection).
        dispatch(name, params = {}) {
            const action = actions[name];
            if (!action) throw new Error(`action inconnue : ${name}`);
            const inverse = action.run(this, params);
            if (inverse && action.undoable !== false) {
                if (transaction) transaction.push(inverse);
                else {
                    undoStack.push(inverse);
                    redoStack.length = 0;
                }
            }
            return inverse;
        },
        // Regroupe des actions en un seul pas d'annulation, sur un ou plusieurs événements
        // (un drag entier, une réponse complète de l'IA) : begin() … commit().
        begin() {
            const outer = transaction;
            transaction = [];
            return outer;
        },
        commit(outer) {
            const inverses = transaction;
            transaction = outer;
            if (!inverses.length) return;
            const combine = list => () => combine(list.slice().reverse().map(inv => inv()));
            const inverse = combine(inverses);
            if (transaction) transaction.push(inverse);
            else {
                undoStack.push(inverse);
                redoStack.length = 0;
            }
        },
        transaction(fn) {
            const outer = this.begin();
            try { fn(); } finally { this.commit(outer); }
        },
        undo() {
            const inverse = undoStack.pop();
            if (inverse) redoStack.push(inverse());
        },
        redo() {
            const inverse = redoStack.pop();
            if (inverse) undoStack.push(inverse());
        },
        // Lot de changements au format de POST /api/v1/changes, puis remise à zéro.
        takeChanges() {
            const nodes = [...dirty.nodes].map(id => state.nodes.get(id)).filter(Boolean);
            const batch = {
                layers: { upsert: [...dirty.layers].map(id => state.layers.get(id)) },
                nodes: { upsert: nodes, delete: [...dirty.deletedNodes] },
                edges: { upsert: [...dirty.edges].map(id => state.edges.get(id)).filter(Boolean), delete: [...dirty.deletedEdges] },
            };
            Object.values(dirty).forEach(set => set.clear());
            return batch;
        },
        hasChanges: () => Object.values(dirty).some(set => set.size > 0),
        // Chargement depuis le serveur : n'est pas une modification.
        hydrate({ layers, layer, nodes, edges }) {
            if (layers) layers.forEach(l => state.layers.set(l.id, l));
            if (layer) state.layerId = layer.id;
            state.nodes.clear();
            state.edges.clear();
            nodes.forEach(n => state.nodes.set(n.id, n));
            edges.forEach(e => state.edges.set(e.id, e));
            state.selection = [];
            emit('store:hydrated');
        },
    };
}
