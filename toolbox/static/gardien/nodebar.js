// Barre d'outils du node, au style du Gardien : une seule barre HTML au-dessus du node actif, à la place des
// barres SVG que Nodz dessine dans chaque node (masquées par gardien.css). Chaque bouton déclenche le gestionnaire
// d'origine de Nodz sur son bouton SVG : mêmes effets, même sauvegarde, même annulation. L'événement ne remonte
// pas jusqu'au node (bubbles: false) : un mousedown n'y lance ni sélection ni glissé.
//
// Node actif : celui dont on écrit le texte (mise en forme), sinon le dernier sélectionné (réglages, et outils de
// dessin ou de fichier selon son type), sinon le dessin en cours.

const TYPE = 7, TEXT = 4, FILE = 5, CANVAS = 6;  // groupes SVG du node (elementsCreation.js)

const TOOLS = {
    params: [
        { kind: 'type', group: TYPE, index: 0, title: 'Type du node' },
        { icon: 'colorpicking', title: 'Couleur', group: TYPE, index: 2, on: 'mousedown' },
        { icon: node => ({ square: 'square', none: 'hide' })[node.getAttribute('shape')] || 'circle', title: 'Forme : cercle, carré, sans', group: TYPE, index: 5, on: 'click' },
        { icon: 'calendar', title: 'Rappel', group: TYPE, index: 6, on: 'click' },
        { icon: node => (node.getAttribute('lock') === '1' ? 'lock' : 'unlock'), title: 'Verrouiller', group: TYPE, index: 7, on: 'click' },
        { icon: 'layer', title: 'Portail vers une nouvelle dimension', group: TYPE, index: 8, on: 'click' },
    ],
    text: [
        { icon: 'bold', title: 'Gras', group: TEXT, index: 0, on: 'mousedown' },
        { icon: 'italic', title: 'Italique', group: TEXT, index: 1, on: 'mousedown' },
        { icon: 'underline', title: 'Souligné', group: TEXT, index: 2, on: 'mousedown' },
        { kind: 'font', step: -1, label: 'A−', title: 'Plus petit', group: TEXT, index: 3 },
        { kind: 'font', step: 1, label: 'A+', title: 'Plus grand', group: TEXT, index: 3 },
        { icon: 'colorpicking', title: 'Couleur du texte', group: TEXT, index: 4, on: 'mousedown' },
        { icon: 'smiley', title: 'Emoji', group: TEXT, index: 5, on: 'mousedown' },
    ],
    canvas: [
        { icon: 'line', title: 'Trait', group: CANVAS, index: 4, on: 'mousedown' },
        { icon: 'circle', title: 'Cercle', group: CANVAS, index: 5, on: 'mousedown' },
        { icon: 'eraser', title: 'Gomme', group: CANVAS, index: 0, on: 'mousedown' },
        { icon: 'undo', title: 'Annuler le trait', group: CANVAS, index: 2, on: 'mousedown' },
        { icon: 'redo', title: 'Rétablir le trait', group: CANVAS, index: 1, on: 'mousedown' },
        { icon: 'eraseall', title: 'Tout effacer', group: CANVAS, index: 3, on: 'mousedown' },
        { icon: 'colorpicking', title: 'Couleur du trait', group: CANVAS, index: 7, on: 'click' },
        { kind: 'size', title: 'Épaisseur', group: CANVAS, index: 6 },
    ],
    file: [
        { icon: 'upload', title: 'Importer un fichier', group: FILE, index: 0, on: 'mousedown', pick: 'div' },
        { icon: 'download', title: 'Télécharger', group: FILE, index: 1, on: 'mousedown', pick: 'div' },
    ],
};

const img = name => `${NODZ_BASE}/static/img/${name}${typeof dark !== 'undefined' && !dark ? '-light' : ''}.svg`;
const fire = (element, type) => element?.dispatchEvent(new MouseEvent(type, { bubbles: false, cancelable: true }));

export function createNodebar() {
    const bar = document.createElement('div');
    bar.id = 'gardien-nodebar';
    bar.hidden = true;
    document.body.append(bar);
    bar.addEventListener('mousedown', event => {
        if (!event.target.closest('select, input')) event.preventDefault();  // le texte du node garde le focus
        event.stopPropagation();
    });
    let drawn = null;  // dernier dessin touché : ses outils restent sous la main pendant qu'on dessine
    let key = '';
    const fontSize = new WeakMap();  // taille de police courante par node (1 à 7, 3 par défaut)

    document.addEventListener('mousedown', event => {
        if (bar.contains(event.target)) return;
        const node = event.target.closest?.('.node-group');
        drawn = node?.getAttribute('type') === 'canvas' ? node : null;
    }, true);

    const editing = () => (document.activeElement?.isContentEditable ? document.activeElement.closest('.node-group') : null);
    const active = () => {
        const node = editing();
        if (node) return [node, ['text']];
        const selected = typeof selectedNodes !== 'undefined' && selectedNodes.length ? selectedNodes[selectedNodes.length - 1] : null;
        const target = selected?.isConnected ? selected : drawn?.isConnected ? drawn : null;
        if (!target) return [null, []];
        const extra = { canvas: 'canvas', file: 'file' }[target.getAttribute('type')];
        return [target, ['params', ...(extra ? [extra] : [])]];
    };
    const source = (node, tool) => {
        const holder = node.children[tool.group]?.children[tool.index];
        return tool.pick === 'div' ? holder?.querySelector('div') : holder?.querySelector(tool.kind === 'size' ? 'input' : tool.kind ? 'select' : 'img');
    };

    function button(node, tool) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = tool.title;
        if (tool.label) b.textContent = tool.label;
        else b.style.backgroundImage = `url("${img(typeof tool.icon === 'function' ? tool.icon(node) : tool.icon)}")`;
        b.addEventListener('click', () => {
            const element = source(node, tool);
            if (tool.kind === 'font') {  // la liste de tailles de Nodz : sélection gardée, puis nouvelle taille
                const size = Math.min(7, Math.max(1, (fontSize.get(node) || 3) + tool.step));
                fontSize.set(node, size);
                fire(element, 'mousedown');
                element.value = String(size);
                element.dispatchEvent(new Event('change'));
                return;
            }
            fire(element, tool.on);
            if (tool.on === 'click' || tool.kind) key = '';  // forme, verrou : l'icône change
        });
        return b;
    }

    function control(node, tool) {
        const element = source(node, tool);
        if (tool.kind === 'type') {
            const select = element.cloneNode(true);  // mêmes types que la liste de Nodz
            select.removeAttribute('id');
            select.value = element.value;
            select.disabled = element.disabled;
            select.title = tool.title;
            select.addEventListener('change', () => {
                element.value = select.value;
                element.dispatchEvent(new Event('change'));
                key = '';
            });
            return select;
        }
        if (tool.kind === 'size') {
            const range = Object.assign(document.createElement('input'), { type: 'range', min: element.min, max: element.max, value: element.value, title: tool.title });
            range.addEventListener('input', () => {
                element.value = range.value;
                element.dispatchEvent(new Event('input'));
            });
            return range;
        }
        return button(node, tool);
    }

    function render(node, modes) {
        const next = `${node.id}|${modes}|${node.getAttribute('shape')}|${node.getAttribute('lock')}|${node.getAttribute('type')}|${typeof dark !== 'undefined' && dark}`;
        if (next === key) return;
        key = next;
        bar.replaceChildren(...modes.flatMap((mode, i) => [
            ...(i ? [Object.assign(document.createElement('span'), { className: 'sep' })] : []),
            ...TOOLS[mode].filter(tool => source(node, tool)).map(tool => control(node, tool)),
        ]));
    }

    (function follow() {
        const [node, modes] = typeof admin !== 'undefined' && admin ? [null, []] : active();
        if (!node) {
            bar.hidden = true;
            key = '';
        } else {
            render(node, modes);
            bar.hidden = false;
            const shape = node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1];
            const r = (shape || node).getBoundingClientRect();
            const x = Math.min(Math.max(8, r.left + r.width / 2 - bar.offsetWidth / 2), innerWidth - bar.offsetWidth - 8);
            const y = r.top - bar.offsetHeight - 12 > 8 ? r.top - bar.offsetHeight - 12 : r.bottom + 12;  // au-dessus, sinon dessous
            bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        }
        requestAnimationFrame(follow);
    })();
}
