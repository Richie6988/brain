// Rappels : une date posée sur un node (calendrier de Nodz, panneau ci-dessous, ou le Gardien : op remind). Trois
// choses autour :
// - compte à rebours : un badge au-dessus de chaque node à rappel de la dimension ouverte (« dans 2 h », « J-3 »), qui
//   pulse dans la dernière heure et passe au rouge à l'échéance ;
// - notification à l'échéance, page ouverte : une carte (Aller, +10 min, Fait), un carillon, et la notification du
//   navigateur si elle est permise ; les rappels échus pendant l'absence sont annoncés une fois, ensemble ;
// - panneau de la cloche : tous les rappels de toutes les dimensions (la cloche de Nodz ne chargeait que la semaine
//   à venir et faisait défiler les nodes), échus et à venir, avec voyage, report et retrait.
// Dans la dimension ouverte, l'attribut `notification` du node fait foi (sauvé par save() de Nodz) ; ailleurs, la route
// toolbox/reminders lit et écrit la base.

import { api } from './api.js';
import { h } from './library.js';
import { locale, t } from './i18n.js';

const TICK = 15000;        // ms entre deux vérifications des échéances
const SOON = 3600e3;       // dernière heure : le badge pulse
const SEEN = 'gardien-reminders-seen';  // rappels déjà notifiés (id@date), pour ne pas les annoncer deux fois

const pad = n => String(n).padStart(2, '0');
const nodz = d => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromNodz = text => {
    const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/.exec(text || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
};
const fromIso = text => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

// Le temps qui reste, en mots courts : « dans 12 min », « dans 3 h », « J-3 » ; passé : « il y a 5 min », « échu ».
export function countdown(date, now = Date.now()) {
    const ms = date - now, abs = Math.abs(ms), min = Math.round(abs / 60e3);
    const span = min < 1 ? t('rem.underMin') : min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : null;
    if (ms >= 0) return span ? t('rem.in', { span }) : t('rem.days', { n: Math.ceil(ms / 864e5) });
    return span ? t('time.ago', { span }) : t('rem.due');
}

const when = date => date.toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function createReminders({ bridge, say, sfx }) {
    let items = [];       // tous les rappels : { id, layer, dimension, at: Date, text }
    let seen = new Set();
    try {
        seen = new Set(JSON.parse(localStorage.getItem(SEEN) || '[]'));
    } catch { /* stockage indisponible : rien de vu */ }
    const remember = () => {
        try {
            localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-300)));
        } catch { /* stockage indisponible */ }
    };
    const key = item => `${item.id}@${iso(item.at)}`;
    const textOf = node => (node.children[0]?.children[0]?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) || t('tour.emptyNode');
    // Nodz tient la dimension ouverte tantôt en nombre, tantôt en texte : comparée en nombre, sinon un rappel venait deux fois.
    const current = () => Number(layerNumber);
    const here = item => Number(item.layer) === current();
    const layerName = () => (typeof layers !== 'undefined' && layers.find(l => Number(l.id) === current())?.name) || String(layerNumber);

    // --- La liste : la base pour les autres dimensions, la page pour celle-ci.
    function local() {
        return [...document.querySelectorAll('.node-group[notification]')].map(node => {
            const at = fromNodz(node.getAttribute('notification'));
            return at && { id: node.id, layer: current(), dimension: layerName(), at, text: textOf(node) };
        }).filter(Boolean);
    }
    function merge(stored) {
        const mine = local(), seen = new Set(mine.map(r => r.id));  // un node, un rappel : la page prime sur la base
        items = [...stored.filter(r => !here(r) && !seen.has(r.id)).map(r => ({ ...r, at: fromIso(r.at) })).filter(r => r.at), ...mine]
            .sort((a, b) => a.at - b.at);
        paint();
    }
    let loading = null;
    function refresh() {
        loading ||= api.request('GET', 'toolbox/reminders').then(data => merge(data.reminders || []))
            .catch(() => merge(items.filter(r => !here(r)).map(r => ({ ...r, at: iso(r.at) }))))
            .finally(() => { loading = null; });
        return loading;
    }

    // --- Poser, déplacer, retirer : dans la page (comme le calendrier de Nodz) ou en base.
    async function set(item, date) {
        const node = here(item) && document.getElementById(item.id);
        if (node) {
            node.setAttribute('notification', date ? nodz(date) : '');
            node.tools?.type?.children[6]?.children[0]?.setAttribute('src', `${NODZ_BASE}/static/img/${date ? 'notification' : 'calendar'}.svg`);
            save(node);
        } else {
            await api.request('POST', 'toolbox/reminders', { ref: item.id, at: date ? iso(date) : '' });
        }
        await refresh();
    }
    const go = item => bridge.perform({ op: 'goto', ref: item.id, layer: item.layer }).catch(() => say(`${item.id} n'existe plus`, 'error'));

    // Op du Gardien : sur un node de la page, la page pose le rappel ; écrit en base (autre dimension), elle relit.
    bridge.define('remind', async ({ ref, at, stored }) => {
        if (stored) return refresh();
        const node = document.getElementById(bridge.idOf(ref));
        if (!node) throw new Error(`remind : ${ref} n'est pas dans cette dimension`);
        return set({ id: node.id, layer: current() }, at ? fromIso(at) : null);
    });

    // --- Compte à rebours sur les nodes de la dimension ouverte.
    const badges = h('div', { id: 'gardien-countdowns', 'aria-hidden': 'true' });
    document.body.append(badges);
    let frame = 0;
    function place() {
        frame = 0;
        const hidden = document.body.classList.contains('gardien-side-on');
        let any = false;
        for (const badge of badges.children) {
            const node = document.getElementById(badge.dataset.id);
            const shape = node && (node.getAttribute('shape') === 'square' ? node.children[2] : node.children[1]);
            const r = shape?.getBoundingClientRect();
            const off = hidden || !r || !r.width || node.style.display === 'none';
            badge.hidden = off;
            if (off) continue;
            any = true;
            badge.style.transform = `translate(${Math.round(r.left + r.width / 2)}px, ${Math.round(r.top - 8)}px) translate(-50%, -100%)`;
        }
        if (any) frame = requestAnimationFrame(place);
    }
    function paint() {
        const now = Date.now();
        const shown = items.filter(r => here(r) && document.getElementById(r.id));
        badges.replaceChildren(...shown.map(r => h('span', {
            class: `gr-badge${r.at - now < 0 ? ' due' : r.at - now < SOON ? ' soon' : ''}`, dataset: { id: r.id }, title: when(r.at),
        }, countdown(r.at, now))));
        if (!frame && shown.length) frame = requestAnimationFrame(place);
        const due = items.filter(r => r.at <= now).length;
        bell.dataset.count = due;
        bell.classList.toggle('gr-has', items.length > 0);
        if (!panel.hidden) list();
    }

    // --- Notification à l'échéance.
    const cards = h('div', { id: 'gardien-reminder-cards', role: 'status' });
    document.body.append(cards);
    function card(item, summary) {
        const close = () => el.remove();
        const el = h('section', { class: 'gr-card' },
            h('i', { class: 'gr-bell' }),
            h('div', {}, h('strong', {}, summary || t('rem.one')), h('p', {}, summary ? t('rem.whileAway') : item.text),
                summary ? null : h('small', {}, `${when(item.at)} · ${item.dimension}`)),
            h('nav', {}, summary ? h('button', { type: 'button', onclick: () => { close(); open(); } }, t('rem.see'))
                : [h('button', { type: 'button', onclick: () => { close(); go(item); } }, t('rem.go')),
                    h('button', { type: 'button', onclick: () => { close(); set(item, new Date(Date.now() + 10 * 60e3)); } }, '+10 min'),
                    h('button', { type: 'button', onclick: () => { close(); set(item, null); } }, t('rem.done'))],
            h('button', { type: 'button', class: 'gr-x', title: t('rem.close'), onclick: close }, '×')));
        cards.append(el);
    }
    function notify(item) {
        card(item);
        sfx.play('remind');
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
            const n = new Notification(t('rem.notif'), { body: item.text, tag: key(item) });
            n.onclick = () => { window.focus(); go(item); n.close(); };
        }
    }
    let first = true;
    function check() {
        const now = Date.now();
        const fresh = items.filter(r => r.at <= now && !seen.has(key(r)));
        fresh.forEach(r => seen.add(key(r)));
        if (fresh.length) remember();
        // Au chargement, les rappels échus pendant l'absence : une seule annonce, pas une pluie de cartes.
        if (first && fresh.length > 1) card(null, t('rem.dueN', { n: fresh.length }));
        else fresh.forEach(notify);
        first = false;
        paint();
    }

    // --- Panneau de la cloche.
    const bell = document.getElementById('notificationButton');
    bell.title = t('rem.title');
    const body = h('div', { class: 'gr-list' });
    const allow = h('button', { type: 'button', class: 'gr-allow', onclick: () => Notification.requestPermission().then(list) },
        t('rem.allow'));
    const panel = h('section', { id: 'gardien-reminders', hidden: true, role: 'dialog', 'aria-label': t('rem.title') },
        h('header', {}, h('strong', {}, t('rem.title')), h('button', { type: 'button', class: 'gr-x', title: t('rem.close'), onclick: () => { panel.hidden = true; } }, '×')),
        allow, body);
    document.body.append(panel);
    function row(item, now) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return h('li', { class: item.at <= now ? 'due' : item.at - now < SOON ? 'soon' : '' },
            h('span', { class: 'gr-left', title: when(item.at) }, countdown(item.at, now)),
            h('button', { type: 'button', class: 'gr-text', title: t('rem.goTo', { id: item.id }), onclick: () => { panel.hidden = true; go(item); } },
                h('b', {}, item.text), h('small', {}, `${when(item.at)} · ${item.dimension}`)),
            h('span', { class: 'gr-actions' },
                h('button', { type: 'button', title: t('rem.hourTitle'), onclick: () => set(item, new Date(Math.max(Date.now(), item.at) + 3600e3)) }, '+1 h'),
                h('button', { type: 'button', title: t('rem.tomorrowTitle'), onclick: () => set(item, tomorrow) }, t('rem.tomorrow')),
                h('button', { type: 'button', class: 'gr-x', title: t('rem.remove'), onclick: () => set(item, null) }, '×')));
    }
    function list() {
        const now = Date.now();
        allow.hidden = typeof Notification === 'undefined' || Notification.permission !== 'default';
        const due = items.filter(r => r.at <= now), next = items.filter(r => r.at > now);
        body.replaceChildren(...(items.length ? [
            ...(due.length ? [h('h4', {}, `${t('rem.dueHead')} · ${due.length}`), h('ul', {}, due.map(r => row(r, now)))] : []),
            ...(next.length ? [h('h4', {}, `${t('rem.nextHead')} · ${next.length}`), h('ul', {}, next.map(r => row(r, now)))] : []),
        ] : [h('p', { class: 'gr-empty' }, t('rem.empty'))]));
    }
    function open() {
        const r = bell.getBoundingClientRect();
        panel.style.left = `${Math.max(16, Math.min(window.innerWidth - 376, r.left + r.width / 2 - 180))}px`;
        panel.style.bottom = `${window.innerHeight - r.top + 12}px`;
        panel.hidden = false;
        list();
        refresh();
    }
    // Avant le défilement de Nodz : la cloche ouvre le panneau.
    bell.addEventListener('click', event => {
        event.stopImmediatePropagation();
        if (panel.hidden) open(); else panel.hidden = true;
    }, true);
    document.addEventListener('mousedown', event => {
        if (!panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) panel.hidden = true;
    }, true);
    // Nodz prévient la cloche quand son calendrier pose ou retire un rappel, et à chaque dimension chargée : la liste
    // se relit (une fois, après la rafale).
    let later = 0;
    bell.addEventListener('countChange', () => {
        clearTimeout(later);
        later = setTimeout(() => refresh().then(check), 400);
    });

    setInterval(() => refresh().then(check), 5 * 60e3);  // rappels posés ailleurs (autre onglet, Gardien en tâche de fond)
    setInterval(check, TICK);
    setInterval(paint, 30e3);  // les comptes à rebours avancent
    return {
        // Connexion, ou dimension chargée : la liste se relit, puis les échéances.
        refresh: () => refresh().then(check),
    };
}
