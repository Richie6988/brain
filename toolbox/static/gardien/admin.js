// Consoles du compte administrateur, sur les anciens boutons « Nod-Z Data » et « Nod-Z Users » de Nodz
// (js/admin.js les crée et émet « nodz-admin »). Console IA : file du Gardien en direct, modèle en
// mémoire, demandes par jour, journal de tous les comptes, travail planifié. Utilisateurs : comptes,
// usage de l'IA, Gardien actif, droit administrateur, univers d'un compte en lecture.

import { api } from './api.js';
import { h } from './library.js';
import { locale, t } from './i18n.js';

const get = path => api.request('GET', `toolbox/admin/${path}`);
const when = iso => (iso ? new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const day = iso => (iso ? new Date(iso).toLocaleDateString(locale()) : t('adm.never'));

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
    const windowEl = h('div', { class: 'gl-window ga-window ga-console', role: 'dialog', tabindex: '-1' },
        h('header', {}, title, nav, h('button', { type: 'button', class: 'gl-close', onclick: close }, t('adm.close'))), notice, body);
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
            button.textContent = t('adm.confirm');
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
            tabs([['activity', t('adm.activity')], ['log', t('adm.log')], ['planned', t('adm.scheduled')]]);
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
            const totals = data.totals;
            const canvas = chart?.canvas || h('canvas', { 'aria-label': t('adm.guardianRequestsPerDay') });
            const loaded = data.loaded;
            body.replaceChildren(
                h('div', { class: 'ga-tiles' }, tile(t('adm.accountsTile'), totals.users), tile(t('adm.activeOver7Days'), totals.active_week), tile(t('adm.requestsToday'), totals.requests_today),
                    tile(t('adm.requestsOver7Days'), totals.requests_week), tile(t('adm.failuresOver7Days'), totals.errors_week, totals.errors_week ? 'bad' : '')),
                h('div', { class: 'ga-grid' },
                    h('section', { class: 'ga-card' }, h('h3', {}, t('adm.guardianQueue'),
                        h('small', {}, t('adm.runningWaiting', { running: data.dispatcher.running, workers: data.dispatcher.workers, waiting: data.dispatcher.waiting }))),
                    data.queue.length ? h('ol', { class: 'ga-queue' }, data.queue.map(q => h('li', { class: q.running ? 'running' : '' },
                        h('i', {}), q.user, h('small', {}, q.running ? t('adm.running') : t('adm.waiting')))))
                        : h('p', { class: 'gl-empty' }, t('adm.noRequestRunning'))),
                    h('section', { class: 'ga-card' }, h('h3', {}, t('adm.modelInMemory')),
                        loaded ? h('div', { class: 'gl-params' }, h('span', {}, h('b', {}, loaded.label)),
                            loaded.stats ? [h('span', {}, 'REQUÊTES ', h('b', {}, loaded.stats.requests)), h('span', {}, 'JETONS ', h('b', {}, loaded.stats.tokens))] : null,
                            loaded.placement ? [h('span', {}, 'CTX ', h('b', {}, loaded.placement.n_ctx)),
                                h('span', {}, t('adm.gpuLayers'), h('b', {}, `${loaded.placement.gpu_layers}/${loaded.placement.layers || '?'}`))] : null)
                            : h('p', { class: 'gl-empty' }, t('adm.noModelLoadedThe')))),
                h('section', { class: 'ga-card' }, h('h3', {}, t('adm.guardianRequestsLast14')), h('div', { class: 'ga-chart' }, canvas)),
                h('section', { class: 'ga-card' }, h('h3', {}, t('adm.mostActiveAccounts7')),
                    data.top.length ? h('div', { class: 'ga-bars' }, data.top.map(row => h('button', { type: 'button', onclick: () => openLog({ q: row.user }) },
                        h('span', {}, row.user), h('i', { style: `width:${(100 * row.requests / data.top[0].requests).toFixed(0)}%` }), h('b', {}, row.requests))))
                        : h('p', { class: 'gl-empty' }, t('adm.noRequestThisWeek'))));
            drawChart(canvas, data.days);
            poll = setTimeout(activity, 3000);
        } catch (error) {
            report(error);
        }
    }

    function drawChart(canvas, days) {
        const labels = days.map(d => new Date(d.day).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' }));
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
            data: { labels, datasets: [{ label: t('adm.requests'), data: values, backgroundColor: '#6848A6', borderRadius: 5 }] },
            options: { animation: false, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });
    }

    // --- Console IA : journal du Gardien, tous comptes

    function openLog(filter) {
        Object.assign(journal, { q: '', user: '', ...filter, entries: null });
        mode = 'console';
        title.textContent = t('adm.aiConsole');
        show('log');
    }

    async function renderLog() {
        const search = h('input', { type: 'search', value: journal.q, placeholder: t('adm.searchTheLogAccount') });
        search.addEventListener('keydown', event => { if (event.key === 'Enter') { journal.q = search.value.trim(); journal.entries = null; renderLog(); } });
        const head = h('div', { class: 'gl-search' }, search,
            journal.user ? h('button', { type: 'button', onclick: () => openLog({ q: journal.q }) }, t('adm.allAccounts')) : null);
        if (!journal.entries) {
            body.replaceChildren(head, h('p', { class: 'gl-empty' }, t('adm.readingTheLog')));
            try {
                journal.entries = (await get(`log?${new URLSearchParams({ q: journal.q, user: journal.user })}`)).entries;
            } catch (error) {
                return report(error);
            }
        }
        body.replaceChildren(head, journal.entries.length ? h('div', { class: 'ga-table-wrap' }, h('table', { class: 'ga-table' },
            h('thead', {}, h('tr', {}, [t('adm.when'), t('adm.account'), 'Type', t('adm.detail')].map(t => h('th', {}, t)))),
            h('tbody', {}, journal.entries.map(e => h('tr', { class: /échec/.test(e.detail) ? 'bad' : '' },
                h('td', { class: 'nowrap' }, when(e.at)),
                h('td', {}, h('button', { type: 'button', class: 'ga-link', onclick: () => openLog({ user: String(e.user_id) }) }, e.user)),
                h('td', {}, h('span', { class: 'gl-cap' }, e.kind)), h('td', {}, e.detail))))))
            : h('p', { class: 'gl-empty' }, t('adm.nothingInTheLog')));
    }

    // --- Console IA : planifications, missions, tâches de tous les comptes

    async function planned() {
        body.replaceChildren(h('p', { class: 'gl-empty' }, t('adm.reading')));
        let data;
        try {
            data = await get('planned');
        } catch (error) {
            return report(error);
        }
        const table = (heads, rows) => (rows.length ? h('div', { class: 'ga-table-wrap' }, h('table', { class: 'ga-table' },
            h('thead', {}, h('tr', {}, heads.map(t => h('th', {}, t)))), h('tbody', {}, rows))) : h('p', { class: 'gl-empty' }, t('adm.none')));
        body.replaceChildren(
            h('h3', {}, t('adm.schedules')),
            table(['', t('adm.account'), t('adm.when'), t('adm.title'), t('adm.lastStart')], data.schedules.map(s => {
                const box = h('input', { type: 'checkbox', checked: s.enabled, title: s.enabled ? t('adm.active') : t('adm.paused') });
                box.addEventListener('change', () => api.request('PATCH', `toolbox/admin/schedules/${s.id}`, { enabled: box.checked })
                    .then(() => ok(`${s.ref} ${box.checked ? 'réactivée' : 'en pause'}`), report));
                return h('tr', {}, h('td', {}, box), h('td', {}, s.user), h('td', {}, h('code', {}, s.expr)), h('td', {}, `${s.ref} · ${s.title}`), h('td', {}, day(s.last)));
            })),
            h('h3', {}, t('adm.missions')),
            table([t('adm.account'), t('adm.mission'), t('adm.rounds'), t('adm.state'), ''], data.missions.map(m => h('tr', {}, h('td', {}, m.user), h('td', {}, `${m.ref} · ${m.goal}`),
                h('td', {}, `${m.iterations}/${m.budget}`), h('td', {}, h('span', { class: `gl-cap ${m.status}` }, m.status)),
                h('td', {}, m.status === 'running' ? twoStep(t('adm.stop'), () => api.request('POST', `toolbox/admin/missions/${m.id}/stop`)
                    .then(() => { ok(t('adm.stopped', { ref: m.ref })); planned(); }, report), { class: 'gl-danger' }) : null)))),
            h('h3', {}, t('adm.openTasks')),
            table([t('adm.account'), t('adm.task'), t('adm.priority'), t('adm.state')], data.tasks.map(task => h('tr', {}, h('td', {}, task.user), h('td', {}, `${task.ref} · ${task.title}`),
                h('td', {}, task.priority), h('td', {}, task.status)))));
    }

    // --- Utilisateurs

    const FILTERS = [['all', t('adm.all')], ['staff', t('adm.administrators')], ['guardian', t('adm.guardianOn')], ['active', t('adm.active7D')]];
    const COLUMNS = [['email', t('adm.account')], ['joined', t('adm.joined')], ['last_login', t('adm.lastLogin')], ['nodes', 'Nodes'], ['requests_week', t('adm.requests7D')],
        ['guardian', t('adm.guardian')], ['staff', 'Admin'], ['', '']];

    async function renderUsers() {
        if (!users) {
            body.replaceChildren(h('p', { class: 'gl-empty' }, t('adm.readingTheAccounts')));
            try {
                ({ users, me } = await get('users'));
            } catch (error) {
                return report(error);
            }
        }
        const search = h('input', { type: 'search', value: list.q, placeholder: t('adm.nameEMailCountry') });
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
            counter.textContent = t(rows.length > 1 ? 'adm.accountsN' : 'adm.accounts1', { n: rows.length, total: users.length });
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
            title: u.guardian ? t('adm.model', { model: u.guardian.model || t('adm.noModel') }) : t('adm.noGuardianYetIt') });
        guardian.addEventListener('change', () => patchUser(u, { guardian: guardian.checked }, t(guardian.checked ? 'adm.guardianTurnedOn' : 'adm.guardianTurnedOff', { email: u.email })));
        const self = u.id === me;
        return h('tr', {},
            h('td', {}, h('strong', {}, u.email || u.username), h('small', {}, [u.username, u.country, u.premium ? 'premium' : ''].filter(Boolean).join(' · '))),
            h('td', { class: 'nowrap' }, day(u.joined)), h('td', { class: 'nowrap' }, u.last_login ? when(u.last_login) : t('adm.never')),
            h('td', {}, u.nodes), h('td', {}, u.requests_week), h('td', {}, guardian),
            h('td', {}, u.staff ? h('span', { class: 'gl-badge loaded' }, 'ADMIN') : null),
            h('td', { class: 'ga-actions' },
                h('button', { type: 'button', onclick: () => watch(u) }, t('adm.seeTheirUniverse')),
                h('button', { type: 'button', onclick: () => openLog({ user: String(u.id) }) }, t('adm.log')),
                self ? null : twoStep(u.staff ? t('adm.removeAdmin') : t('adm.makeAdmin'),
                    () => patchUser(u, { staff: !u.staff }, `${u.email} ${u.staff ? "n'est plus administrateur" : 'est administrateur'}`),
                    { class: u.staff ? 'gl-danger' : '' })));
    }

    // --- Univers d'un compte, en lecture (adminload de Nodz ; save() ne fait rien pendant ce temps)

    const banner = h('div', { id: 'ga-watching', hidden: true });
    document.body.append(banner);
    function watch(u) {
        close();
        adminload(u.id, 1);
        banner.replaceChildren(h('span', {}, t('adm.universeOfReadOnly', { v: u.email || u.username })),
            h('button', { type: 'button', onclick: unwatch }, t('adm.backToMyUniverse')));
        banner.hidden = false;
        say(t('adm.universeOfNothingIs', { v: u.email || u.username }), 'notice');
    }
    function unwatch() {
        banner.hidden = true;
        admin = false;
        load(0);
    }

    function open(panel) {
        mode = panel === 'users' ? 'users' : 'console';
        title.textContent = mode === 'users' ? t('adm.users') : t('adm.aiConsole');
        windowEl.setAttribute('aria-label', title.textContent);
        ok('');
        users = null;
        journal.entries = null;
        modal.hidden = false;
        if (!windowEl.contains(document.activeElement)) windowEl.focus({ preventScroll: true });  // Échap et la saisie restent à la fenêtre, pas à Nodz derrière
        show(mode === 'users' ? 'users' : 'activity');
    }
    function close() {
        modal.hidden = true;
        clearTimeout(poll);
    }

    document.addEventListener('nodz-admin', event => open(event.detail));
    return { open, close };
}
