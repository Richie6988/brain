// Filtre des pensées de l'IA dans le dock, comme le bouton de style des liens : un clic fait passer les pensées (et les
// étincelles du mode Profond) de visibles à estompées, puis masquées, puis de nouveau visibles ; leurs liens suivent.
// Une pensée se reconnaît à sa forme (sans cadre) et à sa couleur de genre (KINDS et SPARK_COLOR de guardian.py) :
// rien à ajouter en base. Le choix est gardé par navigateur.

const COLORS = new Set(['#8b7fc8', '#c9a24a', '#5a5575', '#b89af2', '#3e6b7a']);
const STATES = [
    { name: 'on', label: 'Pensées visibles' },
    { name: 'dim', label: 'Pensées estompées' },
    { name: 'off', label: 'Pensées masquées' },
];
const KEY = 'gardien-thoughts';

const isThought = node => node.getAttribute('shape') === 'none' && COLORS.has(String(node.getAttribute('color')).toLowerCase());

export function createThoughts() {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'thoughtsButton' });
    document.getElementById('linksButton')?.after(button);
    let state = 0;
    try {
        state = Math.max(0, STATES.findIndex(s => s.name === localStorage.getItem(KEY)));
    } catch { /* stockage indisponible */ }

    // Les pensées de la page et leurs liens, marqués ; le style fait le reste.
    function mark() {
        const thoughts = new Set();
        document.querySelectorAll('.node-group').forEach(node => {
            const thought = isThought(node);
            node.classList.toggle('gardien-thought', thought);
            if (thought) thoughts.add(node.id);
        });
        document.querySelectorAll('.link').forEach(link => {
            link.classList.toggle('gardien-thought-link', thoughts.has(link.getAttribute('Node1')) || thoughts.has(link.getAttribute('Node2')));
        });
    }

    function show() {
        STATES.forEach((s, i) => document.body.classList.toggle(`gardien-thoughts-${s.name}`, i === state && s.name !== 'on'));
        button.dataset.state = STATES[state].name;
        button.dataset.label = STATES[state].label;
        mark();
    }

    button.addEventListener('click', () => {
        state = (state + 1) % STATES.length;
        try {
            localStorage.setItem(KEY, STATES[state].name);
        } catch { /* stockage indisponible */ }
        show();
    });

    // Nouveaux nodes (l'IA pense, une dimension se charge) : marqués à l'image suivante, une fois forme et couleur posées.
    let pending = 0;
    new MutationObserver(() => {
        if (state === 0 || pending) return;
        pending = requestAnimationFrame(() => {
            pending = 0;
            mark();
        });
    }).observe(universe, { childList: true, subtree: true, attributeFilter: ['shape', 'color'] });

    show();
}
