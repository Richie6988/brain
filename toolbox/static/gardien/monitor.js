// Tour de contrôle du serveur, comme dans iAqua : CPU, RAM, GPU, VRAM et disque en barres (vert sous
// 60 %, ambre sous 85 %, rouge au-delà), modèle en mémoire et file du broker. Une seule mesure toutes
// les 3 s tant que la page est visible ; chaque vue créée par panel() l'affiche.
// Chaque vue a aussi sa pastille compacte (point du modèle, un anneau de jauge par ressource, stop) : dans l'univers,
// seule la pastille se voit, et un clic déplie le détail (modèle, barres).

import { api } from './api.js';

const PERIOD = 3000;
const ROWS = [['cpu', 'CPU'], ['ram', 'RAM'], ['gpu', 'GPU'], ['vram', 'VRAM'], ['disk', 'Disque']];
const SHORT = { cpu: 'CPU', ram: 'RAM', gpu: 'GPU', vram: 'VRAM', disk: 'DSK' };
const ARC = 2 * Math.PI * 15;  // périmètre de l'anneau (rayon 15 dans une boîte de 36)
const level = p => (p < 60 ? 'ok' : p < 85 ? 'warn' : 'high');
const go = mb => `${(mb / 1024).toFixed(1)} Go`;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function createMonitor({ onSignedOut = () => {} } = {}) {
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
        // Stop : coupe ce que le modèle fait pour toi (demande, préchauffage, tâche de fond, mission), même hors du chat.
        const stopButton = () => {
            const stop = el('button', 'gm-stop', '■');
            Object.assign(stop, { type: 'button', hidden: true, title: 'Arrêter le modèle : ta demande et tes tâches de fond' });
            stop.addEventListener('click', event => {
                event.stopPropagation();  // l'en-tête ouvre Agents & modèles, la pastille déplie le détail
                api.request('POST', 'toolbox/command/stop').catch(() => {});
            });
            return stop;
        };
        const stop = stopButton();
        head.append(dot, name, stop);
        const pill = el('div', 'gm-pill');
        const pillDot = el('span', 'gm-dot');
        const pillStop = stopButton();
        const rings = el('div', 'gm-rings');
        pill.append(pillDot, rings, pillStop);
        pill.addEventListener('click', () => root.classList.toggle('open'));
        const rows = Object.fromEntries(ROWS.map(([key, label]) => {
            const row = el('div', 'gm-row');
            const fill = el('i');
            const bar = el('span', 'gm-bar');
            bar.append(fill);
            const value = el('span', 'gm-value', '--');
            row.append(el('span', 'gm-label', label), bar, value);
            const ring = el('span', 'gm-ring');
            ring.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle cx="18" cy="18" r="15" stroke-dasharray="${ARC.toFixed(2)}" stroke-dashoffset="${ARC.toFixed(2)}"/></svg><b>--</b><small>${SHORT[key]}</small>`;
            rings.append(ring);
            return [key, { row, fill, value, ring }];
        }));
        root.append(pill, head, ...Object.values(rows).map(r => r.row));
        const view = { root, head, dot, name, stop, pillDot, pillStop, rows };
        views.push(view);
        if (last) paint(view, last);
        return view;
    }

    function set(row, percent, title) {
        row.row.hidden = row.ring.hidden = percent == null;
        if (percent == null) return;
        row.fill.style.width = `${Math.min(100, percent)}%`;
        row.fill.className = level(percent);
        row.value.textContent = `${Math.round(percent)} %`;
        row.row.title = row.ring.title = title;
        const arc = row.ring.querySelectorAll('circle')[1];
        arc.setAttribute('stroke-dashoffset', (ARC * (1 - Math.min(100, percent) / 100)).toFixed(2));
        arc.setAttribute('class', level(percent));
        row.ring.querySelector('b').textContent = Math.round(percent);
    }

    function paint(view, data) {
        const { cpu, ram, gpu, disk, model, broker, dispatch, engine } = data;
        set(view.rows.cpu, cpu.percent, `${cpu.cores} cœurs · charge ${cpu.load.join(' ')}`);
        set(view.rows.ram, ram?.percent, ram ? `${go(ram.used_mb)} / ${go(ram.total_mb)}` : '');
        set(view.rows.gpu, gpu?.percent, gpu ? `${gpu.name} · ${gpu.temperature} °C` : '');
        set(view.rows.vram, gpu?.vram_percent, gpu ? `${go(gpu.vram_used_mb)} / ${go(gpu.vram_total_mb)}` : '');
        set(view.rows.disk, disk?.percent, disk ? `${disk.free_gb} Go libres sur ${disk.total_gb} Go` : '');
        view.dot.className = view.pillDot.className = `gm-dot ${model ? (broker.busy ? 'busy' : 'on') : ''}`;
        view.stop.hidden = view.pillStop.hidden = !broker.busy;
        const queue = dispatch.waiting ? ` · ${dispatch.waiting} en file` : '';  // demandes au Gardien en attente
        view.name.textContent = model ? `${model.name}${broker.busy ? ' · au travail' : ''}${queue}`
            : engine ? 'aucun modèle en mémoire' : 'moteur local absent';
        view.pillDot.title = view.name.textContent;
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
        } catch (error) {
            views.forEach(view => view.root.classList.add('offline'));
            if (error.status === 401) {  // la page se croit connectée, le serveur non : on le dit, une fois
                onSignedOut(error.message);
                return;
            }
        }
        timer = setTimeout(tick, PERIOD);
    }

    document.addEventListener('visibilitychange', tick);
    tick();
    return { panel };
}
