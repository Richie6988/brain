// Flèche de saut sur les liens, au style de la visite (tour.js) : la souris près d'un lien (pas besoin de viser le
// trait de 3 px), une grosse flèche s'y pose, tournée vers le bout le plus loin et à la couleur du node d'arrivée ; un
// clic y voyage (focusNode de Nodz, comme l'ancien curseur flèche du lien). Rien pendant un geste, une visite, le mode
// coupe-liens ou un chargement.

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

    let target = null, pending = null;
    const screen = node => ({ x: parseFloat(node.getAttribute('x')) * currentZoom - parseFloat(root.getAttribute('x')) + centerX,
        y: -parseFloat(node.getAttribute('y')) * currentZoom + parseFloat(root.getAttribute('y')) + centerY });
    const hide = () => { button.hidden = true; target = null; };
    const idle = () => !document.body.classList.contains('gardien-cutting') && !isLoading && linkState !== 2
        && document.getElementById('gardien-arrows')?.hidden !== false;

    // Le lien le plus proche du point (x, y), hors des nodes : point projeté, bout d'arrivée, angle.
    function nearest(x, y, limit) {
        let best = null;
        for (const l of document.querySelectorAll('.link')) {
            if (l.style.display === 'none') continue;
            const a = document.getElementById(l.getAttribute('Node1')), b = document.getElementById(l.getAttribute('Node2'));
            if (!a || !b) continue;
            const p = screen(a), q = screen(b), dx = q.x - p.x, dy = q.y - p.y, len2 = dx * dx + dy * dy;
            if (!len2) continue;
            const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
            const d = Math.hypot(p.x + t * dx - x, p.y + t * dy - y);
            if (d > limit || (best && d >= best.d)) continue;
            const to = t < 0.5 ? b : a;  // vers le bout le plus loin de la souris
            best = { d, to, x: p.x + t * dx, y: p.y + t * dy, angle: t < 0.5 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx) };
        }
        return best;
    }

    function update(event) {
        pending = null;
        const over = event.target;
        const onArrow = over === button || button.contains(over);
        if (event.buttons || !idle() || !(onArrow || (svg.contains(over) && !over.closest?.('.node-group')))) return hide();
        const hit = nearest(event.clientX, event.clientY, onArrow ? KEEP : NEAR);
        if (!hit) return hide();
        target = hit.to;
        button.hidden = false;
        button.style.setProperty('--c', target.getAttribute('color') || '#1E90FF');
        button.style.transform = `translate(${hit.x}px, ${hit.y}px) translate(-50%, -50%) rotate(${hit.angle}rad)`;
        button.dataset.label = `Aller à : ${(target.children[0]?.children[0]?.textContent || '').trim().split('\n')[0].slice(0, 60) || '(node vide)'}`;
    }
    document.addEventListener('mousemove', event => {
        if (!pending) pending = requestAnimationFrame(() => update(event));
    }, true);
    svg.addEventListener('wheel', hide, true);  // la vue bouge : la flèche se repose au prochain mouvement

    button.addEventListener('mousedown', event => {
        if (event.button !== 0 || !target) return;
        event.preventDefault();
        event.stopPropagation();
        const to = target;
        hide();
        focusNode(to, false);  // le voyage du lien de Nodz
    });
}
