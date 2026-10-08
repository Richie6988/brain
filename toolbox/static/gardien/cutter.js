// Coupe-liens : X maintenu (ou le bouton Ciseaux du menu), on trace un trait à travers l'univers comme une lame. Chaque
// lien que la lame traverse est tranché aussitôt : une étincelle au point de coupe, un « snip » (effets sonores) qui
// monte d'une note à chaque coupe enchaînée. Pendant le geste, ni glissé de l'univers ni sélection : la lame passe
// même par-dessus les nodes. Un geste entier s'annule d'un seul Ctrl+Z. Échap, ou relâcher X, rend la main.

import { t } from './i18n.js';
const NS = 'http://www.w3.org/2000/svg';
const TRAIL = 380;  // ms de vie d'un point de la traînée

// Les deux segments [a, b] et [c, d] se croisent-ils ? Rend le point de croisement, ou null.
function crossing(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
    const den = r.x * s.y - r.y * s.x;
    if (!den) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * r.x, y: a.y + t * r.y } : null;
}

// Extrémités d'un lien (une ligne SVG de Nodz) à l'écran.
function ends(link) {
    const m = link.getScreenCTM();
    if (!m) return null;
    const point = (x, y) => new DOMPoint(Number(link.getAttribute(x)), Number(link.getAttribute(y))).matrixTransform(m);
    return [point('x1', 'y1'), point('x2', 'y2')];
}

export function createCutter({ timeline }) {
    const overlay = document.createElementNS(NS, 'svg');
    overlay.id = 'gardien-cutter';
    const trail = document.createElementNS(NS, 'polyline');
    overlay.append(trail);
    document.body.append(overlay);
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'cutButton', title: t('cut.title') });
    document.getElementById('linksButton')?.after(button);

    let held = false, toggled = false, cutting = false, last = null, points = [], frame = 0;
    const armed = () => held || toggled;
    function show() {
        document.body.classList.toggle('gardien-cutting', armed());
        button.classList.toggle('on', toggled);
    }

    function draw() {
        const now = performance.now();
        points = points.filter(p => now - p.t < TRAIL);
        trail.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
        frame = points.length || cutting ? requestAnimationFrame(draw) : 0;
    }

    function spark({ x, y }) {
        const burst = Object.assign(document.createElement('i'), { className: 'gardien-spark' });
        burst.style.left = `${x}px`;
        burst.style.top = `${y}px`;
        document.body.append(burst);
        setTimeout(() => burst.remove(), 600);
    }

    // La lame avance de `last` à `next` : les liens traversés sont tranchés.
    function slice(next) {
        [...document.querySelectorAll('.link')].forEach(link => {
            if (link.style.display === 'none') return;
            const pair = ends(link);
            const hit = pair && crossing(last, next, pair[0], pair[1]);
            if (!hit) return;
            spark(hit);
            deleteLink(link);
        });
        last = next;
    }

    document.addEventListener('keydown', event => {
        if (event.key.toLowerCase() !== 'x' || event.ctrlKey || event.metaKey || event.altKey || isTyping
            || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
        if (!held) {
            held = true;
            show();
        }
    });
    document.addEventListener('keyup', event => {
        if (event.key.toLowerCase() === 'x' && held) {
            held = false;
            show();
        }
        if (event.key === 'Escape' && toggled) {
            toggled = false;
            show();
        }
    });
    window.addEventListener('blur', () => { held = false; show(); });
    button.addEventListener('click', () => { toggled = !toggled; show(); });

    // Avant Nodz (capture) : en mode ciseaux, l'appui commence une coupe au lieu d'un glissé ou d'une sélection.
    svg.addEventListener('mousedown', event => {
        if (!armed() || event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cutting = true;
        last = { x: event.clientX, y: event.clientY };
        points = [{ ...last, t: performance.now() }];
        timeline.begin();  // toutes les coupes du geste : un seul Ctrl+Z
        if (!frame) frame = requestAnimationFrame(draw);
    }, true);
    window.addEventListener('mousemove', event => {
        if (!cutting) return;
        const next = { x: event.clientX, y: event.clientY };
        points.push({ ...next, t: performance.now() });
        slice(next);
    }, true);
    window.addEventListener('mouseup', event => {
        if (!cutting) return;
        event.stopImmediatePropagation();
        cutting = false;
        timeline.end();
    }, true);
}
