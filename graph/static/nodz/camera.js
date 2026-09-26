// Le Gardien réalisateur : il navigue avec les gestes de l'humain (navigation.js : crans de
// molette, glissés, focus), joués avec un tempo de cinéma. Un cran de zoom par image après un
// départ en douceur ; chaque glissé devient un travelling fluide. Prise de hauteur pour les longs
// trajets, lent recul pendant la réflexion. L'utilisateur reprend la main au premier geste.

const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createCamera({ svg, store, viewport, view, nav, dispatch, caption, covered = () => 0 }) {
    const { gestures } = nav;
    let take = 0;  // numéro de prise : incrémenté à chaque coupe (geste de l'utilisateur)
    let queue = Promise.resolve();
    let drifting = null;

    // Les nodes visés sont centrés dans l'espace libre au-dessus de la barre de commande.
    const offset = () => covered() / 2;
    const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    // Joue un geste pas à pas ; renvoie false si la prise a été coupée.
    async function perform(gesture, id) {
        let notch = 0;
        for (const move of gesture) {
            if (id !== take) return false;
            if (move.zoom) {
                nav.perform(move);
                const frames = 1 + Math.max(0, 5 - notch++);  // premiers crans espacés, puis un par image
                for (let i = 0; i < frames; i++) await frame();
            } else {
                const duration = Math.min(1800, 350 + Math.hypot(move.dx, move.dy) * 0.7);
                const start = performance.now();
                let done = 0;
                for (let t = 0; t < 1;) {
                    await frame();
                    if (id !== take) return false;
                    t = Math.min(1, (performance.now() - start) / duration);
                    const k = ease(t);
                    nav.perform({ pan: true, dx: move.dx * (k - done), dy: move.dy * (k - done) });
                    done = k;
                }
            }
        }
        viewport.pointerMoved();  // la molette de l'humain repart de son propre pointeur
        return id === take;
    }

    function nodesOnLayer(ids) {
        return [...store.state.nodes.values()].filter(n => n.layer === store.state.layerId && (!ids || ids.includes(n.id)));
    }

    // Plan englobant quelques nodes (marge, barre de commande en bas), en coordonnées des nodes.
    function frameOf(nodes) {
        if (!nodes.length) return null;
        const xs = nodes.flatMap(n => [n.x - n.radius, n.x + n.radius]);
        const ys = nodes.flatMap(n => [n.y - n.radius, n.y + n.radius]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const zoom = Math.min(window.innerWidth / (x1 - x0 + 240), (window.innerHeight - covered()) / (y1 - y0 + 240), 1.6);
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom };
    }

    // Travelling vers un node : prise de hauteur si la cible est loin, glissé jusqu'à elle, puis
    // pinch ancré sur le node (il reste immobile pendant qu'on s'en approche).
    async function focus(node, zoom, id) {
        const p = view.screenCenter(node.id);
        const c = center();
        const far = Math.hypot(p.x - c.x, p.y - c.y) > 0.8 * Math.max(window.innerWidth, window.innerHeight);
        if (far && !(await perform(gestures.zoom(viewport.state.zoom * 0.55), id))) return false;
        if (!(await perform(gestures.focus(node.id, { zoomIn: false, offsetY: offset() }), id))) return false;
        const q = view.screenCenter(node.id);
        return perform(gestures.zoom(zoom, q.x, q.y), id);
    }

    function overview(nodes, id) {
        const shot = frameOf(nodes);
        return shot ? perform(gestures.frame(shot.x, shot.y, shot.zoom, offset()), id) : Promise.resolve(true);
    }

    async function step({ action, node, layer, zoom, text }, id) {
        stopDrift();
        let ok = true;
        if (action === 'travel' && layer !== store.state.layerId && store.state.layers.has(layer)) {
            const loaded = new Promise(resolve => store.once('store:hydrated', resolve));
            dispatch('go_to_layer', { id: layer });
            await loaded;
            await frame();
            ok = await overview(nodesOnLayer(), id);
        } else if (action === 'focus') {
            const target = store.state.nodes.get(node);
            if (!target || target.layer !== store.state.layerId) return;
            ok = await focus(target, zoom ?? Math.max(1.2, viewport.state.zoom), id);
        } else if (action === 'overview' || action === 'travel') {
            ok = await overview(nodesOnLayer(), id);
        }
        if (!ok || id !== take || !text) return;
        caption(text);
        await wait(Math.min(6000, 1400 + text.length * 45));
    }

    function stopDrift() {
        if (drifting) drifting.stop = true;
        drifting = null;
    }

    const camera = {
        play(steps) {
            const id = take;
            queue = queue.then(() => steps.reduce((p, s) => p.then(() => (id === take ? step(s, id) : null)), Promise.resolve()));
            return queue;
        },
        // Cadre les nodes créés quand le Gardien n'a prévu aucun travelling.
        follow(ids) {
            stopDrift();
            const id = take;
            const nodes = nodesOnLayer(ids).concat(nodesOnLayer(store.state.selection));
            queue = queue.then(() => (id === take ? overview(nodes, id) : null));
            return queue;
        },
        // Réflexion : quelques crans de recul, lents, au centre de l'écran.
        async drift() {
            stopDrift();
            const run = { stop: false };
            drifting = run;
            const id = take;
            const c = center();
            viewport.pointerMoved();
            for (let i = 0; i < 6 && !run.stop && id === take; i++) {
                nav.perform({ zoom: true, x: c.x, y: c.y, out: true });
                await wait(700);
            }
            viewport.pointerMoved();
        },
        stopDrift,
        cancel() {
            take += 1;
            stopDrift();
            queue = Promise.resolve();
        },
    };
    ['pointerdown', 'wheel'].forEach(type => svg.addEventListener(type, camera.cancel, { capture: true, passive: true }));
    return camera;
}
