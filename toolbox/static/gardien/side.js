// Vue de côté : l'univers tourne d'un quart de tour autour de l'axe vertical. Le plan (X, Y) d'une dimension devient
// (dimension, Y) : chaque dimension est une colonne, dans l'ordre de leurs numéros, et Y ne change pas. Les nodes y
// gardent leur apparence (forme, couleur, texte mis en forme) : ce sont des répliques posées dans le groupe `universe`
// de Nodz, si bien que la molette, le glissé, Tab et les flèches déplacent la vue exactement comme en vue standard.
// Dans une colonne, les nodes de même hauteur s'écartent (aucun chevauchement) ; les colonnes s'écartent d'autant.
// La dimension ouverte tourne réellement (X·cos θ + Z·sin θ), les autres apparaissent ; liens de chaque dimension et
// portails en arcs entre colonnes. Clic sur un node : retour dans le plan et voyage jusqu'à lui ; Échap ou le cube :
// retour. Les nodes réels sont seulement cachés et les touches de création de Nodz bloquées : rien n'est modifié.
// Pour rester légère, la vue ne montre des autres dimensions que leurs nodes interdimensionnels (les bouts des
// portails), plus les NEAR nodes les plus proches du pointeur, toutes dimensions confondues : on voyage dans
// l'hyperspace en promenant le pointeur (ou en glissant, en zoomant), les nodes s'allument autour de lui, en détail
// les plus proches, en étiquette les autres, construits au premier passage. Un clic sur l'un y voyage.

import { api } from './api.js';

const NS = 'http://www.w3.org/2000/svg';
const DURATION = 1300;
const GAP = 40;          // entre deux nodes d'une colonne
const COLUMN_GAP = 280;  // entre deux colonnes
const RICH = 1500;       // au-delà, contenu en version légère (étiquette SVG, image) : la vue reste fluide
const NEAR = 500;         // nodes des autres dimensions montrés autour du pointeur
const DETAIL = 40;        // les plus proches d'entre eux, en détail (texte mis en forme, image, document)
const DOCS = 12;         // aperçus de documents lus dans les autres dimensions
const PREVIEWED = /\.(pdf|docx?|pptx?)$/i;  // documents dont le serveur garde un aperçu PDF
const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Shift', 'Control', 'Alt', 'Meta']);
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const make = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
};

// Nodes d'une colonne, du haut vers le bas : chacun reste à sa hauteur et s'écarte à gauche ou à droite tant qu'il en
// chevauche un autre. Rend l'étendue de la colonne.
function spread(nodes) {
    const placed = [];
    nodes.sort((a, b) => b.y - a.y).forEach(n => {
        for (let k = 0; ; k++) {
            const ox = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * n.r + GAP);
            if (!placed.some(p => Math.hypot(p.ox - ox, p.y - n.y) < p.r + n.r + GAP)) {
                n.ox = ox;
                placed.push(n);
                break;
            }
        }
    });
    return { min: Math.min(0, ...placed.map(n => n.ox - n.r)), max: Math.max(0, ...placed.map(n => n.ox + n.r)) };
}

const plain = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent;  // sans charger d'image

export function createSide({ bridge, say, filters }) {
    const cube = document.createElement('button');
    cube.type = 'button';
    cube.id = 'gardien-cube';
    cube.innerHTML = '<span class="gc3">' + '<i></i>'.repeat(6) + '</span><small>hyperspace</small>';
    document.body.append(cube);

    let scene = null, busy = false;
    cube.addEventListener('click', () => (scene ? close() : open()));

    // En vue de côté, Nodz ne crée ni n'écrit rien : seules ses touches de déplacement passent.
    document.addEventListener('keydown', event => {
        if (!scene) return;
        if (event.target.closest?.('input, textarea')) return;  // la recherche des filtres reste utilisable
        if (event.key === 'Escape') close();
        if (KEYS.has(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    function frame(e) {
        const { nodes, links, portals, columns, pivot } = scene;
        const theta = (e * Math.PI) / 2, cos = Math.cos(theta), sin = Math.sin(theta);
        const squeeze = 0.25 + 0.75 * Math.abs(Math.cos(2 * theta));  // de profil à mi-rotation
        nodes.forEach(n => {
            if (!n.el) return;  // pas encore montré
            n.px = n.here ? pivot + (n.x - pivot) * cos + (n.fx - pivot) * sin : pivot + (n.fx - pivot) * sin;
            n.el.setAttribute('transform', `translate(${n.px.toFixed(1)} ${(-n.y).toFixed(1)}) scale(${squeeze.toFixed(3)} 1)`);
            n.el.style.opacity = n.here ? 1 : e;
        });
        links.forEach(l => {
            if (!l.el) return;
            l.el.setAttribute('x1', l.a.px); l.el.setAttribute('y1', -l.a.y);
            l.el.setAttribute('x2', l.b.px); l.el.setAttribute('y2', -l.b.y);
            l.el.style.opacity = l.a.here ? 1 : e;
        });
        portals.forEach(p => {
            const lift = Math.min(400, Math.abs(p.b.px - p.a.px) * 0.3);
            p.el.setAttribute('d', `M${p.a.px} ${-p.a.y} Q${(p.a.px + p.b.px) / 2} ${-Math.max(p.a.y, p.b.y) - lift} ${p.b.px} ${-p.b.y}`);
            p.el.style.opacity = e;
        });
        columns.forEach(c => {
            const x = pivot + (c.x - pivot) * sin;
            c.line.setAttribute('x1', x); c.line.setAttribute('x2', x);
            c.label.setAttribute('x', x);
            c.line.style.opacity = c.label.style.opacity = e;
        });
    }

    function animate(from, to) {
        return new Promise(resolve => {
            const start = performance.now();
            (function step(now) {
                const t = Math.min(1, (now - start) / DURATION);
                frame(ease(from + (to - from) * t));
                if (t < 1) requestAnimationFrame(step); else resolve();
            })(start);
        });
    }

    function replica(n, rich) {
        const g = make('g', { class: 'gs-node' });
        g.style.setProperty('--c', n.color || '#33FF99');
        const r = n.r;
        g.append(n.shape === 'square' ? make('rect', { class: 'gs-shape', x: -r, y: -r, width: 2 * r, height: 2 * r })
            : make('circle', { class: `gs-shape${n.shape === 'none' ? ' bare' : ''}`, r }));
        if (rich && n.image) {  // image (ou dessin de la dimension ouverte) : dans la forme, comme en vue standard
            const fo = make('foreignObject', { x: -r, y: -r, width: 2 * r, height: 2 * r });
            fo.append(Object.assign(document.createElement('img'), { className: `gs-image${n.shape === 'square' ? '' : ' round'}`, src: n.image, alt: '', loading: 'lazy' }));
            g.append(fo);
        } else if (rich && n.file) {  // document : sa carte (type et nom), que son aperçu remplace dès qu'il est lu
            const fo = make('foreignObject', { x: -r * 0.78, y: -r * 0.78, width: r * 1.56, height: r * 1.56 });
            const card = Object.assign(document.createElement('div'), { className: 'gs-file' });
            const dot = n.file.lastIndexOf('.');
            card.append(Object.assign(document.createElement('b'), { textContent: dot > 0 ? n.file.slice(dot + 1, dot + 6).toUpperCase() : 'DOC' }),
                Object.assign(document.createElement('span'), { textContent: n.file }));
            fo.append(card);
            g.append(fo);
            n.doc = fo;
            if (n.preview) preview(n, n.preview);
        } else if (rich && n.html) {
            const fo = make('foreignObject', { x: -r * 0.78, y: -r * 0.78, width: r * 1.56, height: r * 1.56 });
            const box = document.createElement('div');
            box.className = 'gs-text';
            const text = document.createElement('span');
            text.className = 'node-text-input';
            text.innerHTML = n.html;
            box.append(text);
            fo.append(box);
            g.append(fo);
        } else if (!rich) {  // beaucoup de nodes : son image, sinon une étiquette (texte, ou type et nom du fichier)
            if (n.image) {
                g.append(make('image', { href: n.image, x: -r, y: -r, width: 2 * r, height: 2 * r, preserveAspectRatio: 'xMidYMid slice',
                    'clip-path': n.shape === 'square' ? '' : `circle(${r}px at ${r}px ${r}px)` }));
            } else {
                const words = (n.file || n.plain || '').trim().replace(/\s+/g, ' ');
                if (words) {
                    const label = make('text', { class: 'gs-label', 'text-anchor': 'middle', dy: '0.35em', 'font-size': Math.max(12, r / 3.2) });
                    label.textContent = words.length > 28 ? `${words.slice(0, 27)}…` : words;
                    g.append(label);
                }
            }
        }
        let press = null;
        g.addEventListener('pointerdown', event => { press = [event.clientX, event.clientY]; });
        g.addEventListener('pointerup', event => {
            if (press && Math.hypot(event.clientX - press[0], event.clientY - press[1]) < 5) close(n);
            press = null;
        });
        return g;
    }

    // L'aperçu d'un document dans sa réplique, comme dans le node : la page du PDF, sans barre ni clic (la molette
    // et le glissé restent à la vue).
    function preview(n, src) {
        const r = n.r * 0.72;
        const fo = make('foreignObject', { x: -r, y: -r, width: 2 * r, height: 2 * r });
        fo.append(Object.assign(document.createElement('iframe'), { className: 'gs-doc', title: n.file, tabIndex: -1,
            src: `${src.split('#')[0]}#view=FitH&toolbar=0&navpanes=0&statusbar=0` }));
        n.doc.replaceWith(fo);
        n.doc = fo;
    }

    // Documents des autres dimensions : leur aperçu est lu au serveur (route de Nodz), quelques-uns au plus.
    function fetchDocs(current) {
        current.nodes.filter(n => !n.here && n.doc && !n.fetched && PREVIEWED.test(n.file)).slice(0, DOCS).forEach(n => {
            n.fetched = true;
            fetch('/load-file/', { method: 'POST', headers: { 'X-CSRFToken': getCookie('nodz_csrftoken') },
                body: JSON.stringify({ nodeID: parseInt(n.id.match(/\d+/)[0], 10), fileName: n.file }) })
                .then(response => (response.ok ? response.blob() : null))
                .then(blob => {
                    if (!blob || scene !== current) return;
                    const url = URL.createObjectURL(blob);
                    current.urls.push(url);
                    preview(n, url);
                })
                .catch(() => {});  // la carte reste
        });
    }

    function build({ layers: known, nodes: stored, links: pairs, portals: bridges }) {
        const current = layerNumber;
        const names = new Map(known.map(l => [l.id, l.name]));
        // La dimension ouverte telle qu'à l'écran (nodes pas encore sauvés compris), les autres telles qu'en base.
        const live = [...document.querySelectorAll('.node-group')].map(g => {
            const shape = g.getAttribute('shape') === 'square' ? g.children[2] : g.children[1];
            const r = g.getAttribute('shape') === 'square' ? Number(shape.getAttribute('width')) / 2 : Number(shape.getAttribute('r'));
            const type = g.getAttribute('type'), sketch = g.children[0].children[3];
            const image = type === 'image' ? g.getAttribute('imagecontent')
                : type === 'canvas' && sketch instanceof HTMLCanvasElement ? sketch.toDataURL() : '';
            return { id: g.id, layer: current, x: Number(g.getAttribute('x')), y: Number(g.getAttribute('y')), r: r || 60,
                color: g.getAttribute('color'), shape: g.getAttribute('shape'), html: g.children[0].children[0].innerHTML,
                plain: g.children[0].children[0].innerText, image: image && image !== 'null' ? image : '',
                file: type === 'file' && g.getAttribute('filename') !== 'null' ? g.getAttribute('filename') : '',
                preview: type === 'file' && g.querySelector('iframe.filepreview')?.style.display === 'block' ? g.querySelector('iframe.filepreview').src : '' };
        });
        const seen = new Set(live.map(n => n.id));
        const nodes = [...live, ...stored.filter(n => n.layer !== current && !seen.has(n.id))
            .map(n => ({ ...n, r: Math.min(300, Math.max(40, n.radius || 60)), plain: plain(n.html) }))];
        const livePairs = [...document.querySelectorAll('.link')].map(l => [l.getAttribute('Node1'), l.getAttribute('Node2')]);
        const center = bridge.center();
        // Colonnes dans l'ordre des numéros de dimension, écartées selon leur largeur ; la dimension ouverte reste
        // au centre de la vue (elle pivote sur place).
        const byLayer = new Map([[current, []]]);
        nodes.forEach(n => {
            n.here = n.layer === current;
            if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
            byLayer.get(n.layer).push(n);
        });
        const order = [...byLayer.keys()].sort((a, b) => a - b);
        let cursor = 0;
        const centers = new Map(), extents = new Map();
        order.forEach(layer => {
            const { min, max } = spread(byLayer.get(layer));
            extents.set(layer, { min, max });
            centers.set(layer, cursor - min);
            cursor = cursor - min + max + COLUMN_GAP;
        });
        const shift = center.x - centers.get(current);
        const gates = new Set(bridges.flat());  // nodes interdimensionnels : montrés d'emblée
        nodes.forEach(n => { n.gate = gates.has(n.id); n.shown = n.here || n.gate; });
        const rich = nodes.filter(n => n.shown).length <= RICH;
        // Dans `universe`, Nodz dessine un node à sa position plus (centerX, centerY) : même décalage ici.
        const group = make('g', { class: 'gardien-side-layer', transform: `translate(${centerX} ${centerY})` });
        const [guides, linkLayer, portalLayer, nodeLayer] = ['gs-guides', 'gs-links', 'gs-portals', 'gs-nodes'].map(c => group.appendChild(make('g', { class: c })));
        const byId = new Map();
        nodes.forEach(n => {
            n.fx = centers.get(n.layer) + shift + n.ox;
            if (n.shown) n.el = nodeLayer.appendChild(replica(n, rich));
            byId.set(n.id, n);
        });
        const links = [];  // tracés quand leurs deux bouts sont montrés
        const linked = new Set();
        [...pairs, ...livePairs].forEach(([a, b]) => {
            const key = [a, b].sort().join('|');
            if (!byId.has(a) || !byId.has(b) || linked.has(key)) return;
            linked.add(key);
            links.push({ a: byId.get(a), b: byId.get(b), el: null });
        });
        const portals = bridges.filter(([a, b]) => byId.has(a) && byId.has(b))
            .map(([a, b]) => ({ a: byId.get(a), b: byId.get(b), el: portalLayer.appendChild(make('path')) }));
        const ys = nodes.length ? nodes : [{ y: center.y, r: 0 }];
        const top = Math.max(...ys.map(n => n.y + n.r)) + 220;  // étiquettes des colonnes au-dessus
        const bottom = Math.min(...ys.map(n => n.y - n.r)) - 120;
        const columns = order.map(layer => {
            const x = centers.get(layer) + shift;
            const line = guides.appendChild(make('line', { class: layer === current ? 'here' : '', y1: -top + 60, y2: -bottom }));
            const label = guides.appendChild(make('text', { class: layer === current ? 'here' : '', y: -top }));
            const count = byLayer.get(layer).length;
            label.textContent = `${layer} · ${names.get(layer) || ''} · ${count} node${count > 1 ? 's' : ''}`;
            return { layer, x, line, label, ...extents.get(layer) };
        });
        const xs = nodes.map(n => n.fx).concat(columns.map(c => c.x));
        scene = { nodes, links, portals, columns, group, nodeLayer, linkLayer, pivot: center.x, urls: [], near: new Set(), at: null,
            far: nodes.filter(n => !n.here && !n.gate),
            bounds: { x0: Math.min(...xs) - 200, x1: Math.max(...xs) + 200, y0: bottom, y1: top } };
        wire();
        sift();
    }

    // Liens dont les deux bouts sont montrés : tracés (une fois), les autres cachés.
    function wire() {
        scene.links.forEach(l => {
            const on = l.a.shown && l.b.shown;
            if (on && !l.el) l.el = scene.linkLayer.appendChild(make('line'));
            if (l.el) l.el.style.display = on ? '' : 'none';
        });
    }

    // Les NEAR nodes les plus proches du point (x, y) de la scène s'allument, les autres s'éteignent (gardés construits).
    function reveal(x, y) {
        const ranked = scene.far.map(n => [(n.fx - x) ** 2 + (n.y + y) ** 2, n]).sort((a, b) => a[0] - b[0]).slice(0, NEAR);
        const near = new Set(ranked.map(([, n]) => n));
        scene.near.forEach(n => {
            if (near.has(n)) return;
            n.shown = false;
            n.el.style.display = 'none';
        });
        ranked.forEach(([, n], i) => {
            const rich = i < DETAIL;
            if (n.el && n.rich !== rich && rich) {  // passé au premier plan : sa réplique détaillée remplace l'étiquette
                n.el.remove();
                n.el = null;
            }
            if (!n.el) {
                n.el = scene.nodeLayer.appendChild(replica(n, rich));
                n.rich = rich;
            }
            n.shown = true;
            n.el.style.display = '';
        });
        scene.near = near;
        wire();
        frame(1);
        sift();
        fetchDocs(scene);
    }

    // Le pointeur se déplace dans la scène (souris, glissé, molette) : l'hyperspace s'allume autour de lui.
    let pending = 0, last = null;
    function follow(event) {
        if (event.clientX !== undefined) last = [event.clientX, event.clientY];
        if (!scene || busy || pending || !last) return;
        pending = requestAnimationFrame(() => {
            pending = 0;
            const m = scene?.group.getScreenCTM();
            if (!scene || busy || !m) return;
            const p = new DOMPoint(...last).matrixTransform(m.inverse());
            const step = 40 / Math.max(m.a, 0.01);  // moins de 40 px d'écran : rien ne change
            if (scene.at && Math.hypot(p.x - scene.at.x, p.y - scene.at.y) < step) return;
            scene.at = p;
            reveal(p.x, p.y);
        });
    }
    document.addEventListener('pointermove', follow);
    document.addEventListener('wheel', follow, { passive: true });

    // Filtres du haut (texte, origine, période) : comme en vue standard, les nodes écartés et leurs liens s'estompent.
    function sift() {
        if (!scene) return;
        const on = filters.active();
        scene.nodes.forEach(n => { n.out = on && !filters.keeps(n.id, n.plain || ''); n.el?.classList.toggle('gs-out', n.out); });
        [...scene.links, ...scene.portals].forEach(l => l.el?.classList.toggle('gs-out', l.a.out || l.b.out));
    }
    filters.onChange(sift);

    async function open() {
        if (busy || (typeof admin !== 'undefined' && admin)) return;
        busy = true;
        try {
            const data = await api.request('GET', 'toolbox/side');
            selectedNodes.slice().forEach(n => nodeUnselection(n));
            const c = bridge.center(), hw = window.innerWidth / 2 / Number(currentZoom), hh = window.innerHeight / 2 / Number(currentZoom);
            const back = { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh };  // la vue à retrouver en sortant
            build(data);
            scene.back = back;
            universe.append(scene.group);
            fetchDocs(scene);
            document.body.classList.add('gardien-side-on');
            cube.classList.add('on');
            frame(0);
            await Promise.all([animate(0, 1), bridge.frame(scene.bounds, 80)]);
            busy = false;
            // Allumé d'emblée autour du centre de la vue, comme si le pointeur y passait : il est encore sur le cube (ou
            // n'a pas bougé), et l'hyperspace s'allumait dans le coin jusqu'au premier mouvement de souris.
            last = [window.innerWidth / 2, window.innerHeight / 2];
            scene.at = null;
            follow({});
        } catch (error) {
            say(`Vue de côté : ${error.message}`, 'error');
            teardown();
        } finally {
            busy = false;
        }
    }

    function teardown() {
        scene?.urls.forEach(url => URL.revokeObjectURL(url));
        scene?.group.remove();
        scene = null;
        document.body.classList.remove('gardien-side-on');
        cube.classList.remove('on');
    }

    async function close(target = null) {
        if (busy || !scene) return;
        busy = true;
        const back = scene.back;
        await Promise.all([animate(1, 0), target ? null : bridge.frame(back, 0)]);
        teardown();
        busy = false;
        if (target) await bridge.perform({ op: 'goto', ref: target.id, layer: target.layer, zoom: 1.2 });
    }

    return { open, close };
}
