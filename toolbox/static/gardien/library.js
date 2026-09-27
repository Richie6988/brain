// Agents et modèles : portage du ModelLoader de SquidMind dans Nodz. Quatre onglets : Agents,
// Bibliothèque (colonnes Gardien / Agents / Image, glisser-déposer, fiches modèles), Fichiers du
// serveur (import des .gguf déjà copiés) et Hugging Face (recherche filtrée, choix du fichier,
// téléchargements suivis). Consulter est ouvert à tous ; changer le serveur est réservé au staff.

import { api } from '../nodz/api.js';

const tb = {
    status: () => api.request('GET', 'toolbox/status'),
    agents: () => api.request('GET', 'toolbox/agents'),
    updateAgent: (id, fields) => api.request('PATCH', `toolbox/agents/${id}`, fields),
    models: () => api.request('GET', 'toolbox/models'),
    updateModel: (id, fields) => api.request('PATCH', `toolbox/models/${id}`, fields),
    removeModel: (id, file) => api.request('DELETE', `toolbox/models/${id}${file ? '?file=1' : ''}`),
    modelAction: (id, action) => api.request('POST', `toolbox/models/${id}/${action}`),
    download: file => api.request('POST', 'toolbox/models', file),
    recommendations: () => api.request('GET', 'toolbox/recommendations'),
    search: params => api.request('GET', `toolbox/hub/search?${new URLSearchParams(params)}`),
    files: repo => api.request('GET', `toolbox/hub/files?${new URLSearchParams({ repo })}`),
    serverFiles: () => api.request('GET', 'toolbox/files'),
    importFile: path => api.request('POST', 'toolbox/files', { path }),
    deleteFile: path => api.request('DELETE', `toolbox/files?${new URLSearchParams({ path })}`),
};

// Types Hugging Face (liste du ModelLoader de SquidMind), regroupés.
const PIPELINES = [
    ['Préréglages', [['', 'Tous'], ['text-generation', 'Génération de texte']]],
    ['Multimodal', [['audio-text-to-text', 'Audio-texte vers texte'], ['image-text-to-text', 'Image-texte vers texte'],
        ['image-text-to-image', 'Image-texte vers image'], ['image-text-to-video', 'Image-texte vers vidéo'],
        ['visual-question-answering', 'Questions sur image'], ['document-question-answering', 'Questions sur document'],
        ['video-text-to-text', 'Vidéo-texte vers texte'], ['any-to-any', 'Tout vers tout']]],
    ['Vision', [['text-to-image', 'Texte vers image'], ['image-to-text', 'Image vers texte'], ['image-to-image', 'Image vers image'],
        ['image-to-video', 'Image vers vidéo'], ['text-to-video', 'Texte vers vidéo'], ['image-classification', "Classification d'image"],
        ['object-detection', "Détection d'objets"], ['image-segmentation', 'Segmentation'], ['depth-estimation', 'Profondeur'],
        ['text-to-3d', 'Texte vers 3D'], ['image-to-3d', 'Image vers 3D'], ['image-feature-extraction', "Caractéristiques d'image"]]],
    ['Langage', [['text-classification', 'Classification de texte'], ['token-classification', 'Entités nommées'],
        ['question-answering', 'Questions-réponses'], ['summarization', 'Résumé'], ['translation', 'Traduction'],
        ['zero-shot-classification', 'Classification zéro-shot'], ['feature-extraction', 'Embeddings'], ['fill-mask', 'Masque'],
        ['sentence-similarity', 'Similarité de phrases'], ['text-ranking', 'Classement de textes']]],
    ['Audio', [['text-to-speech', 'Synthèse vocale'], ['text-to-audio', 'Texte vers audio'],
        ['automatic-speech-recognition', 'Reconnaissance vocale'], ['audio-to-audio', 'Audio vers audio'],
        ['audio-classification', "Classification d'audio"]]],
];
const SORTS = [['downloads', 'Téléchargements'], ['trending', 'Tendance'], ['likes', "J'aime"], ['created', 'Date de sortie'], ['recent', 'Récents']];
const QUANTS = [['', 'Toute quantisation'], ['Q4', 'Q4'], ['Q5', 'Q5'], ['Q8', 'Q8'], ['F16', 'F16'], ['IQ', 'IQ (iMatrix)']];
const SIZES = [['', '', 'Toutes'], ['', '1.5', '≤ 1B'], ['1.5', '4', '1–3B'], ['4', '9', '4–8B'], ['9', '15', '9–14B'], ['15', '', '15B +']];
const CAPS = {
    vision: ['VISION', '#0f9f6e'], tools: ['OUTILS', '#c47a00'], chat: ['CHAT', '#1E90FF'], code: ['CODE', '#00a383'],
    embed: ['EMBED', '#64748b'], image: ['IMAGE', '#6848A6'], audio: ['AUDIO', '#b8447a'], reason: ['RÉFLEXION', '#c2417f'],
};

// --- petits outils

function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    });
    node.append(...children.flat().filter(c => c != null && c !== false));
    return node;
}
const gb = bytes => (!bytes ? '' : bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} Mo` : `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} Go`);
const count = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n || 0));
const ago = seconds => {
    const s = Math.max(0, Date.now() / 1000 - seconds);
    return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `il y a ${Math.round(s / 3600)} h`;
};
const duration = s => (s == null ? '' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const capPill = cap => {
    const [label, color] = CAPS[cap] || [cap.toUpperCase(), '#64748b'];
    return h('span', { class: 'gl-cap', style: `color:${color};border-color:${color}55;background:${color}14` }, label);
};
const quantColor = q => (/Q8|Q6/.test(q) ? '#0f9f6e' : /Q[45]/.test(q) ? '#1E90FF' : /Q[23]/.test(q) ? '#c47a00' : /IQ/.test(q) ? '#6848A6' : '#64748b');

export function createLibrary({ onChange = () => {}, monitor = null } = {}) {
    let state = { staff: false, machine: {}, engine: false, loaded: null, agents: [], models: [], paramSpec: [] };
    let tab = 'agents';
    let tuning = null;  // modèle dont les réglages sont ouverts (panneau pleine largeur)
    let poll = null;
    const hf = { q: '', pipeline: '', sort: 'downloads', quant: '', min_b: '', max_b: '', results: null, repo: null, files: null, error: '' };

    const panels = {};
    const tabs = [['agents', 'Agents'], ['library', 'Bibliothèque'], ['server', 'Fichiers du serveur'], ['hub', 'Hugging Face']];
    const nav = h('nav', { class: 'gl-tabs' }, tabs.map(([key, label]) =>
        h('button', { type: 'button', dataset: { tab: key }, onclick: () => show(key) }, label)));
    const machineLine = h('p', { class: 'gl-machine' });
    const readOnly = h('p', { class: 'gl-warning', hidden: true },
        'Compte invité ou non administrateur : tu peux tout consulter, pas installer. Pour ajouter des modèles, recharge la page, ',
        'choisis LOGIN et entre le compte administrateur du serveur (créé ou promu sur le VPS par ', h('code', {}, 'manage.py bootstrap --email … --password …'), ').');
    const notice = h('p', { class: 'gl-notice', role: 'status' });
    tabs.forEach(([key]) => { panels[key] = h('section', { class: 'gl-panel', dataset: { panel: key } }); });
    const windowEl = h('div', { class: 'gl-window', role: 'dialog', 'aria-label': 'Agents et modèles' },
        h('header', {}, h('h2', {}, 'Agents & modèles'), nav, h('button', { type: 'button', class: 'gl-close', title: 'Fermer', onclick: close }, 'Fermer')),
        monitor, machineLine, readOnly, notice, Object.values(panels));
    const modal = h('div', { class: 'gl-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, windowEl);
    modal.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Escape') close();
    });
    document.body.append(modal);

    const guard = () => (state.staff ? {} : { disabled: true, title: "Réservé à l'administrateur du serveur" });
    const report = error => { notice.textContent = error.message; notice.classList.add('error'); };
    const ok = text => { notice.textContent = text; notice.classList.remove('error'); };
    async function act(run, message) {
        try {
            await run();
            if (message) ok(message);
            await refresh();
        } catch (error) {
            report(error);
        }
    }
    // Suppression en deux temps, sans confirm() natif.
    function confirmButton(label, run, attrs = {}) {
        const button = h('button', { type: 'button', class: 'gl-danger', ...guard(), ...attrs }, label);
        button.addEventListener('click', () => {
            if (button.dataset.armed) act(run);
            else {
                button.dataset.armed = '1';
                button.textContent = 'Confirmer';
                setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
            }
        });
        return button;
    }

    async function refresh() {
        const [status, { agents }, { models }] = await Promise.all([tb.status(), tb.agents(), tb.models()]);
        state = { ...state, staff: status.staff, machine: status.machine, engine: status.engine, loaded: status.loaded, agents, models, paramSpec: status.param_spec };
        const m = state.machine;
        machineLine.replaceChildren(
            m.gpu ? `GPU ${(m.vram_mb / 1024).toFixed(1)} Go` : `Sans GPU · ${(m.ram_mb / 1024).toFixed(1)} Go de RAM`,
            ` · budget des poids ${(m.budget_mb / 1024).toFixed(1)} Go · `,
            state.engine ? 'moteur local prêt' : 'moteur local absent (requirements-ai.txt)');
        readOnly.hidden = state.staff;
        render();
        onChange(state);
        clearTimeout(poll);
        if (!modal.hidden && models.some(x => x.status === 'downloading')) poll = setTimeout(() => refresh().catch(report), 1500);
    }

    function render() {
        nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== tab; });
        ({ agents: renderAgents, library: renderLibrary, server: renderServer, hub: renderHub })[tab]();
    }

    function show(key) {
        tab = key;
        render();
        if (key === 'server') loadServerFiles();
        if (key === 'hub' && !hf.results) hubSearch();
    }

    // --- Agents

    function renderAgents() {
        const ready = state.models.filter(m => m.status === 'ready' && m.kind === 'text');
        panels.agents.replaceChildren(...state.agents.map(agent => {
            const select = h('select', { 'aria-label': `Modèle de ${agent.name}`, disabled: agent.role === 'image' },
                h('option', { value: '' }, agent.role === 'image' ? "Génération d'images à venir" : 'Aucun modèle'),
                ready.map(m => h('option', { value: m.id, selected: m.id === agent.model }, m.label || m.filename)));
            select.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { model: select.value || null }), `${agent.name} : modèle changé`));
            const enabled = h('input', { type: 'checkbox', checked: agent.enabled });
            enabled.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { enabled: enabled.checked })));
            // Les consignes par défaut s'affichent telles quelles ; les garder inchangées n'enregistre rien.
            const prompt = h('textarea', { rows: 12, 'aria-label': `Consignes de ${agent.name}` }, agent.system_prompt || agent.default_prompt);
            const custom = () => (prompt.value.trim() === agent.default_prompt.trim() ? '' : prompt.value);
            prompt.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { system_prompt: custom() }), 'Consignes enregistrées'));
            const reset = h('button', { type: 'button', disabled: !agent.system_prompt }, 'Rétablir les consignes par défaut');
            const sampling = h('form', { class: 'gl-params-form' }, paramFields(['Échantillonnage'], agent.params || {}),
                h('div', { class: 'gl-actions' }, h('button', { type: 'submit' }, 'Enregistrer'),
                    h('button', { type: 'button', onclick: () => act(() => tb.updateAgent(agent.id, { params: {} }), `${agent.name} : échantillonnage du modèle`) }, 'Comme le modèle')));
            sampling.addEventListener('submit', event => {
                event.preventDefault();
                act(() => tb.updateAgent(agent.id, { params: collect(sampling) }), `${agent.name} : échantillonnage enregistré`);
            });
            reset.addEventListener('click', () => act(() => tb.updateAgent(agent.id, { system_prompt: '' }), `${agent.name} : consignes par défaut`));
            return h('article', { class: `gl-agent ${agent.role === 'orchestrator' ? 'is-guardian' : ''}` },
                h('div', { class: 'gl-agent-head' },
                    h('div', {}, h('strong', {}, agent.name), h('span', { class: 'gl-role' }, agent.role), h('small', {}, agent.description)),
                    h('label', { class: 'gl-switch', title: 'Actif' }, enabled, 'actif')),
                select,
                h('details', {}, h('summary', {}, agent.system_prompt ? 'Consignes (personnalisées)' : 'Consignes'), prompt,
                    agent.role === 'orchestrator' ? h('p', { class: 'gl-hint' }, 'Le format de réponse et la liste des outils du Gardien sont ajoutés automatiquement.') : null,
                    reset),
                h('details', {}, h('summary', {}, Object.keys(agent.params || {}).length ? 'Échantillonnage (propre à cet agent)' : 'Échantillonnage'),
                    h('p', { class: 'gl-hint' }, "Vide = réglages du modèle. Ces valeurs priment pour cet agent."), sampling));
        }));
    }

    // --- Bibliothèque

    const categoryOf = m => {
        const guardian = state.agents.find(a => a.role === 'orchestrator');
        if (guardian && guardian.model === m.id) return 'guardian';
        return m.kind === 'image' ? 'image' : 'agents';
    };

    function renderLibrary() {
        const models = state.models.filter(m => m.status === 'ready');
        if (!models.length) return renderWizard();
        const columns = [['guardian', 'GARDIEN', 'Lit les nodes, décide et agit', '#6848A6'],
            ['agents', 'AGENTS', 'Modèles des agents spécialisés', '#1E90FF'], ['image', 'IMAGE', 'Diffusion (à venir)', '#b8447a']];
        const tuned = models.find(m => m.id === tuning);
        panels.library.replaceChildren(tuned ? tuningPanel(tuned) : '', h('div', { class: 'gl-board' }, columns.map(([key, label, desc, color]) => {
            const cards = models.filter(m => categoryOf(m) === key);
            const column = h('div', { class: 'gl-column', style: `border-top-color:${color}`, dataset: { category: key } },
                h('div', { class: 'gl-column-head' }, h('span', { style: `color:${color}` }, label), h('span', {}, cards.length)),
                h('small', {}, desc),
                cards.length ? cards.map(modelCard) : h('div', { class: 'gl-drop-here' }, 'Déposer ici'));
            column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('over'); });
            column.addEventListener('dragleave', () => column.classList.remove('over'));
            column.addEventListener('drop', event => {
                event.preventDefault();
                column.classList.remove('over');
                moveTo(event.dataTransfer.getData('text/plain'), key);
            });
            return column;
        })));
    }

    function moveTo(modelId, category) {
        const model = state.models.find(m => m.id === modelId);
        if (!model || categoryOf(model) === category) return;
        const guardian = state.agents.find(a => a.role === 'orchestrator');
        if (category === 'guardian') {
            act(async () => {
                if (model.kind === 'image') await tb.updateModel(model.id, { kind: 'text' });
                await tb.updateAgent(guardian.id, { model: model.id });
            }, `Le Gardien utilise ${model.label || model.filename}`);
        } else {
            act(async () => {
                if (guardian?.model === model.id) await tb.updateAgent(guardian.id, { model: null });
                await tb.updateModel(model.id, { kind: category === 'image' ? 'image' : 'text' });
            });
        }
    }

    function nameCaps(m) {
        const name = `${m.repo} ${m.filename}`.toLowerCase();
        const caps = new Set(m.capabilities);
        if (/vision|vlm|-vl|llava|moondream|pixtral/.test(name)) caps.add('vision');
        if (/tool|function|hermes|instruct/.test(name)) caps.add('tools');
        if (/think|reason|r1|qwq/.test(name)) caps.add('reason');
        if (/code|coder/.test(name)) caps.add('code');
        return [...caps];
    }

    // Champs de réglages décrits par le serveur (params.py), regroupés ; vide = valeur par défaut.
    function paramFields(groups, cfg) {
        const field = p => {
            const value = cfg[p.key] ?? '';
            let input;
            if (p.kind === 'bool') {
                input = h('select', { name: p.key }, [['', 'défaut'], ['true', 'oui'], ['false', 'non']].map(([v, t]) =>
                    h('option', { value: v, selected: String(value) === v }, t)));
            } else if (p.kind === 'choice') {
                input = h('select', { name: p.key }, h('option', { value: '' }, 'défaut'),
                    p.choices.map(([v, t]) => h('option', { value: v, selected: String(value) === v }, t)));
            } else if (p.kind === 'list') {
                input = h('input', { name: p.key, value: Array.isArray(value) ? value.join(',') : value, placeholder: p.hint || '' });
            } else {
                input = h('input', { name: p.key, type: 'number', value, min: p.min, max: p.max, step: p.kind === 'int' ? 1 : 'any', placeholder: p.hint || '' });
            }
            return h('label', { title: p.hint || '' }, p.label, input);
        };
        return state.paramSpec.filter(p => groups.includes(p.group)).reduce((sets, p) => {
            let set = sets.find(f => f.dataset.group === p.group);
            if (!set) sets.push(set = h('fieldset', { dataset: { group: p.group } }, h('legend', {}, p.group)));
            set.append(field(p));
            return sets;
        }, []);
    }
    const collect = form => Object.fromEntries(state.paramSpec.filter(p => form.elements[p.key])
        .map(p => [p.key, form.elements[p.key].value.trim()]).filter(([, v]) => v !== ''));
    const summary = cfg => {
        const set = state.paramSpec.filter(p => cfg[p.key] !== undefined);
        const shown = (p, v) => (p.kind === 'bool' ? (v ? 'oui' : 'non') : p.kind === 'choice' ? p.choices.find(c => c[0] === String(v))?.[0] ?? v
            : Array.isArray(v) ? v.join(' / ') : v === -1 && p.key === 'n_gpu_layers' ? 'toutes' : String(v));
        return set.length ? set.map(p => h('span', {}, `${p.label} `, h('b', {}, shown(p, cfg[p.key])))) : [h('span', {}, 'Réglages par défaut')];
    };

    // Couches sur GPU : curseur de 0 à toutes, VRAM estimée d'après la taille du fichier.
    function offload(m, form) {
        const layers = m.gguf?.layers;
        const input = form.elements.n_gpu_layers;
        if (!layers || !input) return null;
        const vram = state.machine.vram_mb || 0;
        const perLayer = (m.size || 0) / layers / 1024 ** 2;  // Mo par couche (approximation)
        const fits = vram ? Math.max(0, Math.min(layers, Math.floor((vram * 0.9 - 600) / perLayer))) : 0;  // 600 Mo : cache et tampons
        const count = () => (input.value === '' ? null : Number(input.value) < 0 ? layers : Math.min(layers, Number(input.value)));
        const slider = h('input', { type: 'range', min: 0, max: layers, step: 1, value: count() ?? 0, 'aria-label': 'Couches sur GPU' });
        const note = h('small', {});
        const show = () => {
            const n = count();
            note.textContent = n === null ? `Défaut du serveur · ${layers} couches`
                : `${n} / ${layers} couches · environ ${(n * perLayer / 1024).toFixed(1)} Go de VRAM${vram ? ` sur ${(vram / 1024).toFixed(1)} Go` : ''}`;
            note.className = n !== null && vram && n * perLayer > vram * 0.9 ? 'gl-danger' : '';
        };
        const set = n => { input.value = n; slider.value = n < 0 ? layers : n; show(); };
        slider.addEventListener('input', () => set(Number(slider.value) === layers ? -1 : Number(slider.value)));
        input.addEventListener('input', () => { slider.value = count() ?? 0; show(); });
        show();
        return h('div', { class: 'gl-offload' },
            h('div', { class: 'gl-offload-head' }, h('strong', {}, 'Offload GPU'),
                h('button', { type: 'button', onclick: () => set(0) }, 'CPU'),
                vram ? h('button', { type: 'button', onclick: () => set(fits >= layers ? -1 : fits), title: 'Estimation selon la VRAM libre' }, `Ce qui tient (${fits >= layers ? 'tout' : fits})`) : null,
                h('button', { type: 'button', onclick: () => set(-1) }, 'Tout sur GPU')),
            slider, note,
            vram ? null : h('p', { class: 'gl-hint' }, "Pas de GPU NVIDIA détecté : l'offload n'agira qu'avec un GPU et llama-cpp-python compilé pour CUDA."));
    }

    const closeTuning = () => { tuning = null; render(); };
    function tuningPanel(m) {
        const form = h('form', { class: 'gl-params-form' }, paramFields(['GPU', 'Mémoire et vitesse', 'Échantillonnage'], m.params || {}));
        form.prepend(offload(m, form) || '');
        form.append(h('div', { class: 'gl-actions' }, h('button', { type: 'submit', class: 'gl-primary' }, 'Enregistrer'),
            h('button', { type: 'button', onclick: () => act(() => tb.updateModel(m.id, { params: {} }), 'Réglages par défaut') }, 'Tout par défaut'),
            h('button', { type: 'button', onclick: closeTuning }, 'Fermer')));
        form.addEventListener('submit', event => {
            event.preventDefault();
            act(() => tb.updateModel(m.id, { params: collect(form) }), m.loaded ? 'Réglages enregistrés : le modèle se recharge à la prochaine demande' : 'Réglages enregistrés');
        });
        return h('section', { class: 'gl-tuning' }, h('h3', {}, `Réglages de ${m.label || m.filename}`), form);
    }

    function modelCard(m) {
        const cfg = m.params || {};
        const rename = h('input', { class: 'gl-rename', value: m.label || '', placeholder: m.filename, hidden: true });
        rename.addEventListener('change', () => act(() => tb.updateModel(m.id, { label: rename.value.trim() })));
        const tiny = m.kind === 'text' && m.size && m.size < 0.8 * 1024 ** 3;
        const stats = m.stats;
        const card = h('article', { class: `gl-card ${m.loaded ? 'is-loaded' : ''}`, draggable: 'true' },
            h('div', { class: 'gl-card-head' },
                h('div', {}, h('strong', { title: m.filename }, m.label || m.filename), m.label ? h('small', {}, m.filename) : null, rename),
                h('span', { class: 'gl-size' }, gb(m.size))),
            h('div', { class: 'gl-badges' },
                m.loaded ? h('span', { class: 'gl-badge loaded' }, 'EN MÉMOIRE') : null,
                h('span', { class: 'gl-cap', style: `color:${quantColor(m.quant)}` }, m.quant || '?'),
                nameCaps(m).map(capPill)),
            m.agents.length ? h('small', { class: 'gl-used' }, `Utilisé par ${m.agents.join(', ')}`) : null,
            tiny ? h('p', { class: 'gl-warning' }, 'Très petit : probablement un encodeur, pas un modèle de chat.') : null,
            h('div', { class: 'gl-params' }, summary(cfg)),
            m.gguf?.layers ? h('div', { class: 'gl-params' }, h('span', {}, 'Couches ', h('b', {}, m.gguf.layers)),
                m.gguf.context_length ? h('span', {}, 'Contexte max ', h('b', {}, m.gguf.context_length)) : null,
                m.gguf.architecture ? h('span', {}, 'Architecture ', h('b', {}, m.gguf.architecture)) : null) : null,
            stats ? h('div', { class: 'gl-params' }, h('span', {}, 'Chargé ', h('b', {}, ago(stats.loaded_at))),
                h('span', {}, 'Dernier usage ', h('b', {}, ago(stats.last_used))), h('span', {}, 'Requêtes ', h('b', {}, stats.requests))) : null,
            h('div', { class: 'gl-actions' },
                m.kind === 'text' && categoryOf(m) !== 'guardian'
                    ? h('button', { type: 'button', onclick: () => moveTo(m.id, 'guardian') }, 'Pour le Gardien') : null,
                h('button', { type: 'button', ...guard(), onclick: () => { tuning = tuning === m.id ? null : m.id; render(); } }, 'Réglages'),
                h('button', { type: 'button', ...guard(), onclick: () => { rename.hidden = false; rename.focus(); } }, 'Renommer'),
                h('button', { type: 'button', ...guard(), onclick: () => moveTo(m.id, m.kind === 'image' ? 'agents' : 'image') },
                    m.kind === 'image' ? '→ Texte' : '→ Image'),
                m.loaded ? h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'unload'), 'Mémoire libérée') }, 'Décharger') : null,
                confirmButton('Retirer', () => tb.removeModel(m.id, false), { title: 'Retire de la bibliothèque, garde le fichier' })));
        card.addEventListener('dragstart', event => {
            event.dataTransfer.setData('text/plain', m.id);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        return card;
    }

    async function renderWizard() {
        const box = h('div', { class: 'gl-wizard' }, h('h3', {}, 'Aucun modèle pour l\'instant'),
            h('p', {}, 'Voici ce qui convient à cette machine, en un clic :'), h('p', { class: 'gl-empty' }, 'Analyse de la machine…'));
        panels.library.replaceChildren(box);
        try {
            const rec = await tb.recommendations();
            box.lastChild.replaceWith(h('div', {}, rec.models.map(m => h('div', { class: `gl-rec ${m.recommended ? 'best' : ''}` },
                h('div', {}, h('strong', {}, m.name), h('small', {}, `${m.why} · ${m.size_gb} Go`)),
                h('button', { type: 'button', ...guard(), onclick: () => startDownload({ repo: m.repo, filename: m.filename, size: Math.round(m.size_gb * 1024 ** 3) }) },
                    m.recommended ? 'Recommandé : télécharger' : 'Télécharger')))));
        } catch (error) {
            report(error);
        }
    }

    // --- Fichiers du serveur

    async function loadServerFiles() {
        panels.server.replaceChildren(h('p', { class: 'gl-empty' }, 'Lecture du dossier…'));
        try {
            const { files, models_dir: dir } = await tb.serverFiles();
            panels.server.replaceChildren(
                h('p', { class: 'gl-hint' }, 'Dossier des modèles : ', h('code', {}, dir), '. Un .gguf copié ici (scp) apparaît dans cette liste.'),
                files.length ? h('div', { class: 'gl-list' }, files.map(f => h('div', { class: 'gl-row' },
                    h('span', { class: 'gl-quant', style: `color:${quantColor(f.quant)}` }, f.quant || '?'),
                    h('span', { class: 'gl-name', title: f.path }, f.path), h('span', { class: 'gl-size' }, gb(f.size)),
                    f.model ? h('span', { class: 'gl-badge' }, 'dans la bibliothèque')
                        : h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.importFile(f.path), `${f.name} importé`).then(loadServerFiles) }, 'Importer'),
                    confirmButton('Supprimer', async () => { await tb.deleteFile(f.path); await loadServerFiles(); }))))
                    : h('p', { class: 'gl-empty' }, 'Aucun fichier .gguf dans ce dossier.'));
        } catch (error) {
            report(error);
        }
    }

    function renderServer() {
        if (!panels.server.childElementCount) loadServerFiles();
    }

    // --- Hugging Face

    async function startDownload(file) {
        await act(() => tb.download(file), `Téléchargement de ${file.filename} lancé`);
        if (tab !== 'hub') show('hub');
    }

    async function hubSearch() {
        hf.results = null;
        hf.repo = null;
        hf.error = '';
        renderHub();
        try {
            const params = Object.fromEntries(Object.entries({ q: hf.q, sort: hf.sort, pipeline: hf.pipeline, quant: hf.quant, min_b: hf.min_b, max_b: hf.max_b, limit: 30 })
                .filter(([, v]) => v !== ''));
            hf.results = (await tb.search(params)).models;
        } catch (error) {
            hf.results = [];
            hf.error = error.message;
        }
        renderHub();
    }

    async function openRepo(repo) {
        hf.repo = repo;
        hf.files = null;
        renderHub();
        try {
            hf.files = await tb.files(repo);
        } catch (error) {
            hf.files = { files: [], error: error.message };
        }
        renderHub();
    }

    function select(options, value, onchange, label) {
        const el = h('select', { 'aria-label': label }, options);
        el.value = value;
        el.addEventListener('change', () => onchange(el.value));
        return el;
    }

    function renderHub() {
        const query = h('input', { type: 'search', value: hf.q, placeholder: 'Rechercher un modèle GGUF…', 'aria-label': 'Recherche Hugging Face' });
        query.addEventListener('keydown', event => { if (event.key === 'Enter') { hf.q = query.value.trim(); hubSearch(); } });
        const pipelines = PIPELINES.map(([group, items]) => h('optgroup', { label: group }, items.map(([value, text]) => h('option', { value }, text))));
        const filters = h('div', { class: 'gl-filters' },
            select(pipelines, hf.pipeline, v => { hf.pipeline = v; hubSearch(); }, 'Type'),
            select(SORTS.map(([v, t]) => h('option', { value: v }, t)), hf.sort, v => { hf.sort = v; hubSearch(); }, 'Tri'),
            select(QUANTS.map(([v, t]) => h('option', { value: v }, t)), hf.quant, v => { hf.quant = v; hubSearch(); }, 'Quantisation'));
        const sizes = h('div', { class: 'gl-sizes' }, h('span', {}, 'Taille :'), SIZES.map(([min, max, label]) =>
            h('button', { type: 'button', class: hf.min_b === min && hf.max_b === max ? 'active' : '', onclick: () => { hf.min_b = min; hf.max_b = max; hubSearch(); } }, label)));

        let results;
        if (hf.results === null) results = h('p', { class: 'gl-empty' }, 'Recherche sur Hugging Face…');
        else if (hf.error) results = h('p', { class: 'gl-warning' }, hf.error);
        else if (!hf.results.length) results = h('p', { class: 'gl-empty' }, 'Aucun résultat : essaie d\'autres filtres.');
        else {
            results = h('div', { class: 'gl-list gl-results' }, hf.results.map(m => h('div', { class: `gl-row gl-result ${hf.repo === m.id ? 'open' : ''}`, onclick: () => openRepo(m.id) },
                h('div', { class: 'gl-result-body' },
                    h('div', {}, h('span', { class: 'gl-name' }, m.id), m.size_hint ? h('span', { class: 'gl-size-hint' }, m.size_hint) : null),
                    h('div', { class: 'gl-meta' }, m.capabilities.map(capPill),
                        h('span', {}, `↓ ${count(m.downloads)}`), h('span', {}, `${count(m.likes)} j'aime`),
                        m.updated ? h('span', {}, new Date(m.updated).toLocaleDateString('fr-FR')) : null,
                        h('a', { href: `https://huggingface.co/${m.id}`, target: '_blank', rel: 'noopener', onclick: event => event.stopPropagation() }, 'HF ↗'))),
                h('span', { class: 'gl-open' }, '›'))));
        }

        let filePanel = null;
        if (hf.repo) {
            const files = hf.files;
            filePanel = h('div', { class: 'gl-files' },
                h('div', { class: 'gl-files-head' }, h('a', { href: `https://huggingface.co/${hf.repo}`, target: '_blank', rel: 'noopener' }, hf.repo, ' ↗'),
                    h('button', { type: 'button', onclick: () => { hf.repo = null; renderHub(); } }, '← Retour')),
                files ? h('div', { class: 'gl-meta' }, (files.capabilities || []).map(capPill), files.pipeline ? h('span', {}, files.pipeline) : null) : null,
                h('p', { class: 'gl-hint' }, 'Choisis une quantisation : Q4_K_M le meilleur équilibre · Q8 la meilleure qualité · Q2/IQ2 le plus léger.'),
                !files ? h('p', { class: 'gl-empty' }, 'Lecture des fichiers…')
                    : files.error ? h('p', { class: 'gl-warning' }, files.error)
                        : !files.files.length ? h('p', { class: 'gl-empty' }, 'Aucun fichier .gguf dans ce dépôt.')
                            : h('div', { class: 'gl-list' }, files.files.map((f, i) => h('div', { class: `gl-row ${i === 0 ? 'best' : ''}` },
                                h('span', { class: 'gl-quant', style: `color:${quantColor(f.quant)}` }, f.quant || '?'),
                                i === 0 ? h('span', { class: 'gl-badge best' }, 'Recommandé') : null,
                                f.heavy ? h('span', { class: 'gl-badge heavy', title: 'Plus lourd que le budget mémoire de cette machine : lent ou impossible à charger' }, 'Trop lourd ici') : null,
                                h('span', { class: 'gl-name', title: f.name }, f.name), h('span', { class: 'gl-size' }, gb(f.size)),
                                h('button', { type: 'button', class: 'gl-primary', ...guard(),
                                    onclick: () => startDownload({ repo: hf.repo, filename: f.name, size: f.size, capabilities: files.capabilities }) }, '↓ Ajouter')))));
        }

        const downloads = state.models.filter(m => m.status !== 'ready');
        const downloadList = downloads.length ? h('div', { class: 'gl-downloads' },
            h('h3', {}, 'Téléchargements',
                downloads.some(m => m.status !== 'downloading')
                    ? h('button', { type: 'button', ...guard(), onclick: () => act(() => Promise.all(downloads.filter(m => m.status !== 'downloading').map(m => tb.removeModel(m.id, false)))) }, 'Effacer les terminés') : null),
            downloads.map(m => h('div', { class: 'gl-download' },
                h('div', { class: 'gl-row' }, h('strong', { class: 'gl-name' }, m.filename),
                    h('span', { class: `gl-status ${m.status}` }, { downloading: 'en cours', error: `échec : ${m.error}`, cancelled: 'annulé' }[m.status] || m.status),
                    m.status === 'downloading'
                        ? h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'cancel')) }, 'Annuler')
                        : h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'retry')) }, 'Reprendre')),
                h('div', { class: 'gl-bar' }, h('div', { style: `width:${(m.progress * 100).toFixed(1)}%` })),
                h('small', {}, `${(m.progress * 100).toFixed(1)} % · ${gb(m.downloaded) || '0 Mo'} / ${gb(m.size) || '?'}`,
                    m.speed ? ` · ${(m.speed / 1024 ** 2).toFixed(1)} Mo/s · reste ${duration(m.eta)}` : '')))) : null;

        panels.hub.replaceChildren(h('div', { class: 'gl-search' }, query, h('button', { type: 'button', onclick: () => { hf.q = query.value.trim(); hubSearch(); } }, 'Chercher')),
            ...[filters, sizes, filePanel || results, downloadList].filter(Boolean));
    }

    function open(key) {
        modal.hidden = false;
        if (key) tab = key;
        refresh().then(() => show(tab)).catch(report);
    }
    function close() {
        modal.hidden = true;
        clearTimeout(poll);
    }
    return { open, close, refresh, get state() { return state; } };
}
