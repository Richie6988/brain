// Portail d'un node : un anneau autour de lui, au tracé vivant. Deux contours bruités (sommes de sinus aux phases tirées
// au hasard, propres à chaque portail) se déforment en boucle : l'un respire en dégradé violet → bleu, l'autre, en
// pointillés, tourne à contre-sens. Seul l'anneau prend la souris (survol et clic de Nodz : voyage) ; l'intérieur du
// node reste à lui. Nodz appelle window.portalRing() en créant chaque node ; son contenu remplace l'ancienne porte.

const POINTS = 72;
const FRAMES = 4;
let count = 0;

// Contour fermé autour de (0, 0) : rayon `base` plus des harmoniques ; `phase` décale toutes les ondes (une image).
function contour(base, waves, phase) {
    const points = Array.from({ length: POINTS }, (_, i) => {
        const a = (i / POINTS) * 2 * Math.PI;
        const r = base + waves.reduce((t, w) => t + w.amp * Math.sin(w.k * a + w.p + phase * w.speed), 0);
        return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
    });
    return `M${points.join('L')}Z`;
}

// Une animation de forme : FRAMES images d'un même contour, la dernière revient à la première (boucle sans saut).
function morph(base, waves, duration) {
    const frames = Array.from({ length: FRAMES }, (_, f) => contour(base, waves, (f / FRAMES) * 2 * Math.PI));
    return `<path d="${frames[0]}"><animate attributeName="d" dur="${duration}s" repeatCount="indefinite" `
        + `values="${[...frames, frames[0]].join(';')}" calcMode="spline" keyTimes="${[...Array(FRAMES + 1).keys()].map(i => i / FRAMES).join(';')}" `
        + `keySplines="${Array(FRAMES).fill('0.45 0 0.55 1').join(';')}"/></path>`;
}

const waves = (list, amp) => list.map(k => ({ k, amp: amp * (0.4 + Math.random() * 0.6), p: Math.random() * 6.28, speed: k % 2 ? 1 : -1 }));

window.portalRing = () => {
    const id = `portal-ring-${++count}`;
    return `<svg class="pr" viewBox="-66 -66 132 132" aria-hidden="true">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#b89af2"/><stop offset="0.5" stop-color="#1E90FF"/><stop offset="1" stop-color="#33FF99"/></linearGradient></defs>
<g class="pr-breath" stroke="url(#${id})">${morph(57, waves([3, 5, 8], 3.2), 7 + Math.random() * 3)}</g>
<g class="pr-drift">${morph(62, waves([2, 7, 11], 2.4), 5 + Math.random() * 3)}</g>
<circle class="pr-hit" r="59"/></svg>`;
};
