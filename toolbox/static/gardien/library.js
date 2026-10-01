// Agents et modèles : portage du ModelLoader de SquidMind dans Nodz. Quatre onglets : Agents,
// Bibliothèque (colonnes Gardien / Agents / Image, glisser-déposer, fiches modèles), Fichiers du
// serveur (import des .gguf déjà copiés) et Hugging Face (recherche filtrée, choix du fichier,
// téléchargements suivis). Consulter est ouvert à tous ; changer le serveur est réservé au staff.

import { api } from './api.js';

const tb = {
    status: () => api.request('GET', 'toolbox/status'),
    agents: () => api.request('GET', 'toolbox/agents'),
    updateAgent: (id, fields) => api.request('PATCH', `toolbox/agents/${id}`, fields),
    models: () => api.request('GET', 'toolbox/models'),
    updateModel: (id, fields) => api.request('PATCH', `toolbox/models/${id}`, fields),
    removeModel: (id, file) => api.request('DELETE', `toolbox/models/${id}${file ? '?file=1' : ''}`),
    modelAction: (id, action) => api.request('POST', `toolbox/models/${id}/${action}`),
    download: file => api.request('POST', 'toolbox/models', file),
    addApiModel: fields => api.request('POST', 'toolbox/models', fields),  // { endpoint, name, api_key, label }
    installPack: key => api.request('POST', `toolbox/packs/${key}`),
    tools: () => api.request('GET', 'toolbox/tools'),
    recommendations: () => api.request('GET', 'toolbox/recommendations'),
    search: params => api.request('GET', `toolbox/hub/search?${new URLSearchParams(params)}`),
    files: repo => api.request('GET', `toolbox/hub/files?${new URLSearchParams({ repo })}`),
    serverFiles: () => api.request('GET', 'toolbox/files'),
    importFile: path => api.request('POST', 'toolbox/files', { path }),
    deleteFile: path => api.request('DELETE', `toolbox/files?${new URLSearchParams({ path })}`),
};

// Serveurs compatibles OpenAI proposés dans l'onglet « Par API » (l'URL de base se modifie ensuite).
const API_PRESETS = [
    ['Ollama (local)', 'http://localhost:11434/v1', 'qwen2.5:3b'], ['LM Studio (local)', 'http://localhost:1234/v1', ''],
    ['llama.cpp server', 'http://localhost:8080/v1', ''], ['OpenRouter', 'https://openrouter.ai/api/v1', ''],
    ['OpenAI', 'https://api.openai.com/v1', ''], ['Groq', 'https://api.groq.com/openai/v1', ''], ['Mistral', 'https://api.mistral.ai/v1', ''],
];

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

export function h(tag, attrs = {}, ...children) {
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

export function createLibrary({ onChange = () => {}, monitor = null, onInstallBrain = () => {} } = {}) {
    let state = { staff: false, machine: {}, engine: false, loaded: null, agents: [], models: [], paramSpec: [] };
    let tab = 'agents';
    let tuning = null;  // modèle dont les réglages sont ouverts (panneau pleine largeur)
    let poll = null;
    const hf = { q: '', pipeline: '', sort: 'downloads', quant: '', min_b: '', max_b: '', results: null, repo: null, files: null, error: '' };

    const panels = {};
    const tabs = [['start', 'Choisir mon IA'], ['agents', 'Agents'], ['tools', 'Outils'], ['library', 'Bibliothèque'], ['server', 'Fichiers du serveur'], ['hub', 'Hugging Face'], ['api', 'Par API']];
    const nav = h('nav', { class: 'gl-tabs' }, tabs.map(([key, label]) =>
        h('button', { type: 'button', dataset: { tab: key }, onclick: () => show(key) }, label)));
    const machineLine = h('p', { class: 'gl-machine' });
    const readOnly = h('p', { class: 'gl-warning', hidden: true },
        'Compte invité ou non administrateur : tu branches ta propre IA par API (onglet Par API, avec ta clé) et tu choisis parmi les modèles '
        + 'du serveur ; installer des modèles locaux est réservé au compte administrateur (créé ou promu par ', h('code', {}, 'manage.py bootstrap --email … --password …'), ').');
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
        state = { ...state, staff: status.staff, machine: status.machine, engine: status.engine, loaded: status.loaded, agents, models,
            paramSpec: status.param_spec, imaging: status.imaging, packs: status.packs, gpuOffload: status.gpu_offload };
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
        ({ start: renderStart, agents: renderAgents, tools: renderTools, library: renderLibrary, server: renderServer, hub: renderHub, api: renderApi })[tab]();
    }

    function show(key) {
        tab = key;
        render();
        if (key === 'server') loadServerFiles();
        if (key === 'tools') loadTools();
        if (key === 'hub' && !hf.results) hubSearch();
    }

    // --- Agents

    function renderAgents() {
        panels.agents.replaceChildren(...state.agents.map(agent => {
            // L'Illustrateur prend un modèle d'image, les autres un modèle de texte.
            const ready = state.models.filter(m => m.status === 'ready' && m.kind === (agent.role === 'image' ? 'image' : 'text'));
            const select = h('select', { 'aria-label': `Modèle de ${agent.name}` },
                h('option', { value: '' }, agent.role === 'image' ? 'Aucun modèle d\'image' : 'Aucun modèle'),
                ready.map(m => h('option', { value: m.id, selected: m.id === agent.model }, m.label || m.filename)));
            select.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { model: select.value || null }), `${agent.name} : modèle changé`));
            const enabled = h('input', { type: 'checkbox', checked: agent.enabled });
            enabled.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { enabled: enabled.checked })));
            // Les consignes par défaut s'affichent telles quelles ; les garder inchangées n'enregistre rien. Le Gardien : son
            // prompt système entier, exactement celui qu'il reçoit (agent.prompt).
            const prompt = h('textarea', { rows: agent.prompt ? 26 : 12, 'aria-label': `Consignes de ${agent.name}` },
                agent.prompt || agent.system_prompt || agent.default_prompt);
            const custom = () => (prompt.value.trim() === agent.default_prompt.trim() ? '' : prompt.value);
            // Consignes propres à l'agent : enregistrées sur le serveur, gardées d'une session à l'autre.
            const saved = prompt.value;
            const keep = h('button', { type: 'button', class: 'gl-primary', disabled: true }, 'Enregistrer les consignes');
            const status = h('small', { class: 'gl-hint' }, agent.system_prompt ? 'Consignes personnalisées enregistrées.' : 'Consignes par défaut.');
            prompt.addEventListener('input', () => {
                keep.disabled = prompt.value === saved;
                status.textContent = keep.disabled ? '' : 'Modifiées, pas encore enregistrées.';
            });
            keep.addEventListener('click', () => act(() => tb.updateAgent(agent.id, { system_prompt: custom() }), `${agent.name} : consignes enregistrées`));
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
                agent.role === 'orchestrator' ? h('button', { type: 'button', class: 'gl-primary', onclick: onInstallBrain,
                    title: 'Crée ou complète la dimension Gardien : Prompt système, Mémoire, Cerveau, Outils, un node par outil avec son mode d\'emploi' },
                    'Installer / compléter le Gardien dans l\'univers') : null,
                agent.role === 'orchestrator' ? doctor() : null,
                h('details', {}, h('summary', {}, agent.system_prompt ? 'Consignes (personnalisées)' : 'Consignes'), prompt,
                    agent.role === 'orchestrator' ? h('p', { class: 'gl-hint' }, 'Le format de réponse et la liste des outils du Gardien sont ajoutés automatiquement. '
                        + 'Une fois le Gardien installé dans l\'univers, ses consignes se lisent et se réécrivent dans le node « Prompt système ».') : null,
                    h('div', { class: 'gl-actions' }, keep, reset, status)),
                h('details', {}, h('summary', {}, Object.keys(agent.params || {}).length ? 'Échantillonnage (propre à cet agent)' : 'Échantillonnage'),
                    h('p', { class: 'gl-hint' }, "Vide = réglages du modèle. Ces valeurs priment pour cet agent."), sampling));
        }));
    }

    // Diagnostic : ce qu'une vraie demande au Gardien rencontrera, étape par étape (essai réel du modèle).
    function doctor() {
        const out = h('ul', { class: 'gl-doctor' });
        const run = h('button', { type: 'button', title: 'Vérifie modèle, moteur, mémoire, contexte et vitesse par un essai réel' }, 'Diagnostic');
        run.addEventListener('click', async () => {
            run.disabled = true;
            out.replaceChildren(h('li', { class: 'wait' }, 'Essai du modèle en cours (le charger peut prendre une minute)…'));
            try {
                const { checks } = await api.request('POST', 'toolbox/doctor', {});
                out.replaceChildren(...checks.map(c => h('li', { class: c.ok ? 'ok' : 'bad' }, h('b', {}, c.label), ` ${c.detail}`)));
            } catch (error) {
                out.replaceChildren(h('li', { class: 'bad' }, h('b', {}, 'Diagnostic'), ` ${error.message}`));
            } finally {
                run.disabled = false;
            }
        });
        return h('div', { class: 'gl-doctor-box' }, run, out);
    }

    // --- Outils du Gardien : Nodz et iAqua en un catalogue, activables un par un

    let toolbox = null;
    const SOURCES = { nodz: ['Nodz', '#6848A6'], iaqua: ['iAqua', '#0f9f6e'], 'nodz+iaqua': ['Nodz + iAqua', '#1E90FF'] };
    async function loadTools() {
        try {
            toolbox = await tb.tools();
            render();
        } catch (error) {
            report(error);
        }
    }
    function renderTools() {
        if (!toolbox) return panels.tools.replaceChildren(h('p', { class: 'gl-empty' }, 'Chargement des outils…'));
        const on = new Set(toolbox.enabled);
        const save = () => {
            const all = toolbox.tools.every(t => on.has(t.op));
            act(() => tb.updateAgent(toolbox.guardian, { tools_allowed: all ? [] : [...on] }), 'Outils du Gardien enregistrés').then(loadTools);
        };
        const categories = [...new Set(toolbox.tools.map(t => t.category))];
        panels.tools.replaceChildren(
            h('p', { class: 'gl-hint' }, `${on.size} outils actifs sur ${toolbox.tools.length}. Un outil coupé disparaît des consignes du Gardien et lui est refusé.`),
            ...categories.map(category => h('section', { class: 'gl-toolgroup' }, h('h3', {}, category),
                toolbox.tools.filter(t => t.category === category).map(t => {
                    const [source, color] = SOURCES[t.source];
                    const locked = !toolbox.guardian || !t.available;  // outil administrateur non autorisé ici
                    const box = h('input', { type: 'checkbox', checked: on.has(t.op), disabled: locked,
                        title: t.available ? '' : 'Compte administrateur et GUARDIAN_SHELL=1 dans .env' });
                    box.addEventListener('change', () => { if (box.checked) on.add(t.op); else on.delete(t.op); save(); });
                    return h('label', { class: `gl-tool ${on.has(t.op) ? '' : 'off'}` }, box,
                        h('div', {}, h('strong', {}, t.label), h('code', {}, t.op), t.read ? h('span', { class: 'gl-cap' }, 'LECTURE') : null,
                            t.admin ? h('span', { class: 'gl-badge heavy', title: 'Exécute du code sur le serveur' }, 'ADMIN') : null,
                            h('small', {}, t.doc.replace(/^\{[^}]*\}\s*:\s*/, ''))),
                        h('span', { class: 'gl-cap', style: `color:${color};border-color:${color}55;background:${color}14`, title: t.iaqua ? `iAqua : ${t.iaqua}` : '' }, source));
                }))),
            toolbox.shell ? null : h('p', { class: 'gl-hint' }, 'Outils ADMIN (shell, Python, outils forgés, MCP) : réservés au compte administrateur, '
                + 'après GUARDIAN_SHELL=1 dans le .env du serveur.'));
    }

    // --- Bibliothèque

    const categoryOf = m => {
        const guardian = state.agents.find(a => a.role === 'orchestrator');
        if (guardian && guardian.model === m.id) return 'guardian';
        return m.kind === 'image' ? 'image' : m.kind === 'component' ? 'component' : 'agents';
    };

    // Colonne Image vide : le pack FLUX en un clic, et ce qu'il faut sur le serveur.
    function imageHelp(models) {
        const parts = models.filter(m => m.kind === 'component');
        return h('div', { class: 'gl-image-help' },
            state.imaging ? null : h('p', { class: 'gl-warning' }, "stable-diffusion.cpp (sd) n'est pas installé sur le serveur : voir DEPLOY.md."),
            parts.length ? h('small', {}, 'Compagnons : ', parts.map(m => m.filename).join(', ')) : null,
            Object.entries(state.packs || {}).map(([key, label]) => h('button', { type: 'button', ...guard(),
                onclick: () => act(() => tb.installPack(key), `${label} : téléchargement lancé (onglet Hugging Face)`) }, `Installer ${label}`)));
    }

    function renderLibrary() {
        const models = state.models.filter(m => m.status === 'ready');
        if (!models.length) return renderWizard();
        const columns = [['guardian', 'GARDIEN', 'Lit les nodes, décide et agit', '#6848A6'],
            ['agents', 'AGENTS', 'Modèles des agents spécialisés', '#1E90FF'], ['image', 'IMAGE', "Diffusion : l'Illustrateur dessine", '#b8447a']];
        const tuned = models.find(m => m.id === tuning);
        panels.library.replaceChildren(tuned ? (tuned.kind === 'image' ? imagePanel(tuned) : loadDialog(tuned)) : '', h('div', { class: 'gl-board' }, columns.map(([key, label, desc, color]) => {
            const cards = models.filter(m => categoryOf(m) === key);
            const column = h('div', { class: 'gl-column', style: `border-top-color:${color}`, dataset: { category: key } },
                h('div', { class: 'gl-column-head' }, h('span', { style: `color:${color}` }, label), h('span', {}, cards.length)),
                h('small', {}, desc),
                cards.length ? cards.map(modelCard) : h('div', { class: 'gl-drop-here' }, 'Déposer ici'),
                key === 'image' ? imageHelp(models) : null);
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
    const collect = scope => Object.fromEntries(state.paramSpec.map(p => [p.key, scope.querySelector(`[name="${p.key}"]`)])
        .filter(([, el]) => el).map(([key, el]) => [key, el.value.trim()]).filter(([, v]) => v !== ''));
    const summary = cfg => {
        const set = state.paramSpec.filter(p => cfg[p.key] !== undefined);
        const shown = (p, v) => (p.kind === 'bool' ? (v ? 'oui' : 'non') : p.kind === 'choice' ? p.choices.find(c => c[0] === String(v))?.[0] ?? v
            : Array.isArray(v) ? v.join(' / ') : v === -1 && p.key === 'n_gpu_layers' ? 'toutes' : String(v));
        return set.length ? set.map(p => h('span', {}, `${p.label} `, h('b', {}, shown(p, cfg[p.key])))) : [h('span', {}, 'Réglages par défaut')];
    };

    // Pourquoi l'offload GPU n'agit pas, et quoi faire : l'administrateur compile llama-cpp-python avec CUDA
    // d'ici (deploy/cuda.sh), suit le journal, puis redémarre Nodz.
    function cudaNotice() {
        if (!state.machine.gpu) return h('p', { class: 'gl-hint' }, 'Pas de GPU NVIDIA détecté (nvidia-smi) : tout tourne sur CPU.');
        if (state.gpuOffload == null) return h('p', { class: 'gl-hint' }, 'Moteur llama-cpp-python absent (requirements-ai.txt).');
        if (state.gpuOffload !== false) return null;
        const box = h('div', { class: 'gl-warning gl-cuda' });
        const log = h('pre', { hidden: true });
        const line = h('p', {}, 'Carte NVIDIA détectée, mais llama-cpp-python est compilé sans CUDA : les couches restent sur CPU.');
        const build = h('button', { type: 'button', class: 'gl-primary', ...guard() }, 'Compiler avec CUDA');
        const restart = h('button', { type: 'button', hidden: true }, 'Redémarrer Nodz');
        box.append(line, h('div', { class: 'gl-actions' }, build, restart), log);
        const show = async (start = false) => {
            try {
                const c = start ? await api.request('POST', 'toolbox/cuda', { action: 'build' }) : await api.request('GET', 'toolbox/cuda');
                log.hidden = !c.log.length;
                log.textContent = c.log.slice(-14).join('\n');
                log.scrollTop = log.scrollHeight;
                build.disabled = !state.staff || c.running;
                build.textContent = c.running ? 'Compilation en cours…' : c.code === null ? 'Compiler avec CUDA' : 'Recompiler';
                if (!c.nvcc && !c.running) line.textContent = 'Carte NVIDIA détectée, sans CUDA Toolkit (nvcc) : sudo apt install -y nvidia-cuda-toolkit, puis Compiler avec CUDA.';
                if (c.result) line.textContent = `Compilation : ${c.result}.`;
                restart.hidden = c.code !== 0;
                restart.disabled = !c.restart;
                restart.title = c.restart ? '' : 'Pas de droit sudo sans mot de passe : sudo systemctl restart nodz sur le serveur';
                if (c.running && box.isConnected) setTimeout(show, 2000);
            } catch (error) {
                line.textContent = error.message;
            }
        };
        build.addEventListener('click', () => show(true));
        restart.addEventListener('click', async () => {
            try {
                await api.request('POST', 'toolbox/cuda', { action: 'restart' });
                line.textContent = 'Redémarrage de Nodz… recharge la page dans quelques secondes.';
            } catch (error) {
                line.textContent = error.message;
            }
        });
        if (state.staff) show();
        return box;
    }

    // Placement prévu (mêmes règles que fit.py au chargement) : couches sur GPU, contexte, VRAM et RAM.
    const KV_FACTOR = { f16: 1, q8_0: 0.5, q4_0: 0.25 };
    function estimate(m, ctxRaw, gpuRaw, kvType) {
        const layers = m.gguf?.layers || 0;
        const sizeMb = (m.size || 0) / 1024 ** 2;
        const perLayer = layers ? sizeMb / (layers + 1) : sizeMb;
        const kvMb = (m.kv_bytes || 131072) * (KV_FACTOR[kvType] || 1) / 1024 ** 2;
        const vramMb = state.gpuOffload === false ? 0 : state.machine.vram_mb || 0;
        const placed = m.placement;
        const trained = m.gguf?.context_length || 4096;
        const auto = v => v === '' || v === 'auto';
        let ctx = /^\d+$/.test(ctxRaw) ? Number(ctxRaw) : placed?.n_ctx || Math.min(trained, 8192);
        let onGpu;
        if (gpuRaw === 'max' || gpuRaw === '-1') onGpu = layers;
        else if (/^\d+$/.test(gpuRaw)) onGpu = Math.min(layers, Number(gpuRaw));
        else if (placed && auto(ctxRaw)) onGpu = placed.gpu_layers;
        else onGpu = !perLayer ? 0 : Math.max(0, Math.min(layers, Math.floor((vramMb - 600 - 8192 * kvMb) / perLayer)));  // le GPU d'abord (fit.py)
        if (!vramMb) onGpu = 0;  // pas de GPU utilisable : tout reste sur CPU, quoi qu'on demande
        if (vramMb && layers && onGpu >= layers && /^\d+$/.test(ctxRaw)) {  // tout sur GPU : un contexte trop grand se réduit
            ctx = Math.min(ctx, Math.max(8192, Math.floor((vramMb - 600 - onGpu * perLayer) / kvMb / 1024) * 1024));
        }
        if (auto(ctxRaw) && !placed) {  // contexte auto : le plus grand qui tient, 32768 au plus
            const budget = onGpu && vramMb ? vramMb - 600 - onGpu * perLayer : (state.machine.ram_mb || 0) * 0.8 - sizeMb;
            ctx = Math.max(2048, Math.min(trained, 32768, Math.floor(budget / kvMb / 1024) * 1024));
        }
        const frac = layers ? onGpu / layers : 0;
        const kv = ctx * kvMb;
        return { layers, onGpu, ctx, vram: onGpu ? onGpu * perLayer + kv * frac + 600 : 0, ram: sizeMb - onGpu * perLayer + kv * (1 - frac), frac, vramMb };
    }

    // Réglages de chargement : le dialogue « Edit Params » d'iAqua (mêmes champs, mêmes valeurs par défaut,
    // estimation mémoire en direct) ; les réglages avancés et l'échantillonnage sont repliés dessous.
    function loadDialog(m) {
        const cfg = m.config || {};
        const saved = m.params || {};
        const row = (label, ...field) => h('div', { class: 'gl-load-row' }, h('label', {}, label), h('div', {}, ...field));
        const check = (name, on, text) => h('label', { class: 'gl-check' }, h('input', { type: 'checkbox', name, checked: on !== false }), h('span', {}, text));
        const number = (name, value, min, max, placeholder) => h('input', { type: 'number', name, min, max, value: value ?? '', placeholder });
        const ctx = h('input', { type: 'text', name: 'n_ctx', value: String(saved.n_ctx ?? 'auto'),
            placeholder: 'auto (budget VRAM), ou un nombre comme 45000 : les couches GPU s\'ajustent' });
        const gpu = h('input', { type: 'text', name: 'n_gpu_layers', value: String(saved.n_gpu_layers ?? 'auto'),
            placeholder: 'auto (s\'ajuste au contexte), max, ou un nombre' });
        const layers = m.gguf?.layers;
        const slider = layers ? h('input', { type: 'range', min: 0, max: layers, step: 1, 'aria-label': 'Couches GPU' }) : null;
        const box = h('div', { class: 'gl-estimate' });
        const advanced = h('details', { class: 'gl-advanced' }, h('summary', {}, 'Avancé (multi-GPU, cache KV, RoPE)'), paramFields(['Avancé'], saved));
        const sampling = h('details', { class: 'gl-advanced' }, h('summary', {}, 'Échantillonnage'), paramFields(['Échantillonnage'], saved));
        const status = h('span', { class: 'gl-status' });
        const form = h('form', { class: 'gl-load' },
            h('p', { class: 'gl-hint' }, m.loaded ? 'Enregistre les réglages : ils s\'appliquent au prochain chargement (le modèle se recharge à la prochaine demande).'
                : 'Réglages de chargement : le modèle se charge plus tard, automatiquement, à la première demande.'),
            box,
            row('Contexte', ctx),
            row('Couches GPU', gpu, slider ? h('div', { class: 'gl-gpu-quick' },
                h('button', { type: 'button', onclick: () => setGpu('0') }, 'CPU'), slider,
                h('button', { type: 'button', onclick: () => setGpu('auto') }, 'Auto'),
                h('button', { type: 'button', onclick: () => setGpu('max') }, 'Max')) : null),
            row('', h('small', { class: 'gl-accent' }, 'Recommandé : auto pour les deux. Au chargement, Nodz lit la VRAM libre et choisit '
                + 'les couches GPU qui tiennent en gardant la place du cache, puis le plus grand contexte possible (4096 réservés, 32768 au plus). '
                + 'Un nombre force la valeur.')),
            row('Flash attention', check('flash_attn', cfg.flash_attn, 'Activer (tampons de calcul plus petits, le plus rapide)')),
            row('mmap', check('use_mmap', cfg.use_mmap, 'Activer (chargement rapide, le système partage la mémoire)')),
            row('Garder en mémoire (mlock)', check('use_mlock', cfg.use_mlock, 'Épingler en RAM/VRAM (jamais en swap)')),
            row('Threads CPU', number('n_threads', saved.n_threads, 1, 256, `auto (${cfg.n_threads}, cœurs physiques)`)),
            row('Batch', number('n_batch', saved.n_batch, 32, 8192, 'auto (1024)')),
            row('Libérer après (min)', number('ttl', cfg.ttl, 0, 10080, '720 (0 = jamais)')),
            row('Graine aléatoire', check('random_seed', cfg.random_seed, 'Activer (sinon réponses reproductibles)')),
            advanced, sampling, cudaNotice(),
            h('footer', { class: 'gl-actions' }, status,
                h('button', { type: 'button', onclick: () => act(() => tb.updateModel(m.id, { params: {} }), 'Réglages d\'iAqua par défaut') }, 'Tout par défaut'),
                h('button', { type: 'button', onclick: closeTuning }, 'Annuler'),
                h('button', { type: 'submit', class: 'gl-primary' }, 'Enregistrer')));
        const fmt = mb => (mb < 100 ? '<0,1' : (mb / 1024).toFixed(2).replace('.', ','));
        function show() {
            const g = gpu.value.trim().toLowerCase();
            const e = estimate(m, ctx.value.trim().toLowerCase(), g, form.elements.type_k?.value || 'f16');
            if (slider) slider.value = e.onGpu;
            const auto = ['', 'auto'].includes(ctx.value.trim().toLowerCase()) && ['', 'auto'].includes(g);
            const [speed, level] = auto && m.placement ? ['Auto : le partage retenu au dernier chargement', 'ok']
                : auto ? ['Auto : Nodz choisit le partage au chargement (recommandé)', 'ok']
                    : e.onGpu === 0 ? ['CPU seul : très lent (1 à 3 jetons/s)', 'warn']
                        : e.frac < 0.5 ? ['Surtout CPU : lent (3 à 8 jetons/s)', 'warn']
                            : e.frac >= 0.9 ? ['Surtout GPU : rapide (30 à 80 jetons/s)', 'ok'] : ['Partagé GPU/CPU : moyen (10 à 25 jetons/s)', 'ok'];
            const over = (used, total) => (total && used > total * 0.95 ? 'high' : '');
            box.replaceChildren(h('strong', {}, 'Mémoire estimée'),
                h('div', {}, h('span', {}, 'VRAM (GPU)'), h('b', { class: over(e.vram, e.vramMb) }, `${fmt(e.vram)} Go`),
                    h('small', {}, `${e.onGpu} / ${e.layers || '?'} couches${e.vramMb ? ` · ${fmt(e.vramMb)} Go sur la carte` : ' · pas de GPU utilisable'}`)),
                h('div', {}, h('span', {}, 'RAM (CPU)'), h('b', { class: over(e.ram, state.machine.ram_mb) }, `${fmt(e.ram)} Go`),
                    h('small', {}, `contexte ${e.ctx} jetons${state.machine.ram_mb ? ` · ${fmt(state.machine.ram_mb)} Go de RAM` : ''}`)),
                h('div', {}, h('span', {}, 'Vitesse'), h('b', { class: level }, speed)),
                h('small', {}, `Fichier ${gb(m.size)}`, m.gguf?.context_length ? ` · contexte d'entraînement ${m.gguf.context_length}` : '',
                    m.placement ? ` · dernier chargement : ${m.placement.gpu_layers} couches GPU, contexte ${m.placement.n_ctx}`
                        + `${m.placement.ctx_capped ? ' (réduit pour garder toutes les couches sur le GPU)' : ''}`
                        + `${m.placement.kv_q8 ? ', cache KV q8_0 (RAM juste)' : ''}` : ''),
                m.placement && m.placement.fits === false ? h('small', { class: 'bad' }, `Ne tient pas dans la RAM libre `
                    + `(${fmt(m.placement.need_mb)} Go demandés, ${fmt(m.placement.ram_free_mb)} Go libres) : il relit le disque à chaque jeton, `
                    + 'moins d\'un jeton par seconde. Prends un modèle plus petit.') : '');
        }
        function setGpu(value) { gpu.value = value; show(); }
        slider?.addEventListener('input', () => setGpu(Number(slider.value) === layers ? 'max' : slider.value));
        form.addEventListener('input', show);
        form.addEventListener('change', show);
        show();
        form.addEventListener('submit', event => {
            event.preventDefault();
            const els = form.elements;
            const params = { ...collect(advanced), ...collect(sampling), n_ctx: ctx.value.trim().toLowerCase() || 'auto', n_gpu_layers: gpu.value.trim().toLowerCase() || 'auto',
                flash_attn: els.flash_attn.checked, use_mmap: els.use_mmap.checked, use_mlock: els.use_mlock.checked, random_seed: els.random_seed.checked };
            ['n_threads', 'n_batch', 'ttl'].forEach(key => { if (els[key].value !== '') params[key] = els[key].value; });
            status.textContent = 'Enregistrement…';
            act(() => tb.updateModel(m.id, { params }), m.loaded ? 'Réglages enregistrés : le modèle se recharge à la prochaine demande' : 'Réglages enregistrés')
                .then(() => { if (!notice.classList.contains('error')) closeTuning(); else status.textContent = ''; });
        });
        return h('div', { class: 'gl-dialog', onmousedown: event => { if (event.target.classList.contains('gl-dialog')) closeTuning(); } },
            h('section', { class: 'gl-dialog-card', role: 'dialog', 'aria-label': `Réglages de ${m.label || m.filename}` },
                h('header', {}, h('h3', {}, `Réglages : ${m.label || m.filename}`), h('button', { type: 'button', class: 'gl-close', onclick: closeTuning }, 'Fermer')),
                form));
    }

    const closeTuning = () => { tuning = null; render(); };
    function imagePanel(m) {
        const form = h('form', { class: 'gl-params-form' }, paramFields(['Image'], m.params || {}),
            h('div', { class: 'gl-actions' }, h('button', { type: 'submit', class: 'gl-primary' }, 'Enregistrer'),
                h('button', { type: 'button', onclick: () => act(() => tb.updateModel(m.id, { params: {} }), 'Réglages par défaut') }, 'Tout par défaut'),
                h('button', { type: 'button', onclick: closeTuning }, 'Fermer')));
        form.addEventListener('submit', event => {
            event.preventDefault();
            act(() => tb.updateModel(m.id, { params: collect(form) }), 'Réglages enregistrés');
        });
        return h('section', { class: 'gl-tuning' }, h('h3', {}, `Réglages de ${m.label || m.filename}`), form);
    }

    // Fiche comme iAqua : réglages effectifs (valeurs retenues au chargement quand le modèle est en mémoire),
    // puis l'activité depuis le chargement.
    function loadRows(m) {
        const c = m.config || {};
        const p = m.loaded && m.placement;
        const kv = (label, value, cls = '') => h('span', {}, `${label} `, h('b', { class: cls }, String(value)));
        const yes = v => (v ? 'oui' : 'non');
        const gpuShown = p ? `${p.gpu_layers}/${p.layers || '?'}` : c.n_gpu_layers;
        const differs = p && (String(c.n_ctx) !== String(p.n_ctx) || !['auto', 'max'].includes(String(c.n_gpu_layers)) && Number(c.n_gpu_layers) !== p.gpu_layers);
        const stats = m.stats;
        return [h('div', { class: 'gl-params' }, kv('CTX', p ? p.n_ctx : c.n_ctx), kv('COUCHES GPU', gpuShown), kv('THREADS', c.n_threads), kv('BATCH', c.n_batch)),
            h('div', { class: 'gl-params' }, kv('TTL', `${c.ttl} min`), kv('FLASH', c.flash_attn ? 'ON' : 'OFF', c.flash_attn ? 'on' : 'off'),
                kv('MMAP', yes(c.use_mmap)), kv('MLOCK', yes(c.use_mlock)), c.random_seed === false ? kv('GRAINE', 'fixe') : null),
            differs ? h('small', { class: 'gl-hint' }, `Enregistré : contexte ${c.n_ctx}, couches GPU ${c.n_gpu_layers}`) : null,
            // Des couches restées sur le CPU : chaque jeton les attend. Un clic les met toutes sur le GPU (rechargement).
            p && p.layers && p.gpu_layers < p.layers && p.vram_free_mb ? h('button', { type: 'button', class: 'gl-primary', ...guard(),
                title: 'Toutes les couches sur le GPU : le contexte se réduit s\'il le faut', onclick: () => act(async () => {
                    await tb.updateModel(m.id, { params: { ...m.params, n_gpu_layers: 'max' } });
                    await tb.modelAction(m.id, 'unload');
                }, 'Toutes les couches iront sur le GPU au prochain message') }, `Tout sur le GPU (${p.layers - p.gpu_layers} couches sur CPU)`) : null,
            stats ? h('div', { class: 'gl-params gl-runtime' }, kv('CHARGÉ', ago(stats.loaded_at)), kv('DERNIER USAGE', ago(stats.last_used)),
                kv('REQUÊTES', stats.requests), kv('JETONS', stats.tokens >= 1000 ? `${(stats.tokens / 1000).toFixed(1)} k` : stats.tokens)) : null,
            stats?.last ? h('div', { class: 'gl-params gl-runtime', title: 'Dernier appel : lecture du prompt (attente du premier mot), puis génération' },
                kv('PROMPT', `${stats.last.prompt_tokens ?? '?'} j`), kv('1ER MOT', `${stats.last.wait_s} s`),
                kv('VITESSE', stats.last.speed ? `${stats.last.speed} j/s` : '?')) : null];
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
            m.kind === 'text' ? loadRows(m) : h('div', { class: 'gl-params' }, summary(cfg)),
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

    // Modèles recommandés pour cette machine (mémoire, GPU), à télécharger en un clic : remplace le dernier enfant de `box`.
    async function recommend(box, images = true) {
        try {
            const rec = await tb.recommendations();
            box.lastChild.replaceWith(h('div', {}, rec.models.map(m => h('div', { class: `gl-rec ${m.recommended ? 'best' : ''}` },
                h('div', {}, h('strong', {}, m.name), h('small', {}, `${m.why} · ${m.size_gb} Go`)),
                h('button', { type: 'button', ...guard(), onclick: () => startDownload({ repo: m.repo, filename: m.filename, size: Math.round(m.size_gb * 1024 ** 3) }) },
                    m.recommended ? 'Recommandé : télécharger' : 'Télécharger'))), images ? [h('h3', {}, 'Images'), imageHelp(state.models)] : null));
        } catch (error) {
            report(error);
        }
    }

    async function renderWizard() {
        const box = h('div', { class: 'gl-wizard' }, h('h3', {}, 'Aucun modèle pour l\'instant'),
            h('p', {}, 'Voici ce qui convient à cette machine, en un clic :'), h('p', { class: 'gl-empty' }, 'Analyse de la machine…'));
        panels.library.replaceChildren(box);
        await recommend(box);
    }

    // --- Choisir mon IA : 1. une IA externe par API ou 2. un modèle sur cette machine, puis 3. ses outils.

    function renderStart() {
        const guardian = state.agents.find(a => a.role === 'orchestrator');
        const current = guardian?.model && state.models.find(m => m.id === guardian.model);
        const local = h('div', { class: 'gl-step-recs' }, h('p', { class: 'gl-empty' }, 'Analyse de la machine…'));
        const step = (number, title, text, ...rest) => h('section', { class: 'gl-step' }, h('b', { class: 'gl-step-n' }, number),
            h('div', {}, h('h3', {}, title), h('p', {}, text), ...rest));
        panels.start.replaceChildren(
            h('p', { class: 'gl-step-now' }, current ? `Ton Gardien utilise ${current.label || current.filename}${current.endpoint ? ' (par API)' : ' (sur cette machine)'}.`
                : 'Ton Gardien n\'a pas encore d\'IA : choisis-en une.'),
            step('1', 'Une IA externe, par API', 'OpenAI, Mistral, Groq, OpenRouter… font tourner un grand modèle à ta place. Tu donnes ta clé : '
                + 'elle reste sur le serveur Nodz et ne sert qu\'à toi.',
            h('button', { type: 'button', class: 'gl-primary', onclick: () => show('api') }, 'Brancher une API')),
            step('2', 'Sur ta machine', `${machineLine.textContent}. Un modèle local tourne sans connexion ni clé. `
                + (state.staff ? 'Recommandés pour cette machine :' : 'Installer un modèle est réservé à l\'administrateur du serveur ; sur ton ordinateur, c\'est toi.'),
            local, h('button', { type: 'button', onclick: () => show('hub') }, 'Chercher sur Hugging Face')),
            step('3', 'Ses outils', 'Automatisation (mode Auto du chat) : il appelle des fonctions pour mener une mission, web, fichiers, images, '
                + 'présentations, documents, agents. Agentique (modes Pensée et Profond) : il planifie et agit dans l\'univers, crée, relie, '
                + 'range, supprime, voyage entre dimensions.',
            h('div', { class: 'gl-step-actions' }, h('button', { type: 'button', onclick: () => show('tools') }, 'Choisir ses outils'),
                h('button', { type: 'button', onclick: () => show('agents') }, 'Ses agents'))));
        recommend(local, false);
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

    // --- Par API : un modèle servi ailleurs (Ollama, LM Studio, OpenRouter…), aucun fichier ni mémoire ici.

    function renderApi() {
        const field = (label, input) => h('label', { class: 'gl-field' }, h('span', {}, label), input);
        const name = h('input', { type: 'text', placeholder: 'qwen2.5:3b, gpt-4o-mini, mistral-small-latest…', autocomplete: 'off' });
        const url = h('input', { type: 'url', placeholder: 'http://localhost:11434/v1', autocomplete: 'off' });
        const key = h('input', { type: 'password', placeholder: 'facultative (serveur local)', autocomplete: 'new-password' });
        const label = h('input', { type: 'text', placeholder: 'nom affiché (facultatif)', autocomplete: 'off' });
        const add = h('button', { type: 'button', class: 'gl-primary' }, 'Tester et ajouter');
        add.addEventListener('click', () => act(async () => {
            add.disabled = true;
            add.textContent = 'Test de la connexion…';
            try {
                const model = await tb.addApiModel({ endpoint: url.value.trim(), name: name.value.trim(), api_key: key.value.trim(), label: label.value.trim() });
                const guardian = state.agents.find(a => a.role === 'orchestrator');
                if (guardian && !guardian.model) await tb.updateAgent(guardian.id, { model: model.id });  // un Gardien sans IA la prend aussitôt
            } finally {
                add.disabled = false;
                add.textContent = 'Tester et ajouter';
            }
        }, `${name.value.trim()} ajouté : il sert le Gardien s'il n'avait pas d'IA, sinon choisis-le dans l'onglet Agents`));
        const presets = h('div', { class: 'gl-presets' }, API_PRESETS.map(([title, base, model]) => h('button', { type: 'button', onclick: () => {
            url.value = base;
            if (model && !name.value) name.value = model;
            (name.value ? key : name).focus();
        } }, title)));
        const connected = state.models.filter(m => m.endpoint);
        panels.api.replaceChildren(
            h('p', { class: 'gl-hint' }, "Un serveur compatible OpenAI fait tourner le modèle à la place de cette machine : plus de mémoire prise ici, ",
                'et un gros modèle devient possible. La clé reste sur le serveur Nodz, jamais dans la page.',
                state.staff ? ' Ajouté ici, le modèle sert tout le serveur.' : ' Ton connecteur et ta clé ne servent qu\'à toi ; adresse publique seulement (pas de localhost).'),
            presets,
            h('div', { class: 'gl-api-form' }, field('URL de base', url), field('Modèle', name), field('Clé API', key), field('Nom affiché', label), add),
            connected.length ? h('div', { class: 'gl-list' }, connected.map(m => {
                const mine = m.mine || state.staff ? { disabled: false, title: '' } : {};  // son connecteur se règle par son propriétaire
                const newKey = h('input', { type: 'password', placeholder: m.has_key ? 'clé enregistrée : la remplacer' : 'ajouter une clé', autocomplete: 'new-password' });
                return h('div', { class: 'gl-row' },
                    h('span', { class: 'gl-badge' }, m.mine ? 'À MOI' : 'API'), h('span', { class: 'gl-name', title: m.endpoint }, `${m.label || m.filename} · ${m.endpoint}`),
                    m.agents.length ? h('span', { class: 'gl-size' }, m.agents.join(', ')) : '',
                    newKey, h('button', { type: 'button', ...guard(), ...mine, onclick: () => act(() => tb.updateModel(m.id, { api_key: newKey.value.trim() }), 'Clé enregistrée') }, 'Enregistrer'),
                    confirmButton('Retirer', () => tb.removeModel(m.id), mine));
            })) : h('p', { class: 'gl-empty' }, 'Aucun modèle par API pour le moment.'));
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

    // Sans clé : « Choisir mon IA » tant que le Gardien n'a pas de modèle, sinon l'onglet laissé.
    function open(key) {
        modal.hidden = false;
        refresh().then(() => {
            if (key) tab = key;
            else if (!state.agents.find(a => a.role === 'orchestrator')?.model) tab = 'start';
            show(tab);
        }).catch(report);
    }
    function close() {
        modal.hidden = true;
        clearTimeout(poll);
    }
    return { open, close, refresh, get state() { return state; } };
}
