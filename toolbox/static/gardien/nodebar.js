// Barre d'outils du node, au style du Gardien : une seule barre HTML au-dessus du node actif, à la place des
// barres SVG que Nodz dessine dans chaque node (masquées par gardien.css). Chaque bouton déclenche le gestionnaire
// d'origine de Nodz sur son bouton SVG : mêmes effets, même sauvegarde, même annulation. L'événement ne remonte
// pas jusqu'au node (bubbles: false) : un mousedown n'y lance ni sélection ni glissé.
//
// Node actif : celui dont on écrit le texte (mise en forme), sinon le dernier sélectionné (réglages, et outils de
// dessin ou de fichier selon son type), sinon le dessin en cours.
//
// Poignée de taille : une pastille HTML de taille constante au coin bas droit du node sélectionné ou survolé (elle
// reste tant que le pointeur est près du node). La tirer donne au node le rayon de la distance entre pointeur et
// centre ; même redimensionnement (nodeSizing) et même sauvegarde que Nodz. Elle remplace la double flèche SVG.
// Un node texte carré devient un rectangle : la poignée est à son vrai coin et règle largeur et hauteur à part
// (attribut ratio, gardé par nodeSizing et sauvegardé).

import { dragging as gesture } from './gesture.js';

const TYPE = 'type', TEXT = 'text', FILE = 'file', CANVAS = 'canvas';  // barres d'outils du node (node.tools, elementsCreation.js)

const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

// Image : le choix de fichier de Nodz (le même que son double-clic sur l'image).
function pickImage(node) {
    loadimage = true;
    const select = node.tools.type.children[0].children[0];
    select.value = 'image';
    select.dispatchEvent(new Event('change'));
}

// Retirer ne détruit rien : le node revient à son image d'attente, Ctrl+Z la remet.
function removeImage(node) {
    node.setAttribute('imagecontent', '');
    node.children[0].children[1].src = `${NODZ_BASE}/static/img/newimg${typeof dark !== 'undefined' && !dark ? '-light' : ''}.svg`;
    save(node);
}

// Le fichier reste sur le serveur (Ctrl+Z le remet) : le node oublie son nom et son aperçu.
function removeFile(node) {
    const container = node.children[0].children[2];
    container.querySelectorAll('.filetypeimg, [id^="stlContainer-"]').forEach(element => element.remove());
    const preview = container.children[0];
    preview.removeAttribute('src');
    preview.style.display = 'none';
    node.setAttribute('filename', '');
    node.setAttribute('file', '');
    const name = node.tools.file.children[2]?.querySelector('div');
    if (name) name.textContent = '';
    save(node);
}

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
        { kind: 'family', label: 'Aa', title: 'Police' },
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
    code: [  // nodes de code : l'IDE (ide.js) s'ouvre par un événement
        { kind: 'action', action: 'ide', label: '</> IDE', title: "Ouvrir l'IDE" },
        { kind: 'action', action: 'run', label: '▶', title: 'Ouvrir et exécuter' },
    ],
    image: [  // changer ou retirer l'image déjà chargée (Nodz ne le permettait que par double-clic)
        { kind: 'do', icon: 'newimg', title: "Changer l'image", run: pickImage },
        { kind: 'do', svg: TRASH, title: "Retirer l'image", run: removeImage },
    ],
    file: [
        { icon: 'upload', title: 'Importer ou changer le fichier', group: FILE, index: 0, on: 'mousedown', pick: 'div' },
        { icon: 'download', title: 'Télécharger', group: FILE, index: 1, on: 'mousedown', pick: 'div' },
        { kind: 'do', svg: TRASH, title: 'Retirer le fichier', run: removeFile },
    ],
};

// Polices du bouton « Aa » : familles génériques avec repli, présentes sur toute machine.
const FAMILIES = [
    ['Cascadia Code', "'Cascadia Code', monospace"],
    ['Sans', "system-ui, 'Segoe UI', Roboto, sans-serif"],
    ['Serif', "Georgia, 'Times New Roman', serif"],
    ['Manuscrite', "'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive"],
    ['Machine', "'Courier New', Courier, monospace"],
    ['Affiche', "Impact, 'Arial Black', sans-serif"],
];

const img = name => `${NODZ_BASE}/static/img/${name}${typeof dark !== 'undefined' && !dark ? '-light' : ''}.svg`;
const fire = (element, type) => element?.dispatchEvent(new MouseEvent(type, { bubbles: false, cancelable: true }));

const ARROWS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';

function shapeOf(node) {
    return node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1];
}

function createSizer() {
    const knob = document.createElement('button');
    knob.type = 'button';
    knob.id = 'gardien-sizer';
    knob.title = 'Taille du node (glisser)';
    knob.hidden = true;
    knob.innerHTML = ARROWS;
    document.body.append(knob);
    let node = null, dragging = false, pointer = [0, 0];
    document.addEventListener('pointermove', event => { pointer = [event.clientX, event.clientY]; }, true);

    const center = target => {
        const r = shapeOf(target).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2];
    };
    const near = target => {
        const [cx, cy, halfW, halfH] = center(target);
        return Math.hypot(pointer[0] - cx, pointer[1] - cy) < Math.max(halfW, halfH) + 48;
    };
    const rectangle = target => target.getAttribute('shape') === 'square' && target.getAttribute('type') === 'text';
    function candidate() {
        if (dragging) return node;
        if ((typeof isDragging !== 'undefined' && isDragging) || gesture()) return null;
        const selected = typeof selectedNodes !== 'undefined' && selectedNodes.length === 1 ? selectedNodes[0] : null;
        const hovered = typeof currentNode !== 'undefined' ? currentNode : null;
        const target = [selected, hovered, node].find(n => n?.isConnected && n.getAttribute('lock') !== '1' && (n === selected || near(n)));
        return document.activeElement?.isContentEditable && document.activeElement.closest('.node-group') === target ? null : target;
    }

    knob.addEventListener('pointerdown', event => {
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        knob.setPointerCapture(event.pointerId);
        document.body.classList.add('gardien-sizing');
    });
    knob.addEventListener('pointermove', event => {
        if (!dragging) return;
        const [cx, cy] = center(node);
        if (rectangle(node)) {  // largeur et hauteur à part : le rectangle mesure (w + 30) × (h + 30)
            const w = Math.max(60, (2 * Math.abs(event.clientX - cx)) / currentZoom - 30);
            const h = Math.max(20, (2 * Math.abs(event.clientY - cy)) / currentZoom - 30);
            node.setAttribute('ratio', (w / h).toFixed(4));
            nodeSizing(node, w, h);
            return;
        }
        const radius = Math.max(20, Math.hypot(event.clientX - cx, event.clientY - cy) / currentZoom);  // rayon en unités de Nodz
        nodeSizing(node, radius * Math.SQRT2, radius * Math.SQRT2);
    });
    const release = () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('gardien-sizing');
        save(node);
    };
    knob.addEventListener('pointerup', release);
    knob.addEventListener('pointercancel', release);

    (function follow() {
        node = candidate();
        if (!node || (typeof admin !== 'undefined' && admin)) {
            knob.hidden = true;
        } else {
            const [cx, cy, halfW, halfH] = center(node);
            const square = node.getAttribute('shape') === 'square';  // bas droit du carré ou du rectangle, sinon du cercle
            const [dx, dy] = square ? [halfW, halfH] : [halfW * Math.SQRT1_2, halfH * Math.SQRT1_2];
            knob.hidden = false;
            knob.style.transform = `translate(${Math.round(cx + dx - 14)}px, ${Math.round(cy + dy - 14)}px)`;
            knob.style.setProperty('--c', node.getAttribute('color') || '#b89af2');
        }
        requestAnimationFrame(follow);
    })();
}

export function createNodebar() {
    createSizer();
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
    const SIZES = [1, 2, 4, 6, 7];  // XS, S, M, L, XL : les tailles de la liste de Nodz
    const fontSize = new WeakMap();  // rang de la taille courante par node (M par défaut)

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
        const extra = { canvas: 'canvas', file: 'file', code: 'code', image: 'image' }[target.getAttribute('type')];
        return [target, ['params', ...(extra ? [extra] : [])]];
    };
    const source = (node, tool) => {
        const holder = node.tools?.[tool.group]?.children[tool.index];
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
                const rank = Math.min(SIZES.length - 1, Math.max(0, (fontSize.get(node) ?? 2) + tool.step));
                fontSize.set(node, rank);
                fire(element, 'mousedown');
                element.value = String(SIZES[rank]);
                element.dispatchEvent(new Event('change'));
                return;
            }
            fire(element, tool.on);
            if (tool.on === 'click' || tool.kind) key = '';  // forme, verrou : l'icône change
        });
        return b;
    }

    // Choix de police : menu HTML sous la barre ; le texte garde le focus (la barre retient le mousedown), la police
    // s'applique à la sélection comme le gras (execCommand, balise font face), Nodz l'enregistre en quittant le node.
    function family() {
        const wrap = Object.assign(document.createElement('span'), { className: 'gn-family' });
        const b = Object.assign(document.createElement('button'), { type: 'button', title: 'Police', textContent: 'Aa' });
        const menu = Object.assign(document.createElement('div'), { className: 'gn-menu', hidden: true });
        FAMILIES.forEach(([name, stack]) => {
            const item = Object.assign(document.createElement('button'), { type: 'button', textContent: name, title: name });
            item.style.fontFamily = stack;
            item.addEventListener('click', () => {
                document.execCommand('fontName', false, stack);
                menu.hidden = true;
            });
            menu.append(item);
        });
        b.addEventListener('click', () => { menu.hidden = !menu.hidden; });
        wrap.append(b, menu);
        return wrap;
    }

    function control(node, tool) {
        if (tool.kind === 'family') return family();
        if (tool.kind === 'do') {
            const b = Object.assign(document.createElement('button'), { type: 'button', title: tool.title });
            if (tool.svg) b.innerHTML = tool.svg;
            else b.style.backgroundImage = `url("${img(tool.icon)}")`;
            b.addEventListener('click', () => { tool.run(node); key = ''; });
            return b;
        }
        if (tool.kind === 'action') {
            const b = Object.assign(document.createElement('button'), { type: 'button', title: tool.title, textContent: tool.label, className: 'gn-action' });
            b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('gardien-code', { detail: { node, action: tool.action } })));
            return b;
        }
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
                // Nodz vide la sélection en changeant de type : le node reste choisi, ses outils (IDE…) apparaissent
                if (!selectedNodes.includes(node)) nodeSelection(node);
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
            ...TOOLS[mode].filter(tool => ['family', 'action', 'do'].includes(tool.kind) || source(node, tool)).map(tool => control(node, tool)),
        ]));
    }

    (function follow() {
        const [node, modes] = (typeof admin !== 'undefined' && admin) || gesture() ? [null, []] : active();
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
