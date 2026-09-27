// Pont entre le Gardien et Nodz (/universe) : le Gardien n'a pas d'outils à lui, il utilise ceux de
// Nodz (createNode, checkExistingLinks, deleteNode, nodeSizing, save, load, la touche Entrée de la
// téléportation, les boutons forme et verrou du node) et navigue avec les gestes de l'utilisateur
// (crans de molette sur le SVG, dragUniverse) joués avec un tempo de réalisateur.
// Les variables et fonctions de Nodz sont des globales des scripts classiques de la page.

import { endpoint } from './api.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export function createBridge({ caption }) {
    const refs = new Map();  // référence du Gardien (new1…) → id du node Nodz (N-12)
    let take = 0;            // numéro de prise : un geste de l'utilisateur coupe le travelling
    const cut = () => { take += 1; };
    svg.addEventListener('mousedown', cut, true);
    svg.addEventListener('wheel', event => { if (event.isTrusted) cut(); }, true);

    const nodeOf = ref => document.getElementById(refs.get(ref) || ref);
    const typeSelect = node => node.querySelector('select[id^="nodetypedropdown-"]');  // pas le choix de police
    const rootX = () => parseFloat(root.getAttribute('x'));
    const rootY = () => parseFloat(root.getAttribute('y'));
    // Coordonnées de Nodz (x, y vers le haut) ↔ écran, mêmes formules que createNode.
    const toScreen = (x, y) => ({ x: x * currentZoom - rootX() + centerX, y: -y * currentZoom + rootY() + centerY });
    const toWorld = (sx, sy) => ({ x: (sx - centerX + rootX()) / currentZoom, y: -(sy - centerY - rootY()) / currentZoom });
    const at = node => toScreen(parseFloat(node.getAttribute('x')), parseFloat(node.getAttribute('y')));
    const view = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    // --- gestes, joués comme l'utilisateur les joue

    // Crans de pinch au point écran (x, y) jusqu'à franchir `target` : un cran par image, départ en douceur.
    async function zoomTo(target, x, y, id) {
        isZooming = false;  // nouvelle ancre, comme après un mouvement de souris
        const out = currentZoom > target;
        for (let notch = 0, previous = null; out ? currentZoom > target : currentZoom < target; notch++) {
            if (id !== take || previous === currentZoom) break;  // coupé, ou borne atteinte
            previous = currentZoom;
            svg.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: out ? 0.9 : -0.9, cancelable: true }));
            for (let i = 0; i < 1 + Math.max(0, 5 - notch); i++) await frame();
        }
        isZooming = false;
        return id === take;
    }

    // Glissé de l'univers en travelling fluide (dragUniverse découpé).
    async function pan(dx, dy, id) {
        const duration = Math.min(1800, 350 + Math.hypot(dx, dy) * 0.7);
        const start = performance.now();
        let done = 0;
        for (let t = 0; t < 1;) {
            await frame();
            if (id !== take) return false;
            t = Math.min(1, (performance.now() - start) / duration);
            const k = ease(t);
            dragUniverse(dx * (k - done), dy * (k - done), false);
            done = k;
        }
        return true;
    }

    // Travelling vers un node : prise de hauteur s'il est loin, glissé, pinch ancré sur lui.
    async function focus(node, zoom, id) {
        const p = at(node);
        const v = view();
        const far = Math.hypot(p.x - v.x, p.y - v.y) > 0.8 * Math.max(window.innerWidth, window.innerHeight);
        if (far && !(await zoomTo(currentZoom * 0.55, v.x, v.y, id))) return false;
        const q = at(node);
        if (!(await pan(v.x - q.x, v.y - q.y, id))) return false;
        const r = at(node);
        return zoomTo(zoom, r.x, r.y, id);
    }

    async function overview(id) {
        const nodes = [...document.querySelectorAll('.node-group')];
        if (!nodes.length) return true;
        const pts = nodes.map(n => ({ x: parseFloat(n.getAttribute('x')), y: parseFloat(n.getAttribute('y')), r: parseFloat(n.children[1].getAttribute('r')) }));
        const [x0, x1] = [Math.min(...pts.map(p => p.x - p.r)), Math.max(...pts.map(p => p.x + p.r))];
        const [y0, y1] = [Math.min(...pts.map(p => p.y - p.r)), Math.max(...pts.map(p => p.y + p.r))];
        const zoom = Math.min(window.innerWidth / (x1 - x0 + 240), window.innerHeight / (y1 - y0 + 240), 1.6);
        const v = view();
        if (!(await zoomTo(zoom, v.x, v.y, id))) return false;
        const c = toScreen((x0 + x1) / 2, (y0 + y1) / 2);
        return pan(v.x - c.x, v.y - c.y, id);
    }

    // --- outils de Nodz

    function setText(node, markup) {
        const input = node.children[0].children[0];
        input.innerHTML = markup;
        input.dispatchEvent(new Event('input'));  // Nodz redimensionne le node selon son texte
        node.setAttribute('textcontent', input.innerHTML);
        input.blur();
        save(node);
    }

    // Couleur : mêmes effets que la roue de couleurs de Nodz sur un node.
    function paint(node, value) {
        node.setAttribute('color', value);
        const shape = node.getAttribute('shape');
        if (shape === 'circle') node.children[1].style.stroke = value;
        else if (shape === 'square') node.children[2].style.stroke = value;
        if (linkState === 0) JSON.parse(node.getAttribute('links')).forEach(id => updateLinkColor(document.getElementById(id)));
    }

    // Les boutons du node agissent sur la sélection : on sélectionne le node le temps d'appuyer.
    function withSelection(node, press) {
        const previous = [...selectedNodes];
        previous.forEach(n => nodeUnselection(n));
        nodeSelection(node);
        try {
            press();
        } finally {
            nodeUnselection(node);
            previous.forEach(n => nodeSelection(n));
        }
    }

    function setShape(node, shape) {
        const button = node.children[7].children[5].children[0];
        for (let i = 0; i < 3 && node.getAttribute('shape') !== shape; i++) withSelection(node, () => button.click());
    }

    function setLock(node, lock) {
        if ((node.getAttribute('lock') === '1') !== lock) withSelection(node, () => node.children[7].children[7].children[0].click());
    }

    function linkBetween(a, b) {
        return [...document.querySelectorAll('.link')].find(l =>
            (l.getAttribute('Node1') === a.id && l.getAttribute('Node2') === b.id) || (l.getAttribute('Node1') === b.id && l.getAttribute('Node2') === a.id));
    }

    async function waitLoaded() {
        await wait(50);
        while (isLoading) await wait(50);
        await frame();
    }

    // Image d'un agent : posée comme un import de l'utilisateur (data URL dans imagecontent, mode image).
    async function setImage(node, url) {
        const response = await fetch(endpoint(url), { credentials: 'same-origin' });
        if (!response.ok) throw new Error("image : téléchargement impossible");
        const blob = await response.blob();
        const data = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        node.setAttribute('imagecontent', data);  // avant le mode image : Nodz n'ouvre pas le sélecteur de fichier
        const select = typeSelect(node);
        select.value = 'image';
        select.dispatchEvent(new Event('change'));
        const img = node.children[0].children[1];
        await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; img.src = data; });
        nodeSizing(node, 250, 250);
        save(node);
    }

    const tools = {
        create({ ref, x, y, text, color: tint, shape }) {
            color = tint || getRandomColor();  // couleur du prochain node, comme la barre Espace
            const s = toScreen(x, y);
            const node = createNode(s.x, s.y);
            refs.set(ref, node.id);
            setText(node, text || '');
            if (shape && shape !== 'circle') setShape(node, shape);
            flipCoin(node);
            save(node);
        },
        update({ ref, text }) {
            setText(nodeOf(ref), text);
        },
        async image({ ref, url }) {
            await setImage(nodeOf(ref), url);
        },
        style({ ref, color: tint, shape, radius, lock }) {
            const node = nodeOf(ref);
            if (tint) paint(node, tint);
            if (shape) setShape(node, shape);
            if (radius) nodeSizing(node, radius * Math.SQRT2, radius * Math.SQRT2);
            if (lock !== null && lock !== undefined) setLock(node, lock);
            save(node);
        },
        set_type({ ref, content_type }) {
            const select = typeSelect(nodeOf(ref));
            select.value = content_type;
            select.dispatchEvent(new Event('change'));
        },
        link({ source, target }) {
            checkExistingLinks(nodeOf(source), nodeOf(target));
        },
        unlink({ source, target }) {
            const link = linkBetween(nodeOf(source), nodeOf(target));
            if (!link) return;
            cancelList.push(['linkdeletion', link.cloneNode(true)]);  // Ctrl+Z la rétablit, comme Suppr
            deleteLink(link);
        },
        archive({ ref }) {
            deleteNode([nodeOf(ref)]);
        },
        cleanup({ refs: ids }) {
            deleteNode(ids.map(nodeOf).filter(Boolean));
        },
        // Téléportation : la touche Entrée de Nodz sur le node sélectionné, puis le nom de la dimension.
        async portal({ ref, name }) {
            selectedNodes.forEach(n => nodeUnselection(n));
            nodeSelection(nodeOf(ref));
            isTyping = false;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await wait(80);
            if (name) layerNameInput.value = name;
            saveLayerName();
            await waitLoaded();
        },
        async travel({ layer, name }) {
            const target = layers.find(l => l.id === layer) || layers.find(l => l.name.toLowerCase() === String(name).toLowerCase());
            if (!target || target.id === layerNumber) return;
            load(target.id);
            await waitLoaded();
            await overview(take);
        },
        // Node trouvé dans une autre dimension : voyage, puis travelling jusqu'à lui.
        async goto({ ref, layer, zoom }) {
            if (!nodeOf(ref) && layer !== layerNumber) {
                load(layer);
                await waitLoaded();
            }
            if (!nodeOf(ref)) throw new Error(`goto : ${ref} introuvable`);
            await focus(nodeOf(ref), zoom ?? Math.max(1.2, currentZoom), take);
        },
        async focus({ ref, zoom }) {
            await focus(nodeOf(ref), zoom ?? Math.max(1.2, currentZoom), take);
        },
        async overview() {
            await overview(take);
        },
    };

    return {
        // Contexte envoyé au Gardien : ce que la page montre, en coordonnées de Nodz.
        context() {
            const nodes = [...document.querySelectorAll('.node-group')].map(n => ({
                id: n.id, text: n.getAttribute('textcontent') || n.children[0].children[0].innerHTML, color: n.getAttribute('color'),
                shape: n.getAttribute('shape'), type: n.getAttribute('type'), lock: n.getAttribute('lock') === '1',
                x: parseFloat(n.getAttribute('x')), y: parseFloat(n.getAttribute('y')), r: parseFloat(n.children[1].getAttribute('r')),
            }));
            const current = layers.find(l => l.id === layerNumber);
            return {
                layer: { id: layerNumber, name: current?.name || '' },
                layers: layers.map(l => ({ id: l.id, name: l.name })),
                nodes,
                links: [...document.querySelectorAll('.link')].map(l => [l.getAttribute('Node1'), l.getAttribute('Node2')]),
                selection: selectedNodes.map(n => n.id),
                view: toWorld(view().x, view().y),
            };
        },
        // Exécute une action du Gardien ; les légendes s'affichent à l'arrivée des travellings.
        async perform(action) {
            const tool = tools[action.op];
            if (!tool) return;
            const needs = [action.ref, action.source, action.target].filter(Boolean);
            const missing = needs.find(r => !nodeOf(r));
            if (missing && !['create', 'goto'].includes(action.op)) throw new Error(`${action.op} : ${missing} n'est pas dans cette dimension`);
            const id = take;
            await tool(action);
            if (action.text && ['focus', 'overview', 'travel', 'goto'].includes(action.op) && id === take) {
                caption(action.text);
                await wait(Math.min(6000, 1400 + action.text.length * 45));
            }
        },
        // L'humain déclenche l'IA : Ctrl+Entrée (Cmd+Entrée sur Mac) dans un node en cours d'écriture
        // l'envoie au Gardien. Écrire, déplacer ou quitter un node ne lance rien.
        watchMessages(send) {
            document.addEventListener('keydown', event => {
                if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || !event.isTrusted) return;
                const input = event.target;
                const node = input?.isContentEditable ? input.closest?.('.node-group') : null;
                if (!node) return;
                event.preventDefault();
                event.stopImmediatePropagation();  // ni saut de ligne ni raccourci de Nodz
                const text = input.innerText.trim();
                input.blur();  // Nodz enregistre le node en le quittant
                if (text) send(node, text);
            }, true);
        },
    };
}
