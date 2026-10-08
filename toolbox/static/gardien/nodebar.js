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

import { setStyle, show } from './frames.js';
import { dragging as gesture } from './gesture.js';
import { t } from './i18n.js';

const TYPE = 'type', TEXT = 'text', FILE = 'file', CANVAS = 'canvas';  // barres d'outils du node (node.tools, elementsCreation.js)

// Branche (ranger en arbre, replier) et Sélection (amont, aval, tout ce qui est relié) : leurs nodes pleins en vert.
const ICON_BRANCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8C8 8 8 3 11 3M5 8h6M5 8c3 0 3 5 6 5"/><circle class="dot" cx="3.2" cy="8" r="1.9"/>'
    + '<circle class="dot" cx="12.6" cy="3" r="1.4"/><circle class="dot" cx="12.6" cy="8" r="1.4"/><circle class="dot" cx="12.6" cy="13" r="1.4"/></svg>';
const ICON_PICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.6" ry="5.6" stroke-dasharray="1.8 1.9"/><path d="M5.6 9.6L8 5.6l2.4 4"/>'
    + '<circle class="dot" cx="5.6" cy="9.6" r="1.25"/><circle class="dot" cx="8" cy="5.6" r="1.25"/><circle class="dot" cx="10.4" cy="9.6" r="1.25"/></svg>';

// Les nodes reliés à `node` en remontant (parents : Node1 → Node2 = node), en descendant, ou les deux (tout ce qui lui
// est relié), de proche en proche, par les seuls liens visibles : un node masqué par les filtres coupe la chaîne (sinon
// les nodes au-delà semblaient pris sans lien).
function kin(node, way) {
    const found = new Set([node.id]), queue = [node.id];
    const links = [...document.querySelectorAll('.link:not(.gardien-filtered)')].map(l => [l.getAttribute('Node1'), l.getAttribute('Node2')]);
    while (queue.length) {
        const id = queue.shift();
        links.forEach(([parent, child]) => {
            const next = (way !== 'up' && parent === id) ? child : (way !== 'down' && child === id) ? parent : null;
            if (next && !found.has(next) && document.getElementById(next)) {
                found.add(next);
                queue.push(next);
            }
        });
    }
    found.delete(node.id);
    return [...found].map(id => document.getElementById(id));
}

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
        { kind: 'type', group: TYPE, index: 0, title: t('nb.type') },
        { icon: 'colorpicking', title: t('nb.color'), group: TYPE, index: 2, on: 'mousedown' },
        { icon: node => ({ square: 'square', none: 'hide' })[node.getAttribute('shape')] || 'circle', title: t('nb.shape'), group: TYPE, index: 5, on: 'click' },
        { icon: 'calendar', title: t('nb.reminder'), group: TYPE, index: 6, on: 'click' },
        { icon: node => (node.getAttribute('lock') === '1' ? 'lock' : 'unlock'), title: t('nb.lock'), group: TYPE, index: 7, on: 'click' },
        { icon: 'layer', title: t('nb.portal'), group: TYPE, index: 8, on: 'click' },
        { kind: 'menu', menu: 'branch', svg: ICON_BRANCH, title: t('nb.branch'), when: node => kin(node, 'down').length },  // une branche : des enfants
        { kind: 'menu', menu: 'pick', svg: ICON_PICK, title: t('nb.pick'), when: node => kin(node, 'all').length },  // rien de relié : rien à sélectionner
    ],
    text: [
        { icon: 'bold', title: t('nb.bold'), group: TEXT, index: 0, on: 'mousedown' },
        { icon: 'italic', title: t('nb.italic'), group: TEXT, index: 1, on: 'mousedown' },
        { icon: 'underline', title: t('nb.underline'), group: TEXT, index: 2, on: 'mousedown' },
        { kind: 'font', step: -1, label: 'A−', title: t('nb.smaller'), group: TEXT, index: 3 },
        { kind: 'font', step: 1, label: 'A+', title: t('nb.bigger'), group: TEXT, index: 3 },
        { kind: 'family', label: 'Aa', title: t('nb.font') },
        { icon: 'colorpicking', title: t('nb.textColor'), group: TEXT, index: 4, on: 'mousedown' },
        { icon: 'smiley', title: t('nb.emoji'), group: TEXT, index: 5, on: 'mousedown' },
    ],
    canvas: [
        { icon: 'line', title: t('nb.line'), group: CANVAS, index: 4, on: 'mousedown' },
        { icon: 'circle', title: t('nb.circle'), group: CANVAS, index: 5, on: 'mousedown' },
        { icon: 'eraser', title: t('nb.eraser'), group: CANVAS, index: 0, on: 'mousedown' },
        { icon: 'undo', title: t('nb.undo'), group: CANVAS, index: 2, on: 'mousedown' },
        { icon: 'redo', title: t('nb.redo'), group: CANVAS, index: 1, on: 'mousedown' },
        { icon: 'eraseall', title: t('nb.clear'), group: CANVAS, index: 3, on: 'mousedown' },
        { icon: 'colorpicking', title: t('nb.strokeColor'), group: CANVAS, index: 7, on: 'click' },
        { kind: 'size', title: t('nb.size'), group: CANVAS, index: 6 },
    ],
    code: [  // nodes de code : l'IDE (ide.js) s'ouvre par un événement
        { kind: 'action', action: 'ide', label: '</> IDE', title: t('nb.ide') },
        { kind: 'action', action: 'run', label: '▶', title: t('nb.run') },
    ],
    image: [  // changer ou retirer l'image déjà chargée (Nodz ne le permettait que par double-clic)
        { kind: 'do', icon: 'newimg', title: t('nb.changeImage'), run: pickImage },
        { kind: 'do', svg: TRASH, title: t('nb.removeImage'), run: removeImage },
    ],
    file: [
        { icon: 'upload', title: t('nb.upload'), group: FILE, index: 0, on: 'mousedown', pick: 'div' },
        { icon: 'download', title: t('nb.download'), group: FILE, index: 1, on: 'mousedown', pick: 'div' },
        { kind: 'do', svg: TRASH, title: t('nb.removeFile'), run: removeFile },
    ],
};

// Polices du bouton « Aa » : familles génériques avec repli, présentes sur toute machine.
const FAMILIES = [
    ['Cascadia Code', "'Cascadia Code', monospace"],
    ['Sans', "system-ui, 'Segoe UI', Roboto, sans-serif"],
    ['Serif', "Georgia, 'Times New Roman', serif"],
    [t('nb.fontHand'), "'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive"],
    [t('nb.fontType'), "'Courier New', Courier, monospace"],
    [t('nb.fontPoster'), "Impact, 'Arial Black', sans-serif"],
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
    knob.setAttribute('aria-label', t('nb.knob'));  // pas d'infobulle : le geste parle de lui-même
    knob.hidden = true;
    knob.innerHTML = ARROWS;
    document.body.append(knob);
    let node = null, dragging = false, pointer = [0, 0], press = null;
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
        press = { x: event.clientX, y: event.clientY, at: performance.now() };
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
    // Un clic sans glisser sur la poignée est signalé à gardien.js (vu de haut, il descend en travelling jusqu'au node).
    const release = event => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('gardien-sizing');
        save(node);
        if (event.type === 'pointerup' && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 4 && performance.now() - press.at <= 400) {
            document.dispatchEvent(new CustomEvent('gardien-node-click', { detail: { node } }));
        }
    };
    knob.addEventListener('pointerup', release);
    knob.addEventListener('pointercancel', release);

    (function follow() {
        node = candidate();
        if (!node || (typeof admin !== 'undefined' && admin)) {
            show(knob, false);
        } else {
            const [cx, cy, halfW, halfH] = center(node);
            const square = node.getAttribute('shape') === 'square';  // bas droit du carré ou du rectangle, sinon du cercle
            const [dx, dy] = square ? [halfW, halfH] : [halfW * Math.SQRT1_2, halfH * Math.SQRT1_2];
            show(knob, true);
            setStyle(knob, 'transform', `translate(${Math.round(cx + dx - 14)}px, ${Math.round(cy + dy - 14)}px)`);
            setStyle(knob, '--c', node.getAttribute('color') || '#b89af2');
        }
        requestAnimationFrame(follow);
    })();
}

export function createNodebar({ onBranch }) {
    createSizer();
    const bar = document.createElement('div');
    bar.id = 'gardien-nodebar';
    bar.hidden = true;
    document.body.append(bar);
    bar.addEventListener('mousedown', event => {
        if (!event.target.closest('select, input')) event.preventDefault();  // le texte du node garde le focus
        event.stopPropagation();
    });
    // Menu « Sélection » : remplace la sélection par le node et sa lignée choisie.
    const pickMenu = Object.assign(document.createElement('div'), { id: 'gardien-pick', hidden: true });
    document.body.append(pickMenu);
    pickMenu.addEventListener('mousedown', event => event.preventDefault());
    document.addEventListener('mousedown', event => {
        if (!pickMenu.contains(event.target) && !bar.contains(event.target)) pickMenu.hidden = true;
    }, true);
    // Sélectionner le node et tous ses parents, ses enfants ou tout ce qui lui est relié, rien d'autre : une sélection
    // précédente est remplacée.
    const extend = (way, node) => {
        if (!node.isConnected) return;
        if (document.activeElement?.isContentEditable) document.activeElement.blur();
        const family = [node, ...kin(node, way)];
        [...selectedNodes].forEach(n => { if (!family.includes(n)) nodeUnselection(n); });
        family.forEach(n => { if (!selectedNodes.includes(n)) nodeSelection(n); });
    };
    const openPick = (node, anchor) => {
        pickMenu.replaceChildren(...[['up', `▲ ${t('pick.up')}`, t('pick.upTitle')],
            ['down', `▼ ${t('pick.down')}`, t('pick.downTitle')], ['all', t('pick.all'), t('pick.allTitle')]]
            .map(([way, label, title]) => {
                const count = kin(node, way).length;
                return Object.assign(document.createElement('button'), { type: 'button', textContent: `${label} (${count})`, title, disabled: !count,
                    onclick: () => { pickMenu.hidden = true; extend(way, node); } });
            }));
        pickMenu.style.left = `${Math.min(innerWidth - 190, anchor.left)}px`;
        pickMenu.style.top = `${anchor.bottom + 6}px`;
        pickMenu.hidden = false;
    };
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
        const b = Object.assign(document.createElement('button'), { type: 'button', title: t('nb.font'), textContent: 'Aa' });
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
        if (tool.kind === 'menu') {  // Branche et Sélection : un appui ouvre le menu, un second le referme
            const b = Object.assign(document.createElement('button'), { type: 'button', title: tool.title, innerHTML: tool.svg });
            b.addEventListener('click', () => {
                const branchMenu = document.getElementById('gardien-branch');
                const open = tool.menu === 'branch' ? branchMenu?.hidden === false : !pickMenu.hidden;
                pickMenu.hidden = true;
                if (branchMenu) branchMenu.hidden = true;
                if (open) return;
                if (tool.menu === 'branch') onBranch(node, b.getBoundingClientRect());
                else openPick(node, b.getBoundingClientRect());
            });
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
        const next = `${node.id}|${modes}|${node.getAttribute('shape')}|${node.getAttribute('lock')}|${node.getAttribute('type')}|${node.getAttribute('links')}|${typeof dark !== 'undefined' && dark}`;
        if (next === key) return;
        key = next;
        bar.replaceChildren(...modes.flatMap((mode, i) => [
            ...(i ? [Object.assign(document.createElement('span'), { className: 'sep' })] : []),
            ...TOOLS[mode].filter(tool => (['family', 'action', 'do', 'menu'].includes(tool.kind) || source(node, tool)) && (!tool.when || tool.when(node)))
                .map(tool => control(node, tool)),
        ]));
    }

    (function follow() {
        const [node, modes] = (typeof admin !== 'undefined' && admin) || gesture() ? [null, []] : active();
        if (!node) {
            show(bar, false);
            key = '';
        } else {
            render(node, modes);
            show(bar, true);
            const shape = node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1];
            const r = (shape || node).getBoundingClientRect();
            const x = Math.min(Math.max(8, r.left + r.width / 2 - bar.offsetWidth / 2), innerWidth - bar.offsetWidth - 8);
            const y = r.top - bar.offsetHeight - 12 > 8 ? r.top - bar.offsetHeight - 12 : r.bottom + 12;  // au-dessus, sinon dessous
            setStyle(bar, 'transform', `translate(${Math.round(x)}px, ${Math.round(y)}px)`);
        }
        requestAnimationFrame(follow);
    })();
}
