// Tour de contrôle du serveur, comme dans iAqua : CPU, RAM, GPU, VRAM et disque en barres (vert sous
// 60 %, ambre sous 85 %, rouge au-delà), modèle en mémoire et file du broker. Une seule mesure toutes
// les 3 s tant que la page est visible ; chaque vue créée par panel() l'affiche.

import { api } from '../nodz/api.js';

const PERIOD = 3000;
const ROWS = [['cpu', 'CPU'], ['ram', 'RAM'], ['gpu', 'GPU'], ['vram', 'VRAM'], ['disk', 'Disque']];
const level = p => (p < 60 ? 'ok' : p < 85 ? 'warn' : 'high');
const go = mb => `${(mb / 1024).toFixed(1)} Go`;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function createMonitor() {
    const views = [];
    let last = null;
    let timer = null;

    // Une vue : en-tête (pastille du modèle + nom) puis une ligne par ressource.
    function panel(className = '') {
        const root = el('div', `gm ${className}`.trim());
        root.hidden = !last;  // visible dès la première mesure
        const head = el('div', 'gm-head');
        const dot = el('span', 'gm-dot');
        const name = el('span', 'gm-name', '…');
        head.append(dot, name);
        const rows = Object.fromEntries(ROWS.map(([key, label]) => {
            const row = el('div', 'gm-row');
            const fill = el('i');
            const bar = el('span', 'gm-bar');
            bar.append(fill);
            const value = el('span', 'gm-value', '--');
            row.append(el('span', 'gm-label', label), bar, value);
            return [key, { row, fill, value }];
        }));
        root.append(head, ...Object.values(rows).map(r => r.row));
        const view = { root, head, dot, name, rows };
        views.push(view);
        if (last) paint(view, last);
        return view;
    }

    function set(row, percent, title) {
        row.row.hidden = percent == null;
        if (percent == null) return;
        row.fill.style.width = `${Math.min(100, percent)}%`;
        row.fill.className = level(percent);
        row.value.textContent = `${Math.round(percent)} %`;
        row.row.title = title;
    }

    function paint(view, data) {
        const { cpu, ram, gpu, disk, model, broker, dispatch, engine } = data;
        set(view.rows.cpu, cpu.percent, `${cpu.cores} cœurs · charge ${cpu.load.join(' ')}`);
        set(view.rows.ram, ram?.percent, ram ? `${go(ram.used_mb)} / ${go(ram.total_mb)}` : '');
        set(view.rows.gpu, gpu?.percent, gpu ? `${gpu.name} · ${gpu.temperature} °C` : '');
        set(view.rows.vram, gpu?.vram_percent, gpu ? `${go(gpu.vram_used_mb)} / ${go(gpu.vram_total_mb)}` : '');
        set(view.rows.disk, disk?.percent, disk ? `${disk.free_gb} Go libres sur ${disk.total_gb} Go` : '');
        view.dot.className = `gm-dot ${model ? (broker.busy ? 'busy' : 'on') : ''}`;
        const queue = dispatch.waiting ? ` · ${dispatch.waiting} en file` : '';  // demandes au Gardien en attente
        view.name.textContent = model ? `${model.name}${broker.busy ? ' · au travail' : ''}${queue}`
            : engine ? 'aucun modèle en mémoire' : 'moteur local absent';
        view.head.title = `${model?.stats ? `${model.stats.requests} requêtes depuis le chargement · ` : ''}Ouvrir Agents & modèles`;
        view.root.hidden = false;
        view.root.classList.remove('offline');
    }

    async function tick() {
        clearTimeout(timer);
        if (document.hidden) return;
        if (!isLoggedIn) { timer = setTimeout(tick, 1000); return; }  // globale de Nodz : rien avant la connexion
        try {
            last = await api.request('GET', 'toolbox/system');
            views.forEach(view => paint(view, last));
        } catch {
            views.forEach(view => view.root.classList.add('offline'));
        }
        timer = setTimeout(tick, PERIOD);
    }

    document.addEventListener('visibilitychange', tick);
    tick();
    return { panel };
}
