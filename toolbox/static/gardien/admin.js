// Consoles du compte administrateur, sur les anciens boutons « Nod-Z Data » et « Nod-Z Users » de Nodz
// (js/admin.js les crée et émet « nodz-admin »). Console IA : file du Gardien en direct, modèle en
// mémoire, demandes par jour, journal de tous les comptes, travail planifié. Utilisateurs : comptes,
// usage de l'IA, Gardien actif, droit administrateur, univers d'un compte en lecture.

import { api } from './api.js';
import { h } from './library.js';

const get = path => api.request('GET', `toolbox/admin/${path}`);
const when = iso => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const day = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR') : 'jamais');

export function createAdmin({ say }) {
    let mode = 'console';
    let tab = 'activity';
    let poll = null;
    let chart = null;
    let users = null;
    let me = null;
    const journal = { q: '', user: '', entries: null };
    const list = { q: '', filter: 'all', sort: 'joined', desc: true };

    const title = h('h2', {});
    const nav = h('nav', { class: 'gl-tabs' });
    const notice = h('p', { class: 'gl-notice', role: 'status' });
    const body = h('div', { class: 'ga-body' });
    const windowEl = h('div', { class: 'gl-window ga-window', role: 'dialog' },
        h('header', {}, title, nav, h('button', { type: 'button', class: 'gl-close', onclick: close }, 'Fermer')), notice, body);
    const modal = h('div', { class: 'gl-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, windowEl);
    modal.addEventListener('keydown', event => {
        event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
        if (event.key === 'Escape') close();
    });
    document.body.append(modal);

    const report = error => { notice.textContent = error.message; notice.classList.add('error'); };
    const ok = text => { notice.textContent = text; notice.classList.remove('error'); };

    // Changement sensible en deux temps, sans confirm() natif.
    function twoStep(label, run, attrs = {}) {
        const button = h('button', { type: 'button', ...attrs }, label);
        button.addEventListener('click', () => {
            if (button.dataset.armed) return run();
            button.dataset.armed = '1';
            button.textContent = 'Confirmer';
            setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
        });
        return button;
    }

    function tabs(items) {
        nav.replaceChildren(...items.map(([key, label]) => h('button', { type: 'button', class: key === tab ? 'active' : '', onclick: () => show(key) }, label)));
    }

    function show(key) {
        tab = key;
        clearTimeout(poll);
        if (mode === 'console') {
            tabs([['activity', 'Activité'], ['log', 'Journal'], ['planned', 'Planifié']]);
            ({ activity, log: renderLog, planned })[tab]();
        } else {
            tabs([]);
            renderUsers();
        }
    }

    // --- Console IA : activité en direct

    const tile = (label, value, tone = '') => h('div', { class: `ga-tile ${tone}` }, h('b', {}, String(value)), h('span', {}, label));

    async function activity() {
        try {
            const data = await get('overview');
            if (modal.hidden || mode !== 'console' || tab !== 'activity') return;
            const t = data.totals;
            const canvas = chart?.canvas || h('canvas', { 'aria-label': 'Demandes au Gardien par jour' });
            const loaded = data.loaded;
            body.replaceChildren(
                h('div', { class: 'ga-tiles' }, tile('comptes', t.users), tile('actifs sur 7 jours', t.active_week), tile("demandes aujourd'hui", t.requests_today),
                    tile('demandes sur 7 jours', t.requests_week), tile('échecs sur 7 jours', t.errors_week, t.errors_week ? 'bad' : '')),
                h('div', { class: 'ga-grid' },
                    h('section', { class: 'ga-card' }, h('h3', {}, 'File du Gardien',
                        h('small', {}, `${data.dispatcher.running}/${data.dispatcher.workers} en cours · ${data.dispatcher.waiting} en attente`)),
                    data.queue.length ? h('ol', { class: 'ga-queue' }, data.queue.map(q => h('li', { class: q.running ? 'running' : '' },
                        h('i', {}), q.user, h('small', {}, q.running ? 'en cours' : 'en attente'))))
                        : h('p', { class: 'gl-empty' }, 'Aucune demande en cours.')),
                    h('section', { class: 'ga-card' }, h('h3', {}, 'Modèle en mémoire'),
                        loaded ? h('div', { class: 'gl-params' }, h('span', {}, h('b', {}, loaded.label)),
                            loaded.stats ? [h('span', {}, 'REQUÊTES ', h('b', {}, loaded.stats.requests)), h('span', {}, 'JETONS ', h('b', {}, loaded.stats.tokens))] : null,
                            loaded.placement ? [h('span', {}, 'CTX ', h('b', {}, loaded.placement.n_ctx)),
                                h('span', {}, 'COUCHES GPU ', h('b', {}, `${loaded.placement.gpu_layers}/${loaded.placement.layers || '?'}`))] : null)
                            : h('p', { class: 'gl-empty' }, 'Aucun modèle chargé : le premier appel le charge.'))),
                h('section', { class: 'ga-card' }, h('h3', {}, 'Demandes au Gardien, 14 derniers jours'), h('div', { class: 'ga-chart' }, canvas)),
                h('section', { class: 'ga-card' }, h('h3', {}, 'Comptes les plus actifs (7 jours)'),
                    data.top.length ? h('div', { class: 'ga-bars' }, data.top.map(row => h('button', { type: 'button', onclick: () => openLog({ q: row.user }) },
                        h('span', {}, row.user), h('i', { style: `width:${(100 * row.requests / data.top[0].requests).toFixed(0)}%` }), h('b', {}, row.requests))))
                        : h('p', { class: 'gl-empty' }, 'Aucune demande cette semaine.')));
            drawChart(canvas, data.days);
            poll = setTimeout(activity, 3000);
        } catch (error) {
            report(error);
        }
    }

    function drawChart(canvas, days) {
        const labels = days.map(d => new Date(d.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
        const values = days.map(d => d.requests);
        if (chart) {
            chart.data.labels = labels;
            chart.data.datasets[0].data = values;
            chart.update('none');
            return;
        }
        if (typeof Chart === 'undefined') return;
        chart = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Demandes', data: values, backgroundColor: '#6848A6', borderRadius: 5 }] },
            options: { animation: false, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });
    }

    // --- Console IA : journal du Gardien, tous comptes

    function openLog(filter) {
        Object.assign(journal, { q: '', user: '', ...filter, entries: null });
        mode = 'console';
        title.textContent = 'Console IA';
        show('log');
    }

    async function renderLog() {
        const search = h('input', { type: 'search', value: journal.q, placeholder: 'Chercher dans le journal (compte, demande, outil)…' });
        search.addEventListener('keydown', event => { if (event.key === 'Enter') { journal.q = search.value.trim(); journal.entries = null; renderLog(); } });
        const head = h('div', { class: 'gl-search' }, search,
            journal.user ? h('button', { type: 'button', onclick: () => openLog({ q: journal.q }) }, 'Tous les comptes') : null);
        if (!journal.entries) {
            body.replaceChildren(head, h('p', { class: 'gl-empty' }, 'Lecture du journal…'));
            try {
                journal.entries = (await get(`log?${new URLSearchParams({ q: journal.q, user: journal.user })}`)).entries;
            } catch (error) {
                return report(error);
            }
        }
        body.replaceChildren(head, journal.entries.length ? h('div', { class: 'ga-table-wrap' }, h('table', { class: 'ga-table' },
            h('thead', {}, h('tr', {}, ['Quand', 'Compte', 'Type', 'Détail'].map(t => h('th', {}, t)))),
            h('tbody', {}, journal.entries.map(e => h('tr', { class: /échec/.test(e.detail) ? 'bad' : '' },
                h('td', { class: 'nowrap' }, when(e.at)),
                h('td', {}, h('button', { type: 'button', class: 'ga-link', onclick: () => openLog({ user: String(e.user_id) }) }, e.user)),
                h('td', {}, h('span', { class: 'gl-cap' }, e.kind)), h('td', {}, e.detail))))))
            : h('p', { class: 'gl-empty' }, 'Rien dans le journal.'));
    }

    // --- Console IA : planifications, missions, tâches de tous les comptes

    async function planned() {
        body.replaceChildren(h('p', { class: 'gl-empty' }, 'Lecture…'));
        let data;
        try {
            data = await get('planned');
        } catch (error) {
            return report(error);
        }
        const table = (heads, rows) => (rows.length ? h('div', { class: 'ga-table-wrap' }, h('table', { class: 'ga-table' },
            h('thead', {}, h('tr', {}, heads.map(t => h('th', {}, t)))), h('tbody', {}, rows))) : h('p', { class: 'gl-empty' }, 'Aucun.'));
        body.replaceChildren(
            h('h3', {}, 'Planifications'),
            table(['', 'Compte', 'Quand', 'Titre', 'Dernier départ'], data.schedules.map(s => {
                const box = h('input', { type: 'checkbox', checked: s.enabled, title: s.enabled ? 'Active' : 'En pause' });
                box.addEventListener('change', () => api.request('PATCH', `toolbox/admin/schedules/${s.id}`, { enabled: box.checked })
                    .then(() => ok(`${s.ref} ${box.checked ? 'réactivée' : 'en pause'}`), report));
                return h('tr', {}, h('td', {}, box), h('td', {}, s.user), h('td', {}, h('code', {}, s.expr)), h('td', {}, `${s.ref} · ${s.title}`), h('td', {}, day(s.last)));
            })),
            h('h3', {}, 'Missions'),
            table(['Compte', 'Mission', 'Tours', 'État', ''], data.missions.map(m => h('tr', {}, h('td', {}, m.user), h('td', {}, `${m.ref} · ${m.goal}`),
                h('td', {}, `${m.iterations}/${m.budget}`), h('td', {}, h('span', { class: `gl-cap ${m.status}` }, m.status)),
                h('td', {}, m.status === 'running' ? twoStep('Arrêter', () => api.request('POST', `toolbox/admin/missions/${m.id}/stop`)
                    .then(() => { ok(`${m.ref} arrêtée`); planned(); }, report), { class: 'gl-danger' }) : null)))),
            h('h3', {}, 'Tâches ouvertes'),
            table(['Compte', 'Tâche', 'Priorité', 'État'], data.tasks.map(t => h('tr', {}, h('td', {}, t.user), h('td', {}, `${t.ref} · ${t.title}`),
                h('td', {}, t.priority), h('td', {}, t.status)))));
    }

    // --- Utilisateurs

    const FILTERS = [['all', 'Tous'], ['staff', 'Administrateurs'], ['guardian', 'Gardien actif'], ['active', 'Actifs 7 j']];
    const COLUMNS = [['email', 'Compte'], ['joined', 'Inscrit'], ['last_login', 'Connexion'], ['nodes', 'Nodes'], ['requests_week', 'Demandes 7 j'],
        ['guardian', 'Gardien'], ['staff', 'Admin'], ['', '']];

    async function renderUsers() {
        if (!users) {
            body.replaceChildren(h('p', { class: 'gl-empty' }, 'Lecture des comptes…'));
            try {
                ({ users, me } = await get('users'));
            } catch (error) {
                return report(error);
            }
        }
        const search = h('input', { type: 'search', value: list.q, placeholder: 'Nom, e-mail, pays…' });
        search.addEventListener('input', () => { list.q = search.value.trim().toLowerCase(); drawRows(); });
        const chips = h('div', { class: 'gl-sizes' }, FILTERS.map(([key, label]) =>
            h('button', { type: 'button', class: list.filter === key ? 'active' : '', onclick: () => { list.filter = key; renderUsers(); } }, label)));
        const tbody = h('tbody', {});
        const counter = h('small', { class: 'gl-hint' });
        const sortBy = key => { list.desc = list.sort === key ? !list.desc : true; list.sort = key; renderUsers(); };
        function drawRows() {
            const rows = users.filter(u => (list.filter === 'staff' ? u.staff : list.filter === 'guardian' ? u.guardian?.enabled
                : list.filter === 'active' ? u.requests_week > 0 : true))
                .filter(u => !list.q || `${u.email} ${u.username} ${u.country}`.toLowerCase().includes(list.q))
                .sort((a, b) => {
                    const va = list.sort === 'guardian' ? Number(!!a.guardian?.enabled) : a[list.sort] ?? '';
                    const vb = list.sort === 'guardian' ? Number(!!b.guardian?.enabled) : b[list.sort] ?? '';
                    return (va > vb ? 1 : va < vb ? -1 : 0) * (list.desc ? -1 : 1);
                });
            counter.textContent = `${rows.length} compte${rows.length > 1 ? 's' : ''} sur ${users.length}`;
            tbody.replaceChildren(...rows.map(userRow));
        }
        body.replaceChildren(h('div', { class: 'gl-search' }, search), chips, counter,
            h('div', { class: 'ga-table-wrap' }, h('table', { class: 'ga-table' },
                h('thead', {}, h('tr', {}, COLUMNS.map(([key, label]) => h('th', key ? { class: 'sortable', onclick: () => sortBy(key) } : {},
                    label, list.sort === key && key ? (list.desc ? ' ↓' : ' ↑') : '')))), tbody)));
        drawRows();
    }

    async function patchUser(u, fields, message) {
        try {
            const { user } = await api.request('PATCH', `toolbox/admin/users/${u.id}`, fields);
            users = users.map(x => (x.id === user.id ? user : x));
            ok(message);
        } catch (error) {
            report(error);
        }
        renderUsers();
    }

    function userRow(u) {
        const guardian = h('input', { type: 'checkbox', checked: !!u.guardian?.enabled, disabled: !u.guardian,
            title: u.guardian ? `Modèle : ${u.guardian.model || 'aucun'}` : "Pas encore de Gardien (il en reçoit un en ouvrant Agents & modèles)" });
        guardian.addEventListener('change', () => patchUser(u, { guardian: guardian.checked }, `Gardien de ${u.email} ${guardian.checked ? 'activé' : 'coupé'}`));
        const self = u.id === me;
        return h('tr', {},
            h('td', {}, h('strong', {}, u.email || u.username), h('small', {}, [u.username, u.country, u.premium ? 'premium' : ''].filter(Boolean).join(' · '))),
            h('td', { class: 'nowrap' }, day(u.joined)), h('td', { class: 'nowrap' }, u.last_login ? when(u.last_login) : 'jamais'),
            h('td', {}, u.nodes), h('td', {}, u.requests_week), h('td', {}, guardian),
            h('td', {}, u.staff ? h('span', { class: 'gl-badge loaded' }, 'ADMIN') : null),
            h('td', { class: 'ga-actions' },
                h('button', { type: 'button', onclick: () => watch(u) }, 'Voir son univers'),
                h('button', { type: 'button', onclick: () => openLog({ user: String(u.id) }) }, 'Journal'),
                self ? null : twoStep(u.staff ? 'Retirer admin' : 'Rendre admin',
                    () => patchUser(u, { staff: !u.staff }, `${u.email} ${u.staff ? "n'est plus administrateur" : 'est administrateur'}`),
                    { class: u.staff ? 'gl-danger' : '' })));
    }

    // --- Univers d'un compte, en lecture (adminload de Nodz ; save() ne fait rien pendant ce temps)

    const banner = h('div', { id: 'ga-watching', hidden: true });
    document.body.append(banner);
    function watch(u) {
        close();
        adminload(u.id, 1);
        banner.replaceChildren(h('span', {}, `Univers de ${u.email || u.username}, en lecture`),
            h('button', { type: 'button', onclick: unwatch }, 'Revenir à mon univers'));
        banner.hidden = false;
        say(`Univers de ${u.email || u.username} : rien n'est enregistré tant que tu le regardes.`, 'notice');
    }
    function unwatch() {
        banner.hidden = true;
        admin = false;
        load(0);
    }

    function open(panel) {
        mode = panel === 'users' ? 'users' : 'console';
        title.textContent = mode === 'users' ? 'Utilisateurs' : 'Console IA';
        windowEl.setAttribute('aria-label', title.textContent);
        ok('');
        users = null;
        journal.entries = null;
        modal.hidden = false;
        show(mode === 'users' ? 'users' : 'activity');
    }
    function close() {
        modal.hidden = true;
        clearTimeout(poll);
    }

    document.addEventListener('nodz-admin', event => open(event.detail));
    return { open, close };
}
