// Un renderer par type de contenu : mount(node, ctx) → élément HTML, update(el, node).
// Seul le type actif d'un node est monté ; les autres états restent dans node.payload.
// Les fichiers (image, vidéo, audio, document, 3D) passent par /api/v1/files, réservé au propriétaire.

import { api } from './api.js';

const html = (tag, attrs = {}, ...children) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.append(...children);
    return el;
};
const icon = name => `${document.documentElement.dataset.icons}${name}.svg`;

// Remplace un état du payload en gardant les autres.
function setState(ctx, node, type, state) {
    ctx.dispatch('update_node', { id: node.id, payload: { ...node.payload, [type]: state } });
}

// Choix d'un fichier puis envoi ; l'état du type reçoit {file, name, mime, size}.
function pickAndUpload(ctx, box, type, accept) {
    const input = html('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        box.classList.add('loading');
        try {
            const meta = await api.upload(file);
            setState(ctx, box.node, type, { file: meta.id, name: meta.name, mime: meta.mime, size: meta.size });
        } catch (error) {
            box.title = error.message;
        } finally {
            box.classList.remove('loading');
        }
    });
    input.click();
}

// Renderer d'un média : vide → bouton d'envoi ; sinon l'élément construit par `build(url, state, box)`.
function media(type, accept, label, build) {
    const render = (box, node) => {
        box.node = node;
        const state = node.payload[type];
        const key = state?.file || '';
        if (box.dataset.key === key && box.childElementCount) return;
        box.dataset.key = key;
        box.replaceChildren(key ? build(api.fileUrl(key), state, box) : html('button', {
            type: 'button', className: 'node-empty', title: label,
            onclick: () => pickAndUpload(box.ctx, box, type, accept),
        }, html('img', { src: icon('upload'), alt: '' }), html('span', { textContent: label })));
    };
    return {
        mount(node, ctx) {
            const box = html('div', { className: `node-media node-${type}` });
            box.ctx = ctx;
            render(box, node);
            return box;
        },
        update: render,
    };
}

// --- texte, avec la barre de mise en forme de v1 (taille, gras, italique, souligné, couleur, emoji)

const EMOJIS = ['😀', '😂', '😍', '🤔', '😎', '😢', '👍', '👎', '🙏', '💡', '🔥', '⭐', '❤️', '✅', '❌', '⚠️', '🚀', '🎯', '📌', '📎', '🧠', '🌍', '⏳', '🎉'];

function textTools(editor) {
    const keep = event => event.preventDefault();  // garder la sélection dans le texte
    const command = (name, value = null) => () => {
        document.execCommand(name, false, value);
        editor.dispatchEvent(new Event('input'));
    };
    const button = (name, title, action) => html('button', { type: 'button', title, onmousedown: keep, onclick: action },
        html('img', { src: icon(name), alt: '' }));
    const size = html('select', { title: 'Taille' },
        ...[['2', 'Petit'], ['3', 'Normal'], ['5', 'Grand'], ['7', 'Titre']].map(([value, textContent]) => html('option', { value, textContent })));
    size.value = '3';
    size.addEventListener('change', () => { editor.focus(); command('fontSize', size.value)(); });
    const color = html('input', { type: 'color', title: 'Couleur du texte', value: '#379be7' });
    color.addEventListener('input', () => command('foreColor', color.value)());
    const picker = html('div', { className: 'emoji-picker', hidden: true },
        ...EMOJIS.map(e => html('button', { type: 'button', textContent: e, onmousedown: keep, onclick: () => { command('insertText', e)(); picker.hidden = true; } })));
    return html('div', { className: 'text-tools' },
        size, button('bold', 'Gras', command('bold')), button('italic', 'Italique', command('italic')),
        button('underline', 'Souligné', command('underline')),
        html('label', { title: 'Couleur du texte', className: 'text-color' }, html('img', { src: icon('colorpicking'), alt: '' }), color),
        button('smiley', 'Emoji', () => { picker.hidden = !picker.hidden; }), picker);
}

const text = {
    mount(node, { dispatch }) {
        const editor = html('div', { className: 'node-text', contentEditable: 'true', spellcheck: false });
        const box = html('div', { className: 'node-text-box' }, editor, textTools(editor));
        box.node = node;
        editor.innerHTML = node.payload.text?.html || '';
        box.addEventListener('focusout', event => {
            if (box.contains(event.relatedTarget)) return;
            if (editor.innerHTML !== (box.node.payload.text?.html || '')) dispatch('update_node', { id: box.node.id, text: editor.innerHTML });
        });
        box.addEventListener('keydown', event => {
            if (event.key === 'Escape') editor.blur();
            event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de l'univers
        });
        return box;
    },
    update(box, node) {
        box.node = node;
        if (!box.contains(document.activeElement)) box.firstChild.innerHTML = node.payload.text?.html || '';
    },
    focus: box => box.firstChild.focus(),
};

// --- code : éditable, langue en étiquette (le Codeur y publie)

const code = {
    mount(node, { dispatch }) {
        const area = html('textarea', { className: 'node-code', spellcheck: false });
        const box = html('div', { className: 'node-code-box' }, html('span', { className: 'node-code-lang' }), area);
        area.addEventListener('keydown', event => {
            if (event.key === 'Tab') {
                event.preventDefault();
                area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end');
            }
            if (event.key === 'Escape') area.blur();
            event.stopPropagation();
        });
        area.addEventListener('blur', () => {
            const current = box.node;
            if (area.value !== (current.payload.code?.source || '')) {
                dispatch('update_node', { id: current.id, payload: { ...current.payload, code: { ...(current.payload.code || {}), source: area.value } } });
            }
        });
        code.update(box, node);
        return box;
    },
    update(box, node) {
        box.node = node;
        box.firstChild.textContent = node.payload.code?.language || '';
        if (document.activeElement !== box.lastChild) box.lastChild.value = node.payload.code?.source || '';
    },
    focus: box => box.lastChild.focus(),
};

// --- document : aperçu PDF, sinon icône ; téléchargement et remplacement (v1)

const DOC_ICONS = { xlsx: 'excel', xls: 'excel', csv: 'excel' };

const file = media('file', '*/*', 'Envoyer un fichier', (url, state, box) => {
    const name = state.name || 'fichier';
    const ext = name.split('.').pop().toLowerCase();
    const preview = ext === 'pdf'
        ? html('iframe', { src: `${url}#view=FitH&toolbar=0&navpanes=0&statusbar=0`, title: name, loading: 'lazy' })
        : html('img', { className: 'file-icon', src: icon(DOC_ICONS[ext] || 'file'), alt: '' });
    return html('div', { className: 'file-card' }, preview,
        html('div', { className: 'file-bar' },
            html('a', { href: api.fileUrl(state.file, true), title: 'Télécharger', className: 'file-action' }, html('img', { src: icon('download'), alt: '' })),
            html('span', { className: 'file-name', textContent: name, title: name }),
            html('button', { type: 'button', title: 'Remplacer', className: 'file-action', onclick: () => pickAndUpload(box.ctx, box, 'file', '*/*') },
                html('img', { src: icon('upload'), alt: '' }))));
});

// --- 3D : visualiseur STL (three.js r92 de v1, chargé à la demande), rotation auto et à la souris

let three = null;
function loadThree() {
    three ??= new Promise((resolve, reject) => {
        document.head.append(html('script', { src: document.documentElement.dataset.three, onload: () => resolve(window.THREE), onerror: reject }));
    });
    return three;
}

function parseStl(THREE, buffer) {
    const view = new DataView(buffer);
    const binary = buffer.byteLength >= 84 && buffer.byteLength === 84 + view.getUint32(80, true) * 50;
    let positions;
    if (binary) {
        const count = view.getUint32(80, true);
        positions = new Float32Array(count * 9);
        for (let i = 0; i < count; i++) {
            for (let v = 0; v < 9; v++) positions[i * 9 + v] = view.getFloat32(84 + i * 50 + 12 + v * 4, true);
        }
    } else {
        const numbers = [...new TextDecoder().decode(buffer).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => m.slice(1).map(Number));
        positions = new Float32Array(numbers);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.center();
    geometry.computeBoundingSphere();
    const scale = 1 / (geometry.boundingSphere.radius || 1);
    geometry.scale(scale, scale, scale);
    return geometry;
}

function stlViewer(url, box) {
    const stage = html('div', { className: 'stl-stage' });
    Promise.all([loadThree(), fetch(url, { credentials: 'same-origin' }).then(r => r.arrayBuffer())]).then(([THREE, buffer]) => {
        const size = () => Math.max(1, stage.clientWidth);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(size(), size());
        stage.append(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        const color = new THREE.Color(box.node.color || '#33ff99');
        scene.add(new THREE.Mesh(parseStl(THREE, buffer), new THREE.MeshPhongMaterial({ color, specular: 0x333333, shininess: 60 })));
        scene.add(new THREE.HemisphereLight(0xffffff, 0x222244, 0.9));
        const light = new THREE.DirectionalLight(0xffffff, 0.6);
        light.position.set(2, 3, 2);
        scene.add(light);
        let angle = 0;
        let dragging = null;
        stage.addEventListener('pointerdown', event => {
            event.stopPropagation();
            dragging = event.clientX;
            stage.setPointerCapture(event.pointerId);
        });
        stage.addEventListener('pointermove', event => {
            if (dragging === null) return;
            angle -= (event.clientX - dragging) * 0.01;
            dragging = event.clientX;
        });
        stage.addEventListener('pointerup', () => { dragging = null; });
        const frame = () => {
            if (!stage.isConnected) return renderer.dispose();  // démonté (hors écran ou autre type)
            if (dragging === null) angle += 0.0025;
            camera.position.set(Math.cos(angle) * 3, 0.6, Math.sin(angle) * 3);
            camera.lookAt(scene.position);
            if (renderer.domElement.width !== size()) renderer.setSize(size(), size());
            renderer.render(scene, camera);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }).catch(() => { stage.textContent = 'Aperçu 3D indisponible'; });
    return stage;
}

// --- dessin : opérations vectorielles de v1 (path, circle) plus ligne et gomme, en unités du node

const DRAW_TOOLS = [['pen', 'Crayon'], ['line', 'Ligne'], ['circle', 'Cercle'], ['eraser', 'Gomme']];

function opsOf(node) {
    if (node.payload.drawing?.ops) return node.payload.drawing.ops;
    try {
        return JSON.parse(node.payload.legacy?.canvas || '[]');
    } catch {
        return [];
    }
}

function paint(canvas, ops) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = canvas.width / (canvas.clientWidth || 1);
    ops.forEach(op => {
        ctx.save();
        ctx.scale(k, k);
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = op.color || '#ffffff';
        ctx.lineWidth = op.lineWidth || 2;
        ctx.globalCompositeOperation = op.type === 'erase' ? 'destination-out' : 'source-over';
        if (op.type === 'circle') {
            const c = Array.isArray(op.center) ? op.center[0] : op.center;
            ctx.arc(c.x, c.y, op.radius, 0, 2 * Math.PI);
        } else {
            const [first, ...rest] = op.points || [];
            if (first) {
                ctx.moveTo(first.x, first.y);
                rest.forEach(p => ctx.lineTo(p.x, p.y));
                if (!rest.length) ctx.lineTo(first.x + 0.01, first.y);
            }
        }
        ctx.stroke();
        ctx.restore();
    });
}

const drawing = {
    mount(node, { dispatch, viewport }) {
        const canvas = html('canvas', { className: 'node-canvas' });
        const box = html('div', { className: 'node-drawing' }, canvas);
        const state = { tool: 'pen', color: '#ffffff', width: 2, undone: [] };
        box.node = node;
        const save = ops => dispatch('update_node', { id: box.node.id, payload: { ...box.node.payload, drawing: { ops } } });
        const tools = DRAW_TOOLS.map(([name, title]) => {
            const button = html('button', { type: 'button', title, className: 'draw-tool' }, html('img', { src: icon(name), alt: '' }));
            button.addEventListener('click', () => {
                state.tool = name;
                tools.forEach(b => b.classList.toggle('active', b === button));
            });
            return button;
        });
        tools[0].classList.add('active');
        const color = html('input', { type: 'color', value: state.color, title: 'Couleur' });
        color.addEventListener('input', () => { state.color = color.value; });
        const width = html('input', { type: 'range', min: 1, max: 20, value: state.width, title: 'Épaisseur' });
        width.addEventListener('input', () => { state.width = Number(width.value); });
        const action = (name, title, run) => html('button', { type: 'button', title, onclick: run }, html('img', { src: icon(name), alt: '' }));
        box.append(html('div', { className: 'draw-tools' }, ...tools,
            action('undo', 'Annuler', () => {
                const ops = [...opsOf(box.node)];
                if (ops.length) {
                    state.undone.push(ops.pop());
                    save(ops);
                }
            }),
            action('redo', 'Refaire', () => { if (state.undone.length) save([...opsOf(box.node), state.undone.pop()]); }),
            action('eraseall', 'Tout effacer', () => { if (opsOf(box.node).length) save([]); }),
            html('label', { className: 'draw-color', title: 'Couleur' }, html('img', { src: icon('colorpicking'), alt: '' }), color), width));

        // Coordonnées en unités du node (indépendantes du zoom), comme v1.
        const point = event => {
            const rect = canvas.getBoundingClientRect();
            return { x: (event.clientX - rect.left) / viewport.state.zoom, y: (event.clientY - rect.top) / viewport.state.zoom };
        };
        let current = null;
        canvas.addEventListener('pointerdown', event => {
            if (box.node.lock || event.button !== 0) return;
            event.stopPropagation();
            canvas.setPointerCapture(event.pointerId);
            const p = point(event);
            const base = { color: state.color, lineWidth: state.tool === 'eraser' ? state.width * 4 : state.width };
            current = state.tool === 'circle' ? { ...base, type: 'circle', center: [p], radius: 0 }
                : { ...base, type: state.tool === 'eraser' ? 'erase' : 'path', points: [p], line: state.tool === 'line' };
        });
        canvas.addEventListener('pointermove', event => {
            if (!current) return;
            const p = point(event);
            if (current.type === 'circle') current.radius = Math.hypot(p.x - current.center[0].x, p.y - current.center[0].y);
            else if (current.line) current.points[1] = p;
            else current.points.push(p);
            paint(canvas, [...opsOf(box.node), current]);
        });
        canvas.addEventListener('pointerup', () => {
            if (!current) return;
            const { line, ...op } = current;
            current = null;
            state.undone = [];
            save([...opsOf(box.node), op]);
        });
        new ResizeObserver(() => {
            canvas.width = canvas.clientWidth * devicePixelRatio;
            canvas.height = canvas.clientHeight * devicePixelRatio;
            paint(canvas, opsOf(box.node));
        }).observe(canvas);
        return box;
    },
    update(box, node) {
        box.node = node;
        paint(box.firstChild, opsOf(node));
    },
};

export const renderers = {
    text,
    code,
    file,
    drawing,
    image: media('image', 'image/*', 'Choisir une image', (url, state) => html('img', { src: url, alt: state.name || '', draggable: false })),
    video: media('video', 'video/*', 'Choisir une vidéo', url => html('video', { src: url, controls: true, preload: 'metadata' })),
    audio: media('audio', 'audio/*', 'Choisir un son', url => html('audio', { src: url, controls: true, preload: 'metadata' })),
    model3d: media('model3d', '.stl', 'Choisir un modèle STL', (url, state, box) => stlViewer(url, box)),
    // Types sans renderer propre (prompt) : leur nom, en attendant.
    fallback: {
        mount(node) {
            return html('div', { className: 'node-placeholder', textContent: node.content_type });
        },
        update(el, node) {
            el.textContent = node.content_type;
        },
    },
};
