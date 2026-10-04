// Physique des nodes posés par l'IA : ils se repoussent comme des charges (loi en 1/d², de Coulomb), leurs liens les
// retiennent comme des ressorts (Hooke), un léger rappel les garde près de l'endroit où ils sont nés, et l'amortissement
// les pose. On les voit glisser, s'écarter, rebondir un peu puis se poser. Les nodes déjà là (ceux de l'humain) ne
// bougent pas mais repoussent ; un node verrouillé, sélectionné ou tenu à la souris ne bouge pas non plus. Une fois
// posés, les nodes sont sauvegardés, dans la même transaction Ctrl+Z que la demande qui les a créés.

import { dragging } from './gesture.js';

const CHARGE = 3;        // répulsion : accélération au contact (d = ra + rb), en unités par image²
const REACH = 5;         // au-delà de REACH × (ra + rb), deux nodes s'ignorent
const SPRING = 0.03;     // raideur des liens
const REST = 140;        // longueur au repos d'un lien, bord à bord
const CONTACT = 50;      // écart bord à bord sous lequel deux nodes se poussent franchement (ils se touchent)
const FIRM = 0.35;       // raideur de ce contact
const TETHER = 0.012;    // rappel vers le lieu de naissance
const DAMPING = 0.82;    // vitesse gardée d'une image à l'autre
const MAX_SPEED = 30;
const CALM = 0.08;       // vitesse sous laquelle un node est posé
const QUIET = 20;        // images calmes d'affilée avant la fin
const LONGEST = 9000;    // ms au plus après la dernière naissance
const BURST = 3;         // Ordonner : rayon de l'éclatement, en rayons de node par racine du nombre de nodes
const GATHER = 0.004;    // Ordonner : rappel vers le centre de la zone, plus doux que TETHER

const radius = node => parseFloat(node.children[1]?.getAttribute('r')) || 60;
const place = node => ({ x: parseFloat(node.getAttribute('x')), y: parseFloat(node.getAttribute('y')) });
const TRANSFORM = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;

// Déplace un node dans l'univers comme le glissé de Nodz (transform à l'écran, x / y en base, y vers le haut).
function shift(node, dx, dy) {
    const match = (node.getAttribute('transform') || '').match(TRANSFORM);
    if (!match) return;
    node.setAttribute('transform', `translate(${(parseFloat(match[1]) + dx).toFixed(3)}, ${(parseFloat(match[2]) - dy).toFixed(3)}) scale(${match[3]})`);
    node.setAttribute('x', parseFloat(node.getAttribute('x')) + dx);
    node.setAttribute('y', parseFloat(node.getAttribute('y')) + dy);
}

export function createPhysics({ timeline }) {
    const bodies = new Map();  // id → { node, vx, vy, home }
    let frame = 0, calm = 0, born = 0;

    function add(node, body = {}) {
        if (!node || bodies.has(node.id)) return;
        bodies.set(node.id, { node, vx: 0, vy: 0, home: place(node), tether: TETHER, ...body });
        born = performance.now();
        calm = 0;
        if (!frame) {
            timeline.begin();  // les positions finales rejoignent la demande : un seul Ctrl+Z
            frame = requestAnimationFrame(step);
        }
    }

    // Ordonner une zone : les nodes partent en éclats dans des directions tirées au hasard, loin du centre, ce qui
    // défait les liens croisés ; puis les liens les ramènent vers leurs voisins et un rappel doux vers le centre regroupe.
    function arrange(nodes) {
        if (!nodes.length) return;
        const spots = nodes.map(place);
        const center = { x: spots.reduce((t, p) => t + p.x, 0) / nodes.length, y: spots.reduce((t, p) => t + p.y, 0) / nodes.length };
        const span = BURST * Math.sqrt(nodes.length) * (nodes.reduce((t, n) => t + radius(n), 0) / nodes.length);
        nodes.forEach((node, i) => {
            const angle = Math.random() * 2 * Math.PI, far = span * (0.6 + 0.4 * Math.random());
            const x = center.x + far * Math.cos(angle), y = center.y + far * Math.sin(angle);
            // Vitesse qui, amortie image après image, porte le node jusqu'à son éclat.
            add(node, { vx: (x - spots[i].x) * (1 - DAMPING), vy: (y - spots[i].y) * (1 - DAMPING), home: center, tether: GATHER, burst: true });
        });
    }

    function held(node) {
        return node.getAttribute('lock') === '1' || selectedNodes.includes(node) || dragging() || isLoading || quantum;
    }

    function step() {
        const all = [...document.querySelectorAll('.node-group')];
        let moving = 0;
        const touched = new Set();
        bodies.forEach((body, id) => {
            const { node } = body;
            if (!node.isConnected) return bodies.delete(id);
            if (held(node)) {
                body.vx = body.vy = 0;
                return;
            }
            const a = place(node), ra = radius(node);
            let fx = body.tether * (body.home.x - a.x), fy = body.tether * (body.home.y - a.y);
            all.forEach(other => {
                if (other === node) return;
                const b = place(other), reach = ra + radius(other);
                let dx = a.x - b.x, dy = a.y - b.y;
                const d = Math.hypot(dx, dy);
                if (d > REACH * reach) return;
                if (d < 1) {  // deux nodes au même point : un écart au hasard
                    dx = Math.random() - 0.5;
                    dy = Math.random() - 0.5;
                }
                const push = CHARGE * (reach * reach) / Math.max(d * d, 1) + FIRM * Math.max(0, reach + CONTACT - d);
                const norm = Math.hypot(dx, dy) || 1;
                fx += (push * dx) / norm;
                fy += (push * dy) / norm;
            });
            JSON.parse(node.getAttribute('links') || '[]').forEach(linkId => {
                const link = document.getElementById(linkId);
                const other = link && document.getElementById(link.getAttribute('Node1') === node.id ? link.getAttribute('Node2') : link.getAttribute('Node1'));
                if (!other) return;
                const b = place(other), d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const stretch = d - (ra + radius(other) + REST);
                fx += (SPRING * stretch * (b.x - a.x)) / d;
                fy += (SPRING * stretch * (b.y - a.y)) / d;
            });
            body.vx = (body.vx + fx) * DAMPING;
            body.vy = (body.vy + fy) * DAMPING;
            const speed = Math.hypot(body.vx, body.vy);
            if (body.burst && speed <= MAX_SPEED) body.burst = false;  // l'éclat retombe : la limite de vitesse revient
            if (speed > MAX_SPEED && !body.burst) {
                body.vx *= MAX_SPEED / speed;
                body.vy *= MAX_SPEED / speed;
            }
            if (speed > CALM) {
                moving += 1;
                shift(node, body.vx, body.vy);
                JSON.parse(node.getAttribute('links') || '[]').forEach(linkId => touched.add(linkId));
            }
        });
        touched.forEach(linkId => {
            const link = document.getElementById(linkId);
            if (!link) return;
            updateLink(link);
            if (linkState === 0) updateLinkColor(link);
        });
        calm = moving ? 0 : calm + 1;
        if (bodies.size && calm < QUIET && performance.now() - born < LONGEST) {
            frame = requestAnimationFrame(step);
            return;
        }
        settle();
    }

    // Posés : chaque node sauvegardé à sa place finale, puis la transaction de la demande peut se fermer.
    function settle() {
        frame = 0;
        bodies.forEach(({ node }) => { if (node.isConnected) save(node); });
        bodies.clear();
        timeline.end();
    }

    return { add, arrange };
}
