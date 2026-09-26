// Travellings du Gardien : le vaisseau vole de node en node, recule pour montrer un plan, voyage
// entre les plans. Les étapes sont jouées dans l'ordre ; l'utilisateur reprend la main dès qu'il
// touche le canevas (clic, molette, doigt).

const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createCamera({ svg, store, viewport, dispatch, caption, covered = () => 0 }) {
    const { center, limits } = viewport;
    let flight = 0;  // incrémenté à chaque annulation : les vols en cours s'arrêtent
    let queue = Promise.resolve();
    let drifting = null;
    let hydrated = null;
    store.on('store:hydrated', () => { hydrated?.(); hydrated = null; });

    // Point du plan (coordonnées des nodes) au centre de l'écran, et zoom courant.
    function current() {
        const { tx, ty, zoom } = viewport.state;
        return { x: (innerWidth / 2 - tx) / zoom - center.x, y: (innerHeight / 2 - ty) / zoom - center.y, zoom };
    }

    function place(x, y, zoom) {
        const z = Number(Math.min(limits.max, Math.max(limits.min, zoom)).toFixed(3));
        viewport.setCamera(innerWidth / 2 - (center.x + x) * z, innerHeight / 2 - (center.y + y) * z, z);
    }

    // Les nodes visés sont centrés dans l'espace libre au-dessus de la barre de commande (`covered` px).
    const shift = zoom => covered() / 2 / zoom;

    // Vol en arc : on prend de la hauteur (dézoom) d'autant plus que le trajet est long.
    function fly(to, id, duration) {
        const from = current();
        const distance = Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.zoom, to.zoom);
        const lift = Math.min(0.6, distance / (2.5 * Math.max(innerWidth, innerHeight)));
        const time = duration ?? Math.min(2600, 900 + distance * 0.8);
        const start = performance.now();
        return new Promise(resolve => {
            function frame(now) {
                if (id !== flight) return resolve(false);
                const t = Math.min(1, (now - start) / time);
                const k = ease(t);
                const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * k) * (1 - lift * Math.sin(Math.PI * t));
                place(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, zoom);
                if (t < 1) requestAnimationFrame(frame);
                else resolve(true);
            }
            requestAnimationFrame(frame);
        });
    }

    function nodesOnLayer(ids) {
        return [...store.state.nodes.values()].filter(n => n.layer === store.state.layerId && (!ids || ids.includes(n.id)));
    }

    // Cadre englobant quelques nodes, avec de la marge (et la barre de commande en bas).
    function frameOf(nodes) {
        if (!nodes.length) return null;
        const xs = nodes.flatMap(n => [n.x - n.radius, n.x + n.radius]);
        const ys = nodes.flatMap(n => [n.y - n.radius, n.y + n.radius]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const zoom = Math.min(innerWidth / (x1 - x0 + 240), (innerHeight - covered()) / (y1 - y0 + 240), 1.6);
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + shift(zoom), zoom };
    }

    async function step({ action, node, layer, zoom, text }, id) {
        stopDrift();
        if (action === 'travel' && layer !== store.state.layerId && store.state.layers.has(layer)) {
            const loaded = new Promise(resolve => { hydrated = resolve; });
            dispatch('go_to_layer', { id: layer });
            await loaded;
            if (id !== flight) return;
            const target = frameOf(nodesOnLayer());
            if (target) place(target.x, target.y, target.zoom * 0.4);
            if (target) await fly(target, id, 1400);
        } else if (action === 'focus') {
            const target = store.state.nodes.get(node);
            if (!target || target.layer !== store.state.layerId) return;
            const z = zoom ?? Math.max(1.2, current().zoom);
            await fly({ x: target.x, y: target.y + shift(z), zoom: z }, id);
        } else if (action === 'overview' || action === 'travel') {
            const target = frameOf(nodesOnLayer());
            if (target) await fly(target, id);
        }
        if (id !== flight || !text) return;
        caption(text);
        await wait(Math.min(6000, 1400 + text.length * 45));
    }

    function stopDrift() {
        if (drifting) cancelAnimationFrame(drifting);
        drifting = null;
    }

    const camera = {
        // Ajoute une étape à la file ; renvoie la promesse de fin de file.
        play(steps) {
            const id = flight;
            queue = queue.then(() => steps.reduce((p, s) => p.then(() => (id === flight ? step(s, id) : null)), Promise.resolve()));
            return queue;
        },
        // Cadre les nodes créés quand le Gardien n'a prévu aucun travelling.
        follow(ids) {
            stopDrift();
            const target = frameOf(nodesOnLayer(ids).concat(nodesOnLayer(store.state.selection)));
            if (target) {
                const id = flight;
                queue = queue.then(() => fly({ ...target, zoom: Math.min(target.zoom, Math.max(current().zoom, 0.5)) }, id));
            }
            return queue;
        },
        // Pendant la réflexion : le vaisseau recule lentement (au plus 15 %).
        drift() {
            stopDrift();
            const from = current();
            const start = performance.now();
            const tick = now => {
                const t = Math.min(1, (now - start) / 12000);
                place(from.x, from.y, from.zoom * (1 - 0.15 * ease(t)));
                drifting = t < 1 ? requestAnimationFrame(tick) : null;
            };
            drifting = requestAnimationFrame(tick);
        },
        stopDrift,
        cancel() {
            flight += 1;
            stopDrift();
            queue = Promise.resolve();
        },
    };
    ['pointerdown', 'wheel'].forEach(type => svg.addEventListener(type, camera.cancel, { capture: true, passive: true }));
    return camera;
}
