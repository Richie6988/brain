// Visite pilotée : le joueur se déplace de node en node. De grosses flèches entourent le node central, une par lien
// (et par portail), chacune pointant vers son node ; un clic (ou la flèche du clavier la plus proche) y glisse la
// caméra et les flèches se recalculent autour du nouveau centre. En haut, l'overview : le chemin parcouru (un clic y
// revient) et la carte du node, celui où l'on est, ou la destination de la flèche survolée (texte, couleur, auteur,
// date). Un clic sur un autre node en fait le centre ; un clic dans le vide, ou Échap, quitte la visite.
// Les portails comptent comme des liens : la visite passe dans la dimension de l'autre bout (elle s'y charge). Un pas
// du parcours est donc { id, layer } et non un élément de la page, que le chargement remplace. Rien n'est modifié.

import { api } from './api.js';
import { h } from './library.js';

const GAP = 0.42;  // écart minimal entre deux flèches (radians, ~24°)
const ARROW = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 17h18V7l16 17-16 17V31H8z"/></svg>';
// Texte d'un node avec ses retours à la ligne (innerText les perd quand le node est caché hors de l'écran).
function textOf(node) {
    const html = node?.children[0]?.children[0]?.innerHTML || '';
    const box = document.createElement('div');
    box.innerHTML = html.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n');
    return box.textContent.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}
// Ce que la visite dit d'un node : son texte ; pour une image, un fichier ou un dessin, son genre (et le nom du
// fichier), pas « (node vide) ».
function labelOf(node) {
    const text = textOf(node), type = node.getAttribute('type');
    const name = node.getAttribute('filename');
    const kind = type === 'file' ? (name && name !== 'null' ? `Fichier · ${name}` : 'Fichier')
        : type === 'image' ? 'Image' : type === 'canvas' ? 'Dessin' : '';
    return [kind, text].filter(Boolean).join('\n') || '(node vide)';
}
const ORIGIN = { human: 'écrit par', ai: 'créé par', message: 'message de' };
const when = iso => {
    const date = new Date(iso), minutes = Math.round((Date.now() - date) / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
    return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`
        + ` à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const short = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text) || '(node vide)';

const parse = raw => {
    try {
        const value = JSON.parse(raw || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};
const layerName = layer => layers.find(l => l.id === layer)?.name || `dimension ${layer}`;

// Pas voisins d'un node : par ses liens (attributs Node1 / Node2 des liens de Nodz), puis par ses portails (champ
// quantum : [{ node, layer }]). Un univers d'un autre compte (admin) ne se charge pas : ses portails sont ignorés.
function neighbours(node) {
    const linked = parse(node.getAttribute('links')).map(id => document.getElementById(id)).filter(Boolean)
        .map(link => (link.getAttribute('Node1') === node.id ? link.getAttribute('Node2') : link.getAttribute('Node1')))
        .filter(id => document.getElementById(id)?.classList.contains('node-group'))
        .map(id => ({ id, layer: layerNumber }));
    const portals = parse(node.getAttribute('quantum')).filter(p => p?.node)
        .map(p => ({ id: String(p.node).startsWith('N-') ? String(p.node) : `N-${p.node}`, layer: Number(p.layer) || layerNumber, portal: true }))
        .filter(p => !(typeof admin !== 'undefined' && admin && p.layer !== layerNumber) && !linked.some(l => l.id === p.id));
    return [...linked, ...portals].filter((s, i, all) => all.findIndex(o => o.id === s.id) === i);
}
// Forme visible d'un node (cercle ou rectangle) : centre et rayon à l'écran.
function disc(node) {
    const shape = node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1];
    const r = (shape || node).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.max(r.width, r.height) / 2 };
}
// Écarte les angles trop proches (deux liens presque dans la même direction) pour que chaque flèche reste cliquable.
function spread(angles) {
    const order = angles.map((a, i) => i).sort((i, j) => angles[i] - angles[j]);
    const out = [...angles];
    for (let pass = 0; pass < 12; pass++) {
        for (let k = 0; k < order.length && order.length > 1; k++) {
            const i = order[k], j = order[(k + 1) % order.length];
            let d = out[j] - out[i];
            if (k === order.length - 1) d += 2 * Math.PI;
            if (d < GAP) {
                out[i] -= (GAP - d) / 2;
                out[j] += (GAP - d) / 2;
            }
        }
    }
    return out;
}
// Angle libre pour une flèche sans direction (portail vers une autre dimension) : le plus loin des autres.
function freeAngle(taken) {
    let best = Math.PI / 2, score = -1;
    for (let k = 0; k < 48; k++) {
        const a = (k / 48) * 2 * Math.PI;
        const d = Math.min(Math.PI, ...taken.map(t => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t)))));
        if (d > score) [best, score] = [a, d];
    }
    return best;
}

export function createTour({ bridge, say }) {
    // trail : chaque arrivée, dans l'ordre ; info : texte, couleur de chaque node rencontré (chemin, aperçus) ;
    // meta : traçabilité (route toolbox/nodes/meta) ; arrows : flèches du node central.
    const state = { trail: [], seen: new Set(), info: new Map(), meta: new Map(), arrows: [], hover: null, moving: false, run: 0 };

    const crumbs = h('nav', { class: 'gt-crumbs', 'aria-label': 'Chemin parcouru' });
    const swatch = h('span', { class: 'gt-swatch' });
    const tag = h('small', { class: 'gt-tag' });
    const heading = h('b', { class: 'gt-title' });
    const body = h('span', { class: 'gt-body' });
    const meta = h('p', { class: 'gt-meta' });
    const back = h('button', { type: 'button', class: 'gt-back', title: 'Revenir au node précédent (Retour arrière)', onclick: previous }, '⟲');
    const quit = h('button', { type: 'button', class: 'gt-quit', title: 'Quitter la visite (Échap)', onclick: stop }, '✕');
    const card = h('section', { id: 'gardien-tour', hidden: true, role: 'region', 'aria-label': 'Visite' },
        h('header', {}, crumbs, back, quit),
        h('div', { class: 'gt-current' }, swatch, h('span', { class: 'gt-text' }, tag, heading, body)), meta);
    const ring = h('div', { id: 'gardien-arrows', hidden: true });
    document.body.append(card, ring);

    const here = () => state.trail.at(-1);
    const element = step => (step && step.layer === layerNumber ? document.getElementById(step.id) : null);
    const colorOf = id => state.info.get(id)?.color || '#b89af2';
    const label = step => state.info.get(step.id)?.text || `⟿ ${layerName(step.layer)}`;
    const remember = node => state.info.set(node.id, { text: labelOf(node), color: node.getAttribute('color'), layer: layerNumber });

    // Un clic sans glissé : sur un autre node, il devient le centre ; dans le vide de l'univers, la visite s'arrête.
    // Un glissé ou la molette déplacent la vue : les flèches suivent.
    let press = null;
    document.addEventListener('pointerdown', event => {
        press = card.hidden || card.contains(event.target) || ring.contains(event.target) ? null : [event.clientX, event.clientY, event.target];
    }, true);
    document.addEventListener('pointerup', event => {
        const [x, y, target] = press || [];
        press = null;
        if (!target || Math.hypot(event.clientX - x, event.clientY - y) >= 5 || !svg.contains(target)) return;
        const node = target.closest?.('.node-group');
        if (!node) return stop();
        if (node.id !== here()?.id) setTimeout(() => go({ id: node.id, layer: layerNumber }));  // après la sélection de Nodz
    }, true);

    // Raccourcis pendant la visite : Échap partout ; flèches du clavier et Retour arrière hors saisie.
    const KEYS = { ArrowRight: 0, ArrowDown: Math.PI / 2, ArrowLeft: Math.PI, ArrowUp: -Math.PI / 2 };
    document.addEventListener('keydown', event => {
        if (card.hidden) return;
        if (event.key === 'Escape') stop();
        else if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
        else if (event.key === 'Backspace') previous();
        else if (event.key in KEYS) {
            const want = KEYS[event.key];
            const near = state.arrows.map(a => ({ a, d: Math.abs(Math.atan2(Math.sin(a.angle - want), Math.cos(a.angle - want))) }))
                .filter(o => o.d < 1.2).sort((p, q) => p.d - q.d)[0];
            if (near) go(near.a.step);
        } else return;
        event.preventDefault();
        event.stopImmediatePropagation();  // ni node créé, ni raccourci de Nodz
    }, true);

    // La carte de l'overview : le node survolé par une flèche (destination), sinon celui où l'on est.
    function paint() {
        const step = state.hover || here();
        if (!step) return;
        const color = colorOf(step.id);
        swatch.style.background = color;
        card.style.setProperty('--c', color);
        card.classList.toggle('preview', Boolean(state.hover));
        tag.textContent = state.hover ? (step.layer !== here().layer ? `Portail · ${layerName(step.layer)}` : state.seen.has(step.id) ? 'Déjà vu' : 'Destination')
            : `Ici · ${layerName(step.layer)}`;
        const [first = '', ...rest] = label(step).split('\n');
        heading.textContent = short(first, 90);
        body.textContent = rest.length ? short(rest.join(' · '), 220) : '';
        const facts = state.meta.get(step.id);
        meta.replaceChildren(...(facts ? [
            h('span', { class: `gt-origin ${facts.origin}` }, `${ORIGIN[facts.origin] || 'par'} ${facts.author}`),
            h('span', {}, `créé ${when(facts.created)}`),
            ...(Math.abs(new Date(facts.modified) - new Date(facts.created)) > 60000 ? [h('span', {}, `modifié ${when(facts.modified)}`)] : []),
        ] : []));
        back.disabled = state.trail.length < 2;
        // Chemin : les derniers pas, chacun cliquable (on y revient, la suite du chemin est coupée).
        const from = Math.max(0, state.trail.length - 6);
        crumbs.replaceChildren(...(from > 0 ? [h('span', {}, '…')] : []), ...state.trail.slice(from).flatMap((n, k) => {
            const index = from + k;
            const crumb = h('button', { type: 'button', class: index === state.trail.length - 1 ? 'on' : '', title: label(n), onclick: () => jump(index) }, short(label(n).split('\n')[0], 18));
            crumb.style.setProperty('--c', colorOf(n.id));
            const crossed = index > 0 && state.trail[index - 1].layer !== n.layer;  // passage d'un portail
            return crossed ? [h('span', { class: 'gt-portal', title: `Portail vers ${layerName(n.layer)}` }, '⟿'), crumb] : [crumb];
        }));
    }

    // Traçabilité des nodes affichés (centre et voisins), une demande par node.
    function trace(ids) {
        const missing = ids.filter(id => !state.meta.has(id));
        if (!missing.length) return;
        missing.forEach(id => state.meta.set(id, null));
        api.request('GET', `toolbox/nodes/meta?ids=${missing.join(',')}`)
            .then(({ nodes }) => { Object.entries(nodes).forEach(([id, facts]) => state.meta.set(id, facts)); paint(); })
            .catch(() => {});  // sans traçabilité, la visite continue
    }

    // Les flèches du node central : une par voisin, dans sa direction à l'écran (portails d'ailleurs : angle libre).
    function build(node) {
        const steps = neighbours(node);
        const came = state.trail.at(-2);
        steps.forEach(s => { const el = element(s); if (el) remember(el); });
        trace([node.id, ...steps.filter(s => s.layer === layerNumber).map(s => s.id)]);
        state.arrows = steps.map(step => {
            const button = h('button', { type: 'button', class: ['gt-arrow', step.portal ? 'portal' : '', state.seen.has(step.id) ? 'seen' : '',
                step.id === came?.id ? 'came' : ''].filter(Boolean).join(' '), 'aria-label': `Aller à : ${short(label(step), 60)}` });
            button.innerHTML = ARROW;
            if (step.portal && step.layer !== layerNumber) button.append(h('span', {}, `⟿ ${short(layerName(step.layer), 16)}`));
            button.style.setProperty('--c', colorOf(step.id));
            button.addEventListener('mouseenter', () => { state.hover = step; element(step)?.classList.add('gardien-choice-hover'); paint(); });
            button.addEventListener('mouseleave', () => { state.hover = null; element(step)?.classList.remove('gardien-choice-hover'); paint(); });
            button.addEventListener('click', () => go(step));
            return { step, button, angle: 0 };
        });
        // Directions : glisser ou zoomer la vue ne les change pas, elles se calculent une fois par node central.
        const c = disc(node);
        const near = state.arrows.filter(a => element(a.step));
        const angles = spread(near.map(a => { const d = disc(element(a.step)); return Math.atan2(d.y - c.y, d.x - c.x); }));
        near.forEach((a, i) => { a.angle = angles[i]; });
        const taken = [...angles];
        state.arrows.filter(a => !element(a.step)).forEach(a => { a.angle = freeAngle(taken); taken.push(a.angle); });
        ring.replaceChildren(...state.arrows.map(a => a.button));
        place();
    }

    // Replace les flèches à chaque image autour du node central : la vue peut glisser, zoomer, le node grandir.
    function place() {
        const node = element(here());
        if (!node || ring.hidden) return;
        const c = disc(node);
        const radius = c.r + 56;
        state.arrows.forEach(a => {
            const x = c.x + Math.cos(a.angle) * radius, y = c.y + Math.sin(a.angle) * radius;
            a.button.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${a.angle}rad)`;
            a.button.querySelector('span')?.style.setProperty('transform', `rotate(${-a.angle}rad)`);  // l'étiquette du portail reste droite
        });
    }
    (function loop() {
        if (!ring.hidden && !state.moving) place();
        requestAnimationFrame(loop);
    })();

    // Glisse jusqu'au pas `step` (après chargement de sa dimension s'il est au bout d'un portail), puis ses flèches.
    async function go(step, { replay = false } = {}) {
        const run = ++state.run;
        if (!replay) state.trail.push({ id: step.id, layer: step.layer });
        state.seen.add(step.id);
        state.hover = null;
        state.moving = true;
        ring.classList.add('moving');
        document.querySelectorAll('.gardien-visiting, .gardien-choice-hover').forEach(n => n.classList.remove('gardien-visiting', 'gardien-choice-hover'));
        selectedNodes.slice().forEach(n => nodeUnselection(n));  // la pastille du node se retire
        release();
        document.dispatchEvent(new MouseEvent('mouseup'));
        if (step.layer !== layerNumber) {
            say(`Portail : je passe dans « ${layerName(step.layer)} »`, 'guide');
            await bridge.enter(step.layer);
            if (run !== state.run) return;
        }
        const node = element(step);
        if (!node) {
            state.moving = false;
            ring.replaceChildren();
            heading.textContent = 'Ce node n\'existe plus : ⟲ pour revenir';
            return;
        }
        remember(node);
        node.classList.add('gardien-visiting');
        paint();
        build(node);
        await bridge.visit(node);
        if (run !== state.run) return;
        release();
        state.moving = false;
        ring.classList.remove('moving');
    }

    // Un node cliqué ne garde pas la saisie (Nodz la donne au clic) : les flèches du clavier restent à la visite.
    function release() {
        if (svg.contains(document.activeElement)) document.activeElement.blur();
    }

    // Un pas du chemin : on y revient, la suite est coupée (comme un navigateur).
    function jump(index) {
        if (index < 0 || index >= state.trail.length - 1) return;
        state.trail = state.trail.slice(0, index + 1);
        go(state.trail[index], { replay: true });
    }

    function previous() {
        jump(state.trail.length - 2);
    }

    function stop() {
        state.run += 1;
        state.moving = false;
        bridge.cut();
        card.hidden = ring.hidden = true;
        ring.replaceChildren();
        state.arrows = [];
        document.querySelectorAll('.gardien-visiting, .gardien-choice-hover').forEach(n => n.classList.remove('gardien-visiting', 'gardien-choice-hover'));
    }

    return {
        start(node) {
            if (!node) return;
            stop();
            Object.assign(state, { trail: [], seen: new Set(), info: new Map(), meta: new Map(), hover: null });
            card.hidden = ring.hidden = false;
            go({ id: node.id, layer: layerNumber });
        },
        stop,
    };
}
