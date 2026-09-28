// Filtres de l'univers, sur toutes les dimensions : mot-clé, auteurs à cocher (IA, utilisateurs) et période au double
// curseur (de « depuis toujours » à « à l'instant »), sur la date de création ou de dernière modification. Dans la
// dimension ouverte, les nodes écartés et leurs liens s'estompent (une classe CSS, rien n'est modifié dans Nodz).
// Les nodes gardés de toutes les dimensions forment une liste, du plus récent au plus ancien ou l'inverse : ‹ ›
// (ou Entrée / Maj+Entrée dans la recherche) mènent de l'un à l'autre, en changeant de dimension quand il le faut.

import { api } from './api.js';

const DAY = 24 * 3600;
const STEPS = 1000;  // crans du double curseur
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createFilters() {
    const state = { text: '', off: new Set(), lo: 0, hi: STEPS, basis: 'modified', order: -1 };
    let nodes = {};  // N-12 → {origin, created, modified, layer, text} (serveur, toutes les dimensions)
    let authors = [{ key: 'ai', label: 'IA' }, { key: 'me', label: 'Moi' }];
    let names = {};  // numéro de dimension → nom
    const local = new Map();  // marques posées depuis le chargement, avant la prochaine lecture
    const listeners = [];
    let timer = null;
    let fetched = 0;  // dernière lecture du serveur

    const bar = document.createElement('div');
    bar.id = 'gardien-filters';
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const chip = (label, onclick, props = {}) => make('button', { type: 'button', textContent: label, onclick, ...props });

    // Recherche par mot-clé, dans toutes les dimensions
    const search = make('input', { type: 'search', placeholder: 'Rechercher…', autocomplete: 'off' });
    search.setAttribute('aria-label', 'Rechercher dans toutes les dimensions');
    search.addEventListener('input', () => { state.text = fold(search.value.trim()); update(); });
    search.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
        if (event.key === 'Escape') { search.value = ''; state.text = ''; update(); search.blur(); }
    });
    search.addEventListener('keyup', event => event.stopPropagation());

    // Auteurs : une liste à cocher (IA, utilisateurs)
    const who = chip('Auteurs ▾', () => { menu.hidden = !menu.hidden; }, { className: 'who', title: 'Qui a écrit les nodes' });
    const menu = make('div', { className: 'gf-menu', hidden: true });
    const whoWrap = make('span', { className: 'gf-who' });
    whoWrap.append(who, menu);
    function renderAuthors() {
        menu.replaceChildren(...authors.map(({ key, label }) => {
            const box = make('input', { type: 'checkbox', checked: !state.off.has(key) });
            box.disabled = !state.off.has(key) && state.off.size === authors.length - 1;  // au moins un auteur reste coché
            box.addEventListener('change', () => {
                if (box.checked) state.off.delete(key); else state.off.add(key);
                renderAuthors();
                update();
            });
            const line = make('label');
            line.append(box, ` ${label}`);
            return line;
        }));
        who.textContent = state.off.size ? `${authors.filter(a => !state.off.has(a.key)).map(a => a.label).join(', ')} ▾` : 'Auteurs ▾';
    }
    document.addEventListener('mousedown', event => { if (!whoWrap.contains(event.target)) menu.hidden = true; }, true);

    // Période : double curseur, du plus ancien node à maintenant (échelle resserrée vers le présent)
    const lo = make('input', { type: 'range', min: 0, max: STEPS, value: 0, className: 'lo', title: 'Depuis' });
    const hi = make('input', { type: 'range', min: 0, max: STEPS, value: STEPS, className: 'hi', title: "Jusqu'à" });
    const span = make('span', { className: 'gf-span' });
    const range = make('span', { className: 'gf-range' });
    const track = make('i', { className: 'track' });
    range.append(track, lo, hi);
    [lo, hi].forEach(input => input.addEventListener('input', () => {
        if (Number(lo.value) > Number(hi.value)) (input === lo ? hi : lo).value = input.value;
        state.lo = Number(lo.value);
        state.hi = Number(hi.value);
        update();
    }));
    const basis = chip('modifiés', () => { state.basis = state.basis === 'modified' ? 'created' : 'modified'; update(); },
        { className: 'basis', title: 'La période et l\'ordre suivent la dernière modification ou la création' });

    // Ordre et parcours de toutes les dimensions
    const newest = chip('Récent', () => { state.order = -1; walk.index = -1; update(); step(1); }, { title: 'Du plus récent au plus ancien' });
    const oldest = chip('Ancien', () => { state.order = 1; walk.index = -1; update(); step(1); }, { title: 'Du plus ancien au plus récent' });
    const back = chip('‹', () => step(-1), { className: 'nav', title: 'Précédent (Maj+Entrée)' });
    const ahead = chip('›', () => step(1), { className: 'nav', title: 'Suivant (Entrée)' });
    const where = make('span', { className: 'where' });
    const count = make('span', { className: 'count' });
    const sep = () => make('i', { className: 'sep' });
    bar.append(search, back, ahead, where, sep(), whoWrap, sep(), range, span, basis, sep(), newest, oldest, count);
    document.getElementById('button-container').after(bar);

    const now = () => Date.now() / 1000;
    const earliest = () => Math.min(now() - 3600, ...Object.values(nodes).map(n => n[state.basis] || now()));
    const at = position => now() - (now() - earliest()) * ((STEPS - position) / STEPS) ** 2;  // plus fin près de maintenant
    const ago = seconds => {
        const minutes = Math.round((now() - seconds) / 60);
        if (now() - seconds < 60) return now() - seconds < 5 ? "à l'instant" : `il y a ${Math.round(now() - seconds)} s`;
        if (minutes < 60) return `il y a ${minutes} min`;
        if (minutes < 1440) return `il y a ${Math.round(minutes / 60)} h`;
        if (minutes < 30 * 1440) return `il y a ${Math.round(minutes / 1440)} j`;
        return new Date(seconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const ranged = () => state.lo > 0 || state.hi < STEPS;
    const active = () => !!state.text || state.off.size > 0 || ranged();

    // Un node (id, texte) passe-t-il les filtres ? Aussi pour la vue de côté.
    function keeps(id, text) {
        if (state.text && !fold(text).includes(state.text)) return false;
        const info = nodes[id];
        const origin = local.get(id) || info?.origin || 'user';
        if (state.off.has(origin === 'ai' ? 'ai' : 'me')) return false;
        if (!ranged()) return true;
        const date = info?.[state.basis] ?? now();  // node nouveau : il vient d'être créé et modifié
        return date >= at(state.lo) - 1 && date <= at(state.hi) + 1;
    }
    const liveText = node => node.children[0]?.children[0]?.innerText || '';
    function keep(node) {
        if (node.contains(document.activeElement)) return true;  // le node en cours d'écriture reste visible
        return keeps(node.id, liveText(node));
    }

    // Les nodes gardés de toutes les dimensions (la dimension ouverte telle qu'à l'écran), dans l'ordre choisi.
    const walk = { list: [], index: -1 };
    function matches() {
        const here = typeof layerNumber !== 'undefined' ? layerNumber : null;
        const seen = new Set();
        const list = [];
        document.querySelectorAll('.node-group').forEach(node => {
            seen.add(node.id);
            if (keep(node)) list.push({ id: node.id, layer: Number(here) });
        });
        Object.entries(nodes).forEach(([id, info]) => {
            if (!seen.has(id) && Number(info.layer) !== Number(here) && keeps(id, info.text || '')) list.push({ id, layer: Number(info.layer) });
        });
        const date = id => nodes[id]?.[state.basis] ?? now();
        return list.sort((a, b) => state.order * (date(a.id) - date(b.id)));
    }
    function step(direction) {
        const list = walk.list;
        if (!list.length) return;
        walk.index = ((walk.index + direction) % list.length + list.length) % list.length;
        const hit = list[walk.index];
        const info = nodes[hit.id];
        where.textContent = `${walk.index + 1} / ${list.length}${hit.layer !== Number(layerNumber) ? ` · ${names[hit.layer] || `dimension ${hit.layer}`}` : ''}`;
        where.title = `${info?.text || ''}${info ? `\n${state.basis === 'created' ? 'créé' : 'modifié'} ${ago(info[state.basis])}` : ''}`;
        const node = document.getElementById(hit.id);
        if (node && hit.layer === Number(layerNumber)) focusNode(node, true);
        else load(hit.layer, hit.id);
    }

    function apply() {
        const on = active();
        const hidden = new Set();
        document.querySelectorAll('.node-group').forEach(node => {
            const out = on && !keep(node);
            node.classList.toggle('gardien-filtered', out);
            if (out) hidden.add(node.id);
        });
        document.querySelectorAll('.link').forEach(link => {
            link.classList.toggle('gardien-filtered', hidden.has(link.getAttribute('Node1')) || hidden.has(link.getAttribute('Node2')));
        });
        walk.list = matches();
        walk.index = Math.min(walk.index, walk.list.length - 1);
        const dimensions = new Set(walk.list.map(hit => hit.layer)).size;
        count.textContent = on ? `${walk.list.length} node${walk.list.length > 1 ? 's' : ''} · ${dimensions} dim.` : '';
        back.hidden = ahead.hidden = !on || walk.list.length < 1;
        if (!on) where.textContent = '';
        listeners.forEach(listener => listener());
    }

    async function refresh() {
        fetched = Date.now();
        try {
            const data = await api.request('GET', 'toolbox/marks');
            nodes = data.nodes;
            authors = data.authors || authors;
            names = data.layers || names;
            local.clear();
            renderAuthors();
        } catch { /* hors ligne : on garde la dernière lecture */ }
        apply();
    }

    function update() {
        span.textContent = `${state.lo === 0 ? 'toujours' : ago(at(state.lo))} → ${state.hi === STEPS ? 'maintenant' : ago(at(state.hi))}`;
        span.title = 'Période : de « depuis toujours » à « à l\'instant »';
        track.style.setProperty('--lo', `${(state.lo / STEPS) * 100}%`);
        track.style.setProperty('--hi', `${(state.hi / STEPS) * 100}%`);
        basis.textContent = state.basis === 'modified' ? 'modifiés' : 'créés';
        newest.classList.toggle('on', state.order === -1);
        oldest.classList.toggle('on', state.order === 1);
        bar.classList.toggle('active', active());
        clearInterval(timer);
        if (active()) timer = setInterval(refresh, 15000);  // dates et marques d'autres onglets
        // Un filtre qui s'active relit toutes les dimensions (nodes créés depuis) ; sinon, filtrage instantané.
        if (active() && Date.now() - fetched > 5000) refresh(); else apply();
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

    renderAuthors();
    update();
    refresh();  // dates, auteurs et textes de toutes les dimensions
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
