// Filtres globaux de l'univers : texte (le même champ que la recherche de la barre du bas), origine des
// nodes (écrits à la main ou créés par l'IA) et période (dernière modification). Les nodes écartés et
// leurs liens s'estompent et ne captent plus la souris ; rien n'est modifié dans Nodz (une classe CSS,
// retirée quand tout est affiché).

import { api } from './api.js';

const ORIGINS = [['user', 'Moi'], ['ai', 'IA']];  // un message au Gardien compte comme écrit à la main
const PERIODS = [[0, 'Tout'], [1, '24 h'], [7, '7 j'], [30, '30 j']];
const DAY = 24 * 3600;
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function createFilters() {
    const state = { origins: new Set(ORIGINS.map(([key]) => key)), days: 0, text: '' };
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
    // Champ de recherche : filtre en direct et reste le même texte que la recherche de la barre du bas
    // (Entrée y lance la recherche de Nodz, avec ses flèches précédent / suivant).
    const bottom = document.getElementById('semanticsearch');
    const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Rechercher…', autocomplete: 'off' });
    search.setAttribute('aria-label', 'Filtrer les nodes par texte');
    const typed = value => { state.text = fold(value.trim()); update(); };
    search.addEventListener('input', () => { bottom.value = search.value; typed(search.value); });
    search.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Enter' && search.value.trim()) searchrequest([{ search: search.value }]);
        if (event.key === 'Escape') { search.value = bottom.value = ''; typed(''); search.blur(); }
    });
    search.addEventListener('keyup', event => event.stopPropagation());
    bottom.addEventListener('input', () => { search.value = bottom.value; typed(bottom.value); });
    bar.append(search, sep(), ...origins, sep(), ...periods, count);
    document.getElementById('button-container').after(bar);

    const active = () => state.days > 0 || state.origins.size < ORIGINS.length || !!state.text;
    const dated = () => state.days > 0 || state.origins.size < ORIGINS.length;  // besoin des marques du serveur

    function keep(node) {
        if (node.contains(document.activeElement)) return true;  // le node en cours d'écriture reste visible
        if (state.text && !fold(node.children[0]?.children[0]?.innerText || '').includes(state.text)) return false;
        const info = nodes[node.id];
        const found = local.get(node.id) || info?.origin || 'user';
        if (!state.origins.has(found === 'message' ? 'user' : found)) return false;
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
        if (dated()) {
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
