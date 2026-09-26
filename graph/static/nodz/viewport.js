// Caméra de l'univers. Les maths reprennent exactement zoom.js et dragUniverse.js de Nodz v1
// (banc tests/feel) : cran de 0,95, bornes « 0.08 » et « 8.62 », zoom arrondi à 3 décimales,
// translation arrondie à 1e-5, compensation du centre puis du point visé.

const ZOOM_STEP = 0.95;
const MIN_ZOOM = Number((ZOOM_STEP ** 50).toFixed(2));
const MAX_ZOOM = Number((1 / ZOOM_STEP ** 42).toFixed(2));

export function createViewport(universe, { width = window.innerWidth, height = window.innerHeight } = {}) {
    const center = { x: width / 2, y: height / 2 };
    const state = { tx: 0, ty: 0, zoom: 1, zoomLabel: '1', rootX: 0, rootY: 0, anchor: null };
    const listeners = new Set();

    function apply() {
        const t = state.tx === 0 && state.ty === 0 && state.zoom === 1 && state.zoomLabel === '1'
            ? 'translate(0,0) scale(1)'
            : `translate(${state.tx.toFixed(5)}, ${state.ty.toFixed(5)}) scale(${state.zoomLabel})`;
        universe.setAttribute('transform', t);
        listeners.forEach(fn => fn(state));
    }

    // Translation de la caméra ; `moveRoot` suit le point d'origine (faux pour la compensation du centre).
    function translate(dx, dy, moveRoot = true) {
        state.tx = Number((state.tx + dx).toFixed(5));
        state.ty = Number((state.ty + dy).toFixed(5));
        if (moveRoot) {
            state.rootX -= dx;
            state.rootY += dy;
        }
        apply();
    }

    function zoomAt(clientX, clientY, zoomOut) {
        if (!state.anchor) {
            state.anchor = {
                x: Math.round(clientX - center.x + state.rootX) / state.zoom,
                y: -Math.round(clientY - center.y - state.rootY) / state.zoom,
            };
        }
        const prev = state.zoom;
        const next = zoomOut ? Math.max(MIN_ZOOM, prev * ZOOM_STEP) : Math.min(MAX_ZOOM, prev / ZOOM_STEP);
        state.zoomLabel = next.toFixed(3);
        state.zoom = Number(state.zoomLabel);
        const delta = state.zoom - prev;
        translate(-center.x * delta, -center.y * delta, false);
        translate(-state.anchor.x * delta, state.anchor.y * delta);
    }

    return {
        state,
        center,
        onChange: fn => listeners.add(fn),
        // Molette : deltaY entier = pan à deux doigts, non entier = pinch.
        wheel(event) {
            if (event.deltaY === Math.round(event.deltaY)) translate(-event.deltaX, -event.deltaY);
            else zoomAt(event.clientX, event.clientY, event.deltaY > 0);
        },
        pan: translate,
        zoomAt,
        // Le point visé par le pinch n'est recalculé qu'après un mouvement du pointeur (comme v1).
        pointerMoved() { state.anchor = null; },
        reset() {
            Object.assign(state, { tx: 0, ty: 0, zoom: 1, zoomLabel: '1', rootX: 0, rootY: 0, anchor: null });
            apply();
        },
        // Écran → univers (position d'un node créé sous le pointeur), arrondi comme v1.
        toUniverse(clientX, clientY) {
            return {
                x: Math.round((clientX - center.x + state.rootX) / state.zoom),
                y: Math.round((clientY - center.y - state.rootY) / state.zoom),
            };
        },
        toScreen(x, y) {
            return { x: x * state.zoom + state.tx, y: y * state.zoom + state.ty };
        },
    };
}
