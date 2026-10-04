// Pont entre le Gardien et Nodz (/universe) : le Gardien n'a pas d'outils à lui, il utilise ceux de
// Nodz (createNode, checkExistingLinks, deleteNode, nodeSizing, save, load, la touche Entrée de la
// téléportation, les boutons forme et verrou du node) et navigue avec les gestes de l'utilisateur
// (crans de molette sur le SVG, dragUniverse) joués avec un tempo de réalisateur.
// Les variables et fonctions de Nodz sont des globales des scripts classiques de la page.

import { endpoint } from './api.js';
import { dragging } from './gesture.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SKETCH = 360;  // côté d'un node de croquis posé par l'IA (le canvas de Nodz en fait 750)
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export function createBridge({ caption, onTour = () => {}, onAttach = () => {}, onBranch = () => {}, onSchema = async () => {}, onFree = () => {}, onArrange = () => {},
    onCodeError = () => {} }) {
    let ide = null;  // l'IDE des nodes de code (gardien.js le branche) : le Codeur y écrit et y exécute
    const refs = new Map();  // référence du Gardien (new1…) → id du node Nodz (N-12)
    let take = 0;            // numéro de prise : un geste de l'utilisateur coupe le travelling
    const cut = () => { take += 1; };
    let tempo = 1;           // vitesse des travellings (la visite la règle ; 1 pour le Gardien)
    svg.addEventListener('mousedown', cut, true);
    svg.addEventListener('wheel', event => { if (event.isTrusted) cut(); }, true);

    const nodeOf = ref => document.getElementById(refs.get(ref) || ref);
    // Le choix du type (pas celui de la police) : dans la barre d'outils du node, rangée hors du node (node.tools).
    const typeSelect = node => (node.tools?.type || node).querySelector('select[id^="nodetypedropdown-"]');
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
            for (let i = 0; i < Math.max(1, Math.round((1 + Math.max(0, 5 - notch)) / tempo)); i++) await frame();
        }
        isZooming = false;
        return id === take;
    }

    // Glissé de l'univers en travelling fluide (dragUniverse découpé).
    async function pan(dx, dy, id) {
        const duration = Math.min(1800, 350 + Math.hypot(dx, dy) * 0.7) / tempo;
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

    // Recul jusqu'à voir tous les nodes de la dimension, ou seulement ceux donnés (une pensée du Gardien et ses résultats).
    async function overview(id, only) {
        const nodes = only?.length ? only : [...document.querySelectorAll('.node-group')];
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
        const button = node.tools.type.children[5].children[0];
        for (let i = 0; i < 3 && node.getAttribute('shape') !== shape; i++) withSelection(node, () => button.click());
    }

    function setLock(node, lock) {
        if ((node.getAttribute('lock') === '1') !== lock) withSelection(node, () => node.tools.type.children[7].children[0].click());
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
        create({ ref, x, y, text, color: tint, shape, forming, free }) {
            color = tint || getRandomColor();  // couleur du prochain node, comme la barre Espace
            const s = toScreen(x, y);
            const node = createNode(s.x, s.y);
            refs.set(ref, node.id);
            node.classList.toggle('gardien-forming', !!forming);  // une pensée qui s'écrit encore (mode Pensée)
            setText(node, text || '');
            if (shape && shape !== 'circle') setShape(node, shape);
            flipCoin(node);
            save(node);
            if (free) onFree(node);  // pensées et résultats (pas les gabarits) : la physique les écarte
        },
        update({ ref, text }) {
            nodeOf(ref).classList.remove('gardien-forming');
            setText(nodeOf(ref), text);
        },
        // Mode Pensée : les mots que le modèle a failli écrire flottent autour de la pensée, dérivent et s'évaporent ;
        // éphémères, ils ne sont ni des nodes ni sauvegardés.
        whisper({ ref, words }) {
            const node = nodeOf(ref);
            if (!node) return;
            const c = at(node);
            (words || []).forEach((word, i) => {
                const angle = -Math.PI / 2 + (i - (words.length - 1) / 2) * 0.9 + (Math.random() - 0.5) * 0.4;
                const w = Object.assign(document.createElement('span'), { className: 'gardien-whisper', textContent: `${word}…` });
                w.style.left = `${c.x + Math.cos(angle) * 70}px`;
                w.style.top = `${c.y + Math.sin(angle) * 50}px`;
                w.style.setProperty('--dx', `${Math.cos(angle) * 60}px`);
                w.style.setProperty('--dy', `${Math.sin(angle) * 60 - 30}px`);
                w.style.animationDelay = `${i * 0.25}s`;
                w.addEventListener('animationend', () => w.remove());
                document.body.append(w);
            });
        },
        // Mode Pensée : la pensée en train de s'écrire, mot à mot ; pas sauvegardée (update la fige et la sauve).
        draft({ ref, text }) {
            const node = nodeOf(ref);
            if (!node) return;
            node.children[0].children[0].innerHTML = text;
            node.setAttribute('textcontent', text);
        },
        async image({ ref, url }) {
            await setImage(nodeOf(ref), url);
        },
        // Le Codeur : le node devient un node de code, le code s'y écrit et s'exécute ; une erreur est rendue au Gardien.
        async code({ ref, lang, code }) {
            const node = nodeOf(ref);
            const select = typeSelect(node);
            select.value = 'code';
            select.dispatchEvent(new Event('change'));
            if (!ide) return;
            const { result, lines } = await ide.deliver(node, lang, code);
            const error = result !== 'ok' ? result : lines.find(l => /Traceback|Error\b|Erreur/.test(l));
            if (error) onCodeError(node, lines.slice(-6).join('\n') || error);
        },
        // Croquis de l'Illustrateur ou du Gardien : le node passe en dessin, à la taille du croquis (SKETCH de côté),
        // et les traits, dessinés pour un canvas de 750, s'y tracent un à un à l'échelle ; puis il est sauvé.
        async sketch({ ref, operations: drawn }) {
            const node = nodeOf(ref);
            const select = typeSelect(node);
            select.value = 'canvas';
            select.dispatchEvent(new Event('change'));
            nodeSizing(node, SKETCH, SKETCH);
            const k = SKETCH / 750, at = p => ({ x: p.x * k, y: p.y * k });
            const operations = drawn.map(o => ({ ...o, lineWidth: Math.max(1, o.lineWidth * k), ...(o.points ? { points: o.points.map(at) } : {}),
                ...(o.center ? { center: o.center.map(at), radius: o.radius * k } : {}) }));
            node.setAttribute('canvascontent', JSON.stringify(operations));
            const canvasId = node.children[0].children[3].id;
            for (let shown = 1; shown <= operations.length; shown++) {
                redrawCanvas(canvasId, shown - operations.length, operations);
                await new Promise(resolve => setTimeout(resolve, Math.max(25, 900 / operations.length)));
            }
            save(node);
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
            deleteLink(link);
        },
        archive({ ref }) {
            deleteNode([nodeOf(ref)]);
        },
        cleanup({ refs: ids }) {
            deleteNode(ids.map(nodeOf).filter(Boolean));
        },
        // Téléportation : la touche Entrée de Nodz sur le node sélectionné, puis le nom de la dimension. items : le
        // détail, posé en cercle autour du portail dans la nouvelle dimension (la copie du node y est seule).
        async portal({ ref, name, items }) {
            selectedNodes.forEach(n => nodeUnselection(n));
            nodeSelection(nodeOf(ref));
            isTyping = false;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await wait(80);
            if (name) layerNameInput.value = name;
            saveLayerName();
            await waitLoaded();
            const copy = document.querySelector('.node-group');
            if (!items?.length || !copy) return;
            const c = at(copy), reach = ((parseFloat(copy.children[1].getAttribute('r')) || 60) + 170) * currentZoom;
            items.forEach((text, i) => {
                const angle = (2 * Math.PI * i) / items.length - Math.PI / 2;
                color = copy.getAttribute('color') || getRandomColor();  // couleur du prochain node, comme la barre Espace
                const node = createNode(c.x + Math.cos(angle) * reach, c.y + Math.sin(angle) * reach);
                setText(node, text);
                checkExistingLinks(copy, node);
                save(node);
            });
            save(copy);
        },
        // Mode Pensée : un résultat devient un portail vers une nouvelle dimension (la touche Entrée de Nodz), puis retour
        // dans la dimension de la pensée, qui reste sous les yeux.
        async gate({ ref, name, items }) {
            const back = layerNumber;
            await tools.portal({ ref, name, items });
            load(back);
            await waitLoaded();
        },
        // Projet d'iAqua : une nouvelle dimension du même nom (bouton « New dimension » de Nodz), puis retour.
        async dimension({ name }) {
            if (layers.some(l => l.name.toLowerCase() === name.toLowerCase())) return;
            const back = layerNumber;
            createNewLayer();
            await wait(80);
            layerNameInput.value = name;
            saveLayerName();
            await waitLoaded();
            load(back);
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
        // Mode Pensée : la caméra cadre ce que le Gardien vient de penser et de créer.
        async frame({ refs: ids }) {
            await overview(take, (ids || []).map(nodeOf).filter(Boolean));
        },
        // Visite interactive d'une branche, pilotée par l'utilisateur (tour.js).
        tour({ ref }) {
            onTour(nodeOf(ref));
        },
        // Modèle de la galerie (SWOT, Eisenhower, Ishikawa…), fait de nodes et de liens (schemas.js), puis travelling
        // jusqu'à lui : la caméra le centre et recule s'il dépasse l'écran.
        async schema({ type, x, y, fill, title }) {
            const { width, height } = await onSchema(type, { x, y }, fill, title);
            const id = take, v = view(), c = toScreen(x, y);
            if (!(await pan(v.x - c.x, v.y - c.y, id))) return;
            const zoom = Math.min(Number(currentZoom), window.innerWidth / (width + 360), window.innerHeight / (height + 360));
            if (zoom < Number(currentZoom)) await zoomTo(zoom, v.x, v.y, id);
        },
    };

    return {
        useIde(editor) { ide = editor; },
        // Travelling de la visite ; faux si l'utilisateur a repris la main (clic, molette) ou si la visite a coupé.
        async visit(node, zoom = 0.9) {  // assez large pour voir les branches au-dessus du lecteur
            cut();
            return focus(node, zoom, take);
        },
        setTempo(k) { tempo = k; },
        center: () => toWorld(window.innerWidth / 2, window.innerHeight / 2),  // centre de la vue, en coordonnées de Nodz
        // Recule (jamais n'avance) pour montrer une zone de `width` × `height` autour du centre de la vue.
        async fit(width, height) {
            const zoom = Math.min(window.innerWidth / width, window.innerHeight / height);
            if (zoom >= currentZoom) return true;
            cut();
            const v = view();
            return zoomTo(zoom, v.x, v.y, take);
        },
        // Cadre une zone (coordonnées de Nodz) avec les gestes de Nodz : crans de molette puis glissé, comme overview.
        async frame({ x0, x1, y0, y1 }, margin = 160) {
            cut();
            const id = take, v = view();
            const zoom = Math.min(window.innerWidth / (x1 - x0 + 2 * margin), (window.innerHeight - 140) / (y1 - y0 + 2 * margin), 1.6);
            if (!(await zoomTo(zoom, v.x, v.y, id))) return false;
            const c = toScreen((x0 + x1) / 2, (y0 + y1) / 2);
            return pan(v.x - c.x, v.y - c.y, id);
        },
        // La visite passe un portail : la dimension de l'autre bout se charge, la caméra suit ensuite.
        async enter(layer) {
            if (layer === layerNumber) return;
            cut();
            load(layer);
            await waitLoaded();
        },
        cut,
        idOf: ref => refs.get(ref) || ref,  // identifiant Nodz (N-12) d'une référence du Gardien
        define: (op, fn) => { tools[op] = fn; },  // op exécutée par un autre module (remind : reminders.js)
        // Se rend dans la dimension `name` (créée si besoin, comme le bouton « New dimension » de Nodz) et y reste.
        async enterDimension(name) {
            const target = layers.find(l => l.name.toLowerCase() === name.toLowerCase());
            if (target && target.id === layerNumber) return;
            if (target) {
                load(target.id);
            } else {
                createNewLayer();
                await wait(80);
                layerNameInput.value = name;
                saveLayerName();
            }
            await waitLoaded();
        },
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
            if (missing && !['create', 'goto', 'remind'].includes(action.op)) throw new Error(`${action.op} : ${missing} n'est pas dans cette dimension`);
            const id = take;
            await tool(action);
            if (action.text && ['focus', 'overview', 'travel', 'goto'].includes(action.op) && id === take) {
                caption(action.text);
                await wait(Math.min(6000, 1400 + action.text.length * 45));
            }
        },
        // L'humain déclenche l'IA : la pastille « Gardien » près du node en cours d'écriture (ou du seul node
        // sélectionné), ou Ctrl+Entrée (Cmd+Entrée sur Mac) dans le node. Écrire, déplacer ou quitter un
        // node ne lance rien.
        // La pastille d'un node porte Branche ▾ (ranger, replier) et Sélection ▾ (amont, aval, tout ce qui lui est relié) ;
        // celle d'une multisélection : Gardien · N nodes et Ordonner. La Visite part du bouton du dock (gardien.js).
        watchMessages(send) {
            const textOf = node => node.children[0]?.children[0]?.innerText?.trim() || '';
            const pill = document.createElement('div');
            pill.id = 'gardien-send';
            pill.hidden = true;
            pill.innerHTML = '<button type="button" class="send" title="Joindre ces nodes à ta prochaine demande au Gardien (chat)"><i></i><span>Gardien</span></button>'
                + '<button type="button" class="arrange" title="Ordonner ces nodes : ils se repoussent et se posent">Ordonner</button>'
                + '<button type="button" class="branch" title="Branche : ranger en arbre, replier">Branche ▾</button>'
                + '<button type="button" class="pick" title="Sélection : amont, aval ou tout ce qui est relié">Sélection ▾</button>';
            const [sendButton, arrangeButton, branchButton, pickButton] = pill.children;
            // Les nodes reliés à `node` en remontant (parents : Node1 → Node2 = node), en descendant, ou les deux (tout ce
            // qui lui est relié), de proche en proche, par les seuls liens visibles : un node masqué par les filtres coupe
            // la chaîne (sinon les nodes au-delà semblaient pris sans lien).
            const kin = (node, way) => {
                const found = new Set([node.id]), queue = [node.id];
                const links = [...document.querySelectorAll('.link:not(.gardien-filtered)')].map(l => [l.getAttribute('Node1'), l.getAttribute('Node2')]);
                while (queue.length) {
                    const id = queue.shift();
                    links.forEach(([parent, child]) => {
                        const next = (way !== 'up' && parent === id) ? child : (way !== 'down' && child === id) ? parent : null;
                        if (next && !found.has(next) && document.getElementById(next)) {
                            found.add(next);
                            queue.push(next);
                        }
                    });
                }
                found.delete(node.id);
                return [...found].map(id => document.getElementById(id));
            };
            // Menu « Sélection » : remplace la sélection par le node et sa lignée choisie.
            const pickMenu = Object.assign(document.createElement('div'), { id: 'gardien-pick', hidden: true });
            document.body.append(pickMenu);
            pickMenu.addEventListener('mousedown', event => event.preventDefault());  // garde le focus : la pastille garde son node
            document.addEventListener('mousedown', event => { if (!pickMenu.contains(event.target)) pickMenu.hidden = true; }, true);
            const openPick = node => {
                const r = pickButton.getBoundingClientRect();
                pickMenu.replaceChildren(...[['up', '▲ Amont', 'Le node et tous ses parents, de lien en lien'],
                    ['down', '▼ Aval', 'Le node et tous ses enfants, de lien en lien'], ['all', 'Tout', 'Le node et tout ce qui lui est relié']]
                    .map(([way, label, title]) => {
                        const count = kin(node, way).length;
                        return Object.assign(document.createElement('button'), { type: 'button', textContent: `${label} (${count})`, title, disabled: !count,
                            onclick: () => { pickMenu.hidden = true; extend(way, node); } });
                    }));
                pickMenu.style.left = `${Math.min(innerWidth - 190, r.left)}px`;
                pickMenu.style.top = `${r.bottom + 6}px`;
                pickMenu.hidden = false;
            };
            const label = sendButton.querySelector('span');
            document.body.append(pill);
            let target = null;
            let group = [];  // multisélection : ses nodes partent au chat comme contexte de la prochaine demande
            const place = () => {
                if (!target || !target.isConnected) return hide();
                pill.style.visibility = dragging() ? 'hidden' : '';  // pendant un glissé : ni mesure ni suivi
                if (dragging()) return requestAnimationFrame(place);
                const shape = target.getAttribute('shape') === 'square' ? target.children[2] : target.children[1];
                const r = (shape || target).getBoundingClientRect();
                pill.style.left = `${Math.min(window.innerWidth - pill.offsetWidth - 8, r.right + 8)}px`;
                pill.style.top = `${Math.max(8, r.top + r.height / 2 - pill.offsetHeight / 2)}px`;
                sendButton.disabled = target.classList.contains('gardien-thinking');
                requestAnimationFrame(place);  // suit le node pendant les zooms et glissés
            };
            const show = (node, nodes = []) => {
                if (typeof admin !== 'undefined' && admin) return;  // univers d'un autre compte, en lecture
                group = nodes;
                pill.classList.toggle('multi', nodes.length > 1);
                label.textContent = `Gardien · ${nodes.length} nodes`;
                branchButton.hidden = nodes.length > 1 || !kin(node, 'down').length;  // une branche : des enfants
                if (target === node) return;
                const idle = !target;
                target = node;
                pill.hidden = false;
                if (idle) place();
            };
            function hide() { target = null; group = []; pill.hidden = true; }
            const fire = node => {
                const input = node.children[0].children[0];
                const text = textOf(node);
                if (document.activeElement === input) input.blur();  // Nodz enregistre le node en le quittant
                hide();
                if (text) send(node, text);
            };
            const editing = () => {
                const input = document.activeElement;
                return input?.isContentEditable ? input.closest?.('.node-group') : null;
            };
            // Le node en cours d'écriture ou le seul node sélectionné, s'il est relié à d'autres (sinon ses menus seraient
            // vides) ; plusieurs nodes sélectionnés : la pastille les joint au chat.
            const refresh = () => {
                const node = editing() || (selectedNodes.length === 1 ? selectedNodes[0] : null);
                if (!editing() && selectedNodes.length > 1) show(selectedNodes[selectedNodes.length - 1], [...selectedNodes]);
                else if (node && kin(node, 'all').length) show(node);
                else hide();
            };
            document.addEventListener('input', event => { if (event.target.isContentEditable) refresh(); }, true);
            document.addEventListener('focusin', refresh, true);
            document.addEventListener('focusout', () => setTimeout(refresh), true);
            document.addEventListener('mouseup', () => setTimeout(refresh), true);
            pill.addEventListener('mousedown', event => event.preventDefault());  // garde le focus dans le node
            sendButton.addEventListener('click', () => {
                const nodes = group;
                hide();
                onAttach(nodes);
            });
            // Sélection de zone : la physique de répulsion range ces nodes, les autres restent en place.
            branchButton.addEventListener('click', () => { if (target) onBranch(target, branchButton.getBoundingClientRect()); });
            arrangeButton.addEventListener('click', () => {
                const nodes = group.filter(n => n.isConnected);
                hide();
                onArrange(nodes);
            });
            pickButton.addEventListener('click', () => { if (target) openPick(target); });
            // Sélectionner le node et tous ses parents, ses enfants ou tout ce qui lui est relié, rien d'autre : une
            // sélection précédente est remplacée ; la pastille passe en multisélection.
            const extend = (way, node = target) => {
                if (!node?.isConnected) return;
                if (document.activeElement?.isContentEditable) document.activeElement.blur();
                const family = [node, ...kin(node, way)];
                [...selectedNodes].forEach(n => { if (!family.includes(n)) nodeUnselection(n); });
                family.forEach(n => { if (!selectedNodes.includes(n)) nodeSelection(n); });
                refresh();
            };
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') hide();
                if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || !event.isTrusted) return;
                const node = editing();
                if (!node) return;
                event.preventDefault();
                event.stopImmediatePropagation();  // ni saut de ligne ni raccourci de Nodz
                fire(node);
            }, true);
        },
    };
}
