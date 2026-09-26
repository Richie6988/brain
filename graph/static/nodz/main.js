// Point d'entrée de la nouvelle interface (/next) : store + catalogue d'actions + vue, sur /api/v1.

import { actions } from './actions.js';
import { api, createSync } from './api.js';
import { bindCommand } from './command.js';
import { bindInteractions } from './interaction.js';
import { bindLibrary } from './library.js';
import { createNavigation } from './navigation.js';
import { bindNodeTools } from './nodetools.js';
import { createRenderer } from './render.js';
import { createStore } from './store.js';
import { bindToolbar } from './toolbar.js';
import { createViewport } from './viewport.js';

const BASE = document.documentElement.dataset.base || '';
const svg = document.getElementById('nodz');
const universe = document.getElementById('universe');
const status = document.getElementById('status');

const store = createStore();
store.register(actions);
const viewport = createViewport(universe);
const sync = createSync(store, { onError: error => { status.textContent = `Sauvegarde impossible : ${error.message}`; } });
const view = createRenderer({ svg, universe, store, viewport, dispatch: (name, params) => store.dispatch(name, params) });
const nav = createNavigation({ viewport, store, view });
bindInteractions({ svg, store, viewport, view, sync, nav });
bindCommand({ svg, store, viewport, view, nav, sync });
bindToolbar({ svg, store, nav });
bindNodeTools({ store, viewport, view, nav, icons: Object.fromEntries(Object.entries(document.getElementById('node-tools').dataset).map(([k, v]) => [k.replace(/^icon/, '').toLowerCase(), v])) });
bindLibrary();

async function loadLayer(layerId) {
    await sync.flush();
    const graph = await api.graph(layerId);
    viewport.reset();
    nav.resetOrigin();
    store.hydrate(graph);
}

// Changement de plan (téléportation, navigation) : on sauvegarde puis on charge le plan cible.
store.on('layer:current', layerId => loadLayer(layerId).catch(error => { status.textContent = error.message; }));

async function boot() {
    const { layers } = await api.layers();
    let home = layers.find(l => l.kind === 'user');
    if (!home) {
        home = { id: crypto.randomUUID(), name: 'Home', index: 0, kind: 'user' };
        store.write.putLayer(home);
        await sync.flush();
    }
    store.hydrate({ layers: layers.length ? layers : [home], nodes: [], edges: [] });
    store.state.layerId = home.id;
    await loadLayer(home.id);
    document.body.classList.add('ready');
}

async function start() {
    try {
        await boot();
    } catch (error) {
        if (error.status !== 401) throw error;
        document.getElementById('login').hidden = false;
    }
}

document.getElementById('guest').addEventListener('click', async () => {
    await fetch(`${BASE}/guest/`, { credentials: 'same-origin' });
    document.getElementById('login').hidden = true;
    await boot();
});
window.addEventListener('beforeunload', () => sync.flush());
// Les commandes du canevas (barre haute, outils du node) ne gardent pas le focus : les raccourcis restent actifs.
['click', 'change'].forEach(type => document.addEventListener(type, event => {
    const control = event.target.closest?.('#toolbar button, .anchor button, .anchor select');
    if (control) control.blur();
}));

// Point d'accès du banc tests/feel : même observables que l'ancienne interface.
window.__nodzFeel = {
    snapshot: () => ({
        universe: universe.getAttribute('transform'),
        zoom: viewport.state.zoom,
        layer: store.state.layers.get(store.state.layerId)?.index + 1,
        nodes: [...store.state.nodes.values()].filter(n => n.layer === store.state.layerId).map(n => [n.id, view.transformOf(n.id)]),
        selected: [...store.state.selection],
    }),
    ringPoint: id => view.ringPoint(id),
};

start();
