// Étincelle : dans une dimension vide, une carte au centre invite à poser une première idée (ou à en prendre une
// des exemples). L'idée devient un node au centre de la vue et part aussitôt au Gardien, qui la fait pousser en pistes
// parallèles : la valeur de Nodz se voit dans la première minute. La carte s'efface dès qu'un node existe ; × la retire
// pour de bon dans ce navigateur. Pas sous automatisation (les bancs pilotent un univers vide) ni dans un salon.

const KEY = 'gardien-spark-off';
const EXAMPLES = ['Organiser un voyage au Japon', 'Lancer mon podcast', 'Préparer un entretien d\'embauche'];

export function createSpark({ bridge, onSpark }) {
    let off = false;
    try {
        off = localStorage.getItem(KEY) === '1';
    } catch { /* stockage indisponible : la carte revient à chaque visite */ }
    if (off || navigator.webdriver || new URLSearchParams(location.search).has('room')) return;

    const card = document.createElement('section');
    card.id = 'gardien-spark';
    card.hidden = true;
    card.innerHTML = '<button type="button" class="gsp-x" title="Ne plus proposer">×</button>'
        + '<b>Pose ta première idée</b><p>Le Gardien la fait pousser en pistes parallèles, sous tes yeux.</p>'
        + '<form><input maxlength="120" placeholder="Un projet, une question, un rêve…" aria-label="Ta première idée"><button type="submit">Faire pousser</button></form>'
        + '<div class="gsp-examples"></div>';
    document.body.append(card);
    const input = card.querySelector('input');
    card.querySelector('.gsp-examples').append(...EXAMPLES.map(text => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = text;
        chip.addEventListener('click', () => grow(text));
        return chip;
    }));
    card.addEventListener('keydown', event => event.stopPropagation());  // Espace, Entrée : pas les raccourcis de Nodz
    card.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        if (input.value.trim()) grow(input.value.trim());
    });
    card.querySelector('.gsp-x').addEventListener('click', () => {
        try {
            localStorage.setItem(KEY, '1');
        } catch { /* le choix vaut pour cette visite */ }
        card.remove();
    });

    async function grow(text) {
        card.hidden = true;
        const c = bridge.center();
        await bridge.perform({ op: 'create', ref: 'spark', x: Math.round(c.x), y: Math.round(c.y), text: text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]), color: '#33FF99' });
        const node = document.getElementById(bridge.idOf('spark'));
        if (node) onSpark(node, text);
    }

    // Visible seulement quand la dimension ouverte est vide, l'univers chargé et aucune fenêtre au-dessus.
    setInterval(() => {
        if (!card.isConnected) return;
        const empty = document.body.classList.contains('gardien-ready') && !isLoading
            && !document.querySelector('.node-group') && !document.querySelector('.gl-modal:not([hidden])');
        if (empty === card.hidden) {
            card.hidden = !empty;
            if (empty) input.focus({ preventScroll: true });
        }
    }, 700);
}
