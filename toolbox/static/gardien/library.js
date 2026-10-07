// Agents et modèles : portage du ModelLoader de SquidMind dans Nodz, dans une fenêtre sombre à barre latérale.
// Cinq sections : Mon IA (état du Gardien, choix rapide API ou machine), Agents (modèle, actif, consignes), Modèles
// (Installés en colonnes Gardien / Agents / Image avec glisser-déposer, Hugging Face, Par API, Fichiers du serveur),
// Outils (interrupteurs et recherche) et Documents. Les réglages d'un modèle se font en clair (mémoire de conversation,
// où il tourne, combien de temps il reste chargé), le détail technique replié dessous. Consulter est ouvert à tous ;
// changer le serveur est réservé au staff.

import { api, endpoint } from './api.js';
import { locale, t } from './i18n.js';

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
    premium: () => api.request('GET', 'toolbox/premium'),
    checkout: () => api.request('POST', 'toolbox/premium/checkout'),
    portal: () => api.request('POST', 'toolbox/premium/portal'),
};

// Serveurs compatibles OpenAI proposés dans l'onglet « Par API » (l'URL de base se modifie ensuite).
const API_PRESETS = [
    ['Ollama (local)', 'http://localhost:11434/v1', 'qwen2.5:3b'], ['LM Studio (local)', 'http://localhost:1234/v1', ''],
    ['llama.cpp server', 'http://localhost:8080/v1', ''], ['OpenRouter', 'https://openrouter.ai/api/v1', ''],
    ['OpenAI', 'https://api.openai.com/v1', ''], ['Groq', 'https://api.groq.com/openai/v1', ''], ['Mistral', 'https://api.mistral.ai/v1', ''],
];

// Types Hugging Face (liste du ModelLoader de SquidMind), regroupés.
const PIPELINES = [
    [t('lib.presets'), [['', t('lib.all')], ['text-generation', t('lib.textGeneration')]]],
    ['Multimodal', [['audio-text-to-text', t('lib.audioTextToText')], ['image-text-to-text', t('lib.imageTextToText')],
        ['image-text-to-image', t('lib.imageTextToImage')], ['image-text-to-video', t('lib.imageTextToVideo')],
        ['visual-question-answering', t('lib.visualQuestionAnswering')], ['document-question-answering', t('lib.documentQuestionAnswering')],
        ['video-text-to-text', t('lib.videoTextToText')], ['any-to-any', t('lib.anyToAny')]]],
    ['Vision', [['text-to-image', t('lib.textToImage')], ['image-to-text', t('lib.imageToText')], ['image-to-image', t('lib.imageToImage')],
        ['image-to-video', t('lib.imageToVideo')], ['text-to-video', t('lib.textToVideo')], ['image-classification', "Classification d'image"],
        ['object-detection', t('lib.objectDetection')], ['image-segmentation', 'Segmentation'], ['depth-estimation', t('lib.depth')],
        ['text-to-3d', t('lib.textTo3d')], ['image-to-3d', t('lib.imageTo3d')], ['image-feature-extraction', t('lib.imageFeatures')]]],
    [t('lib.language'), [['text-classification', t('lib.textClassification')], ['token-classification', t('lib.namedEntities')],
        ['question-answering', t('lib.questionAnswering')], ['summarization', t('lib.summarization')], ['translation', t('lib.translation')],
        ['zero-shot-classification', t('lib.zeroShotClassification')], ['feature-extraction', 'Embeddings'], ['fill-mask', t('lib.fillMask')],
        ['sentence-similarity', t('lib.sentenceSimilarity')], ['text-ranking', t('lib.textRanking')]]],
    ['Audio', [['text-to-speech', t('lib.textToSpeech')], ['text-to-audio', t('lib.textToAudio')],
        ['automatic-speech-recognition', t('lib.speechRecognition')], ['audio-to-audio', t('lib.audioToAudio')],
        ['audio-classification', "Classification d'audio"]]],
];
const SORTS = [['downloads', t('lib.downloads')], ['trending', t('lib.trending')], ['likes', "J'aime"], ['created', t('lib.releaseDate')], ['recent', t('lib.recent')]];
const QUANTS = [['', t('lib.anyQuantization')], ['Q4', 'Q4'], ['Q5', 'Q5'], ['Q8', 'Q8'], ['F16', 'F16'], ['IQ', 'IQ (iMatrix)']];
const SIZES = [['', '', t('lib.all2')], ['', '1.5', '≤ 1B'], ['1.5', '4', '1–3B'], ['4', '9', '4–8B'], ['9', '15', '9–14B'], ['15', '', '15B +']];
// Barre latérale : les cinq sections, et les sous-onglets de Modèles (les clés d'onglet restent celles d'avant :
// open('library'), open('hub'), open('start') continuent de marcher).
const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const SECTIONS = [
    ['start', t('lib.myAi'), t('lib.whatRunsYourGuardian'), icon('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>')],
    ['agents', 'Agents', t('lib.eachAgentItsModel'), icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M15.5 14.3A5 5 0 0 1 21 19"/>')],
    ['models', t('lib.models'), t('lib.installedModelsAndWhere'), icon('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM9 1.5V4M15 1.5V4M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5"/>')],
    ['tools', t('lib.tools'), t('lib.whatTheGuardianIs'), icon('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>')],
    ['docs', 'Documents', t('lib.yourDocumentTemplatesSo'), icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>')],
];
const MODEL_TABS = [['library', t('lib.installed')], ['hub', 'Hugging Face'], ['api', t('lib.viaApi')], ['server', t('lib.serverFiles')]];
const sectionOf = key => (MODEL_TABS.some(([k]) => k === key) ? 'models' : key);
const ROLES = { orchestrator: t('lib.conductor'), text: t('lib.writing'), code: 'Code', image: t('lib.images') };
const AVATARS = {
    orchestrator: icon('<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>'),
    text: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    code: icon('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
    image: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>'),
};
const CAPS = {
    vision: ['VISION', '#0f9f6e'], tools: [t('lib.capTools'), '#c47a00'], chat: ['CHAT', '#1E90FF'], code: ['CODE', '#00a383'],
    embed: ['EMBED', '#64748b'], image: ['IMAGE', '#6848A6'], audio: ['AUDIO', '#b8447a'], reason: [t('lib.reasoning'), '#c2417f'],
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
const gb = bytes => (!bytes ? '' : bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} ${t('unit.mb')}` : `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} ${t('mon.gb')}`);
const count = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n || 0));
const ago = seconds => {
    const s = Math.max(0, Date.now() / 1000 - seconds);
    return s < 60 ? t('lib.justNow') : s < 3600 ? t('time.ago', { span: `${Math.round(s / 60)} min` }) : t('time.ago', { span: `${Math.round(s / 3600)} h` });
};
const duration = s => (s == null ? '' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const capPill = cap => {
    const [label, color] = CAPS[cap] || [cap.toUpperCase(), '#64748b'];
    return h('span', { class: 'gl-cap', style: `color:${color};border-color:${color}55;background:${color}14` }, label);
};
const quantColor = q => (/Q8|Q6/.test(q) ? '#0f9f6e' : /Q[45]/.test(q) ? '#1E90FF' : /Q[23]/.test(q) ? '#c47a00' : /IQ/.test(q) ? '#6848A6' : '#64748b');

export function createLibrary({ onChange = () => {}, monitor = null, onOpenHome = () => {} } = {}) {
    let state = { staff: false, machine: {}, engine: false, loaded: null, agents: [], models: [], paramSpec: [] };
    let tab = 'agents';
    let modelTab = 'library';  // dernier sous-onglet de Modèles
    let tuning = null;  // modèle dont les réglages sont ouverts (panneau pleine largeur)
    let poll = null;
    const hf = { q: '', pipeline: '', sort: 'downloads', quant: '', min_b: '', max_b: '', results: null, repo: null, files: null, error: '' };

    const panels = {};
    const nav = h('nav', { class: 'ga-nav' }, SECTIONS.map(([key, label]) => {
        const button = h('button', { type: 'button', dataset: { section: key }, onclick: () => show(key === 'models' ? modelTab : key) });
        button.innerHTML = SECTIONS.find(([k]) => k === key)[3];
        button.append(h('span', {}, label));
        return button;
    }));
    const seg = h('div', { class: 'ga-seg', role: 'tablist' }, MODEL_TABS.map(([key, label]) =>
        h('button', { type: 'button', role: 'tab', dataset: { tab: key }, onclick: () => show(key) }, label)));
    const title = h('h3', {}), subtitle = h('p', {});
    const machineLine = h('p', { class: 'gl-machine' });
    const readOnly = h('p', { class: 'gl-warning', hidden: true },
        t('lib.guestOrNonAdministrator')
        + t('lib.theServerSAi'), h('code', {}, 'manage.py bootstrap --email … --password …'), ').');
    const notice = h('p', { class: 'gl-notice', role: 'status' });
    [...SECTIONS.map(([key]) => key).filter(key => key !== 'models'), ...MODEL_TABS.map(([key]) => key)]
        .forEach(key => { panels[key] = h('section', { class: 'gl-panel', dataset: { panel: key } }); });
    const windowEl = h('div', { class: 'gl-window ga-window', role: 'dialog', tabindex: '-1', 'aria-label': t('lib.agentsAndModels') },
        h('aside', { class: 'ga-side' }, h('h2', {}, t('lib.agentsModels')), nav, h('div', { class: 'ga-machine' }, monitor, machineLine)),
        h('div', { class: 'ga-main' },
            h('header', { class: 'ga-head' }, h('div', {}, title, subtitle), h('button', { type: 'button', class: 'ga-x', title: t('lib.closeEsc'), onclick: close }, '×')),
            seg, readOnly, h('div', { class: 'ga-body' }, Object.values(panels)), notice));
    const modal = h('div', { class: 'gl-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, windowEl);
    modal.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Escape') close();
    });
    modal.addEventListener('mousedown', event => {  // un menu ⋯ ouvert se ferme au clic ailleurs
        windowEl.querySelectorAll('.ga-more[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    });
    // Un menu ⋯ s'ouvre vers l'intérieur de la fenêtre : vers la droite, sauf s'il déborderait (dernière colonne).
    windowEl.addEventListener('toggle', event => {
        const menu = event.target;
        if (!menu.classList?.contains('ga-more') || !menu.open) return;
        const list = menu.lastElementChild, body = menu.closest('.ga-body') || windowEl;
        menu.classList.remove('ga-more-end');
        if (list.getBoundingClientRect().right > body.getBoundingClientRect().right - 8) menu.classList.add('ga-more-end');
    }, true);
    document.body.append(modal);
    // Liens externes (Hugging Face…) ouverts dès l'appui : pendant un téléchargement la fenêtre se redessine toutes les
    // 1,5 s, et un lien remplacé entre l'appui et le relâchement ne recevait jamais son clic. Le clic qui suit n'ouvre
    // pas un second onglet ; Ctrl, Maj, Cmd et le clic du milieu restent au navigateur. Tant que le bouton est enfoncé,
    // le redessin attend le relâchement (les boutons du panneau gardent aussi leurs clics).
    let pressed = false, stale = false;
    windowEl.addEventListener('pointerdown', event => {
        pressed = true;
        const link = event.target.closest?.('a[target="_blank"]');
        if (!link || !/^https?:/.test(link.href) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        window.open(link.href, '_blank', 'noopener');
        link.dataset.opened = '1';
    });
    windowEl.addEventListener('click', event => {
        const link = event.target.closest?.('a[data-opened]');
        if (!link) return;
        event.preventDefault();
        delete link.dataset.opened;
    }, true);
    window.addEventListener('pointerup', () => {
        pressed = false;
        if (stale) { stale = false; render(); }
    });

    const guard = () => (state.staff ? {} : { disabled: true, title: t('lib.reservedForTheServer') });
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
                button.textContent = t('lib.confirm');
                setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
            }
        });
        return button;
    }

    async function refresh() {
        const [status, { agents }, { models }, premium] = await Promise.all([tb.status(), tb.agents(), tb.models(), tb.premium().catch(() => null)]);
        state = { ...state, staff: status.staff, machine: status.machine, engine: status.engine, loaded: status.loaded, agents, models, premium,
            paramSpec: status.param_spec, imaging: status.imaging, packs: status.packs, gpuOffload: status.gpu_offload };
        // CPU, RAM, GPU ne disent quelque chose qu'à qui fait tourner un modèle ici : sinon, le moniteur se cache.
        state.local = agents.some(a => a.enabled && a.model && models.some(m => m.id === a.model && !m.endpoint));
        windowEl.classList.toggle('ga-remote', !state.local);
        const m = state.machine;
        machineLine.replaceChildren(
            m.gpu ? t('lib.gpuGb', { v: (m.vram_mb / 1024).toFixed(1) }) : t('lib.noGpuGbOf', { v: (m.ram_mb / 1024).toFixed(1) }),
            t('lib.weightsBudgetGb', { v: (m.budget_mb / 1024).toFixed(1) }),
            state.engine ? t('lib.localEngineReady') : t('lib.noLocalEngineRequirements'));
        readOnly.hidden = state.staff;
        if (pressed) stale = true; else render();
        onChange(state);
        clearTimeout(poll);
        if (!modal.hidden && models.some(x => x.status === 'downloading')) poll = setTimeout(() => refresh().catch(report), 1500);
    }

    function render() {
        const section = sectionOf(tab);
        const [, label, sub] = SECTIONS.find(([k]) => k === section);
        title.textContent = label;
        subtitle.textContent = sub;
        nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.section === section));
        seg.hidden = section !== 'models';
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== tab; });
        ({ start: renderStart, docs: renderDocs, agents: renderAgents, tools: renderTools, library: renderLibrary, server: renderServer, hub: renderHub, api: renderApi })[tab]();
    }

    function show(key) {
        tab = key;
        if (sectionOf(key) === 'models') modelTab = key;
        render();
        if (key === 'server') loadServerFiles();
        if (key === 'tools') loadTools();
        if (key === 'docs') loadDocs();
        if (key === 'hub' && !hf.results) hubSearch();
    }

    // --- Agents

    function renderAgents() {
        const ordered = [...state.agents].sort((a, b) => (b.role === 'orchestrator') - (a.role === 'orchestrator'));
        panels.agents.replaceChildren(h('div', { class: 'ga-agents' }, ordered.map(agent => {
            // L'Illustrateur prend un modèle d'image, les autres un modèle de texte.
            const ready = state.models.filter(m => m.status === 'ready' && m.kind === (agent.role === 'image' ? 'image' : 'text'));
            const select = h('select', { 'aria-label': t('lib.modelFor', { name: agent.name }) },
                h('option', { value: '' }, agent.role === 'image' ? t('lib.noImageModel') : t('lib.noModel')),
                ready.map(m => h('option', { value: m.id, selected: m.id === agent.model }, m.label || m.filename)));
            select.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { model: select.value || null }), t('lib.modelChanged', { name: agent.name })));
            const enabled = h('input', { type: 'checkbox', checked: agent.enabled, 'aria-label': `${agent.name} actif` });
            enabled.addEventListener('change', () => act(() => tb.updateAgent(agent.id, { enabled: enabled.checked })));
            // Les consignes par défaut s'affichent telles quelles ; les garder inchangées n'enregistre rien. Le Gardien : son
            // prompt système entier, exactement celui qu'il reçoit (agent.prompt).
            const prompt = h('textarea', { rows: agent.prompt ? 26 : 12, 'aria-label': t('lib.instructionsFor', { name: agent.name }) },
                agent.prompt || agent.system_prompt || agent.default_prompt);
            const custom = () => (prompt.value.trim() === agent.default_prompt.trim() ? '' : prompt.value);
            // Consignes propres à l'agent : enregistrées sur le serveur, gardées d'une session à l'autre.
            const saved = prompt.value;
            const keep = h('button', { type: 'button', class: 'gl-primary', disabled: true }, t('lib.saveTheInstructions'));
            const status = h('small', { class: 'gl-hint' }, agent.system_prompt ? t('lib.customInstructionsSaved') : t('lib.defaultInstructions'));
            prompt.addEventListener('input', () => {
                keep.disabled = prompt.value === saved;
                status.textContent = keep.disabled ? '' : t('lib.changedNotSavedYet');
            });
            keep.addEventListener('click', () => act(() => tb.updateAgent(agent.id, { system_prompt: custom() }), t('lib.instructionsSaved', { name: agent.name })));
            const reset = h('button', { type: 'button', disabled: !agent.system_prompt }, t('lib.restoreTheDefaultInstructions'));
            const sampling = h('form', { class: 'gl-params-form' }, paramFields(['Échantillonnage'], agent.params || {}),
                h('div', { class: 'gl-actions' }, h('button', { type: 'submit' }, t('lib.save')),
                    h('button', { type: 'button', onclick: () => act(() => tb.updateAgent(agent.id, { params: {} }), t('lib.modelSSampling', { name: agent.name })) }, t('lib.sameAsTheModel'))));
            sampling.addEventListener('submit', event => {
                event.preventDefault();
                act(() => tb.updateAgent(agent.id, { params: collect(sampling) }), t('lib.samplingSaved', { name: agent.name }));
            });
            reset.addEventListener('click', () => act(() => tb.updateAgent(agent.id, { system_prompt: '' }), t('lib.defaultInstructions2', { name: agent.name })));
            const avatar = h('span', { class: 'ga-avatar', 'aria-hidden': 'true' });
            avatar.innerHTML = AVATARS[agent.role] || AVATARS.text;
            const guardian = agent.role === 'orchestrator';
            return h('article', { class: `gl-agent ${guardian ? 'is-guardian' : ''} ${agent.enabled ? '' : 'is-off'}` },
                h('div', { class: 'gl-agent-head' }, avatar,
                    h('div', {}, h('strong', {}, agent.name), h('span', { class: 'gl-role' }, ROLES[agent.role] || agent.role), h('small', {}, agent.description)),
                    h('label', { class: 'gl-switch', title: agent.enabled ? t('lib.onClickToTurn') : t('lib.offClickToTurn') }, enabled, h('i', {}))),
                h('label', { class: 'ga-field' }, h('span', {}, t('lib.model')), select),
                guardian ? h('div', { class: 'gl-actions' }, h('button', { type: 'button', class: 'gl-primary', onclick: onOpenHome,
                    title: t('lib.itsDimensionSoulIdentity') },
                    t('lib.openItsGuardianDimension')), doctor()) : null,
                h('details', {}, h('summary', {}, agent.system_prompt ? t('lib.instructionsCustom') : t('lib.instructions')), prompt,
                    agent.role === 'orchestrator' ? h('p', { class: 'gl-hint' }, t('lib.theGuardianSResponse')
                        + t('lib.itsInstructionsLiveIn')) : null,
                    h('div', { class: 'gl-actions' }, keep, reset, status)),
                h('details', {}, h('summary', {}, Object.keys(agent.params || {}).length ? t('lib.creativityAndLengthSpecific') : t('lib.creativityAndLength')),
                    h('p', { class: 'gl-hint' }, t('lib.emptyTheModelS')), sampling));
        })));
    }

    // Diagnostic : ce qu'une vraie demande au Gardien rencontrera, étape par étape (essai réel du modèle).
    function doctor() {
        const out = h('ul', { class: 'gl-doctor' });
        const run = h('button', { type: 'button', title: t('lib.checksModelEngineMemory') }, t('lib.diagnostics'));
        run.addEventListener('click', async () => {
            run.disabled = true;
            out.replaceChildren(h('li', { class: 'wait' }, t('lib.testingTheModelLoading')));
            try {
                const { checks } = await api.request('POST', 'toolbox/doctor', {});
                out.replaceChildren(...checks.map(c => h('li', { class: c.ok ? 'ok' : 'bad' }, h('b', {}, c.label), ` ${c.detail}`)));
            } catch (error) {
                out.replaceChildren(h('li', { class: 'bad' }, h('b', {}, t('lib.diagnostics')), ` ${error.message}`));
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
        if (!toolbox) return panels.tools.replaceChildren(h('p', { class: 'gl-empty' }, t('lib.loadingTools')));
        const on = new Set(toolbox.enabled);
        const save = () => {
            const all = toolbox.tools.every(t => on.has(t.op));
            act(() => tb.updateAgent(toolbox.guardian, { tools_allowed: all ? [] : [...on] }), t('lib.guardianToolsSaved')).then(loadTools);
        };
        const categories = [...new Set(toolbox.tools.map(t => t.category))];
        // Recherche : masque les outils qui ne correspondent pas (sans redessiner : la saisie garde le focus).
        const search = h('input', { type: 'search', class: 'ga-search', placeholder: t('lib.searchAToolWeb'), 'aria-label': t('lib.searchATool') });
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            panels.tools.querySelectorAll('.gl-toolgroup').forEach(group => {
                const tools = [...group.querySelectorAll('.gl-tool')];
                tools.forEach(t => { t.hidden = Boolean(q) && !t.dataset.find.includes(q); });
                group.hidden = tools.every(t => t.hidden);
                if (q) group.open = true;
            });
        });
        panels.tools.replaceChildren(
            h('div', { class: 'ga-toolbar' }, search, h('span', { class: 'ga-count' }, t('lib.onOf', { size: on.size, length: toolbox.tools.length }))),
            h('p', { class: 'gl-hint' }, t('lib.aToolTurnedOff')),
            ...categories.map(category => {
                const list = toolbox.tools.filter(t => t.category === category);
                const active = list.filter(t => on.has(t.op)).length;
                return h('details', { class: 'gl-toolgroup', open: true }, h('summary', {}, category, h('span', { class: 'ga-count' }, `${active} / ${list.length}`)),
                list.map(tool => {
                    const [source, color] = SOURCES[tool.source];
                    const locked = !toolbox.guardian || !tool.available || tool.always;  // outil administrateur non autorisé ici, ou toujours permis
                    const box = h('input', { type: 'checkbox', checked: on.has(tool.op), disabled: locked,
                        title: tool.always ? t('lib.alwaysAllowedItNeeds')
                            : tool.available ? '' : t('lib.administratorAccountAndGuardian') });
                    box.addEventListener('change', () => { if (box.checked) on.add(tool.op); else on.delete(tool.op); save(); });
                    return h('label', { class: `gl-tool ${on.has(tool.op) ? '' : 'off'}`, dataset: { find: `${tool.label} ${tool.op} ${tool.doc}`.toLowerCase() } }, h('span', { class: 'gl-switch' }, box, h('i', {})),
                        h('div', {}, h('strong', {}, tool.label), h('code', {}, tool.op), tool.read ? h('span', { class: 'gl-cap' }, t('lib.read')) : null,
                            tool.admin ? h('span', { class: 'gl-badge heavy', title: t('lib.runsCodeOnThe') }, 'ADMIN') : null,
                            h('small', {}, tool.doc.replace(/^\{[^}]*\}\s*:\s*/, ''))),
                        h('span', { class: 'gl-cap', style: `color:${color};border-color:${color}55;background:${color}14`, title: tool.iaqua ? `iAqua : ${tool.iaqua}` : '' }, source));
                }));
            }),
            toolbox.shell ? null : h('p', { class: 'gl-hint' }, t('lib.adminToolsShellPython')
                + t('lib.afterGuardianShell1')));
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
            // Sans stable-diffusion.cpp, FLUX ne peut rien générer : l'administrateur le compile d'ici (deploy/sd.sh).
            state.imaging ? null : jobBox({
                path: 'toolbox/sd', label: t('lib.installStableDiffusionCpp'), again: t('lib.reinstall'),
                intro: t('lib.stableDiffusionCppSd'),
                update(c) { if (c.installed) state.imaging = true; },
            }),
            parts.length ? h('small', {}, t('lib.companions'), parts.map(m => m.filename).join(', ')) : null,
            Object.entries(state.packs || {}).map(([key, label]) => h('button', { type: 'button', ...guard(),
                onclick: () => act(() => tb.installPack(key), t('lib.downloadStartedHuggingFace', { label })) }, t('lib.install', { label }))));
    }

    function renderLibrary() {
        const models = state.models.filter(m => m.status === 'ready');
        if (!models.length) return renderWizard();
        const columns = [['guardian', 'GARDIEN', t('lib.readsTheNodesDecides'), '#6848A6'],
            ['agents', 'AGENTS', t('lib.modelsOfTheSpecialised'), '#1E90FF'], ['image', 'IMAGE', t('lib.diffusionTheIllustratorDraws'), '#b8447a']];
        const tuned = models.find(m => m.id === tuning);
        panels.library.replaceChildren(tuned ? (tuned.kind === 'image' ? imagePanel(tuned) : loadDialog(tuned)) : '', h('div', { class: 'gl-board' }, columns.map(([key, label, desc, color]) => {
            const cards = models.filter(m => categoryOf(m) === key);
            const column = h('div', { class: 'gl-column', style: `border-top-color:${color}`, dataset: { category: key } },
                h('div', { class: 'gl-column-head' }, h('span', { style: `color:${color}` }, label), h('span', {}, cards.length)),
                h('small', {}, desc),
                cards.length ? cards.map(modelCard) : h('div', { class: 'gl-drop-here' }, t('lib.dropHere')),
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
            }, t('lib.theGuardianUses', { v: model.label || model.filename }));
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

    // Libellé d'un réglage dans la langue de l'interface, sinon celui du serveur (params.py).
    const known = (key, fallback) => (t(key) === key ? fallback : t(key));
    const label = p => known(`param.${p.key}`, p.label);
    const choiceLabel = (p, value, text) => known(`pchoice.${p.key}.${value}`, text);
    const hint = p => known(`phint.${p.key}`, p.hint || '');
    // Champs de réglages décrits par le serveur (params.py), regroupés ; vide = valeur par défaut.
    function paramFields(groups, cfg) {
        const field = p => {
            const value = cfg[p.key] ?? '';
            let input;
            if (p.kind === 'bool') {
                input = h('select', { name: p.key }, [['', t('lib.default')], ['true', t('lib.yes')], ['false', t('lib.no')]].map(([v, text]) =>
                    h('option', { value: v, selected: String(value) === v }, text)));
            } else if (p.kind === 'choice') {
                input = h('select', { name: p.key }, h('option', { value: '' }, t('lib.default')),
                    p.choices.map(([v, text]) => h('option', { value: v, selected: String(value) === v }, choiceLabel(p, v, text))));
            } else if (p.kind === 'list') {
                input = h('input', { name: p.key, value: Array.isArray(value) ? value.join(',') : value, placeholder: hint(p) });
            } else {
                input = h('input', { name: p.key, type: 'number', value, min: p.min, max: p.max, step: p.kind === 'int' ? 1 : 'any', placeholder: hint(p) });
            }
            return h('label', { title: hint(p) }, label(p), input);
        };
        return state.paramSpec.filter(p => groups.includes(p.group)).reduce((sets, p) => {
            let set = sets.find(f => f.dataset.group === p.group);
            if (!set) sets.push(set = h('fieldset', { dataset: { group: p.group } }, h('legend', {}, t(`pgroup.${p.group}`))));
            set.append(field(p));
            return sets;
        }, []);
    }
    const collect = scope => Object.fromEntries(state.paramSpec.map(p => [p.key, scope.querySelector(`[name="${p.key}"]`)])
        .filter(([, el]) => el).map(([key, el]) => [key, el.value.trim()]).filter(([, v]) => v !== ''));
    const summary = cfg => {
        const set = state.paramSpec.filter(p => cfg[p.key] !== undefined);
        const shown = (p, v) => (p.kind === 'bool' ? (v ? t('lib.yes') : t('lib.no')) : p.kind === 'choice' ? p.choices.find(c => c[0] === String(v))?.[0] ?? v
            : Array.isArray(v) ? v.join(' / ') : v === -1 && p.key === 'n_gpu_layers' ? t('lib.all') : String(v));
        return set.length ? set.map(p => h('span', {}, `${label(p)} `, h('b', {}, shown(p, cfg[p.key])))) : [h('span', {}, t('lib.defaultSettings'))];
    };

    // Un script de compilation lancé d'ici (administrateur) : bouton, journal, résultat, suivi toutes les 2 s.
    // update(c, line) ajuste le message et les boutons propres au script.
    function jobBox({ path, intro, label, again, update = () => {}, extra = [] }) {
        const box = h('div', { class: 'gl-warning gl-cuda' });
        const log = h('pre', { hidden: true });
        const line = h('p', {}, intro);
        const build = h('button', { type: 'button', class: 'gl-primary', ...guard() }, label);
        box.append(line, h('div', { class: 'gl-actions' }, build, ...extra), log);
        const show = async (start = false) => {
            try {
                const c = start ? await api.request('POST', path, { action: 'build' }) : await api.request('GET', path);
                log.hidden = !c.log.length;
                log.textContent = c.log.slice(-14).join('\n');
                log.scrollTop = log.scrollHeight;
                build.disabled = !state.staff || c.running;
                build.textContent = c.running ? t('lib.building') : c.code === null ? label : again;
                update(c, line);
                if (c.result) line.textContent = t('lib.build', { result: c.result });
                if (c.running && box.isConnected) setTimeout(show, 2000);
            } catch (error) {
                line.textContent = error.message;
            }
        };
        build.addEventListener('click', () => show(true));
        if (state.staff) show();
        return box;
    }

    // Pourquoi l'offload GPU n'agit pas, et quoi faire : l'administrateur compile llama-cpp-python avec CUDA
    // d'ici (deploy/cuda.sh), suit le journal, puis redémarre Nodz.
    function cudaNotice() {
        if (!state.machine.gpu) return h('p', { class: 'gl-hint' }, t('lib.noNvidiaGpuDetected'));
        if (state.gpuOffload == null) return h('p', { class: 'gl-hint' }, t('lib.llamaCppPythonEngine'));
        if (state.gpuOffload !== false) return null;
        const restart = h('button', { type: 'button', hidden: true }, t('lib.restartNodz'));
        const box = jobBox({
            path: 'toolbox/cuda', label: t('lib.buildWithCuda'), again: t('lib.rebuild'), extra: [restart],
            intro: t('lib.nvidiaCardDetectedBut'),
            update(c, line) {
                if (!c.nvcc && !c.running) line.textContent = t('lib.nvidiaCardDetectedWithout');
                restart.hidden = c.code !== 0;
                restart.disabled = !c.restart;
                restart.title = c.restart ? '' : t('lib.noPasswordlessSudoSudo');
            },
        });
        restart.addEventListener('click', async () => {
            try {
                await api.request('POST', 'toolbox/cuda', { action: 'restart' });
                box.querySelector('p').textContent = t('lib.restartingNodzReloadThe');
            } catch (error) {
                box.querySelector('p').textContent = error.message;
            }
        });
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
            placeholder: t('lib.autoVramBudgetOr') });
        const gpu = h('input', { type: 'text', name: 'n_gpu_layers', value: String(saved.n_gpu_layers ?? 'auto'),
            placeholder: t('lib.autoAdjustsToThe') });
        const layers = m.gguf?.layers;
        const slider = layers ? h('input', { type: 'range', min: 0, max: layers, step: 1, 'aria-label': t('lib.gpuLayers') }) : null;
        const box = h('div', { class: 'gl-estimate' });
        const advanced = h('details', { class: 'gl-advanced' }, h('summary', {}, t('lib.advancedMultiGpuKv')), paramFields(['Avancé'], saved));
        const sampling = h('details', { class: 'gl-advanced' }, h('summary', {}, t('pgroup.Échantillonnage')), paramFields(['Échantillonnage'], saved));
        const status = h('span', { class: 'gl-status' });
        // En clair : trois choix qui remplissent les vrais champs (repliés dans « Réglages avancés »).
        const ttlInput = number('ttl', cfg.ttl, 0, 10080, '720 (0 = jamais)');
        const choices = [];
        const choice = (label, hint, options, read, write) => {
            const buttons = options.map(([value, text]) => h('button', { type: 'button', dataset: { value }, onclick: () => { write(value); show(); } }, text));
            choices.push(() => buttons.forEach(b => b.classList.toggle('on', b.dataset.value === read())));
            return h('div', { class: 'ga-choice' }, h('div', {}, h('b', {}, label), h('small', {}, hint)), h('div', { class: 'ga-seg' }, buttons));
        };
        const simple = h('div', { class: 'ga-simple' },
            choice(t('lib.conversationMemory'), t('lib.howMuchTextIt'),
                [['auto', t('lib.auto')], ['4096', '4 k'], ['8192', '8 k'], ['16384', '16 k'], ['32768', '32 k']],
                () => ctx.value.trim().toLowerCase() || 'auto', value => { ctx.value = value; }),
            choice(t('lib.whereItRuns'), 'La carte graphique est bien plus rapide ; Auto en met le plus possible.',
                [['0', t('lib.processor')], ['auto', t('lib.auto')], ['max', t('lib.graphicsCard')]],
                () => gpu.value.trim().toLowerCase() || 'auto', value => { gpu.value = value; }),
            choice(t('lib.keepLoaded'), t('lib.afterThisTimeWithout'),
                [['10', '10 min'], ['120', '2 h'], ['720', '12 h'], ['0', t('lib.always')]],
                () => ttlInput.value.trim() || String(cfg.ttl ?? 720), value => { ttlInput.value = value; }));
        const form = h('form', { class: 'gl-load' },
            h('p', { class: 'gl-hint' }, m.loaded ? t('lib.saveTheSettingsThey')
                : t('lib.loadSettingsTheModel')),
            simple, box,
            h('details', { class: 'gl-advanced' }, h('summary', {}, t('lib.advancedSettings')), h('div', { class: 'gl-load' },
            row(t('lib.context'), ctx),
            row(t('lib.gpuLayers'), gpu, slider ? h('div', { class: 'gl-gpu-quick' },
                h('button', { type: 'button', onclick: () => setGpu('0') }, 'CPU'), slider,
                h('button', { type: 'button', onclick: () => setGpu('auto') }, t('lib.auto')),
                h('button', { type: 'button', onclick: () => setGpu('max') }, 'Max')) : null),
            row('', h('small', { class: 'gl-accent' }, t('lib.recommendedAutoForBoth')
                + t('lib.theGpuLayersThat')
                + t('lib.aNumberForcesThe'))),
            row('Flash attention', check('flash_attn', cfg.flash_attn, t('lib.enableSmallerComputeBuffers'))),
            row('mmap', check('use_mmap', cfg.use_mmap, t('lib.enableFastLoadingThe'))),
            row(t('lib.keepInMemoryMlock'), check('use_mlock', cfg.use_mlock, t('lib.pinInRamVram'))),
            row(t('lib.cpuThreads'), number('n_threads', saved.n_threads, 1, 256, t('lib.autoPhysicalCores', { n_threads: cfg.n_threads }))),
            row('Batch', number('n_batch', saved.n_batch, 32, 8192, 'auto (1024)')),
            row(t('lib.freeAfterMin'), ttlInput),
            row(t('lib.randomSeed'), check('random_seed', cfg.random_seed, t('lib.enableOtherwiseReproducibleAnswers'))),
            advanced, sampling)), cudaNotice(),
            h('footer', { class: 'gl-actions' }, status,
                h('button', { type: 'button', onclick: () => act(() => tb.updateModel(m.id, { params: {} }), t('lib.defaultIaquaSettings')) }, t('lib.allDefaults')),
                h('button', { type: 'button', onclick: closeTuning }, t('lib.cancel')),
                h('button', { type: 'submit', class: 'gl-primary' }, t('lib.save'))));
        const fmt = mb => (mb < 100 ? '<0,1' : (mb / 1024).toFixed(2).replace('.', ','));
        function show() {
            const g = gpu.value.trim().toLowerCase();
            const e = estimate(m, ctx.value.trim().toLowerCase(), g, form.elements.type_k?.value || 'f16');
            if (slider) slider.value = e.onGpu;
            choices.forEach(update => update());
            const auto = ['', 'auto'].includes(ctx.value.trim().toLowerCase()) && ['', 'auto'].includes(g);
            const [speed, level] = auto && m.placement ? [t('lib.autoTheSplitKept'), 'ok']
                : auto ? [t('lib.autoNodzPicksThe'), 'ok']
                    : e.onGpu === 0 ? [t('lib.cpuOnlyVerySlow'), 'warn']
                        : e.frac < 0.5 ? [t('lib.mostlyCpuSlow3'), 'warn']
                            : e.frac >= 0.9 ? [t('lib.mostlyGpuFast30'), 'ok'] : [t('lib.sharedGpuCpuMedium'), 'ok'];
            const over = (used, total) => (total && used > total * 0.95 ? 'high' : '');
            box.replaceChildren(h('strong', {}, t('lib.estimatedMemory')),
                h('div', {}, h('span', {}, 'VRAM (GPU)'), h('b', { class: over(e.vram, e.vramMb) }, `${fmt(e.vram)} ${t('mon.gb')}`),
                    h('small', {}, t('lib.layersOf', { on: e.onGpu, total: e.layers || '?' })
                        + (e.vramMb ? t('lib.onTheCard', { size: fmt(e.vramMb) }) : t('lib.noUsableGpu')))),
                h('div', {}, h('span', {}, 'RAM (CPU)'), h('b', { class: over(e.ram, state.machine.ram_mb) }, `${fmt(e.ram)} ${t('mon.gb')}`),
                    h('small', {}, t('lib.contextTokens', { n: e.ctx }) + (state.machine.ram_mb ? t('lib.ofRam', { size: fmt(state.machine.ram_mb) }) : ''))),
                h('div', {}, h('span', {}, t('lib.speed')), h('b', { class: level }, speed)),
                h('small', {}, t('lib.file', { v: gb(m.size) }), m.gguf?.context_length ? t('lib.trainingContext', { context_length: m.gguf.context_length }) : '',
                    m.placement ? t('lib.lastLoadGpuLayers', { gpu_layers: m.placement.gpu_layers, n_ctx: m.placement.n_ctx })
                        + (m.placement.ctx_capped ? t('lib.ctxCapped') : '') + (m.placement.kv_q8 ? t('lib.kvQ8') : '') : ''),
                m.placement && m.placement.fits === false ? h('small', { class: 'bad' }, t('lib.doesnTFitIn')
                    + t('lib.gbNeededGbFree', { v: fmt(m.placement.need_mb), v1: fmt(m.placement.ram_free_mb) })
                    + t('lib.underOneTokenPer')) : '');
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
            status.textContent = t('lib.saving');
            act(() => tb.updateModel(m.id, { params }), m.loaded ? t('lib.settingsSavedTheModel') : t('lib.settingsSaved'))
                .then(() => { if (!notice.classList.contains('error')) closeTuning(); else status.textContent = ''; });
        });
        return h('div', { class: 'gl-dialog', onmousedown: event => { if (event.target.classList.contains('gl-dialog')) closeTuning(); } },
            h('section', { class: 'gl-dialog-card', role: 'dialog', 'aria-label': t('lib.settingsFor', { v: m.label || m.filename }) },
                h('header', {}, h('h3', {}, t('lib.settings', { v: m.label || m.filename })), h('button', { type: 'button', class: 'gl-close', onclick: closeTuning }, t('lib.close'))),
                form));
    }

    const closeTuning = () => { tuning = null; render(); };
    function imagePanel(m) {
        const form = h('form', { class: 'gl-params-form' }, paramFields(['Image'], m.params || {}),
            h('div', { class: 'gl-actions' }, h('button', { type: 'submit', class: 'gl-primary' }, t('lib.save')),
                h('button', { type: 'button', onclick: () => act(() => tb.updateModel(m.id, { params: {} }), t('lib.defaultSettings')) }, t('lib.allDefaults')),
                h('button', { type: 'button', onclick: closeTuning }, t('lib.close'))));
        form.addEventListener('submit', event => {
            event.preventDefault();
            act(() => tb.updateModel(m.id, { params: collect(form) }), t('lib.settingsSaved'));
        });
        return h('section', { class: 'gl-tuning' }, h('h3', {}, t('lib.settingsFor', { v: m.label || m.filename })), form);
    }

    // Fiche d'un modèle, en clair : mémoire de conversation, où il tourne, combien de temps il reste chargé, puis son
    // activité (le détail technique est dans Réglages).
    const kilo = n => (n >= 1000 ? `${Math.round(n / 1024)} k` : String(n));
    const kept = ttl => (Number(ttl) === 0 ? t('lib.alwaysLoaded') : Number(ttl) >= 60 ? t('lib.freedAfterH', { v: Math.round(ttl / 60) }) : t('lib.freedAfterMin', { ttl }));
    function loadRows(m) {
        const c = m.config || {};
        const p = m.loaded && m.placement;
        const chip = (text, cls = '') => h('span', { class: `ga-chip ${cls}` }, text);
        const ctx = p ? p.n_ctx : c.n_ctx;
        const where = p ? (!p.gpu_layers ? [t('lib.cpuOnly'), 'warn'] : p.gpu_layers >= p.layers ? [t('lib.allOnGpu'), 'ok'] : [`GPU ${t('lib.layersOf', { on: p.gpu_layers, total: p.layers })}`, ''])
            : String(c.n_gpu_layers) === '0' ? [t('lib.cpuOnly'), 'warn'] : String(c.n_gpu_layers) === 'max' ? [t('lib.allOnGpu'), 'ok'] : [t('lib.gpuAuto'), ''];
        const differs = p && (String(c.n_ctx) !== String(p.n_ctx) || !['auto', 'max'].includes(String(c.n_gpu_layers)) && Number(c.n_gpu_layers) !== p.gpu_layers);
        const stats = m.stats;
        return [h('div', { class: 'gl-params' }, chip(t('lib.memoryChip', { size: /^\d+$/.test(String(ctx)) ? kilo(Number(ctx)) : 'auto' })), chip(...where), chip(kept(c.ttl ?? 720))),
            differs ? h('small', { class: 'gl-hint' }, t('lib.savedContextGpuLayers', { n_ctx: c.n_ctx, n_gpu_layers: c.n_gpu_layers })) : null,
            p?.vram_unknown ? h('small', { class: 'gl-hint' }, t('lib.unreadableGraphicsCardNvidia')) : null,
            // Des couches restées sur le CPU : chaque jeton les attend. Un clic les met toutes sur le GPU (rechargement).
            p && p.layers && p.gpu_layers < p.layers && p.vram_free_mb ? h('button', { type: 'button', class: 'gl-primary', ...guard(),
                title: t('lib.allLayersOnThe'), onclick: () => act(async () => {
                    await tb.updateModel(m.id, { params: { ...m.params, n_gpu_layers: 'max' } });
                    await tb.modelAction(m.id, 'unload');
                }, t('lib.allLayersWillGo')) }, t('lib.allOnTheGpu', { v: p.layers - p.gpu_layers })) : null,
            stats ? h('small', { class: 'gl-runtime' }, t(stats.requests > 1 ? 'lib.loadedN' : 'lib.loaded1', { ago: ago(stats.loaded_at), n: stats.requests,
                tokens: stats.tokens >= 1000 ? `${(stats.tokens / 1000).toFixed(1)} k` : stats.tokens })
                + (stats.last ? t('lib.lastAnswer', { wait: stats.last.wait_s }) + (stats.last.speed ? t('lib.tokensPerS', { speed: stats.last.speed }) : '') : '')) : null];
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
                m.loaded ? h('span', { class: 'gl-badge loaded' }, t('lib.inMemory')) : null,
                h('span', { class: 'gl-cap', style: `color:${quantColor(m.quant)}` }, m.quant || '?'),
                nameCaps(m).map(capPill)),
            m.agents.length ? h('small', { class: 'gl-used' }, t('lib.usedBy', { v: m.agents.join(', ') })) : null,
            tiny ? h('p', { class: 'gl-warning' }, t('lib.verySmallProbablyAn')) : null,
            m.kind === 'text' ? loadRows(m) : h('div', { class: 'gl-params' }, summary(cfg)),
            h('div', { class: 'gl-actions' },
                m.kind === 'text' && categoryOf(m) !== 'guardian'
                    ? h('button', { type: 'button', class: 'gl-primary', onclick: () => moveTo(m.id, 'guardian') }, t('lib.forTheGuardian')) : null,
                h('button', { type: 'button', ...guard(), onclick: () => { tuning = tuning === m.id ? null : m.id; render(); } }, t('lib.settings2')),
                // Le reste, plus rare, dans le menu ⋯ (il se ferme au clic ailleurs).
                h('details', { class: 'ga-more' }, h('summary', { title: t('lib.more') }, '⋯'), h('div', {},
                    h('button', { type: 'button', ...guard(), onclick: () => { rename.hidden = false; rename.focus(); } }, t('lib.rename')),
                    h('button', { type: 'button', ...guard(), onclick: () => moveTo(m.id, m.kind === 'image' ? 'agents' : 'image') },
                        m.kind === 'image' ? t('lib.fileAsAText') : t('lib.fileAsAnImage')),
                    m.loaded ? h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'unload'), t('lib.memoryFreed')) }, t('lib.freeTheMemory')) : null,
                    confirmButton(t('lib.removeFromTheLibrary'), () => tb.removeModel(m.id, false), { title: t('lib.theFileStaysOn') })))));
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
                h('div', {}, h('strong', {}, m.name), h('small', {}, `${known(`rec.${m.filename}`, m.why)} · ${m.size_gb} ${t('mon.gb')}`)),
                h('button', { type: 'button', ...guard(), onclick: () => startDownload({ repo: m.repo, filename: m.filename, size: Math.round(m.size_gb * 1024 ** 3) }) },
                    m.recommended ? t('lib.recommendedDownload') : t('lib.download')))), images ? [h('h3', {}, t('lib.images')), imageHelp(state.models)] : null));
        } catch (error) {
            report(error);
        }
    }

    async function renderWizard() {
        const box = h('div', { class: 'gl-wizard' }, h('h3', {}, t('lib.noModelYet')),
            h('p', {}, t('lib.hereSWhatSuits')), h('p', { class: 'gl-empty' }, t('lib.analysingTheMachine')));
        panels.library.replaceChildren(box);
        await recommend(box);
    }

    // --- Documents : la bibliothèque de modèles du Rédacteur (pptx, docx, xlsx, pdf de l'utilisateur, pour son style).

    let docs = null;
    async function loadDocs() {
        try {
            docs = (await api.request('GET', 'toolbox/documents')).templates;
            render();
        } catch (error) {
            report(error);
        }
    }
    function renderDocs() {
        if (!docs) return panels.docs.replaceChildren(h('p', { class: 'gl-empty' }, t('lib.loadingTemplates')));
        const file = h('input', { type: 'file', accept: '.pptx,.docx,.xlsx,.pdf' });
        const name = h('input', { type: 'text', placeholder: t('lib.templateNameOptional'), maxlength: 60 });
        const add = h('button', { type: 'button', class: 'gl-primary' }, t('lib.addTheTemplate'));
        add.addEventListener('click', () => act(async () => {
            if (!file.files[0]) throw new Error(t('lib.chooseAPptxDocx'));
            const form = new FormData();
            form.append('file', file.files[0]);
            if (name.value.trim()) form.append('name', name.value.trim());
            const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/) || [])[1] || '');
            const response = await fetch(endpoint('toolbox/documents'), { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-CSRFToken': csrf } });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || response.statusText);
            docs = data.templates;
        }, t('lib.templateAddedTheWriter')));
        const kinds = { pptx: 'PowerPoint', docx: 'Word', xlsx: 'Excel', pdf: 'PDF' };
        panels.docs.replaceChildren(
            h('p', { class: 'gl-hint' }, t('lib.yourDocumentTemplatesA'),
                t('lib.whenTheGuardianOr'),
                t('lib.headersAndFootersStay')),
            h('div', { class: 'gl-api-form' }, h('label', { class: 'gl-field' }, h('span', {}, t('lib.file2')), file),
                h('label', { class: 'gl-field' }, h('span', {}, t('lib.name')), name), add),
            docs.length ? h('div', { class: 'gl-list' }, docs.map(doc => h('div', { class: 'gl-row' },
                h('span', { class: 'gl-badge' }, kinds[doc.kind] || doc.kind), h('span', { class: 'gl-name' }, doc.name), h('span', { class: 'gl-size' }, gb(doc.size)),
                confirmButton(t('lib.remove'), async () => {
                    docs = (await api.request('DELETE', `toolbox/documents?${new URLSearchParams({ name: doc.name })}`)).templates;
                }, { disabled: false, title: '' }))))
                : h('p', { class: 'gl-empty' }, t('lib.noTemplateYet')));
    }

    // --- Mon IA : l'état du Gardien, puis ses deux IA possibles (sa clé API, ou le Premium hébergé ici), et ses outils.
    // L'univers reste gratuit ; l'IA du serveur est réservée au Premium (un petit modèle gratuit dégraderait l'expérience).

    // Stripe : la page de paiement (ou le portail de l'abonnement) s'ouvre à la place de Nodz, le retour revient ici.
    const goStripe = (button, call) => act(async () => {
        button.disabled = true;
        try {
            location.href = (await call()).url;
        } finally {
            button.disabled = false;
        }
    });

    function premiumOffer(current) {
        const p = state.premium;
        const action = !p?.configured ? h('button', { type: 'button', disabled: true }, t('lib.soon'))
            : p.active ? h('button', { type: 'button' }, t('lib.manageMySubscription'))
            : p.guest ? h('a', { class: 'gl-primary ga-link', href: `${document.documentElement.dataset.base || ''}/register/` }, t('lib.createMyAccount'))
            : h('button', { type: 'button', class: 'gl-primary' }, t('lib.goPremium'));
        if (action.tagName === 'BUTTON' && p?.configured) action.addEventListener('click', () => goStripe(action, p.active ? tb.portal : tb.checkout));
        return h('section', { class: `ga-option ga-offer ga-premium${p?.active ? ' on' : ''}` },
            h('h4', {}, 'Premium', p?.price ? h('span', { class: 'ga-price' }, p.price) : ''),
            h('p', {}, t('lib.premiumPitch', { model: p?.model ? ` (${p.model})` : '' })
                + (!p?.configured ? t('lib.comingSoonOnThis') : p.active ? t('lib.yourSubscriptionIsActive') : p.guest ? t('lib.youNeedAnAccount') : t('lib.cancelAnyTime'))),
            current?.premium ? h('span', { class: 'gl-badge' }, t('lib.active')) : action);
    }

    function renderStart() {
        const guardian = state.agents.find(a => a.role === 'orchestrator');
        const current = guardian?.model && state.models.find(m => m.id === guardian.model);
        const [where, level] = !current ? [t('lib.noAiItSleeps'), 'off'] : current.premium ? ['Premium', 'ok'] : current.endpoint ? [t('lib.viaApi2'), 'ok']
            : current.loaded ? [t('lib.onThisMachineIn'), 'ok'] : [t('lib.onThisMachineLoaded'), 'ok'];
        const option = (title, text, ...rest) => h('section', { class: 'ga-option ga-offer' }, h('h4', {}, title), h('p', {}, text), ...rest);
        const local = h('div', { class: 'gl-step-recs' }, h('p', { class: 'gl-empty' }, t('lib.analysingTheMachine')));
        panels.start.replaceChildren(
            h('div', { class: `ga-now ${level}` }, h('span', { class: 'ga-dot' }),
                h('div', {}, h('small', {}, t('lib.yourGuardian')), h('strong', {}, current ? current.label || current.filename : t('lib.noAiYet')), h('span', {}, where)),
                guardian ? h('button', { type: 'button', onclick: () => show('agents') }, t('lib.itsAgents')) : null),
            h('p', { class: 'gl-hint ga-pitch' }, t('lib.theUniverseTheTour')
                + t('lib.yoursViaApiOr')),
            h('div', { class: 'ga-options ga-offers' },
                option(t('lib.yourApiKey'), t('lib.yourOpenaiMistralGroq')
                    + t('lib.yourKeyStaysOn'),
                    current?.mine ? h('span', { class: 'gl-badge' }, t('lib.active')) : h('button', { type: 'button', onclick: () => show('api') }, t('lib.plugInMyKey'))),
                premiumOffer(current)),
            state.staff ? h('div', { class: 'ga-option ga-wide' }, h('h4', {}, t('lib.onThisMachineAdministrator')),
                h('p', {}, t('lib.noConnectionOrKey', { textContent: machineLine.textContent })),
                local, h('button', { type: 'button', onclick: () => show('hub') }, t('lib.searchHuggingFace'))) : '',
            h('div', { class: 'ga-option ga-wide' }, h('h4', {}, t('lib.whatItIsAllowed')),
                h('p', {}, t('lib.thoughtModeItCreates')
                    + t('lib.imagesPresentationsAndIts')),
                h('div', { class: 'gl-actions' }, h('button', { type: 'button', onclick: () => show('tools') }, t('lib.chooseItsTools')),
                    h('button', { type: 'button', onclick: onOpenHome }, t('lib.openItsGuardianDimension')))));
        if (state.staff) recommend(local, false);
    }

    // --- Fichiers du serveur

    async function loadServerFiles() {
        panels.server.replaceChildren(h('p', { class: 'gl-empty' }, t('lib.readingTheFolder')));
        try {
            const { files, models_dir: dir } = await tb.serverFiles();
            panels.server.replaceChildren(
                h('p', { class: 'gl-hint' }, t('lib.modelsFolder'), h('code', {}, dir), t('lib.aGgufCopiedHere')),
                files.length ? h('div', { class: 'gl-list' }, files.map(f => h('div', { class: 'gl-row' },
                    h('span', { class: 'gl-quant', style: `color:${quantColor(f.quant)}` }, f.quant || '?'),
                    h('span', { class: 'gl-name', title: f.path }, f.path), h('span', { class: 'gl-size' }, gb(f.size)),
                    f.model ? h('span', { class: 'gl-badge' }, t('lib.inTheLibrary'))
                        : h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.importFile(f.path), t('lib.imported', { name: f.name })).then(loadServerFiles) }, t('lib.import')),
                    confirmButton(t('lib.delete'), async () => { await tb.deleteFile(f.path); await loadServerFiles(); }))))
                    : h('p', { class: 'gl-empty' }, t('lib.noGgufFileIn')));
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
        const key = h('input', { type: 'password', placeholder: t('lib.optionalLocalServer'), autocomplete: 'new-password' });
        const label = h('input', { type: 'text', placeholder: t('lib.displayNameOptional'), autocomplete: 'off' });
        const add = h('button', { type: 'button', class: 'gl-primary' }, t('lib.testAndAdd'));
        add.addEventListener('click', () => act(async () => {
            add.disabled = true;
            add.textContent = t('lib.testingTheConnection');
            try {
                const model = await tb.addApiModel({ endpoint: url.value.trim(), name: name.value.trim(), api_key: key.value.trim(), label: label.value.trim() });
                const guardian = state.agents.find(a => a.role === 'orchestrator');
                if (guardian && !guardian.model) await tb.updateAgent(guardian.id, { model: model.id });  // un Gardien sans IA la prend aussitôt
            } finally {
                add.disabled = false;
                add.textContent = t('lib.testAndAdd');
            }
        }, t('lib.addedItServesThe', { v: name.value.trim() })));
        const presets = h('div', { class: 'gl-presets' }, API_PRESETS.map(([title, base, model]) => h('button', { type: 'button', onclick: () => {
            url.value = base;
            if (model && !name.value) name.value = model;
            (name.value ? key : name).focus();
        } }, title)));
        const connected = state.models.filter(m => m.endpoint);
        panels.api.replaceChildren(
            h('p', { class: 'gl-hint' }, t('lib.anOpenaiCompatibleServer'),
                t('lib.andABigModel'),
                state.staff ? t('lib.addedHereTheModel') : t('lib.yourConnectorAndYour')),
            presets,
            h('div', { class: 'gl-api-form' }, field(t('lib.baseUrl'), url), field(t('lib.model'), name), field(t('lib.apiKey'), key), field(t('lib.displayName'), label), add),
            connected.length ? h('div', { class: 'gl-list' }, connected.map(m => {
                const mine = m.mine || state.staff ? { disabled: false, title: '' } : {};  // son connecteur se règle par son propriétaire
                const newKey = h('input', { type: 'password', placeholder: m.has_key ? t('lib.keySavedReplaceIt') : t('lib.addAKey'), autocomplete: 'new-password' });
                return h('div', { class: 'gl-row' },
                    h('span', { class: 'gl-badge' }, m.mine ? t('lib.mine') : 'API'), h('span', { class: 'gl-name', title: m.endpoint }, `${m.label || m.filename} · ${m.endpoint}`),
                    m.agents.length ? h('span', { class: 'gl-size' }, m.agents.join(', ')) : '',
                    newKey, h('button', { type: 'button', ...guard(), ...mine, onclick: () => act(() => tb.updateModel(m.id, { api_key: newKey.value.trim() }), t('lib.keySaved')) }, t('lib.save')),
                    confirmButton(t('lib.remove'), () => tb.removeModel(m.id), mine));
            })) : h('p', { class: 'gl-empty' }, t('lib.noApiModelYet')));
    }

    // --- Hugging Face

    async function startDownload(file) {
        await act(() => tb.download(file), t('lib.downloading', { filename: file.filename }));
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
        const query = h('input', { type: 'search', value: hf.q, placeholder: t('lib.searchAGgufModel'), 'aria-label': t('lib.huggingFaceSearch') });
        query.addEventListener('keydown', event => { if (event.key === 'Enter') { hf.q = query.value.trim(); hubSearch(); } });
        const pipelines = PIPELINES.map(([group, items]) => h('optgroup', { label: group }, items.map(([value, text]) => h('option', { value }, text))));
        const filters = h('div', { class: 'gl-filters' },
            select(pipelines, hf.pipeline, v => { hf.pipeline = v; hubSearch(); }, t('lib.type')),
            select(SORTS.map(([v, t]) => h('option', { value: v }, t)), hf.sort, v => { hf.sort = v; hubSearch(); }, t('lib.sort')),
            select(QUANTS.map(([v, t]) => h('option', { value: v }, t)), hf.quant, v => { hf.quant = v; hubSearch(); }, t('lib.quantization')));
        const sizes = h('div', { class: 'gl-sizes' }, h('span', {}, t('lib.size')), SIZES.map(([min, max, label]) =>
            h('button', { type: 'button', class: hf.min_b === min && hf.max_b === max ? 'active' : '', onclick: () => { hf.min_b = min; hf.max_b = max; hubSearch(); } }, label)));

        let results;
        if (hf.results === null) results = h('p', { class: 'gl-empty' }, t('lib.searchingHuggingFace'));
        else if (hf.error) results = h('p', { class: 'gl-warning' }, hf.error);
        else if (!hf.results.length) results = h('p', { class: 'gl-empty' }, t('lib.noResultsTryOther'));
        else {
            results = h('div', { class: 'gl-list gl-results' }, hf.results.map(m => h('div', { class: `gl-row gl-result ${hf.repo === m.id ? 'open' : ''}`, onclick: () => openRepo(m.id) },
                h('div', { class: 'gl-result-body' },
                    h('div', {}, h('span', { class: 'gl-name' }, m.id), m.size_hint ? h('span', { class: 'gl-size-hint' }, m.size_hint) : null),
                    h('div', { class: 'gl-meta' }, m.capabilities.map(capPill),
                        h('span', {}, `↓ ${count(m.downloads)}`), h('span', {}, t('lib.likes', { n: count(m.likes) })),
                        m.updated ? h('span', {}, new Date(m.updated).toLocaleDateString(locale())) : null,
                        h('a', { href: `https://huggingface.co/${m.id}`, target: '_blank', rel: 'noopener', onclick: event => event.stopPropagation() }, 'HF ↗'))),
                h('span', { class: 'gl-open' }, '›'))));
        }

        let filePanel = null;
        if (hf.repo) {
            const files = hf.files;
            filePanel = h('div', { class: 'gl-files' },
                h('div', { class: 'gl-files-head' }, h('a', { href: `https://huggingface.co/${hf.repo}`, target: '_blank', rel: 'noopener' }, hf.repo, ' ↗'),
                    h('button', { type: 'button', onclick: () => { hf.repo = null; renderHub(); } }, t('lib.back'))),
                files ? h('div', { class: 'gl-meta' }, (files.capabilities || []).map(capPill), files.pipeline ? h('span', {}, files.pipeline) : null) : null,
                h('p', { class: 'gl-hint' }, t('lib.pickAQuantizationQ4')),
                !files ? h('p', { class: 'gl-empty' }, t('lib.readingTheFiles'))
                    : files.error ? h('p', { class: 'gl-warning' }, files.error)
                        : !files.files.length ? h('p', { class: 'gl-empty' }, t('lib.noGgufFileIn2'))
                            : h('div', { class: 'gl-list' }, files.files.map((f, i) => h('div', { class: `gl-row ${i === 0 ? 'best' : ''}` },
                                h('span', { class: 'gl-quant', style: `color:${quantColor(f.quant)}` }, f.quant || '?'),
                                i === 0 ? h('span', { class: 'gl-badge best' }, t('lib.recommended')) : null,
                                f.heavy ? h('span', { class: 'gl-badge heavy', title: t('lib.heavierThanThisMachine') }, t('lib.tooHeavyHere')) : null,
                                h('span', { class: 'gl-name', title: f.name }, f.name), h('span', { class: 'gl-size' }, gb(f.size)),
                                h('button', { type: 'button', class: 'gl-primary', ...guard(),
                                    onclick: () => startDownload({ repo: hf.repo, filename: f.name, size: f.size, capabilities: files.capabilities }) }, t('lib.add'))))));
        }

        const downloads = state.models.filter(m => m.status !== 'ready');
        const downloadList = downloads.length ? h('div', { class: 'gl-downloads' },
            h('h3', {}, t('lib.downloads'),
                downloads.some(m => m.status !== 'downloading')
                    ? h('button', { type: 'button', ...guard(), onclick: () => act(() => Promise.all(downloads.filter(m => m.status !== 'downloading').map(m => tb.removeModel(m.id, false)))) }, t('lib.clearFinished')) : null),
            downloads.map(m => h('div', { class: 'gl-download' },
                h('div', { class: 'gl-row' }, h('strong', { class: 'gl-name' }, m.filename),
                    h('span', { class: `gl-status ${m.status}` }, { downloading: t('lib.inProgress'), error: t('lib.failed', { error: m.error }), cancelled: t('lib.cancelled') }[m.status] || m.status),
                    m.status === 'downloading'
                        ? h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'cancel')) }, t('lib.cancel'))
                        : h('button', { type: 'button', ...guard(), onclick: () => act(() => tb.modelAction(m.id, 'retry')) }, t('lib.resume'))),
                h('div', { class: 'gl-bar' }, h('div', { style: `width:${(m.progress * 100).toFixed(1)}%` })),
                h('small', {}, `${(m.progress * 100).toFixed(1)} % · ${gb(m.downloaded) || `0 ${t('unit.mb')}`} / ${gb(m.size) || '?'}`,
                    m.speed ? t('lib.speedLeft', { speed: (m.speed / 1024 ** 2).toFixed(1), left: duration(m.eta) }) : '')))) : null;

        panels.hub.replaceChildren(h('div', { class: 'gl-search' }, query, h('button', { type: 'button', onclick: () => { hf.q = query.value.trim(); hubSearch(); } }, t('lib.search'))),
            ...[filters, sizes, filePanel || results, downloadList].filter(Boolean));
    }

    // Sans clé : « Choisir mon IA » tant que le Gardien n'a pas de modèle, sinon l'onglet laissé.
    function open(key) {
        modal.hidden = false;
        if (!windowEl.contains(document.activeElement)) windowEl.focus({ preventScroll: true });  // Échap et la saisie restent à la fenêtre, pas à Nodz derrière
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
