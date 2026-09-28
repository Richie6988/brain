// Vue de côté : l'univers tourne d'un quart de tour autour de l'axe vertical. Le plan (X, Y) d'une dimension devient
// le plan (dimension, Y) : chaque dimension est une colonne placée à son numéro, Y ne change pas, et l'ancien X ne
// reste qu'en léger décalage (profondeur). La dimension ouverte tourne réellement (X·cos θ + Z·sin θ), les autres
// apparaissent en colonnes ; liens de chaque dimension en traits fins, portails en arcs entre colonnes.
// Survol : le texte du node ; clic : la vue retourne dans le plan et va au node, dans sa dimension. Molette et
// glissé : zoom et déplacement. Échap ou le bouton : retour. Lecture seule, rien n'est modifié dans Nodz.

import { api } from './api.js';

const NS = 'http://www.w3.org/2000/svg';
const DURATION = 1100;
const LABELS = 80;  // au-delà, les textes ne s'affichent qu'au survol
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
};

export function createSide({ bridge, say }) {
    const dock = document.getElementById('agentsButton');
    const button = Object.assign(document.createElement('button'), { className: 'menuBtn', id: 'sideButton' });
    dock.after(button);
    button.addEventListener('mouseover', () => createTooltip('sideButton', 'Vue de côté : X = dimension, Y = Y'));
    button.addEventListener('click', () => (root.hidden ? open() : close()));

    const root = document.createElement('section');
    root.id = 'gardien-side';
    root.hidden = true;
    root.innerHTML = '<header><strong>Vue de côté</strong><span>X = numéro de dimension · Y = Y · clic sur un node pour y aller</span>'
        + '<button type="button" class="gs-close" title="Revenir dans le plan (Échap)">✕</button></header><p class="gs-tip" hidden></p>';
    const svg = svgEl('svg', { class: 'gs-canvas' });
    const view = svgEl('g');
    const [guides, links, portals, dots, labels] = ['gs-guides', 'gs-links', 'gs-portals', 'gs-dots', 'gs-labels'].map(c => view.appendChild(svgEl('g', { class: c })));
    svg.append(view);
    root.prepend(svg);
    document.body.append(root);
    const tip = root.querySelector('.gs-tip');
    root.querySelector('.gs-close').addEventListener('click', () => close());
    document.addEventListener('keydown', event => {
        if (!root.hidden && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    }, true);

    let scene = null, busy = false;
    let pan = { x: 0, y: 0, k: 1 };
    const applyPan = () => view.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${pan.k})`);

    // Place tout à l'angle θ (e = avancement 0 → 1 de la rotation).
    function frame(e) {
        const s = scene, theta = (e * Math.PI) / 2, cos = Math.cos(theta), sin = Math.sin(theta);
        const scale = lerp(s.s0, s.s1, e), mx = lerp(0, s.mx, e), my = lerp(0, s.my, e);
        const W = window.innerWidth / 2, H = window.innerHeight / 2;
        const point = n => {
            const X = (n.x - s.vx) * (s.depth + (1 - s.depth) * cos) + n.z * sin;  // l'ancien X s'efface en profondeur
            return [W + (X - mx) * scale, H - (n.y - s.vy - my) * scale];
        };
        root.style.setProperty('--veil', (0.97 * e).toFixed(3));
        s.nodes.forEach(n => {
            [n.px, n.py] = point(n);
            n.dot.setAttribute('cx', n.px.toFixed(1));
            n.dot.setAttribute('cy', n.py.toFixed(1));
            n.dot.setAttribute('r', lerp(n.r0, 7, e).toFixed(1));
            n.dot.style.opacity = n.here ? 1 : e;
            n.dot.style.fillOpacity = n.here ? e : 1;  // au départ, le texte du vrai node reste lisible
            if (n.label) {
                n.label.setAttribute('x', (n.px + 11).toFixed(1));
                n.label.setAttribute('y', (n.py + 4).toFixed(1));
                n.label.style.opacity = e.toFixed(3);
            }
        });
        s.links.forEach(l => {
            l.el.setAttribute('x1', l.a.px); l.el.setAttribute('y1', l.a.py);
            l.el.setAttribute('x2', l.b.px); l.el.setAttribute('y2', l.b.py);
            l.el.style.opacity = (l.a.here ? 0.5 : 0.5 * e).toFixed(3);
        });
        s.portals.forEach(p => {
            const lift = Math.min(160, Math.abs(p.b.px - p.a.px) * 0.35);
            p.el.setAttribute('d', `M${p.a.px} ${p.a.py} Q${(p.a.px + p.b.px) / 2} ${Math.min(p.a.py, p.b.py) - lift} ${p.b.px} ${p.b.py}`);
            p.el.style.opacity = e.toFixed(3);
        });
        s.columns.forEach(c => {
            const x = W + (c.z - mx) * scale;
            c.line.setAttribute('x1', x); c.line.setAttribute('x2', x);
            c.line.setAttribute('y1', 100); c.line.setAttribute('y2', window.innerHeight - 90);
            c.label.setAttribute('x', x); c.label.setAttribute('y', 90);
            c.line.style.opacity = c.label.style.opacity = e.toFixed(3);
        });
    }

    function animate(from, to) {
        return new Promise(resolve => {
            const start = performance.now();
            (function step(now) {
                const t = Math.min(1, (now - start) / DURATION);
                frame(ease(lerp(from, to, t)));
                if (t < 1) requestAnimationFrame(step); else resolve();
            })(start);
        });
    }

    async function open() {
        if (busy || (typeof admin !== 'undefined' && admin)) return;
        busy = true;
        try {
            const data = await api.request('GET', 'toolbox/side');
            build(data);
            pan = { x: 0, y: 0, k: 1 };
            applyPan();
            root.hidden = false;
            button.classList.add('on');
            await animate(0, 1);
        } catch (error) {
            say(`Vue de côté : ${error.message}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function close(target = null) {
        if (busy || root.hidden) return;
        busy = true;
        tip.hidden = true;
        pan = { x: 0, y: 0, k: 1 };
        applyPan();
        await animate(1, 0);
        root.hidden = true;
        button.classList.remove('on');
        busy = false;
        if (target) await bridge.perform({ op: 'goto', ref: target.id, layer: target.layer, zoom: 1.2 });
    }

    function build({ layers: known, nodes, links: pairs, portals: bridges }) {
        const current = layerNumber;
        const center = bridge.center();
        const W = window.innerWidth / 2, H = window.innerHeight / 2, s0 = Number(currentZoom);
        // Calage : les coordonnées enregistrées n'ont pas tout à fait l'origine de l'écran. Les nodes de la page donnent
        // leur centre réel ; l'écart médian corrige tous les nodes (Y reste comparable d'une dimension à l'autre).
        const live = new Map([...document.querySelectorAll('.node-group')].map(g => {
            const r = (g.getAttribute('shape') === 'square' ? g.children[2] : g.children[1]).getBoundingClientRect();
            return [g.id, { x: center.x + (r.left + r.width / 2 - W) / s0, y: center.y - (r.top + r.height / 2 - H) / s0, r: r.width / 2 }];
        }));
        const deltas = nodes.filter(n => n.layer === current && live.has(n.id)).map(n => [live.get(n.id).x - n.x, live.get(n.id).y - n.y]);
        const median = k => (deltas.length ? deltas.map(d => d[k]).sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0);
        const [dx, dy] = [median(0), median(1)];
        nodes.forEach(n => {
            const here = n.layer === current && live.get(n.id);
            Object.assign(n, here ? { x: here.x, y: here.y, r0: here.r } : { x: n.x + dx, y: n.y + dy, r0: 7 });
        });
        const ys = nodes.map(n => n.y), xs = nodes.map(n => n.x);
        const spanY = Math.max(600, Math.max(...ys, 0) - Math.min(...ys, 0));
        const spanX = Math.max(600, Math.max(...xs, 0) - Math.min(...xs, 0));
        const col = Math.min(1500, Math.max(250, spanY / 3));  // écart entre deux numéros de dimension
        const depth = Math.min(0.12, (col * 0.35) / spanX);    // part de l'ancien X gardée en profondeur
        const byId = new Map();
        [guides, links, portals, dots, labels].forEach(g => g.replaceChildren());
        const named = nodes.length <= LABELS;  // peu de nodes : leur texte à côté du point
        const s = { vx: center.x, vy: center.y, s0, depth, nodes: [], links: [], portals: [], columns: [] };
        nodes.forEach(n => {
            const node = { ...n, z: (n.layer - current) * col, here: n.layer === current };
            node.dot = dots.appendChild(svgEl('circle', { class: n.shape === 'square' ? 'square' : '' }));
            node.dot.style.setProperty('--c', n.color || '#33FF99');
            node.dot.addEventListener('mouseenter', () => {
                const name = (known.find(l => l.id === n.layer) || {}).name || '';
                tip.textContent = `${n.text || '(node vide)'}  ·  ${n.layer} ${name}`;
                tip.hidden = false;
            });
            node.dot.addEventListener('mouseleave', () => { tip.hidden = true; });
            node.dot.addEventListener('click', () => close(n));
            if (named && n.text) {
                node.label = labels.appendChild(svgEl('text'));
                node.label.textContent = n.text.length > 24 ? `${n.text.slice(0, 23)}…` : n.text;
            }
            byId.set(n.id, node);
            s.nodes.push(node);
        });
        pairs.forEach(([a, b]) => byId.has(a) && byId.has(b) && s.links.push({ a: byId.get(a), b: byId.get(b), el: links.appendChild(svgEl('line')) }));
        bridges.forEach(([a, b]) => byId.has(a) && byId.has(b) && s.portals.push({ a: byId.get(a), b: byId.get(b), el: portals.appendChild(svgEl('path')) }));
        const used = new Set(nodes.map(n => n.layer).concat(current));
        known.filter(l => used.has(l.id)).forEach(l => {
            const line = guides.appendChild(svgEl('line', { class: l.id === current ? 'here' : '' }));
            const label = guides.appendChild(svgEl('text', { class: l.id === current ? 'here' : '' }));
            label.textContent = `${l.id} · ${l.name}`;
            s.columns.push({ z: (l.id - current) * col, line, label });
        });
        // Vue finale : toutes les colonnes et tout Y tiennent à l'écran.
        const fx = s.nodes.map(n => (n.x - s.vx) * depth + n.z).concat(s.columns.map(c => c.z));
        const fy = s.nodes.map(n => n.y - s.vy).concat(0);
        const [x0, x1, y0, y1] = [Math.min(...fx), Math.max(...fx), Math.min(...fy), Math.max(...fy)];
        s.s1 = Math.min((window.innerWidth - 160) / Math.max(1, x1 - x0), (window.innerHeight - 220) / Math.max(1, y1 - y0), 1.5);
        s.mx = (x0 + x1) / 2;
        s.my = (y0 + y1) / 2;
        scene = s;
    }

    // Molette : zoom sous le pointeur ; glissé : déplacement (vue finale seulement).
    svg.addEventListener('wheel', event => {
        event.preventDefault();
        if (busy) return;
        const k = Math.min(8, Math.max(0.3, pan.k * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        pan.x = event.clientX - ((event.clientX - pan.x) * k) / pan.k;
        pan.y = event.clientY - ((event.clientY - pan.y) * k) / pan.k;
        pan.k = k;
        applyPan();
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', event => {
        if (busy || event.target.closest('circle')) return;
        drag = { x: event.clientX - pan.x, y: event.clientY - pan.y };
        svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
        if (!drag) return;
        pan.x = event.clientX - drag.x;
        pan.y = event.clientY - drag.y;
        applyPan();
    });
    svg.addEventListener('pointerup', () => { drag = null; });

    return { open, close };
}
