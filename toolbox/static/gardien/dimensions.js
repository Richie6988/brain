// Liste des dimensions de Nodz, enrichie sans la réécrire : champ de recherche (Entrée ouvre la première
// trouvée), dimensions épinglées en tête (gardées sur le serveur), nombre de nodes de chacune. Nodz
// redessine la liste (renderLayers) ; on la complète à chaque fois.

import { api } from './api.js';

const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createDimensions() {
    const list = document.getElementById('dropdown-content');
    let pinned = [];
    let counts = {};
    let query = '';
    let busy = false;

    const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Chercher une dimension…', autocomplete: 'off' });
    search.className = 'gd-search';
    search.setAttribute('aria-label', 'Chercher une dimension');
    const empty = Object.assign(document.createElement('p'), { className: 'gd-empty', textContent: 'Aucune dimension de ce nom.' });

    ['keydown', 'keyup', 'keypress'].forEach(type => search.addEventListener(type, event => event.stopPropagation()));
    search.addEventListener('click', event => event.stopPropagation());
    search.addEventListener('input', () => { query = fold(search.value.trim()); filter(); });
    search.addEventListener('keydown', event => {
        if (event.key === 'Enter') items().find(item => !item.hidden)?.click();
        if (event.key === 'Escape') { search.value = ''; query = ''; filter(); }
    });

    const items = () => [...list.querySelectorAll('.dropdown-item[data-layer]')];

    function filter() {
        let shown = 0;
        items().forEach(item => {
            item.hidden = !!query && !fold(item.dataset.name).includes(query);
            if (!item.hidden) shown += 1;
        });
        empty.hidden = !query || shown > 0;
    }

    async function save() {
        try {
            ({ pinned, counts } = await api.request('PATCH', 'toolbox/dimensions', { pinned }));
        } catch { /* hors ligne : l'épingle reste pour cette page */ }
        renderLayers();
    }

    // Complète la liste que Nodz vient de dessiner : même ordre que `layers` (la dimension courante en tête).
    function decorate() {
        const rows = [...list.children].filter(el => el.classList.contains('dropdown-item') && !el.classList.contains('new'));
        if (!rows.length || rows[0].dataset.layer) return;
        busy = true;
        rows.forEach((row, i) => {
            const layer = layers[i];
            if (!layer) return;
            row.dataset.layer = layer.id;
            row.dataset.name = layer.name;
            const on = pinned.includes(layer.id);
            row.classList.toggle('pinned', on);
            const pin = Object.assign(document.createElement('button'), { type: 'button', className: `gd-pin ${on ? 'on' : ''}`,
                title: on ? 'Désépingler' : 'Épingler en tête de liste' });
            pin.addEventListener('click', event => {
                event.stopPropagation();  // pas de voyage vers la dimension
                pinned = on ? pinned.filter(id => id !== layer.id) : [...pinned, layer.id];
                save();
            });
            const count = Object.assign(document.createElement('small'), { className: 'gd-count', textContent: counts[layer.id] ?? '' });
            count.title = 'nodes';
            row.prepend(pin);
            row.querySelector('.icon')?.before(count);
        });
        // Ordre : la dimension courante, les épinglées (ordre d'épinglage), puis les autres.
        const current = rows[0];
        const pins = pinned.map(id => rows.find(r => Number(r.dataset.layer) === id)).filter(r => r && r !== current);
        let anchor = current;
        pins.forEach(row => { anchor.after(row); anchor = row; });
        if (pins.length) anchor.classList.add('gd-last-pin');
        list.querySelector('.new')?.after(search);
        list.append(empty);
        filter();
        busy = false;
    }

    new MutationObserver(() => { if (!busy) decorate(); }).observe(list, { childList: true });
    // Un clic en dehors de la liste (et de son bouton) la referme, comme un menu.
    document.addEventListener('mousedown', event => {
        if (list.style.display === 'block' && !list.contains(event.target) && !event.target.closest?.('.dropdown-button')) list.style.display = 'none';
    }, true);
    // À l'ouverture : nombres à jour et curseur dans la recherche.
    document.querySelector('.dropdown-button').addEventListener('click', () => {
        if (list.style.display !== 'block') return;
        search.value = '';
        query = '';
        refresh().then(() => search.focus());  // après le nouveau rendu, qui replace le champ
    });

    async function refresh() {
        try {
            ({ pinned, counts } = await api.request('GET', 'toolbox/dimensions'));
        } catch {
            return;
        }
        if (typeof selectedLayer !== 'undefined' && selectedLayer) renderLayers();
    }
    refresh();
}
