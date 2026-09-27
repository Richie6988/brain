// Filtres globaux de l'univers : origine des nodes (écrits à la main, messages au Gardien, créés par
// l'IA) et période (dernière modification). Les nodes écartés et leurs liens s'estompent et ne
// captent plus la souris ; rien n'est modifié dans Nodz (une classe CSS, retirée quand tout est affiché).

import { api } from './api.js';

const ORIGINS = [['user', 'Moi'], ['message', 'Messages'], ['ai', 'IA']];
const PERIODS = [[0, 'Tout'], [1, '24 h'], [7, '7 j'], [30, '30 j']];
const DAY = 24 * 3600;

export function createFilters() {
    const state = { origins: new Set(ORIGINS.map(([key]) => key)), days: 0 };
    let nodes = {};  // N-12 → {origin, created, modified} (serveur)
    const local = new Map();  // marques posées depuis le chargement, avant la prochaine lecture
    let timer = null;

    const bar = document.createElement('div');
    bar.id = 'gardien-filters';
    const chip = (label, onclick) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick });
    const origins = ORIGINS.map(([key, label]) => {
        const b = chip(label, () => {
            // Tout affiché : un clic isole cette origine ; ensuite, chaque clic l'ajoute ou la retire.
            if (state.origins.size === ORIGINS.length) state.origins = new Set([key]);
            else if (!state.origins.delete(key)) state.origins.add(key);
            if (!state.origins.size) state.origins = new Set(ORIGINS.map(([k]) => k));
            update();
        });
        b.dataset.key = key;
        return b;
    });
    const periods = PERIODS.map(([days, label]) => {
        const b = chip(label, () => { state.days = days; update(); });
        b.dataset.days = days;
        return b;
    });
    const count = document.createElement('span');
    count.className = 'count';
    const sep = () => Object.assign(document.createElement('i'), { className: 'sep' });
    bar.append(...origins, sep(), ...periods, count);
    document.getElementById('button-container').after(bar);

    const active = () => state.days > 0 || state.origins.size < ORIGINS.length;

    function keep(node) {
        const info = nodes[node.id];
        const origin = local.get(node.id) || info?.origin || 'user';
        if (!state.origins.has(origin)) return false;
        const modified = info?.modified ?? Date.now() / 1000;  // node nouveau : il vient d'être modifié
        return !state.days || Date.now() / 1000 - modified <= state.days * DAY;
    }

    function apply() {
        const on = active();
        const hidden = new Set();
        let shown = 0;
        document.querySelectorAll('.node-group').forEach(node => {
            const out = on && !keep(node);
            node.classList.toggle('gardien-filtered', out);
            if (out) hidden.add(node.id);
            else shown += 1;
        });
        document.querySelectorAll('.link').forEach(link => {
            link.classList.toggle('gardien-filtered', hidden.has(link.getAttribute('Node1')) || hidden.has(link.getAttribute('Node2')));
        });
        count.textContent = on ? `${shown} / ${shown + hidden.size}` : '';
    }

    async function refresh() {
        try {
            nodes = (await api.request('GET', 'toolbox/marks')).nodes;
            local.clear();
        } catch { /* hors ligne : on garde la dernière lecture */ }
        apply();
    }

    function update() {
        origins.forEach(b => b.classList.toggle('on', state.origins.has(b.dataset.key)));
        periods.forEach(b => b.classList.toggle('on', Number(b.dataset.days) === state.days));
        bar.classList.toggle('active', active());
        clearInterval(timer);
        if (active()) {
            refresh();
            timer = setInterval(refresh, 15000);  // dates et marques d'autres onglets
        } else {
            apply();
        }
    }

    // Nodz ajoute et retire des nodes (chargement d'une dimension, création) : on réapplique.
    let pending = false;
    new MutationObserver(() => {
        if (!active() || pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; apply(); });
    }).observe(document.body, { childList: true, subtree: true });

    update();
    return {
        // Marque des nodes (message au Gardien, création de l'IA) côté serveur et tout de suite à l'écran.
        mark(ids, origin) {
            ids = ids.filter(Boolean);
            if (!ids.length) return;
            ids.forEach(id => {  // un message au Gardien reste un message
                const message = local.get(id) === 'message' || nodes[id]?.origin === 'message';
                local.set(id, message ? 'message' : origin);
            });
            if (active()) apply();
            api.request('POST', 'toolbox/marks', { nodes: ids, origin }).catch(() => {});
        },
    };
}
