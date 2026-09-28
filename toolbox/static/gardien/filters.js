// Filtres globaux de l'univers : texte (avec la recherche dans toutes les dimensions), origine des
// nodes (écrits à la main ou créés par l'IA) et période, sur la date de création ou de dernière modification.
// Les nodes écartés et leurs liens s'estompent et ne captent plus la souris ; rien n'est modifié dans Nodz (une
// classe CSS, retirée quand tout est affiché). Parcours chronologique : « Récents » ou « Anciens » mène de node
// en node (‹ ›) dans l'ordre de la date choisie, parmi ceux que les filtres gardent.

import { api } from './api.js';

const ORIGINS = [['user', 'Moi'], ['ai', 'IA']];  // un message au Gardien compte comme écrit à la main
const PERIODS = [[0, 'Tout'], [1 / 24, '1 h'], [1, '24 h'], [7, '7 j'], [30, '30 j'], [365, '1 an']];
const BASES = [['modified', 'Modifiés'], ['created', 'Créés']];
const DAY = 24 * 3600;
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function createFilters() {
    const state = { origins: new Set(ORIGINS.map(([key]) => key)), days: 0, text: '', basis: 'modified' };
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
    const bases = BASES.map(([key, label]) => {
        const b = chip(label, () => { state.basis = key; update(); });
        b.dataset.basis = key;
        b.title = key === 'created' ? 'La période et le parcours suivent la date de création' : 'La période et le parcours suivent la dernière modification';
        return b;
    });
    // Parcours chronologique
    const walk = { dir: 0, list: [], index: -1 };
    const newest = chip('Récents', () => startWalk(-1));
    const oldest = chip('Anciens', () => startWalk(1));
    newest.title = 'Du plus récent au plus ancien : ‹ › pour avancer';
    oldest.title = 'Du plus ancien au plus récent : ‹ › pour avancer';
    const back = Object.assign(chip('‹', () => stepWalk(-1)), { className: 'nav', hidden: true, title: 'Node précédent dans le temps' });
    const ahead = Object.assign(chip('›', () => stepWalk(1)), { className: 'nav', hidden: true, title: 'Node suivant dans le temps' });
    const moment = Object.assign(document.createElement('span'), { className: 'where' });
    const count = document.createElement('span');
    count.className = 'count';
    const sep = () => Object.assign(document.createElement('i'), { className: 'sep' });
    // Recherche (celle de la barre du bas y est reprise) : filtre en direct les nodes de la dimension ; Entrée
    // cherche dans toutes les dimensions et parcourt les résultats en carrousel (‹ ›, Entrée / Maj+Entrée),
    // en voyageant vers la dimension du résultat quand il le faut.
    const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Rechercher…', autocomplete: 'off' });
    search.setAttribute('aria-label', 'Rechercher dans toutes les dimensions');
    const found = { query: '', results: [], index: -1 };
    const arrow = (text, title, step) => Object.assign(document.createElement('button'), { type: 'button', className: 'nav', textContent: text, title,
        hidden: true, onclick: () => move(step) });
    const prev = arrow('‹', 'Résultat précédent (Maj+Entrée)', -1);
    const next = arrow('›', 'Résultat suivant (Entrée)', 1);
    const where = Object.assign(document.createElement('span'), { className: 'where' });
    const typed = value => { state.text = fold(value.trim()); update(); };
    search.addEventListener('input', () => typed(search.value));
    search.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Enter') lookup(event.shiftKey ? -1 : 1);
        if (event.key === 'Escape') { search.value = ''; typed(''); showResults({ query: '', results: [], index: -1 }); search.blur(); }
    });
    search.addEventListener('keyup', event => event.stopPropagation());

    async function lookup(step) {
        const query = search.value.trim();
        if (!query) return;
        if (query !== found.query) {
            try {
                const { results } = await api.request('GET', `toolbox/search?${new URLSearchParams({ q: query })}`);
                showResults({ query, results, index: -1 });
            } catch {
                return;
            }
        }
        move(step);
    }
    function showResults(value) {
        Object.assign(found, value);
        prev.hidden = next.hidden = found.results.length < 2;
        where.textContent = found.query && !found.results.length ? 'aucun résultat' : '';
    }
    // Carrousel : du dernier au premier et inversement ; un résultat d'une autre dimension y emmène.
    function move(step) {
        const n = found.results.length;
        if (!n) return;
        found.index = ((found.index + step) % n + n) % n;
        const hit = found.results[found.index];
        where.textContent = `${found.index + 1} / ${n}${hit.dimension ? ` · ${hit.dimension}` : ''}`;
        where.title = hit.text;
        const node = document.getElementById(hit.id);
        if (node && hit.layer === layerNumber) {
            focusNode(node, true);
        } else {
            load(hit.layer, hit.id);
        }
    }
    bar.append(search, prev, next, where, sep(), ...origins, sep(), ...periods, sep(), ...bases, sep(), newest, oldest, back, ahead, moment, count);

    const dateOf = id => (nodes[id]?.[state.basis] ?? Date.now() / 1000);  // node pas encore sauvé : maintenant
    const ago = seconds => {
        const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
        if (minutes < 60) return minutes < 1 ? "à l'instant" : `il y a ${minutes} min`;
        if (minutes < 1440) return `il y a ${Math.round(minutes / 60)} h`;
        return new Date(seconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    async function startWalk(dir) {
        if (walk.dir === dir) return stopWalk();  // second clic : on arrête
        await refresh();
        const kept = [...document.querySelectorAll('.node-group')].filter(n => !n.classList.contains('gardien-filtered'));
        walk.list = kept.map(n => n.id).sort((a, b) => dir * (dateOf(a) - dateOf(b)));
        Object.assign(walk, { dir, index: -1 });
        newest.classList.toggle('on', dir === -1);
        oldest.classList.toggle('on', dir === 1);
        back.hidden = ahead.hidden = walk.list.length < 2;
        stepWalk(1);
    }
    function stepWalk(step) {
        const n = walk.list.length;
        if (!n) return stopWalk();
        walk.index = Math.min(n - 1, Math.max(0, walk.index + step));
        const id = walk.list[walk.index];
        const verb = state.basis === 'created' ? 'créé' : 'modifié';
        moment.textContent = `${walk.index + 1} / ${n} · ${verb} ${ago(dateOf(id))}`;
        back.disabled = walk.index === 0;
        ahead.disabled = walk.index === n - 1;
        const node = document.getElementById(id);
        if (node) focusNode(node, true);
    }
    function stopWalk() {
        Object.assign(walk, { dir: 0, list: [], index: -1 });
        [newest, oldest].forEach(b => b.classList.remove('on'));
        back.hidden = ahead.hidden = true;
        moment.textContent = '';
    }
    document.getElementById('button-container').after(bar);

    const active = () => state.days > 0 || state.origins.size < ORIGINS.length || !!state.text;
    const dated = () => state.days > 0 || state.origins.size < ORIGINS.length;  // besoin des marques du serveur

    function keep(node) {
        if (node.contains(document.activeElement)) return true;  // le node en cours d'écriture reste visible
        return keeps(node.id, node.children[0]?.children[0]?.innerText || '');
    }
    // Un node (id, texte) passe-t-il les filtres ? Aussi pour les répliques de la vue de côté, toutes dimensions.
    function keeps(id, text) {
        if (state.text && !fold(text).includes(state.text)) return false;
        const info = nodes[id];
        const found = local.get(id) || info?.origin || 'user';
        if (!state.origins.has(found === 'message' ? 'user' : found)) return false;
        const date = info?.[state.basis] ?? Date.now() / 1000;  // node nouveau : il vient d'être créé et modifié
        return !state.days || Date.now() / 1000 - date <= state.days * DAY;
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
        listeners.forEach(listener => listener());
    }
    const listeners = [];

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
        bases.forEach(b => b.classList.toggle('on', b.dataset.basis === state.basis));
        if (walk.dir) stopWalk();  // les filtres ont changé : le parcours repart d'un clic
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

    // Lecteur de document : quand l'aperçu d'un node Fichier (iframe PDF) passe sous la barre, elle s'efface pour
    // laisser ses boutons (pages, zoom, téléchargement) cliquables ; elle revient dès qu'on s'en éloigne.
    setInterval(() => {
        const zone = bar.getBoundingClientRect();
        const under = [...document.querySelectorAll('.node-group .filepreview')].some(frame => {
            if (frame.style.display === 'none') return false;
            const r = frame.getBoundingClientRect();
            return r.width > 0 && r.top < zone.bottom + 8 && r.bottom > zone.top && r.left < zone.right && r.right > zone.left;
        });
        bar.classList.toggle('viewer', under);
    }, 300);

    update();
    return {
        // Vue de côté : même filtre sur ses répliques, réappliqué à chaque changement (onChange).
        active,
        keeps,
        onChange: listener => listeners.push(listener),
        counted: (shown, total) => { count.textContent = active() ? `${shown} / ${total}` : ''; },
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
