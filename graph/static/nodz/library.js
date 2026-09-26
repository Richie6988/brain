// Bibliothèque : agents (chacun branché sur un modèle local) et modèles Hugging Face.
// Téléchargement et suppression des modèles réservés au staff (partagés par tout le serveur).

import { api } from './api.js';

const tb = api.toolbox;

function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    });
    node.append(...children.flat().filter(c => c != null));
    return node;
}

const size = bytes => (bytes ? `${(bytes / 1e9).toFixed(1)} Go` : '');

export function bindLibrary() {
    const panel = document.getElementById('library');
    const $ = id => document.getElementById(id);
    let staff = false;
    let models = [];
    let poll = null;

    function report(error) {
        $('library-state').textContent = error.message;
    }

    // Suppression en deux temps, sans confirm() natif.
    function confirmButton(label, action) {
        const button = h('button', { type: 'button' }, label);
        button.addEventListener('click', () => {
            if (button.dataset.armed) action().catch(report);
            else {
                button.dataset.armed = '1';
                button.textContent = 'Confirmer';
                setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
            }
        });
        return button;
    }

    async function renderAgents() {
        const { agents } = await tb.agents();
        const ready = models.filter(m => m.status === 'ready' && m.kind === 'text');
        $('agent-list').replaceChildren(...agents.map(agent => {
            const select = h('select', { 'aria-label': `Modèle de ${agent.name}`, disabled: agent.role === 'image' },
                h('option', { value: '' }, agent.role === 'image' ? 'Génération d\'images à venir' : 'Aucun modèle'),
                ready.map(m => h('option', { value: m.id, selected: m.id === agent.model }, `${m.repo.split('/')[1]} ${m.quant}`)));
            select.addEventListener('change', () => tb.updateAgent(agent.id, { model: select.value || null }).catch(report));
            return h('li', {}, h('div', {}, h('strong', {}, agent.name), h('small', {}, agent.description)), select);
        }));
    }

    function renderModels() {
        $('model-list').replaceChildren(...(models.length ? models.map(m => h('li', {},
            h('div', {}, h('strong', {}, `${m.repo.split('/')[1]} ${m.quant}`),
                h('small', {}, m.status === 'downloading' ? `Téléchargement ${Math.round(m.progress * 100)} %`
                    : m.status === 'error' ? `Erreur : ${m.error}` : [size(m.size), m.loaded ? 'chargé' : ''].filter(Boolean).join(' · '))),
            staff ? confirmButton('Supprimer', async () => { await tb.deleteModel(m.id); await refresh(); }) : null,
        )) : [h('li', { class: 'empty' }, staff ? 'Aucun modèle : choisis-en un ci-dessous.' : 'Aucun modèle installé.')]));
    }

    async function refresh() {
        ({ models } = await tb.models());
        renderModels();
        await renderAgents();
        clearTimeout(poll);
        if (!panel.hidden && models.some(m => m.status === 'downloading')) poll = setTimeout(() => refresh().catch(report), 2000);
    }

    async function download(file) {
        await tb.download(file);
        await refresh();
    }

    function fileItem(repo, file, why = '') {
        return h('li', {}, h('div', {}, h('strong', {}, file.name || file.filename), h('small', {}, [file.quant, size(file.size), why].filter(Boolean).join(' · '))),
            h('button', { type: 'button', onclick: () => download({ repo, filename: file.name || file.filename, size: file.size || 0 }).catch(report) }, 'Télécharger'));
    }

    async function showFiles(repo, item) {
        const { files, capabilities } = await tb.files(repo);
        item.querySelector('button').disabled = true;
        item.after(...files.slice(0, 6).map(f => {
            const li = fileItem(repo, f, f.recommended ? 'recommandé' : '');
            li.classList.add('file');
            return li;
        }));
        if (capabilities.length) item.querySelector('small').textContent += ` · ${capabilities.join(', ')}`;
    }

    async function search(event) {
        event.preventDefault();
        const form = event.target;
        $('hub-results').replaceChildren(h('li', { class: 'empty' }, 'Recherche…'));
        const { models: found } = await tb.search(form.q.value, form.sort.value);
        $('hub-results').replaceChildren(...(found.length ? found.map(m => {
            const item = h('li', {}, h('div', {}, h('strong', {}, m.id), h('small', {}, [m.role, m.size_b ? `${m.size_b}B` : '', `${m.downloads} téléchargements`].filter(Boolean).join(' · '))));
            item.append(h('button', { type: 'button', onclick: () => showFiles(m.id, item).catch(report) }, 'Fichiers'));
            return item;
        }) : [h('li', { class: 'empty' }, 'Aucun résultat.')]));
    }

    async function open() {
        panel.hidden = false;
        $('library-state').textContent = '';
        const status = await tb.status();
        staff = status.staff;
        $('library-engine').textContent = status.engine
            ? (status.broker.busy ? `Moteur occupé (${status.broker.holder})` : 'Moteur local prêt')
            : 'Moteur local absent : installer requirements-ai.txt sur le serveur';
        $('hub').hidden = !staff;
        if (staff) {
            const rec = await tb.recommendations();
            $('recommended').replaceChildren(...rec.models.map(m => fileItem(m.repo, { filename: m.filename, size: m.size_gb * 1e9 }, m.why)));
        }
        await refresh();
    }

    $('library-toggle').addEventListener('click', () => (panel.hidden ? open().catch(report) : (panel.hidden = true)));
    $('library-close').addEventListener('click', () => { panel.hidden = true; });
    $('hub-search').addEventListener('submit', event => search(event).catch(report));
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') panel.hidden = true; });
}
