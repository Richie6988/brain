// Sélecteur de contexte, au-dessus du dock : choisir des nodes de toutes les dimensions pour les joindre au Gardien.
// Recherche par mot-clé, auteurs à cocher (IA, utilisateurs), période au double curseur (de « toujours » à
// « maintenant », sur la création ou la dernière modification) et ordre. Les nodes gardés s'affichent en colonnes, une
// par dimension : une case par node, une case par dimension pour tout prendre ; le compteur donne les nodes, leurs
// dimensions et une estimation des jetons envoyés au modèle. Cliquer un texte y voyage. Pendant qu'il est ouvert, la
// dimension à l'écran estompe les nodes écartés et allume les nodes cochés (classes CSS, rien n'est modifié dans Nodz).

import { api } from './api.js';
import { describe } from './dataset.js';

const STEPS = 1000;  // crans du double curseur
const SHOWN = 40;  // nodes affichés par dimension (les plus récents d'abord, selon l'ordre)
const CHARS_PER_TOKEN = 3.5;
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createFilters({ onAttach = () => {} } = {}) {
    const state = { text: '', off: new Set(), lo: 0, hi: STEPS, basis: 'modified', order: -1 };
    let nodes = {};  // N-12 → {origin, created, modified, layer, text} (serveur, toutes les dimensions)
    let authors = [{ key: 'ai', label: 'IA' }, { key: 'me', label: 'Moi' }];
    let names = {};  // numéro de dimension → nom
    const local = new Map();  // marques posées depuis le chargement, avant la prochaine lecture
    const picked = new Set();  // nodes cochés pour le contexte
    const listeners = [];
    let fetched = 0;
    let open = false;

    const make = (tag, props = {}, ...children) => {
        const el = Object.assign(document.createElement(tag), props);
        el.append(...children);
        return el;
    };
    const chip = (label, onclick, props = {}) => make('button', { type: 'button', textContent: label, onclick, ...props });

    // --- Le panneau
    const panel = make('section', { id: 'gardien-context', hidden: true });
    panel.setAttribute('aria-label', 'Contexte pour le Gardien');
    const search = make('input', { type: 'search', placeholder: 'Chercher dans toutes les dimensions…', autocomplete: 'off' });
    search.addEventListener('input', () => { state.text = fold(search.value.trim()); update(); });
    ['keydown', 'keyup', 'keypress'].forEach(type => search.addEventListener(type, event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (type === 'keydown' && event.key === 'Escape') toggle(false);
    }));

    // Auteurs : liste à cocher (le dernier coché reste)
    const menu = make('div', { className: 'gx-pop', hidden: true });
    const who = chip('Auteurs ▾', () => { period.hidden = true; menu.hidden = !menu.hidden; }, { className: 'gx-drop' });
    function renderAuthors() {
        menu.replaceChildren(...authors.map(({ key, label }) => {
            const box = make('input', { type: 'checkbox', checked: !state.off.has(key) });
            box.disabled = !state.off.has(key) && state.off.size === authors.length - 1;
            box.addEventListener('change', () => {
                if (box.checked) state.off.delete(key); else state.off.add(key);
                renderAuthors();
                update();
            });
            return make('label', {}, box, ` ${label}`);
        }));
        who.textContent = `${state.off.size ? authors.filter(a => !state.off.has(a.key)).map(a => a.label).join(', ') : 'Auteurs'} ▾`;
        who.classList.toggle('on', state.off.size > 0);
    }

    // Période : double curseur (échelle resserrée vers le présent) et base créés / modifiés
    const lo = make('input', { type: 'range', min: 0, max: STEPS, value: 0, className: 'lo' });
    const hi = make('input', { type: 'range', min: 0, max: STEPS, value: STEPS, className: 'hi' });
    const track = make('i', { className: 'track' });
    const span = make('span', { className: 'gx-span' });
    const basis = chip('modifiés', () => { state.basis = state.basis === 'modified' ? 'created' : 'modified'; update(); }, { className: 'gx-basis' });
    const period = make('div', { className: 'gx-pop gx-period', hidden: true }, make('span', { className: 'gx-range' }, track, lo, hi), span, basis);
    [lo, hi].forEach(input => input.addEventListener('input', () => {
        if (Number(lo.value) > Number(hi.value)) (input === lo ? hi : lo).value = input.value;
        state.lo = Number(lo.value);
        state.hi = Number(hi.value);
        update();
    }));
    const when = chip('Période ▾', () => { menu.hidden = true; period.hidden = !period.hidden; }, { className: 'gx-drop' });
    const order = chip('Récents', () => { state.order = -state.order; update(); }, { className: 'gx-order', title: 'Ordre des nodes dans chaque dimension' });
    const close = chip('×', () => toggle(false), { className: 'gx-close', title: 'Fermer (Échap)' });
    const head = make('div', { className: 'gx-head' }, search, make('span', { className: 'gx-wrap' }, who, menu),
        make('span', { className: 'gx-wrap' }, when, period), order, close);

    const columns = make('div', { className: 'gx-cols' });
    const count = make('span', { className: 'gx-count' });
    const all = chip('Tout', () => { walk().forEach(hit => picked.add(hit.id)); render(); }, { title: 'Cocher tous les nodes gardés' });
    const none = chip('Aucun', () => { picked.clear(); render(); });
    const join = chip('Joindre au Gardien', () => attach(), { className: 'gx-join' });
    panel.append(head, columns, make('div', { className: 'gx-foot' }, count, all, none, join));
    document.body.append(panel);
    document.addEventListener('mousedown', event => {
        if (!menu.contains(event.target) && event.target !== who) menu.hidden = true;
        if (!period.contains(event.target) && event.target !== when) period.hidden = true;
        // Un clic hors du panneau le ferme ; les nodes cochés partent au Gardien, sans passer par « Joindre ».
        if (open && !panel.contains(event.target) && !button.contains(event.target)) finish();
    }, true);

    // Bouton « Filtres » du dock, à côté de la recherche
    const button = make('button', { type: 'button', id: 'gardien-context-button', className: 'menuBtn', title: 'Filtres' });
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z"/></svg>';  // entonnoir
    button.addEventListener('click', () => (open ? finish() : toggle(true)));
    document.getElementById('nextsearch')?.after(button);

    function toggle(on = !open) {
        open = on;
        panel.hidden = !on;
        button.classList.toggle('on', on);
        if (on) {
            selectedNodes.forEach(node => picked.add(node.id));  // la sélection de l'univers arrive cochée
            refresh();
            search.focus();
        } else {
            menu.hidden = period.hidden = true;
        }
        apply();
    }

    // --- Filtres
    const now = () => Date.now() / 1000;
    const earliest = () => Math.min(now() - 3600, ...Object.values(nodes).map(n => n[state.basis] || now()));
    const at = position => now() - (now() - earliest()) * ((STEPS - position) / STEPS) ** 2;  // plus fin près de maintenant
    const ago = seconds => {
        const s = now() - seconds;
        if (s < 5) return "à l'instant";
        if (s < 60) return `il y a ${Math.round(s)} s`;
        if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
        if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
        if (s < 30 * 86400) return `il y a ${Math.round(s / 86400)} j`;
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

    // Les nodes gardés de toutes les dimensions (la dimension ouverte telle qu'à l'écran), dans l'ordre choisi.
    function walk() {
        const here = typeof layerNumber !== 'undefined' ? Number(layerNumber) : null;
        const seen = new Set();
        const list = [];
        document.querySelectorAll('.node-group').forEach(node => {
            seen.add(node.id);
            const text = liveText(node).trim();
            if (keeps(node.id, text)) list.push({ id: node.id, layer: here, text });
        });
        Object.entries(nodes).forEach(([id, info]) => {
            if (!seen.has(id) && Number(info.layer) !== here && keeps(id, info.text || '')) list.push({ id, layer: Number(info.layer), text: info.text || '' });
        });
        const date = id => nodes[id]?.[state.basis] ?? now();
        return list.sort((a, b) => state.order * (date(a.id) - date(b.id)));
    }

    function travel(hit) {
        const node = document.getElementById(hit.id);
        if (node && hit.layer === Number(layerNumber)) focusNode(node, true);
        else load(hit.layer, hit.id);
    }

    function render() {
        const list = walk();
        const byLayer = new Map();
        list.forEach(hit => { if (!byLayer.has(hit.layer)) byLayer.set(hit.layer, []); byLayer.get(hit.layer).push(hit); });
        const here = Number(layerNumber);
        const layers = [...byLayer.keys()].sort((a, b) => (a === here ? -1 : b === here ? 1 : a - b));  // la dimension ouverte d'abord
        columns.replaceChildren(...(layers.length ? layers.map(layer => {
            const hits = byLayer.get(layer);
            const box = make('input', { type: 'checkbox', checked: hits.every(hit => picked.has(hit.id)) });
            box.indeterminate = !box.checked && hits.some(hit => picked.has(hit.id));
            box.addEventListener('change', () => { hits.forEach(hit => (box.checked ? picked.add(hit.id) : picked.delete(hit.id))); render(); });
            const title = make('label', { className: 'gx-dim' }, box, make('b', { textContent: names[layer] || `Dimension ${layer}` }),
                make('small', { textContent: ` ${hits.length}` }));
            const items = hits.slice(0, SHOWN).map(hit => {
                const check = make('input', { type: 'checkbox', checked: picked.has(hit.id) });
                check.addEventListener('change', () => { if (check.checked) picked.add(hit.id); else picked.delete(hit.id); render(); });
                const info = nodes[hit.id];
                const text = make('button', { type: 'button', className: 'gx-text', textContent: hit.text.slice(0, 80) || '(vide)',
                    title: `${hit.text.slice(0, 300)}${info ? `\n${state.basis === 'created' ? 'créé' : 'modifié'} ${ago(info[state.basis])}` : ''}\nCliquer : y aller` });
                text.addEventListener('click', () => travel(hit));
                return make('div', { className: `gx-item${picked.has(hit.id) ? ' on' : ''}` }, check, text);
            });
            const more = hits.length > SHOWN ? [make('p', { className: 'gx-more', textContent: `+ ${hits.length - SHOWN} (affine la recherche)` })] : [];
            return make('div', { className: `gx-col${layer === here ? ' here' : ''}` }, title, make('div', { className: 'gx-list' }, ...items, ...more));
        }) : [make('p', { className: 'gx-empty', textContent: 'Aucun node ne correspond.' })]));
        const chosen = [...picked];
        const dims = new Set(chosen.map(id => layerOf(id)));
        const chars = chosen.reduce((sum, id) => sum + textOf(id).length + 40, 0);  // + l'objet autour du texte
        count.textContent = chosen.length ? `${chosen.length} node${chosen.length > 1 ? 's' : ''} · ${dims.size} dim. · ~${Math.round(chars / CHARS_PER_TOKEN)} jetons`
            : `${list.length} node${list.length > 1 ? 's' : ''} trouvé${list.length > 1 ? 's' : ''} : coche ceux à joindre`;
        join.disabled = !chosen.length;
        highlight();
    }
    const layerOf = id => (document.getElementById(id) ? Number(layerNumber) : Number(nodes[id]?.layer));
    const textOf = id => { const node = document.getElementById(id); return node ? liveText(node) : nodes[id]?.text || ''; };

    // Fermer en gardant la sélection en cours : jointe au Gardien s'il y en a une (× et Échap ferment sans joindre).
    function finish() {
        if (picked.size) attach();
        else toggle(false);
    }

    // Export (bouton Importer / Exporter du dock) : les nodes cochés, sinon ceux que les filtres gardent ; dimension,
    // texte, auteur, dates, et pour la dimension à l'écran aussi type, couleur, position, rappel, liens.
    function exportRows() {
        const ids = picked.size ? [...picked] : walk().map(hit => hit.id);
        const day = seconds => (seconds ? new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') : '');
        const rows = ids.map(id => {
            const info = nodes[id] || {}, node = document.getElementById(id), layer = layerOf(id);
            return { ...(node ? describe(node) : { id, texte: textOf(id).trim() }), dimension: names[layer] || layer,
                auteur: (local.get(id) || info.origin) === 'ai' ? 'IA' : 'humain', 'créé': day(info.created), 'modifié': day(info.modified) };
        });
        return rows;
    }

    function attach() {
        const items = [...picked].map(id => ({ id, text: textOf(id).trim(), layer: layerOf(id) }));
        if (!items.length) return;
        onAttach(items);
        picked.clear();
        toggle(false);
    }

    // Dans la dimension à l'écran : nodes écartés estompés, nodes cochés allumés (seulement panneau ouvert).
    function highlight() {
        document.querySelectorAll('.node-group').forEach(node => node.classList.toggle('gardien-picked', open && picked.has(node.id)));
    }
    function apply() {
        const on = open && active();
        const hidden = new Set();
        document.querySelectorAll('.node-group').forEach(node => {
            const out = on && !node.contains(document.activeElement) && !keeps(node.id, liveText(node));
            node.classList.toggle('gardien-filtered', out);
            if (out) hidden.add(node.id);
        });
        document.querySelectorAll('.link').forEach(link => {
            link.classList.toggle('gardien-filtered', hidden.has(link.getAttribute('Node1')) || hidden.has(link.getAttribute('Node2')));
        });
        if (open) render(); else highlight();
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
        track.style.setProperty('--lo', `${(state.lo / STEPS) * 100}%`);
        track.style.setProperty('--hi', `${(state.hi / STEPS) * 100}%`);
        basis.textContent = state.basis === 'modified' ? 'modifiés' : 'créés';
        when.classList.toggle('on', ranged());
        when.textContent = ranged() ? `${span.textContent} ▾` : 'Période ▾';
        order.textContent = state.order === -1 ? 'Récents' : 'Anciens';
        if (open && Date.now() - fetched > 15000) refresh(); else apply();
    }

    // Nodz ajoute et retire des nodes (chargement d'une dimension, création) : on réapplique.
    let pending = false;
    new MutationObserver(() => {
        if (!open || pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; apply(); });
    }).observe(typeof universe !== 'undefined' ? universe : document.body, { childList: true, subtree: true });

    renderAuthors();
    update();
    return {
        // Vue de côté : même filtre sur ses répliques, réappliqué à chaque changement (onChange).
        active: () => open && active(),
        refined: () => active() || picked.size > 0,  // des filtres posés ou des nodes cochés : l'export « Filtres » a un sens
        exportRows,
        keeps,
        onChange: listener => listeners.push(listener),
        toggle,
        // Marque des nodes (message au Gardien, création de l'IA) côté serveur et tout de suite dans les filtres.
        mark(ids, origin) {
            ids = ids.filter(Boolean);
            if (!ids.length) return;
            ids.forEach(id => {  // un message au Gardien reste un message
                const message = local.get(id) === 'message' || nodes[id]?.origin === 'message';
                local.set(id, message ? 'message' : origin);
            });
            if (open) apply();
            api.request('POST', 'toolbox/marks', { nodes: ids, origin }).catch(() => {});
        },
    };
}
