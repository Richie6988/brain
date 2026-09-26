// Barre haute reprise de v1 : plein écran, style des liens (dégradé, neutre, masqué), drapeau
// (nouvelle origine), retour à l'origine, liste des plans (Maj), recherche dans le plan (Ctrl+F).

const LINK_STYLES = ['gradient', 'neutral', 'hidden'];
const LINK_TITLES = { gradient: 'Liens en dégradé', neutral: 'Liens neutres', hidden: 'Liens masqués' };

const textOf = node => {
    const box = document.createElement('div');
    box.innerHTML = node.payload?.text?.html || '';
    return box.textContent.trim();
};

export function bindToolbar({ svg, store, nav }) {
    const $ = id => document.getElementById(id);
    const dispatch = (name, params) => store.dispatch(name, params);
    const linksButton = $('links-button');
    const list = $('layers-list');
    const search = $('search');
    let linkStyle = 0;
    let matches = [];
    let cursor = -1;

    // Un bouton ne garde pas le focus : les raccourcis du canevas restent actifs.
    $('toolbar').addEventListener('click', event => event.target.closest('button')?.blur());

    $('fullscreen-button').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    });

    function applyLinkStyle() {
        const style = LINK_STYLES[linkStyle];
        svg.dataset.links = style;
        linksButton.dataset.state = style;
        linksButton.title = LINK_TITLES[style];
    }
    linksButton.addEventListener('click', () => {
        linkStyle = (linkStyle + 1) % LINK_STYLES.length;
        applyLinkStyle();
    });
    applyLinkStyle();

    // Drapeau : épingle affichée 3 s au centre, comme v1.
    $('flag-button').addEventListener('click', () => {
        nav.setOrigin();
        const pin = $('pin');
        pin.hidden = false;
        clearTimeout(pin.timer);
        pin.timer = setTimeout(() => { pin.hidden = true; }, 3000);
    });
    $('origin-button').addEventListener('click', () => nav.play(nav.gestures.toOrigin()));

    function renderLayers() {
        const layers = [...store.state.layers.values()].filter(l => l.kind !== 'archive').sort((a, b) => a.index - b.index);
        list.replaceChildren(...layers.map(layer => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = layer.name || `Dim-${layer.index + 1}`;
            button.classList.toggle('current', layer.id === store.state.layerId);
            button.addEventListener('click', () => {
                list.hidden = true;
                dispatch('go_to_layer', { id: layer.id });
            });
            item.append(button);
            return item;
        }));
    }
    function toggleLayers(force) {
        list.hidden = force ?? !list.hidden;
        if (!list.hidden) renderLayers();
    }
    $('layers-button').addEventListener('click', () => toggleLayers());
    store.on('layer:current', () => toggleLayers(true));

    // Recherche : les nodes du plan dont le texte contient la requête, parcourus avec Entrée.
    function find() {
        const query = search.value.trim().toLowerCase();
        matches = query ? [...store.state.nodes.values()]
            .filter(n => n.layer === store.state.layerId && textOf(n).toLowerCase().includes(query))
            .map(n => n.id) : [];
        cursor = -1;
        $('search-count').textContent = query ? `0/${matches.length}` : '';
    }
    function step(direction) {
        if (!matches.length) return;
        cursor = (cursor + direction + matches.length) % matches.length;
        $('search-count').textContent = `${cursor + 1}/${matches.length}`;
        dispatch('select', { ids: [matches[cursor]] });
        nav.play(nav.gestures.focus(matches[cursor]));
    }
    search.addEventListener('input', find);
    search.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
            search.value = '';
            find();
            search.blur();
        }
    });

    document.addEventListener('keydown', event => {
        const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            search.focus();
            search.select();
        } else if (event.key === 'Shift' && !typing && !event.repeat) {
            toggleLayers();
        }
    });
}
