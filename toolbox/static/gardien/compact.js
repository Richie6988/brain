// Mode compact : une vue passagère pour lire d'un coup d'œil une arborescence complexe. Les nodes sélectionnés (sinon
// toute la dimension, branches repliées laissées) se rangent selon le choix de la barre : Arbre (les liens de parent
// à enfant, de gauche à droite), Nuage (les plus reliés au centre, en plus grand), Processus horizontal ou vertical
// (une étape par niveau, dans le sens des liens). Les formes s'effacent : seul le contenu reste, en texte net. Rien
// n'est enregistré : un node réécrit en compact est sauvegardé à sa place éclatée, et le retour (bouton, C, Échap) rend
// chaque node à sa place exacte. Déplacer un node, changer de dimension ou une action du Gardien ramènent à l'éclaté.

import { t } from './i18n.js';
const DURATION = 380;  // ms de transition
const READABLE = 0.75; // zoom minimal du cadrage : en deçà, les textes ne se lisent plus
const KEEP = 'gardien-compact-layout';

const ICONS = {
    tree: '<path d="M4 12h5M9 6v12M9 6h4M9 18h4M13 12h-4"/><circle cx="4" cy="12" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="18" r="1.6"/>',
    cloud: '<circle cx="12" cy="12" r="3.2"/><circle cx="5" cy="8" r="1.6"/><circle cx="19" cy="9" r="2"/><circle cx="7" cy="17" r="1.8"/><circle cx="17.5" cy="17" r="1.4"/>',
    row: '<rect x="2.5" y="9" width="5" height="6" rx="1.5"/><rect x="16.5" y="9" width="5" height="6" rx="1.5"/><rect x="9.5" y="9" width="5" height="6" rx="1.5"/>',
    column: '<rect x="9" y="2.5" width="6" height="5" rx="1.5"/><rect x="9" y="9.5" width="6" height="5" rx="1.5"/><rect x="9" y="16.5" width="6" height="5" rx="1.5"/>',
};
const LAYOUTS = [
    { id: 'tree', label: t('cp.tree'), title: t('cp.tree') },
    { id: 'cloud', label: t('cp.cloud'), title: t('cp.cloudTitle') },
    { id: 'row', label: t('cp.row'), title: t('cp.rowTitle') },
    { id: 'column', label: t('cp.column'), title: t('cp.columnTitle') },
];

const TRANSFORM = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;
const place = node => ({ x: parseFloat(node.getAttribute('x')), y: parseFloat(node.getAttribute('y')) });
const ease = t => 1 - (1 - t) ** 3;

// Repère d'un node : sa place et la translation de son transform, lus une fois par transition (relus à chaque image,
// leurs arrondis s'additionnaient et le node ne revenait pas exactement à sa place).
function basis(node) {
    const match = (node.getAttribute('transform') || '').match(TRANSFORM);
    return match && { ...place(node), tx: parseFloat(match[1]), ty: parseFloat(match[2]), scale: match[3] };
}

// Pose un node en (x, y) de l'univers comme le glissé de Nodz (transform à l'écran, y vers le haut), sans l'enregistrer.
function put(node, x, y, base = basis(node)) {
    if (!base) return;
    node.setAttribute('transform', `translate(${(base.tx + x - base.x).toFixed(3)}, ${(base.ty - (y - base.y)).toFixed(3)}) scale(${base.scale})`);
    node.setAttribute('x', x);
    node.setAttribute('y', y);
}

// Taille du contenu des nodes dans l'univers (le texte, l'image…), sans leur forme. Nodz cache les nodes hors de
// l'écran (display none, sans taille) : le temps de la mesure ils s'affichent tous, en une seule passe de mise en page.
function measure(items) {
    items.forEach(i => { if (i.node.style.display === 'none') i.node.style.display = 'block'; });
    items.forEach(i => {
        const r = (i.node.children[0]?.children[0] || i.node.children[0] || i.node).getBoundingClientRect();
        i.w = r.width / currentZoom;
        i.h = r.height / currentZoom;
    });
}

// Liens entre les nodes rangés : sortants (Node1 vers Node2, de parent à enfant) et entrants, par indice.
function graph(items) {
    const index = new Map(items.map((i, k) => [i.node.id, k]));
    const out = items.map(() => []), inn = items.map(() => []);
    document.querySelectorAll('.link').forEach(link => {
        const a = index.get(link.getAttribute('Node1')), b = index.get(link.getAttribute('Node2'));
        if (a === undefined || b === undefined || a === b) return;
        out[a].push(b);
        inn[b].push(a);
    });
    return { out, inn };
}

// Les rangements calculent des positions locales (u vers la droite, v vers le bas) en une passe, sans relaxation.

// Nodes sans aucun lien : en grille sous le reste (ils n'ont ni parent ni étape).
function grid(items, list, top, width) {
    let u = 0, v = top, line = 0;
    const at = new Map();
    list.forEach(k => {
        const { w, h } = items[k];
        if (u && u + w > width) { u = 0; v += line + 18; line = 0; }
        at.set(k, { u: u + w / 2, v: v + h / 2 });
        u += w + 40;
        line = Math.max(line, h);
    });
    return at;
}

// Arbre de gauche à droite : une colonne par profondeur, chaque parent au milieu de ses enfants.
function tree(items, g) {
    const n = items.length, kids = items.map(() => []), depth = new Array(n).fill(-1), at = new Map();
    const top = (a, b) => items[b].home.y - items[a].home.y || items[a].home.x - items[b].home.x;  // haut de la carte d'abord
    const linked = [...items.keys()].filter(k => g.out[k].length || g.inn[k].length);
    const roots = [];
    const grow = root => {
        roots.push(root);
        depth[root] = 0;
        for (let q = [root], k = 0; k < q.length; k++) {
            const p = q[k];
            [...new Set(g.out[p])].sort(top).forEach(c => {
                if (depth[c] !== -1) return;
                depth[c] = depth[p] + 1;
                kids[p].push(c);
                q.push(c);
            });
        }
    };
    linked.filter(k => !g.inn[k].length).sort(top).forEach(grow);  // racines : aucun lien entrant
    linked.sort(top).forEach(k => { if (depth[k] === -1) grow(k); });  // boucles sans racine
    const widths = [];
    linked.forEach(k => { widths[depth[k]] = Math.max(widths[depth[k]] || 0, items[k].w); });
    const column = [0];
    widths.forEach((w, d) => { column[d + 1] = column[d] + w + 70; });
    const low = [];  // bas du dernier node posé, par colonne
    let cursor = 0;
    const shift = (p, d) => {
        const a = at.get(p);
        a.v += d;
        low[depth[p]] = Math.max(low[depth[p]] ?? -Infinity, a.v + items[p].h / 2);
        kids[p].forEach(c => shift(c, d));
    };
    const lay = p => {
        const { w, h } = items[p], d = depth[p];
        kids[p].forEach(lay);
        const v = kids[p].length ? (at.get(kids[p][0]).v + at.get(kids[p].at(-1)).v) / 2 : cursor + h / 2;
        at.set(p, { u: column[d] + w / 2, v });
        const room = (low[d] ?? -Infinity) + 14 - (v - h / 2);
        if (room > 0) shift(p, room);
        else low[d] = v + h / 2;
        cursor = Math.max(cursor, ...low.filter(Number.isFinite).map(b => b + 14));
    };
    roots.forEach(r => { lay(r); cursor += 30; });  // un peu d'air entre deux arbres
    const alone = [...items.keys()].filter(k => depth[k] === -1);
    grid(items, alone, cursor + 40, Math.max(column.at(-1), 900)).forEach((a, k) => at.set(k, a));
    return { at, anchor: roots[0] ?? 0 };
}

// Processus : une bande par étape (plus long chemin depuis les débuts, boucles coupées), dans le sens des liens.
// Horizontal : les étapes en colonnes de gauche à droite ; vertical : en lignes de haut en bas, coupées si trop longues.
function process(items, g, horizontal) {
    const level = items.map(() => -1), left = items.map((_, k) => new Set(g.inn[k]).size), done = items.map(() => false);
    const first = horizontal ? (a, b) => items[b].home.y - items[a].home.y : (a, b) => items[a].home.x - items[b].home.x;
    const linked = [...items.keys()].filter(k => g.out[k].length || g.inn[k].length);
    linked.forEach(k => { level[k] = 0; });
    const queue = linked.filter(k => !left[k]).sort(first);
    for (let count = 0; count < linked.length;) {
        // Boucle sans début : son node le plus en amont sur la carte en devient un.
        if (!queue.length) queue.push(linked.filter(k => !done[k]).sort(first)[0]);
        const p = queue.shift();
        if (done[p]) continue;
        done[p] = true;
        count += 1;
        new Set(g.out[p]).forEach(c => {
            if (done[c]) return;
            level[c] = Math.max(level[c], level[p] + 1);
            if (--left[c] === 0) queue.push(c);
        });
    }
    const levels = [];
    linked.forEach(k => (levels[level[k]] ||= []).push(k));
    const order = new Map();
    levels.forEach((band, l) => {  // dans une étape, à hauteur de ses prédécesseurs (moins de croisements)
        const rank = k => {
            const before = g.inn[k].filter(p => order.has(p)).map(p => order.get(p));
            return before.length ? before.reduce((a, b) => a + b, 0) / before.length : Infinity;
        };
        band.sort(first);
        if (l) band.sort((a, b) => rank(a) - rank(b));
        band.forEach((k, i) => order.set(k, i));
    });
    const at = new Map(), cross = horizontal ? 16 : 36, gap = horizontal ? 90 : 50, long = horizontal ? 1100 : 1700;
    let main = 0;
    levels.filter(Boolean).forEach(band => {
        const chunks = [[]];
        let length = 0;
        band.forEach(k => {
            const s = horizontal ? items[k].h : items[k].w;
            if (chunks.at(-1).length && length + s > long) { chunks.push([]); length = 0; }
            chunks.at(-1).push(k);
            length += s + cross;
        });
        chunks.forEach(chunk => {
            const thick = Math.max(...chunk.map(k => (horizontal ? items[k].w : items[k].h)));
            let c = -(chunk.reduce((t, k) => t + (horizontal ? items[k].h : items[k].w) + cross, 0) - cross) / 2;
            chunk.forEach(k => {
                const s = horizontal ? items[k].h : items[k].w;
                at.set(k, horizontal ? { u: main + thick / 2, v: c + s / 2 } : { u: c + s / 2, v: main + thick / 2 });
                c += s + cross;
            });
            main += thick + gap;
        });
    });
    const box = [...at.values()];
    const bottom = box.length ? Math.max(...box.map(a => a.v)) + 60 : 0, width = horizontal ? Math.max(main, 900) : long;
    const alone = [...items.keys()].filter(k => level[k] === -1);
    grid(items, alone, bottom + 40, width).forEach((a, k) => at.set(k, { u: a.u - (horizontal ? 0 : width / 2), v: a.v }));
    return { at, anchor: levels[0]?.[0] ?? 0 };
}

// Nuage : du plus relié au moins relié, en spirale depuis le centre, chacun à la première place libre.
function cloud(items, order) {
    const at = new Map(), cells = new Map(), CELL = 140, PAD = 10;
    const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    const span = (u, v, w, h, visit) => {
        for (let x = Math.floor((u - w / 2 - PAD) / CELL); x <= Math.floor((u + w / 2 + PAD) / CELL); x++)
            for (let y = Math.floor((v - h / 2 - PAD) / CELL); y <= Math.floor((v + h / 2 + PAD) / CELL); y++) if (visit(`${x},${y}`)) return true;
        return false;
    };
    const free = (u, v, w, h) => !span(u, v, w, h, cell => (cells.get(cell) || []).some(o =>
        Math.abs(o.u - u) < (o.w + w) / 2 + PAD && Math.abs(o.v - v) < (o.h + h) / 2 + PAD));
    let from = 0;  // le centre se remplit : chaque node reprend la spirale un peu avant la place du précédent
    order.forEach(k => {
        const { w, h } = items[k];
        let t = from * 0.8, u = 7 * t * Math.cos(t) * 1.7, v = 7 * t * Math.sin(t);
        while (!free(u, v, w, h)) {  // spirale d'Archimède, plus large que haute (comme l'écran)
            t += 9 / Math.max(9, 7 * t);
            u = 7 * t * Math.cos(t) * 1.7;
            v = 7 * t * Math.sin(t);
        }
        from = t;
        const box = { u, v, w, h };
        at.set(k, { u, v });
        span(u, v, w, h, cell => { (cells.get(cell) || cells.set(cell, []).get(cell)).push(box); });
    });
    return { at, anchor: order[0] };
}

export function createCompact({ bridge, say }) {
    let items = null;      // en compact : [{ node, home, x, y, w, h }]
    let layer = null;
    let animating = 0;
    let kind = 'tree';
    try { kind = LAYOUTS.some(l => l.id === localStorage.getItem(KEEP)) ? localStorage.getItem(KEEP) : kind; } catch { /* stockage indisponible */ }

    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'compactButton', title: 'Compact (C)' });
    document.getElementById('visitButton')?.after(button);
    button.addEventListener('click', () => toggle());

    // Barre des rangements, en haut de l'écran pendant le compact.
    const bar = Object.assign(document.createElement('div'), { id: 'gardien-compact-bar', hidden: true });
    const count = document.createElement('span');
    count.className = 'gc-count';
    bar.append(count);
    const choices = LAYOUTS.map((l, k) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', title: `${l.title} (${k + 1})` });
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[l.id]}</svg><span>${l.label}</span>`;
        b.addEventListener('click', () => arrange(l.id));
        bar.append(b);
        return b;
    });
    const quit = Object.assign(document.createElement('button'), { type: 'button', className: 'gc-quit', textContent: t('cp.quit'), title: t('cp.quitTitle') });
    quit.addEventListener('click', () => off());
    bar.append(quit);
    document.body.append(bar);

    // Un node réécrit en compact s'enregistre à sa place éclatée : le compact n'est jamais sauvegardé.
    const inner = window.save;
    window.save = function (node, tunnel) {
        const item = items?.find(i => i.node === node);
        if (!item) return inner(node, tunnel);
        const shown = place(node);
        node.setAttribute('x', item.home.x);
        node.setAttribute('y', item.home.y);
        try {
            return inner(node, tunnel);
        } finally {
            node.setAttribute('x', shown.x);
            node.setAttribute('y', shown.y);
        }
    };

    // Transition : chaque node glisse de `from` à `to`, ses liens suivent ; `view` (écran) glisse la vue en même temps.
    // Seuls glissent les nodes à l'écran au départ ou à l'arrivée : les autres sautent d'un coup (rien à voir, et des
    // centaines de nodes de moins à redessiner à chaque image).
    function slide(moves, view = { x: 0, y: 0 }) {
        let done = 0;
        const run = ++animating, start = performance.now();
        const screen = (p, dx = 0, dy = 0) => ({ x: p.x * currentZoom - parseFloat(root.getAttribute('x')) + centerX + dx,
            y: -p.y * currentZoom + parseFloat(root.getAttribute('y')) + centerY + dy });
        const seen = ({ x, y }) => x > -300 && x < window.innerWidth + 300 && y > -300 && y < window.innerHeight + 300;
        const moving = moves.filter(m => seen(screen(m.from)) || seen(screen(m.to, view.x, view.y)));
        const linksOf = list => new Set(list.flatMap(m => JSON.parse(m.node.getAttribute('links') || '[]')));
        const follow = links => links.forEach(id => {
            const link = document.getElementById(id);
            if (!link) return;
            updateLink(link);
            if (linkState === 0) updateLinkColor(link);
        });
        const still = new Set(moving);
        const jumps = moves.filter(m => !still.has(m));
        jumps.forEach(m => { if (m.node.isConnected) put(m.node, m.to.x, m.to.y); });
        follow(linksOf(jumps));
        const links = linksOf(moving);
        moving.forEach(m => { m.base = basis(m.node); });
        return new Promise(resolve => {
            (function frame(now) {
                if (run !== animating) return resolve(false);
                const k = ease(Math.min(1, (now - start) / DURATION));
                if (view.x || view.y) dragUniverse(view.x * (k - done), view.y * (k - done), false);
                done = k;
                moving.forEach(m => {
                    if (!m.node.isConnected) return;
                    if (k === 1) put(m.node, m.to.x, m.to.y, m.base);  // la place exacte, sans reste d'interpolation
                    else put(m.node, m.from.x + (m.to.x - m.from.x) * k, m.from.y + (m.to.y - m.from.y) * k, m.base);
                });
                follow(links);
                if (k < 1) requestAnimationFrame(frame);
                else resolve(true);
            })(start);
        });
    }

    // Range les nodes du compact selon `id`, en glissant depuis leur place actuelle, puis cadre le résultat.
    async function arrange(id) {
        if (!items) return;
        kind = id;
        try { localStorage.setItem(KEEP, id); } catch { /* stockage indisponible */ }
        choices.forEach((b, k) => b.classList.toggle('on', LAYOUTS[k].id === id));
        const g = graph(items);
        const degree = items.map((_, k) => new Set([...g.out[k], ...g.inn[k]]).size);
        const order = [...items.keys()].sort((a, b) => degree[b] - degree[a] || items[b].home.y - items[a].home.y);
        const most = Math.max(1, ...degree);
        // Nuage : la taille du texte dit combien un node est relié (14 à 32 px) ; ailleurs, la taille du compact.
        items.forEach((i, k) => {
            if (id === 'cloud') i.node.style.setProperty('--gc-font', `${Math.round(14 + 18 * Math.sqrt(degree[k] / most))}px`);
            else i.node.style.removeProperty('--gc-font');
        });
        measure(items);
        const { at, anchor } = id === 'tree' ? tree(items, g) : id === 'cloud' ? cloud(items, order) : process(items, g, id === 'row');
        // Le rangement se centre là où étaient les nodes, quel que soit le rangement choisi.
        const box = items.map((i, k) => ({ ...at.get(k), w: i.w, h: i.h }));
        const u0 = Math.min(...box.map(b => b.u - b.w / 2)), u1 = Math.max(...box.map(b => b.u + b.w / 2));
        const v0 = Math.min(...box.map(b => b.v - b.h / 2)), v1 = Math.max(...box.map(b => b.v + b.h / 2));
        const cx = items.reduce((t, i) => t + i.home.x, 0) / items.length, cy = items.reduce((t, i) => t + i.home.y, 0) / items.length;
        const from = items.map(i => place(i.node));
        items.forEach((i, k) => { i.x = cx + box[k].u - (u0 + u1) / 2; i.y = cy - (box[k].v - (v0 + v1) / 2); });
        dispatcher();
        if (!(await slide(items.map((i, k) => ({ node: i.node, from: from[k], to: { x: i.x, y: i.y } }))))) return;
        if (!items) return;  // déjà quitté pendant la transition
        dispatcher();  // nodes déplacés : Nodz remontre ceux qui entrent à l'écran
        frame(items[anchor]);
    }

    // Tout le rangement sous les yeux s'il reste lisible ; sinon cadré au zoom lisible depuis son début (la racine de
    // l'arbre, la première étape, le cœur du nuage).
    function frame(start) {
        const x0 = Math.min(...items.map(i => i.x - i.w / 2)), x1 = Math.max(...items.map(i => i.x + i.w / 2));
        const y0 = Math.min(...items.map(i => i.y - i.h / 2)), y1 = Math.max(...items.map(i => i.y + i.h / 2));
        const fit = Math.min(window.innerWidth / (x1 - x0 + 120), (window.innerHeight - 140) / (y1 - y0 + 120));
        if (fit >= READABLE) return bridge.frame({ x0, x1, y0, y1 }, 60);
        const hw = window.innerWidth / READABLE / 2 - 60, hh = (window.innerHeight - 140) / READABLE / 2 - 60;
        const c = kind === 'cloud' ? { x: start.x, y: start.y }
            : kind === 'column' ? { x: (x0 + x1) / 2, y: y1 - hh }
            : { x: x0 + hw, y: kind === 'tree' ? start.y : (y0 + y1) / 2 };
        bridge.frame({ x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh }, 60);
    }

    function on() {
        // La sélection (au moins deux nodes) ; sinon toute la dimension. Une branche repliée reste repliée, hors du rangement.
        const shown = node => node.isConnected && !node.classList.contains('gardien-folded');
        const picked = selectedNodes.filter(shown);
        const nodes = picked.length >= 2 ? [...new Set(picked)] : [...document.querySelectorAll('.node-group:not(.gardien-folded)')];
        if (nodes.length < 2) return say(t('cp.few'), 'notice');
        layer = layerNumber;
        items = nodes.map(node => ({ node, home: place(node) }));
        // Le reste de la carte s'efface derrière une sélection.
        const inside = new Set(nodes.map(n => n.id));
        if (picked.length >= 2) {
            document.querySelectorAll('.node-group').forEach(n => { if (!inside.has(n.id)) n.classList.add('gc-out'); });
            document.querySelectorAll('.link').forEach(l => { if (!inside.has(l.getAttribute('Node1')) || !inside.has(l.getAttribute('Node2'))) l.classList.add('gc-out'); });
        }
        nodes.forEach(n => n.style.setProperty('--node-color', n.getAttribute('color') || '#33FF99'));  // pastille du texte
        document.body.classList.add('gardien-compact');  // formes effacées d'abord : les tailles mesurées sont celles du texte
        count.textContent = t(picked.length >= 2 ? 'cp.countPicked' : 'cp.count', { n: nodes.length });
        bar.hidden = false;
        button.classList.add('on');
        return arrange(kind);
    }

    // Retour à l'éclaté : chaque node à sa place exacte ; le node au centre de l'écran y reste (la vue suit).
    function off() {
        if (!items) return Promise.resolve();
        const back = items;
        items = null;
        bar.hidden = true;
        button.classList.remove('on');
        document.body.classList.remove('gardien-compact');
        document.querySelectorAll('.gc-out').forEach(e => e.classList.remove('gc-out'));
        back.forEach(i => { i.node.style.removeProperty('--node-color'); i.node.style.removeProperty('--gc-font'); });
        if (layer !== layerNumber) return Promise.resolve();  // dimension quittée : ses nodes sont déjà rechargés à leur place
        animating += 1;
        back.forEach(i => { if (i.node.isConnected) put(i.node, i.x, i.y); });
        const c = bridge.center();
        const anchor = back.reduce((best, i) => (Math.hypot(i.x - c.x, i.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? i : best));
        return slide(back.map(i => ({ node: i.node, from: { x: i.x, y: i.y }, to: i.home })),
            { x: (anchor.x - anchor.home.x) * currentZoom, y: (anchor.home.y - anchor.y) * currentZoom }).then(() => dispatcher());
    }

    const toggle = () => (items ? off() : on());

    // C bascule ; en compact, 1 à 4 choisissent le rangement et Échap revient à l'éclaté (hors saisie et fenêtres).
    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
        if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('.gl-modal:not([hidden])')) return;
        const key = event.key.toLowerCase(), pick = items && LAYOUTS[Number(key) - 1];
        if (key !== 'c' && !pick && !(items && key === 'escape')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pick) arrange(pick.id);
        else if (key === 'escape') off();
        else toggle();
    }, true);

    // Déplacer un node ramène d'abord à l'éclaté (le glissé continue depuis sa vraie place).
    let press = null;
    document.addEventListener('pointerdown', event => { press = items && event.target.closest?.('.node-group') ? [event.clientX, event.clientY] : null; }, true);
    document.addEventListener('pointermove', event => {
        if (press && event.buttons && Math.hypot(event.clientX - press[0], event.clientY - press[1]) > 4) {
            press = null;
            off();
        }
    }, true);
    // Changer de dimension (ou un rechargement) quitte le compact.
    setInterval(() => { if (items && (isLoading || layerNumber !== layer)) off(); }, 300);

    return { off };
}
