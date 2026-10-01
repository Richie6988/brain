// Relier en glissant : un node glissé contre un autre et tenu au contact une demi-seconde allume l'autre ; au relâcher,
// les deux sont reliés (le lien de Nodz, annulable par Ctrl+Z). Un glissé qui ne fait que passer ne relie rien, ni un
// glissé de plusieurs nodes à la fois.

import { dragging } from './gesture.js';

const HOLD = 500;     // ms de contact avant de proposer le lien
const CONTACT = 12;   // bords à moins de 12 unités : les deux nodes se touchent

const place = node => ({ x: parseFloat(node.getAttribute('x')), y: parseFloat(node.getAttribute('y')),
    r: parseFloat(node.children[1]?.getAttribute('r')) || 60 });

// Le node le plus proche que `node` touche, ou null.
function touching(node) {
    const a = place(node);
    let best = null, gap = CONTACT;
    document.querySelectorAll('.node-group').forEach(other => {
        if (other === node) return;
        const b = place(other), edge = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
        if (edge < gap) {
            gap = edge;
            best = other;
        }
    });
    return best;
}

export function createLinkDrop() {
    let target = null, since = 0, armed = false, frame = 0;

    function reset() {
        target?.classList.remove('gardien-link-armed');
        target = null;
        armed = false;
    }

    // Tant que le glissé dure, même pointeur immobile : le contact est suivi à chaque image.
    function watch() {
        frame = 0;
        const node = isDragging && dragging() && selectedNodes.length === 1 ? selectedNodes[0] : null;
        if (!node) return reset();
        const other = touching(node);
        if (other !== target) {
            reset();
            target = other;
            since = performance.now();
        }
        if (target && !armed && performance.now() - since >= HOLD) {
            armed = true;
            target.classList.add('gardien-link-armed');
        }
        frame = requestAnimationFrame(watch);
    }

    document.addEventListener('pointermove', () => { if (!frame) frame = requestAnimationFrame(watch); }, true);
    document.addEventListener('pointerup', () => {
        const node = selectedNodes.length === 1 ? selectedNodes[0] : null;
        if (armed && node && touching(node) === target) {
            checkExistingLinks(node, target);
            save(node);
            save(target);
        }
        cancelAnimationFrame(frame);
        frame = 0;
        reset();
    }, true);
}
