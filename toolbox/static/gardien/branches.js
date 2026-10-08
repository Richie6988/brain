// Branches d'une carte. Une branche : un node et tout ce qui descend de lui par ses liens (Node1 → Node2, comme Aval).
// - Replier : ses descendants et leurs liens disparaissent, une pastille « +N » à côté du node les rappelle (un clic
//   déplie) ; l'état reste dans ce navigateur, par dimension, et revient à chaque chargement. Déplier range tout l'arbre
//   depuis sa racine.
// - Ranger en arbre : de gauche à droite, chaque niveau dans sa colonne, chaque sous-arbre dans sa bande, animé ; les
//   positions sont enregistrées d'un coup (un seul Ctrl+Z).
// - Exporter (bouton Importer / Exporter du dock, exchange.js) : Markdown, OPML, FreeMind (.mm), que lisent XMind,
//   MindNode, MindMeister, Obsidian, Workflowy…
// Tout se fait à partir de la page : les nodes et les liens de la dimension ouverte.

import { setStyle, show } from './frames.js';
import { t } from './i18n.js';

const KEY = 'gardien-folds';
const GAP_X = 160;   // entre le bord d'un node et le bord de ses enfants
const GAP_Y = 46;    // entre deux sous-arbres voisins
const SAVE_GAP = 40; // ms entre deux enregistrements d'un rangement
const MIN_BADGE = 40; // px à l'écran sous lesquels un node replié ne montre plus sa pastille
const TRANSFORM = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const byId = id => document.getElementById(id);
const nodes = () => [...universe.querySelectorAll('.node-group')];
// Texte d'un node avec ses retours à la ligne, lu sans mise en page (innerText en forçait une par node : replier ou
// ranger une grande branche figeait la page).
const textOf = node => {
    const input = node.children[0]?.children[0];
    if (!input) return '';
    const copy = input.cloneNode(true);
    copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    copy.querySelectorAll('div, p, li').forEach(block => block.prepend('\n'));
    return copy.textContent.replace(/\n{3,}/g, '\n\n').trim();
};

// Demi-largeur et demi-hauteur d'un node, en unités de l'univers (rectangle : son cadre ; sinon son cercle).
export function half(node) {
    if (node.getAttribute('shape') === 'square') {
        const box = node.children[2];
        return { w: (parseFloat(box.getAttribute('width')) || 120) / 2, h: (parseFloat(box.getAttribute('height')) || 120) / 2 };
    }
    const r = parseFloat(node.children[1]?.getAttribute('r')) || 60;
    return { w: r, h: r };
}

// Enfants d'un node : les nodes au bout de ses liens sortants (parmi `only` s'il est donné), dans l'ordre de la carte
// (de haut en bas, puis de gauche à droite), pas dans celui des liens.
function children(id, only = null) {
    const at = child => [-parseFloat(byId(child).getAttribute('y')), parseFloat(byId(child).getAttribute('x'))];
    return [...universe.querySelectorAll('.link')].filter(l => l.getAttribute('Node1') === id).map(l => l.getAttribute('Node2'))
        .filter(child => byId(child)?.classList.contains('node-group') && (!only || only.has(child)))
        .sort((a, b) => { const [ya, xa] = at(a), [yb, xb] = at(b); return ya - yb || xa - xb; });
}

// L'arbre d'une branche : { id, text, kids } ; un node déjà rencontré n'y figure qu'une fois (cycles, parents multiples).
export function tree(rootId, seen = new Set(), only = null) {
    seen.add(rootId);
    const kids = children(rootId, only).filter(id => !seen.has(id)).map(id => { seen.add(id); return id; });
    return { id: rootId, text: textOf(byId(rootId)), kids: kids.map(id => tree(id, seen, only)) };
}

export function descendants(rootId) {
    const all = [];
    const walk = t => t.kids.forEach(k => { all.push(k.id); walk(k); });
    walk(tree(rootId));
    return all;
}

// Toute la dimension (ou les seuls nodes de `only`) : les racines (aucun lien entrant), puis ce qui resterait (cycles
// sans racine).
export function forest(only = null) {
    const kept = nodes().filter(n => !only || only.has(n.id));
    const entering = new Set([...universe.querySelectorAll('.link')].filter(l => !only || only.has(l.getAttribute('Node1')))
        .map(l => l.getAttribute('Node2')));
    const seen = new Set(), roots = [];
    [...kept.filter(n => !entering.has(n.id)), ...kept].forEach(node => {
        if (!seen.has(node.id)) roots.push(tree(node.id, seen, only));
    });
    return roots;
}

// Positions d'un arbre rangé de gauche à droite autour de `origin` (la racine reste où elle est). `size(id)` : demi-
// largeur et demi-hauteur. y vers le haut, comme Nodz.
export function layout(root, origin, size) {
    const band = t => (t.band = Math.max(2 * size(t.id).h + GAP_Y, t.kids.reduce((sum, k) => sum + band(k), 0)));
    band(root);
    const spots = new Map();
    const put = (t, x, top) => {  // top : haut de la bande du sous-arbre (y vers le bas)
        spots.set(t.id, { x, down: top + t.band / 2 });
        let y = top + (t.band - t.kids.reduce((sum, k) => sum + k.band, 0)) / 2;
        t.kids.forEach(k => {
            put(k, x + size(t.id).w + GAP_X + size(k.id).w, y);
            y += k.band;
        });
    };
    put(root, origin.x, 0);
    const shift = spots.get(root.id).down;
    return new Map([...spots].map(([id, p]) => [id, { x: p.x, y: origin.y - (p.down - shift) }]));
}

function move(node, x, y) {
    const match = (node.getAttribute('transform') || '').match(TRANSFORM);
    if (!match) return;
    const dx = x - parseFloat(node.getAttribute('x')), dy = y - parseFloat(node.getAttribute('y'));
    node.setAttribute('transform', `translate(${(parseFloat(match[1]) + dx).toFixed(3)}, ${(parseFloat(match[2]) - dy).toFixed(3)}) scale(${match[3]})`);
    node.setAttribute('x', x);
    node.setAttribute('y', y);
}

// Les nodes glissent vers leurs places, les liens suivent ; puis chacun est enregistré. Un node déjà à sa place ne
// bouge pas et n'est pas réenregistré.
export function glide(spots, duration = 450) {
    const moving = [...spots].map(([id, to]) => ({ node: byId(id), to })).filter(m => m.node)
        .map(m => ({ ...m, from: { x: parseFloat(m.node.getAttribute('x')), y: parseFloat(m.node.getAttribute('y')) } }))
        .filter(({ from, to }) => Math.hypot(to.x - from.x, to.y - from.y) > 0.5);
    const links = new Set(moving.flatMap(m => JSON.parse(m.node.getAttribute('links') || '[]')));
    return new Promise(resolve => {
        const start = performance.now();
        const frame = now => {
            const k = ease(Math.min(1, (now - start) / duration));
            moving.forEach(({ node, from, to }) => move(node, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k));
            links.forEach(id => { const link = byId(id); if (link) updateLink(link); });
            if (k < 1) return requestAnimationFrame(frame);
            // Enregistrés un à un, pas en rafale (un serveur peut refuser des connexions) ; l'écart reste sous celui
            // qui clôt un geste dans l'historique : un seul Ctrl+Z. En masse (bulk.js), ils partent groupés : d'un coup.
            if (window.nodzQuiet) return resolve(moving.forEach(({ node }) => save(node)));
            moving.reduce((queue, { node }) => queue.then(() => { save(node); return new Promise(r => setTimeout(r, SAVE_GAP)); }),
                Promise.resolve()).then(resolve);
        };
        requestAnimationFrame(frame);
    });
}

export function arrange(rootNode) {
    // Une branche repliée compte pour son seul node ; ses descendants cachés le suivent d'un bloc.
    const hidden = id => byId(id).classList.contains('gardien-folded');
    const full = tree(rootNode.id);
    const visible = t => ({ ...t, kids: t.kids.filter(k => !hidden(k.id)).map(visible) });
    const spots = layout(visible(full), { x: parseFloat(rootNode.getAttribute('x')), y: parseFloat(rootNode.getAttribute('y')) }, id => half(byId(id)));
    const at = id => ({ x: parseFloat(byId(id).getAttribute('x')), y: parseFloat(byId(id).getAttribute('y')) });
    const carry = (t, shift) => t.kids.forEach(k => {
        const here = at(k.id);
        const own = hidden(k.id) ? shift : { x: spots.get(k.id).x - here.x, y: spots.get(k.id).y - here.y };
        if (hidden(k.id)) spots.set(k.id, { x: here.x + shift.x, y: here.y + shift.y });
        carry(k, own);
    });
    carry(full, { x: 0, y: 0 });
    spots.delete(rootNode.id);
    return glide(spots);
}

// Vue éclatée (radiale) d'un arbre : la racine reste au centre ; chaque sous-arbre occupe un secteur d'angle
// proportionnel à son nombre de feuilles, chaque profondeur une couronne, assez grande pour que deux nodes voisins ne
// se touchent pas. Une branche repliée compte pour son seul node, ses descendants cachés la suivent d'un bloc.
const RING_GAP = 80;   // entre deux couronnes, et entre deux nodes voisins d'une couronne
export function explode(rootNode) {
    const hidden = id => byId(id).classList.contains('gardien-folded');
    const full = tree(rootNode.id);
    const visible = t => ({ ...t, kids: t.kids.filter(k => !hidden(k.id)).map(visible) });
    const shown = visible(full);
    const leaves = t => (t.leaves = t.kids.length ? t.kids.reduce((sum, k) => sum + leaves(k), 0) : 1);
    leaves(shown);
    const depths = [];
    const walk = (t, d) => { (depths[d] = depths[d] || []).push(t); t.kids.forEach(k => walk(k, d + 1)); };
    walk(shown, 0);
    const reach = t => { const s = half(byId(t.id)); return Math.hypot(s.w, s.h); };  // demi-diagonale
    const radius = [0];
    for (let d = 1; d < depths.length; d++) {
        const outer = Math.max(...depths[d].map(reach)), inner = Math.max(...depths[d - 1].map(reach));
        const room = shown.leaves * (2 * outer + RING_GAP) / (2 * Math.PI);  // une feuille par arc de 2π / feuilles
        radius[d] = Math.max(radius[d - 1] + inner + outer + RING_GAP, room);
    }
    const centre = { x: parseFloat(rootNode.getAttribute('x')), y: parseFloat(rootNode.getAttribute('y')) };
    const spots = new Map();
    const put = (t, d, from, to) => {
        const a = (from + to) / 2;
        if (d) spots.set(t.id, { x: centre.x + radius[d] * Math.cos(a), y: centre.y + radius[d] * Math.sin(a) });
        let start = from;
        t.kids.forEach(k => {
            const end = start + (to - from) * k.leaves / t.leaves;
            put(k, d + 1, start, end);
            start = end;
        });
    };
    put(shown, 0, -Math.PI, Math.PI);
    const at = id => ({ x: parseFloat(byId(id).getAttribute('x')), y: parseFloat(byId(id).getAttribute('y')) });
    const carry = (t, shift) => t.kids.forEach(k => {
        const here = at(k.id);
        const own = hidden(k.id) ? shift : { x: spots.get(k.id).x - here.x, y: spots.get(k.id).y - here.y };
        if (hidden(k.id)) spots.set(k.id, { x: here.x + shift.x, y: here.y + shift.y });
        carry(k, own);
    });
    carry(full, { x: 0, y: 0 });
    return glide(spots);
}

// --- export

const xml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const line = text => text.replace(/\s*\n\s*/g, ' ');

export function toMarkdown(roots) {
    const out = [];
    const walk = (t, depth) => {
        out.push(depth ? `${'  '.repeat(depth - 1)}- ${line(t.text) || '(vide)'}` : `# ${line(t.text) || '(vide)'}`);
        t.kids.forEach(k => walk(k, depth + 1));
    };
    roots.forEach((r, i) => { if (i) out.push(''); walk(r, 0); });
    return out.join('\n') + '\n';
}

export function toOpml(roots, title) {
    const walk = (t, pad) => (t.kids.length
        ? `${pad}<outline text="${xml(line(t.text))}">\n${t.kids.map(k => walk(k, `${pad}  `)).join('')}${pad}</outline>\n`
        : `${pad}<outline text="${xml(line(t.text))}"/>\n`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xml(title)}</title></head>\n  <body>\n${roots.map(r => walk(r, '    ')).join('')}  </body>\n</opml>\n`;
}

export function toFreemind(roots, title) {
    const walk = (t, pad) => (t.kids.length
        ? `${pad}<node TEXT="${xml(line(t.text))}">\n${t.kids.map(k => walk(k, `${pad}  `)).join('')}${pad}</node>\n`
        : `${pad}<node TEXT="${xml(line(t.text))}"/>\n`);
    const top = roots.length === 1 ? roots : [{ text: title, kids: roots }];
    return `<map version="1.0.1">\n${top.map(r => walk(r, '  ')).join('')}</map>\n`;
}

export const FORMATS = [
    ['Markdown', 'md', 'text/markdown', (roots) => toMarkdown(roots)],
    ['OPML', 'opml', 'text/x-opml', (roots, title) => toOpml(roots, title)],
    ['FreeMind', 'mm', 'application/x-freemind', (roots, title) => toFreemind(roots, title)],
];

// --- replier

export function createBranches({ say }) {
    let folds = {};
    try {
        folds = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch { /* stockage indisponible : les replis vivent le temps de la page */ }
    const keep = () => {
        try {
            localStorage.setItem(KEY, JSON.stringify(folds));
        } catch { /* stockage indisponible */ }
    };
    const here = () => String(layerNumber);
    const folded = () => new Set(folds[here()] || []);

    const layer = document.createElement('div');
    layer.id = 'gardien-folds';
    document.body.append(layer);

    // Masque les descendants des nodes repliés de la dimension ouverte ; une pastille +N pour chacun.
    function apply() {
        const roots = [...folded()].filter(id => byId(id));
        const hidden = new Set(roots.flatMap(descendants));
        roots.forEach(id => hidden.delete(id));  // un node replié dans une branche repliée garde sa propre pastille
        nodes().forEach(node => node.classList.toggle('gardien-folded', hidden.has(node.id)));
        universe.querySelectorAll('.link').forEach(link => link.classList.toggle('gardien-folded',
            hidden.has(link.getAttribute('Node1')) || hidden.has(link.getAttribute('Node2'))));
        // « +0 » (rien en dessous, liens pas encore là) : pas de pastille ; le repli reste noté.
        layer.replaceChildren(...roots.filter(id => !hidden.has(id) && descendants(id).length).map(id => {
            const badge = Object.assign(document.createElement('button'), { type: 'button', className: 'gf-badge',
                textContent: `+${descendants(id).length}`, title: t('br.unfoldTitle') });
            badge.dataset.node = id;
            badge.addEventListener('click', () => toggle(byId(id)));
            return badge;
        }));
    }
    (function track() {  // les pastilles suivent leurs nodes (zoom, glissé)
        // Une fenêtre de Nodz ouverte (profil, galerie, export…, sans z-index) : les pastilles passaient par-dessus.
        show(layer, !(typeof overlay !== 'undefined' && overlay));
        if (!layer.hidden) layer.querySelectorAll('.gf-badge').forEach(badge => {
            const node = byId(badge.dataset.node);
            const box = node && (node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1]).getBoundingClientRect();
            // Au dézoom, la pastille rapetisse avec le node (jamais au-delà de sa taille) et disparaît sous MIN_BADGE px.
            const big = box?.width >= MIN_BADGE;
            show(badge, big);
            // En miroir de la poignée de taille (nodebar.js) par rapport au diamètre horizontal : coin haut-droit d'un
            // rectangle, à 45° en haut à droite d'un rond.
            if (!big) return;
            const square = node.getAttribute('shape') === 'square';
            const dx = square ? box.width / 2 : box.width / 2 * Math.SQRT1_2, dy = square ? box.height / 2 : box.height / 2 * Math.SQRT1_2;
            const x = box.left + box.width / 2 + dx, y = box.top + box.height / 2 - dy;
            setStyle(badge, 'transform', `translate(calc(${x.toFixed(1)}px - 50%), calc(${y.toFixed(1)}px - 50%)) scale(${Math.min(1, Number(currentZoom)).toFixed(3)})`);
        });
        requestAnimationFrame(track);
    })();
    // Un chargement de dimension (ou des nodes qui arrivent) : les replis de cette dimension reviennent.
    // (un node témoin qui n'est plus dans la page : la dimension a été rechargée, ses nodes sont tout neufs).
    let seen = '', witness = null;
    setInterval(() => {
        if (typeof layerNumber === 'undefined' || isLoading) return;
        const now = `${layerNumber}:${universe.querySelectorAll('.node-group').length}:${universe.querySelectorAll('.link').length}`;
        if (now !== seen || (witness && !witness.isConnected)) apply();
        seen = now;
        witness = universe.querySelector('.node-group');
    }, 300);

    function toggle(node) {
        const set = folded();
        const unfolding = set.has(node.id);
        if (unfolding) set.delete(node.id); else set.add(node.id);
        folds[here()] = [...set];
        keep();
        apply();
        // Déplier : seule la branche rouverte se range (ses nodes qui reviennent), le reste de la dimension ne bouge pas
        // et n'est pas réenregistré.
        if (unfolding) arrange(node);
    }

    // Menu « Branche » de la barre d'outils du node.
    const menu = document.createElement('div');
    menu.id = 'gardien-branch';
    menu.hidden = true;
    document.body.append(menu);
    // Hors du menu et de la barre d'outils du node (son bouton Branche ouvre et referme lui-même le menu).
    document.addEventListener('mousedown', event => {
        if (!menu.contains(event.target) && !event.target.closest?.('#gardien-nodebar')) menu.hidden = true;
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.hidden = true; });
    const item = (label, title, run) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, title,
        onclick: () => { menu.hidden = true; run(); } });


    return {
        // Le menu d'une branche, ouvert sous `anchor` (DOMRect du bouton de la barre d'outils).
        open(node, anchor) {
            const count = descendants(node.id).length;
            const isFolded = folded().has(node.id);
            menu.replaceChildren(
                item(t('br.tree'), t('br.treeTitle'), () => {
                    if (isFolded) toggle(node);
                    arrange(node).then(() => say(t(count > 1 ? 'br.arrangedN' : 'br.arranged1', { count })));
                }),
                item(isFolded ? t('br.unfold', { count }) : t('br.fold', { count }), isFolded ? t('br.unfoldHint') : t('br.foldHint'), () => toggle(node)));
            menu.style.left = `${Math.min(innerWidth - 190, anchor.left)}px`;
            menu.style.top = `${anchor.bottom + 6}px`;
            menu.hidden = false;
        },
        hasBranch: node => children(node.id).length > 0,
        // Toute la dimension `layer` dépliée (la maison du Gardien se montre en entier), sans rien déplacer.
        unfoldAll: layer => {
            delete folds[String(layer)];
            keep();
            apply();
        },
        apply,
    };
}
