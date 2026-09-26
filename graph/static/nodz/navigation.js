// Gestes de navigation de Nodz v1, décomposés en pas élémentaires : un cran de molette
// ({zoom}) ou un glissé ({pan}). L'humain les joue d'un coup, comme v1 (`play`) ; le Gardien
// rejoue exactement les mêmes pas au rythme d'un réalisateur (camera.js).

export function createNavigation({ viewport, store, view }) {
    const origin = { x: 0, y: 0 };  // point du plan marqué par le drapeau (coordonnées des nodes)
    let focused = true;             // état du saut de zoom (Tab), partagé avec le focus comme en v1

    const screenCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    function perform(move) {
        if (move.zoom) viewport.zoomAt(move.x, move.y, move.out);
        else viewport.pan(move.dx, move.dy);
    }

    // Crans de zoom au point (x, y) jusqu'à franchir `target` (bornes du viewport comprises).
    function* zoomTo(target, x, y) {
        const out = viewport.state.zoom > target;
        for (let previous = null; out ? viewport.state.zoom > target : viewport.state.zoom < target;) {
            if (previous === viewport.state.zoom) return;  // borne atteinte
            previous = viewport.state.zoom;
            yield { zoom: true, x, y, out };
        }
    }

    // Glissé qui amène le point écran (sx, sy) au centre de l'écran (décalé de `offsetY`).
    function* centerOn(sx, sy, offsetY = 0) {
        const c = screenCenter();
        const dx = c.x - sx;
        const dy = c.y - offsetY - sy;
        if (dx || dy) yield { pan: true, dx, dy };
    }

    const gestures = {
        // Tab (v1) : saut de zoom extrême au pointeur, avant jusqu'à 1,2 ou arrière jusqu'à 0,1.
        *zoomJump(x, y) {
            if (viewport.state.zoom < 0.3) focused = false;
            if (!focused) {
                while (viewport.state.zoom <= 1.2) yield { zoom: true, x, y, out: false };
                focused = true;
            } else {
                while (viewport.state.zoom >= 0.1) yield { zoom: true, x, y, out: true };
                focused = false;
            }
        },
        // focusNode (v1) : zoom au centre jusqu'à dépasser 1 si demandé, puis centrage du node.
        *focus(id, { zoomIn = true, zoom, offsetY = 0 } = {}) {
            if (!store.state.nodes.has(id)) return;
            focused = true;
            const c = screenCenter();
            viewport.pointerMoved();
            if (zoom) yield* zoomTo(zoom, c.x, c.y);
            else if (zoomIn && viewport.state.zoom <= 1) yield* zoomTo(1.0001, c.x, c.y);
            const p = view.screenCenter(id);
            yield* centerOn(p.x, p.y, offsetY);
        },
        // Clic sur un lien (v1) : voyage vers l'extrémité la plus éloignée du pointeur.
        *travelLink(edgeId, x, y) {
            const edge = store.state.edges.get(edgeId);
            if (!edge) return;
            const a = view.screenCenter(edge.source);
            const b = view.screenCenter(edge.target);
            const far = Math.hypot(x - a.x, y - a.y) < Math.hypot(x - b.x, y - b.y) ? edge.target : edge.source;
            yield* gestures.focus(far, { zoomIn: false });
        },
        // Flèches (v1) : 4 px par appui, 0,7 en diagonale.
        *arrows(vx, vy) {
            yield { pan: true, dx: -vx * 4, dy: -vy * 4 };
        },
        // Bouton origine (v1) : retour au point marqué par le drapeau.
        *toOrigin(offsetY = 0) {
            const { zoom, tx, ty } = viewport.state;
            yield* centerOn((viewport.center.x + origin.x) * zoom + tx, (viewport.center.y + origin.y) * zoom + ty, offsetY);
        },
        // Recul jusqu'à `zoom` au centre de l'écran, puis centrage du point (x, y) du plan.
        *frame(x, y, zoom, offsetY = 0) {
            const c = screenCenter();
            viewport.pointerMoved();
            yield* zoomTo(zoom, c.x, c.y);
            const s = viewport.state;
            yield* centerOn((viewport.center.x + x) * s.zoom + s.tx, (viewport.center.y + y) * s.zoom + s.ty, offsetY);
        },
    };

    return {
        gestures,
        perform,
        // Joue un geste d'un coup (humain).
        play(gesture) {
            for (const move of gesture) perform(move);
        },
        // Drapeau (v1) : le centre de l'écran devient l'origine.
        setOrigin() {
            const c = screenCenter();
            const { zoom, tx, ty } = viewport.state;
            origin.x = (c.x - tx) / zoom - viewport.center.x;
            origin.y = (c.y - ty) / zoom - viewport.center.y;
        },
        resetOrigin() {
            origin.x = 0;
            origin.y = 0;
            focused = true;
        },
    };
}
