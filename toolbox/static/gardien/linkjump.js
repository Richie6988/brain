// Flèche de saut sur les liens, au style de la visite (tour.js) : la souris près d'un lien (pas besoin de viser le
// trait de 3 px), une grosse flèche s'y pose, tournée vers le bout le plus loin et à la couleur du node d'arrivée ; un
// clic y voyage (focusNode de Nodz, comme l'ancien curseur flèche du lien). Rien pendant un geste, une visite, le mode
// coupe-liens ou un chargement.

// Couleur du node d'arrivée : son attribut, sinon le trait réellement affiché (cercle ou rectangle).
function colorOf(node) {
    const set = node.getAttribute('color');
    if (set && set !== 'null') return set;
    const shape = node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1];
    return (shape && getComputedStyle(shape).stroke) || '#1E90FF';
}
const shown = link => link.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? link.style.display !== 'none';

const NEAR = 14;   // distance au lien qui fait apparaître la flèche (px)
const KEEP = 34;   // flèche affichée : on la garde tant que la souris reste sur elle
const ARROW = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 17h18V7l16 17-16 17V31H8z"/></svg>';

export function createLinkJump() {
    const layer = document.createElement('div');
    layer.id = 'gardien-jump';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gt-arrow';
    button.hidden = true;
    button.innerHTML = ARROW;
    layer.append(button);
    document.body.append(layer);

    let target = null, pending = null, mouse = null;
    const screen = node => ({ x: parseFloat(node.getAttribute('x')) * currentZoom - parseFloat(root.getAttribute('x')) + centerX,
        y: -parseFloat(node.getAttribute('y')) * currentZoom + parseFloat(root.getAttribute('y')) + centerY });
    const hide = () => { button.hidden = true; target = null; };
    const idle = () => !document.body.classList.contains('gardien-cutting') && !isLoading && linkState !== 2
        && document.getElementById('gardien-arrows')?.hidden !== false;

    // Le lien le plus proche du point (x, y), hors des nodes : point projeté, bout d'arrivée, angle.
    function nearest(x, y, limit) {
        let best = null;
        for (const l of document.querySelectorAll('.link')) {
            const a = document.getElementById(l.getAttribute('Node1')), b = document.getElementById(l.getAttribute('Node2'));
            if (!a || !b) continue;
            const p = screen(a), q = screen(b), dx = q.x - p.x, dy = q.y - p.y, len2 = dx * dx + dy * dy;
            if (!len2) continue;
            const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
            const d = Math.hypot(p.x + t * dx - x, p.y + t * dy - y);
            if (d > limit || (best && d >= best.d) || !shown(l)) continue;  // un lien masqué (filtres, branche repliée) : rien
            const to = t < 0.5 ? b : a;  // vers le bout le plus loin de la souris
            best = { d, to, x: p.x + t * dx, y: p.y + t * dy, angle: t < 0.5 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx) };
        }
        return best;
    }

    function update({ clientX: x, clientY: y, buttons, target: over }) {
        pending = null;
        mouse = { clientX: x, clientY: y, buttons: 0 };
        const onArrow = over === button || button.contains(over);
        if (buttons || !idle() || !(onArrow || (svg.contains(over) && !over.closest?.('.node-group')))) return hide();
        const hit = nearest(x, y, onArrow ? KEEP : NEAR);
        if (!hit) return hide();
        target = hit.to;
        button.hidden = false;
        button.style.setProperty('--c', colorOf(target));
        button.style.transform = `translate(${hit.x}px, ${hit.y}px) translate(-50%, -50%) rotate(${hit.angle}rad)`;
        button.dataset.label = `Aller à : ${(target.children[0]?.children[0]?.textContent || '').trim().split('\n')[0].slice(0, 60) || '(node vide)'}`;
    }
    document.addEventListener('mousemove', event => {
        if (!pending) pending = requestAnimationFrame(() => update(event));
    }, true);
    // La vue bouge sans la souris (Tab, voyage, caméra du Gardien, molette) : à chaque image, la flèche affichée est
    // revérifiée sous la souris ; plus de lien dessous, elle disparaît (avant, elle restait sur le vide).
    (function follow() {
        if (!button.hidden && mouse) {
            const over = document.elementFromPoint(mouse.clientX, mouse.clientY);
            if (over) update({ ...mouse, target: over });
        }
        requestAnimationFrame(follow);
    })();

    button.addEventListener('mousedown', event => {
        if (event.button !== 0 || !target) return;
        event.preventDefault();
        event.stopPropagation();
        const to = target;
        hide();
        focusNode(to, false);  // le voyage du lien de Nodz
    });
}
