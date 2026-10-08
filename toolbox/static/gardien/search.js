// Recherche du dock : Entrée cherche dans toutes les dimensions (route toolbox/search, score de la recherche de Nodz),
// puis ‹ › (ou Entrée / Maj+Entrée) parcourent les résultats en carrousel. Le compteur dit « x / y » (et la dimension
// quand le résultat est ailleurs) ; le résultat courant s'allume et la caméra y voyage, dimension comprise.
// Échap ou un champ vidé éteint la recherche.

import { api } from './api.js';
import { t } from './i18n.js';

export function createSearch({ bridge }) {
    const input = document.getElementById('semanticsearch');
    const back = document.getElementById('prevsearch');
    const ahead = document.getElementById('nextsearch');
    input.placeholder = t('search.ph');
    input.setAttribute('aria-label', t('search.label'));
    back.dataset.label = t('search.prev');
    ahead.dataset.label = t('search.next');
    const count = Object.assign(document.createElement('span'), { id: 'gardien-search-count' });
    ahead.after(count);

    let results = [], index = -1, query = '';

    function light(id) {
        document.querySelectorAll('.node-group.gardien-found').forEach(node => node.classList.remove('gardien-found'));
        document.getElementById(id)?.classList.add('gardien-found');
    }

    function clear() {
        results = [];
        index = -1;
        query = '';
        count.textContent = '';
        light(null);
    }

    // Compteur : la dimension du résultat tant qu'on n'y est pas.
    function tell(hit) {
        const away = Number(hit.layer) !== Number(layerNumber);
        count.textContent = `${index + 1} / ${results.length}${away && hit.dimension ? ` · ${hit.dimension}` : ''}`;
        count.dataset.label = hit.text;
    }

    function show() {
        const hit = results[index];
        tell(hit);
        light(hit.id);
        bridge.perform({ op: 'goto', ref: hit.id, layer: hit.layer }).then(() => {
            if (results[index] !== hit) return;  // un autre résultat a été demandé entre-temps
            tell(hit);
            light(hit.id);
        }).catch(() => {});
    }

    function step(direction) {
        if (!results.length) return;
        index = ((index + direction) % results.length + results.length) % results.length;
        show();
    }

    async function find() {
        const text = input.value.trim();
        if (!text) return clear();
        if (text === query && results.length) return step(1);
        query = text;
        const data = await api.request('GET', `toolbox/search?q=${encodeURIComponent(text)}`);
        results = data.results;
        index = -1;
        if (results.length) step(1);
        else {
            count.textContent = '0 / 0';
            light(null);
        }
    }

    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) step(-1);
            else find().catch(() => { count.textContent = t('search.down'); });
        } else if (event.key === 'Escape') {
            input.value = '';
            clear();
            input.blur();
        }
    });
    input.addEventListener('input', () => { if (input.value.trim() !== query) { results = []; index = -1; count.textContent = ''; light(null); } });
    back.addEventListener('click', () => step(-1));
    ahead.addEventListener('click', () => (results.length ? step(1) : find().catch(() => {})));
}
