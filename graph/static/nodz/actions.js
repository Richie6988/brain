// Catalogue d'actions : une seule définition par action, utilisée par la souris, le clavier et
// (Phase 4) par l'IA comme outils. `params` décrit les paramètres pour le LLM ; `run` modifie le
// store et renvoie une fonction inverse (annuler), elle-même renvoyant l'inverse de l'inverse.

const uuid = () => crypto.randomUUID();
const palette = ['#33FF99', '#6848A6', '#FF6B6B', '#FFD93D', '#4D96FF', '#FF8FE8', '#00D1C1'];
const randomColor = () => palette[Math.floor(Math.random() * palette.length)];

function restoreNodes(store, snapshots) {
    return () => {
        const current = snapshots.map(s => store.state.nodes.get(s.id)).filter(Boolean).map(n => ({ ...n }));
        snapshots.forEach(s => store.write.putNode({ ...s }));
        return restoreNodes(store, current);
    };
}

export const actions = {
    create_node: {
        description: 'Crée un node sur le plan courant, à la position donnée (coordonnées univers).',
        params: { x: 'number', y: 'number', content_type: 'text|image|file|video|audio|model3d|code', text: 'string?', color: 'string?' },
        run(store, { x, y, content_type = 'text', text, color, id = uuid(), payload = {} }) {
            const node = {
                id, layer: store.state.layerId, x, y, radius: 62.5, shape: 'circle', color: color || randomColor(),
                lock: false, content_type, payload: text ? { ...payload, text: { html: text } } : payload, status: 'accepted', version: 0,
            };
            const undo = () => { store.write.removeNode(id); return redo; };
            const redo = () => { store.write.putNode({ ...node }); return undo; };
            return redo();
        },
    },
    update_node: {
        description: "Modifie les propriétés d'un node (texte, couleur, forme, taille, verrou, type).",
        params: { id: 'node_id', text: 'string?', color: 'string?', shape: 'circle|square|none?', radius: 'number?', lock: 'boolean?', content_type: 'string?' },
        run(store, { id, text, ...fields }) {
            const node = store.state.nodes.get(id);
            if (!node) return null;
            const before = { ...node };
            const next = { ...node, ...fields };
            if (text !== undefined) next.payload = { ...node.payload, text: { ...(node.payload.text || {}), html: text } };
            store.write.putNode(next);
            return restoreNodes(store, [before]);
        },
    },
    move_nodes: {
        description: 'Déplace des nodes de (dx, dy) en coordonnées univers.',
        params: { ids: 'node_id[]', dx: 'number', dy: 'number' },
        run(store, { ids, dx, dy }) {
            const before = [];
            ids.forEach(id => {
                const node = store.state.nodes.get(id);
                if (!node || node.lock) return;
                before.push({ ...node });
                store.write.putNode({ ...node, x: Number((node.x + dx).toFixed(5)), y: Number((node.y + dy).toFixed(5)) });
            });
            return before.length ? restoreNodes(store, before) : null;
        },
    },
    delete_nodes: {
        description: 'Supprime des nodes et leurs liens (archivés côté serveur, historique conservé).',
        params: { ids: 'node_id[]' },
        run(store, { ids }) {
            const nodes = ids.map(id => store.state.nodes.get(id)).filter(Boolean).map(n => ({ ...n }));
            const edges = [...store.state.edges.values()].filter(e => ids.includes(e.source) || ids.includes(e.target)).map(e => ({ ...e }));
            const redo = () => {
                edges.forEach(e => store.write.removeEdge(e.id));
                nodes.forEach(n => store.write.removeNode(n.id));
                return undo;
            };
            const undo = () => {
                nodes.forEach(n => store.write.putNode({ ...n }));
                edges.forEach(e => store.write.putEdge({ ...e }));
                return redo;
            };
            return redo();
        },
    },
    link_nodes: {
        description: 'Relie deux nodes du plan courant.',
        params: { source: 'node_id', target: 'node_id' },
        run(store, { source, target, kind = 'link', id = uuid() }) {
            if (source === target) return null;
            const exists = [...store.state.edges.values()].some(e =>
                (e.source === source && e.target === target) || (e.source === target && e.target === source));
            if (exists) return null;
            const edge = { id, source, target, kind };
            const undo = () => { store.write.removeEdge(id); return redo; };
            const redo = () => { store.write.putEdge({ ...edge }); return undo; };
            return redo();
        },
    },
    paste_nodes: {
        description: 'Colle des nodes complets (et leurs liens) sur le plan courant.',
        params: { nodes: 'node[]', edges: 'edge[]' },
        run(store, { nodes, edges = [] }) {
            const layer = store.state.layerId;
            const placed = nodes.map(n => ({ ...n, layer, status: 'accepted' }));
            const redo = () => {
                placed.forEach(n => store.write.putNode({ ...n }));
                edges.forEach(e => store.write.putEdge({ ...e }));
                return undo;
            };
            const undo = () => {
                edges.forEach(e => store.write.removeEdge(e.id));
                placed.forEach(n => store.write.removeNode(n.id));
                return redo;
            };
            return redo();
        },
    },
    move_to_layer: {
        description: "Envoie des nodes sur un autre plan ; leurs liens vers ceux qui restent deviennent des portails.",
        params: { ids: 'node_id[]', layer: 'layer_id' },
        run(store, { ids, layer }) {
            if (!store.state.layers.has(layer) || layer === store.state.layerId) return null;
            const nodes = ids.map(id => store.state.nodes.get(id)).filter(n => n && !n.lock).map(n => ({ ...n }));
            const moved = new Set(nodes.map(n => n.id));
            const edges = [...store.state.edges.values()]
                .filter(e => moved.has(e.source) !== moved.has(e.target)).map(e => ({ ...e }));
            const redo = () => {
                nodes.forEach(n => {
                    store.write.putNode({ ...n, layer });
                    store.state.portalEnds.set(n.id, layer);
                });
                edges.forEach(e => store.write.putEdge({ ...e, kind: 'portal' }));
                return undo;
            };
            const undo = () => {
                nodes.forEach(n => {
                    store.write.putNode({ ...n });
                    store.state.portalEnds.delete(n.id);
                });
                edges.forEach(e => store.write.putEdge({ ...e }));
                return redo;
            };
            return nodes.length ? redo() : null;
        },
    },
    unlink: {
        description: 'Supprime un lien.',
        params: { id: 'edge_id' },
        run(store, { id }) {
            const edge = store.state.edges.get(id);
            if (!edge) return null;
            const undo = () => { store.write.putEdge({ ...edge }); return redo; };
            const redo = () => { store.write.removeEdge(id); return undo; };
            return redo();
        },
    },
    teleport: {
        description: "Emmène un node dans un nouveau plan, relié à l'original par un portail, et y déplace la vue.",
        params: { id: 'node_id?', name: 'string?' },
        undoable: false,
        run(store, { id = store.state.selection.at(-1), name }) {
            const source = store.state.nodes.get(id);
            if (!source) return null;
            const indexes = [...store.state.layers.values()].map(l => l.index);
            const index = Math.max(...indexes, -1) + 1;
            const layer = { id: uuid(), name: name || `Dim-${index + 1}`, index, kind: 'user' };
            store.write.putLayer(layer);
            const copy = { ...source, id: uuid(), layer: layer.id, x: 0, y: 0, version: 0 };
            store.write.putNode(copy);
            store.write.putEdge({ id: uuid(), source: source.id, target: copy.id, kind: 'portal' });
            store.write.setLayer(layer.id);
            return null;
        },
    },
    go_to_layer: {
        description: 'Affiche un autre plan.',
        params: { id: 'layer_id' },
        undoable: false,
        run(store, { id }) {
            if (store.state.layers.has(id)) store.write.setLayer(id);
            return null;
        },
    },
    select: {
        description: 'Remplace la sélection (liste vide pour tout désélectionner).',
        params: { ids: 'node_id[]' },
        undoable: false,
        run(store, { ids }) { store.write.select(ids); return null; },
    },
};
