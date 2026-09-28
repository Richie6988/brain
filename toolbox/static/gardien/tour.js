// Visite interactive d'une arborescence, comme une vidéo dont on choisit la suite : la caméra part d'un
// node et suit ses liens en travelling. À chaque embranchement, la visite s'arrête et propose les
// branches (« cette branche ou celle-ci ») ; au bout d'une branche, elle revient au dernier embranchement
// resté ouvert. Le parcours est gardé comme l'historique d'un navigateur : ⏮ et ⏭ (← →) y font autant
// d'allers-retours qu'on veut, le fil d'Ariane y saute d'un clic ; au bout du parcours, ⏭ explore la suite, et
// quand tout est vu, il continue de suivre les liens. Lecture / pause, vitesse, mode auto (il choisit seul).
// Les portails comptent comme des liens : la visite les prend et continue dans la dimension de l'autre bout (elle
// s'y charge). Un pas du parcours est donc { id, layer } et non un élément de la page, que le chargement remplace.
// À chaque node, sa traçabilité : création, dernière modification, origine et auteur (route toolbox/nodes/meta).
// Un clic hors de la carte quitte la visite ; un glissé ou la molette sur l'univers la met en pause. Rien n'est modifié.

import { api } from './api.js';
import { h } from './library.js';

const SPEEDS = [0.5, 1, 1.5, 2, 3];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Texte d'un node avec ses retours à la ligne (innerText les perd quand le node est caché hors de l'écran).
function textOf(node) {
    const html = node?.children[0]?.children[0]?.innerHTML || '';
    const box = document.createElement('div');
    box.innerHTML = html.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n');
    return box.textContent.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}
const ORIGIN = { human: 'écrit par', ai: 'créé par', message: 'message de' };
const when = iso => {
    const date = new Date(iso), minutes = Math.round((Date.now() - date) / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
    return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`
        + ` à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const short = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text) || '(node vide)';

const parse = raw => {
    try {
        const value = JSON.parse(raw || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};
const layerName = layer => layers.find(l => l.id === layer)?.name || `dimension ${layer}`;

// Pas voisins d'un node : par ses liens (attributs Node1 / Node2 des liens de Nodz), puis par ses portails (champ
// quantum : [{ node, layer }]). Un univers d'un autre compte (admin) ne se charge pas : ses portails sont ignorés.
function neighbours(node) {
    const linked = parse(node.getAttribute('links')).map(id => document.getElementById(id)).filter(Boolean)
        .map(link => (link.getAttribute('Node1') === node.id ? link.getAttribute('Node2') : link.getAttribute('Node1')))
        .filter(id => document.getElementById(id)?.classList.contains('node-group'))
        .map(id => ({ id, layer: layerNumber }));
    const portals = parse(node.getAttribute('quantum')).filter(p => p?.node)
        .map(p => ({ id: String(p.node).startsWith('N-') ? String(p.node) : `N-${p.node}`, layer: Number(p.layer) || layerNumber, portal: true }))
        .filter(p => !(typeof admin !== 'undefined' && admin && p.layer !== layerNumber) && !linked.some(l => l.id === p.id));
    return [...linked, ...portals];
}

export function createTour({ bridge, say }) {
    // trail : chaque arrivée, dans l'ordre ; at : où l'on en est dans ce parcours (⏮ ⏭ s'y déplacent).
    // next : voisins de chaque node déjà atteint (on ne peut plus les lire une fois sa dimension quittée) ;
    // info : texte, couleur et dimension de chaque pas, pour le fil d'Ariane et les choix ; known : nodes connus.
    const state = { trail: [], at: -1, seen: new Set(), known: new Set(), next: new Map(), info: new Map(), meta: new Map(),
        playing: false, auto: false, speed: 1, choices: [], run: 0 };

    const title = h('strong', {});
    const bar = h('i');
    const crumbs = h('nav', { class: 'gt-crumbs', 'aria-label': 'Parcours' });
    const swatch = h('span', { class: 'gt-swatch' });
    const place = h('span', { class: 'gt-place' });
    const heading = h('b', { class: 'gt-title' });
    const body = h('span', { class: 'gt-body' });
    const text = h('span', { class: 'gt-text' }, heading, body);
    const current = h('div', { class: 'gt-current' }, swatch, text);
    const meta = h('p', { class: 'gt-meta' });
    const choices = h('div', { class: 'gt-choices' });
    const play = h('button', { type: 'button', class: 'gt-play', title: 'Lecture / pause (Espace)' });
    const back = h('button', { type: 'button', title: 'Node précédent (←)' }, '⏮');
    const ahead = h('button', { type: 'button', title: 'Node suivant (→) ; à un embranchement, la première branche' }, '⏭');
    const auto = h('button', { type: 'button', class: 'gt-auto', title: 'Aux embranchements, choisir seul la première branche' }, 'Auto');
    const speeds = h('div', { class: 'gt-speeds' }, SPEEDS.map(k => h('button', { type: 'button', dataset: { speed: k }, onclick: () => setSpeed(k) }, `${k}×`)));
    const quit = h('button', { type: 'button', class: 'gt-quit', title: 'Quitter la visite (Échap)', onclick: stop }, '✕');
    const card = h('section', { id: 'gardien-tour', hidden: true, role: 'region', 'aria-label': 'Visite' },
        h('div', { class: 'gt-progress' }, bar),
        h('header', {}, h('span', { class: 'gt-dot' }), title, place, quit), crumbs, current, meta, choices,
        h('footer', {}, h('div', { class: 'gt-transport' }, back, play, ahead), speeds, auto));
    document.body.append(card);

    play.addEventListener('click', () => (state.playing ? pause() : resume()));
    // Un clic (sans glissé) hors de la carte quitte la visite.
    let press = null;
    document.addEventListener('pointerdown', event => { press = card.hidden || card.contains(event.target) ? null : [event.clientX, event.clientY]; }, true);
    document.addEventListener('pointerup', event => {
        if (press && Math.hypot(event.clientX - press[0], event.clientY - press[1]) < 5) stop();
        press = null;
    }, true);
    back.addEventListener('click', previous);
    ahead.addEventListener('click', forward);
    auto.addEventListener('click', () => {
        state.auto = !state.auto;
        paint();
        if (state.auto && state.choices.length) choose(state.choices[0]);
    });

    // Raccourcis pendant la visite (sauf pendant une saisie) : Espace, ←, →, 1 à 9, Échap.
    document.addEventListener('keydown', event => {
        if (card.hidden || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
        const n = Number(event.key);
        if (event.key === ' ') state.playing ? pause() : resume();
        else if (event.key === 'Escape') stop();
        else if (event.key === 'ArrowLeft' || event.key === 'Backspace') previous();
        else if (event.key === 'ArrowRight') forward();
        else if (n >= 1 && n <= state.choices.length) choose(state.choices[n - 1]);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();  // ni node créé par Espace, ni raccourci de Nodz
    }, true);

    const here = () => state.trail[state.at];
    const element = step => (step && step.layer === layerNumber ? document.getElementById(step.id) : null);
    const open = step => (state.next.get(step.id) || []).filter(n => !state.seen.has(n.id));
    const colorOf = step => state.info.get(step?.id)?.color || '#b89af2';
    const label = step => (state.info.has(step.id) ? state.info.get(step.id).text : `⟿ ${layerName(step.layer)}`);

    // Ce que la page montre de la dimension chargée : voisins et textes des nodes atteignables depuis `node`
    // (ils font la barre de progression ; les portails comptent, leur dimension sera lue en y arrivant).
    function survey(node) {
        for (let queue = [node]; queue.length;) {
            const n = queue.shift();
            if (state.next.has(n.id)) continue;
            state.known.add(n.id);
            state.info.set(n.id, { text: textOf(n) || '(node vide)', color: n.getAttribute('color'), layer: layerNumber });
            const steps = neighbours(n);
            state.next.set(n.id, steps);
            steps.forEach(s => {
                state.known.add(s.id);
                const el = element(s);
                if (el && !state.next.has(s.id)) queue.push(el);
            });
        }
        const missing = [...state.info.keys()].filter(id => !state.meta.has(id));
        if (missing.length) {
            missing.forEach(id => state.meta.set(id, null));  // une seule demande par node
            api.request('GET', `toolbox/nodes/meta?ids=${missing.join(',')}`)
                .then(({ nodes }) => { Object.entries(nodes).forEach(([id, facts]) => state.meta.set(id, facts)); paint(); })
                .catch(() => {});  // sans traçabilité, la visite continue
        }
    }

    function paint() {
        const step = here();
        const total = state.known.size;
        const away = step && state.trail[0] && step.layer !== state.trail[0].layer;
        title.textContent = `Visite · ${state.seen.size} / ${total}`;
        place.textContent = step ? layerName(step.layer) : '';
        place.classList.toggle('away', Boolean(away));
        bar.style.width = `${total ? (100 * state.seen.size) / total : 0}%`;
        swatch.style.background = colorOf(step);
        card.style.setProperty('--c', colorOf(step));  // liseré et halo à la couleur du node
        const [first = '', ...rest] = (step ? label(step) : '').split('\n');
        heading.textContent = short(first, 90);
        body.textContent = rest.length ? short(rest.join(' · '), 220) : '';
        // Traçabilité : créé, modifié, par qui (Nodz ne garde pas l'auteur de chaque modification)
        const facts = step && state.meta.get(step.id);
        meta.replaceChildren(...(facts ? [
            h('span', { class: `gt-origin ${facts.origin}` }, `${ORIGIN[facts.origin] || 'par'} ${facts.author}`),
            h('span', {}, `créé ${when(facts.created)}`),
            ...(Math.abs(new Date(facts.modified) - new Date(facts.created)) > 60000 ? [h('span', {}, `modifié ${when(facts.modified)}`)] : []),
        ] : []));
        play.textContent = state.playing ? '⏸' : '▶';
        back.disabled = state.at <= 0;
        ahead.disabled = !step || (state.at === state.trail.length - 1 && !(state.next.get(step.id) || []).length);
        // Fil d'Ariane : les étapes autour de la position, chacune cliquable (aller-retour direct).
        const from = Math.max(0, state.at - 3), to = Math.min(state.trail.length, state.at + 3);
        crumbs.replaceChildren(...(from > 0 ? [h('span', {}, '…')] : []), ...state.trail.slice(from, to).flatMap((n, k) => {
            const index = from + k;
            const crumb = h('button', { type: 'button', class: index === state.at ? 'on' : '', title: label(n) || '(node vide)',
                onclick: () => jump(index) }, short(label(n), 18));
            crumb.style.setProperty('--c', colorOf(n));
            const crossed = index > 0 && state.trail[index - 1].layer !== n.layer;  // passage d'un portail
            return crossed ? [h('span', { class: 'gt-portal', title: `Portail vers ${layerName(n.layer)}` }, '⟿'), crumb] : [crumb];
        }), ...(to < state.trail.length ? [h('span', {}, '…')] : []));
        auto.classList.toggle('on', state.auto);
        speeds.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === state.speed));
        document.querySelectorAll('.gardien-choice').forEach(n => n.classList.remove('gardien-choice'));
        choices.replaceChildren(...(state.choices.length ? [h('small', {}, `${state.choices.length} branches : laquelle ?`),
            ...state.choices.map((n, i) => {
                const el = element(n);
                el?.classList.add('gardien-choice');
                const button = h('button', { type: 'button', class: n.portal ? 'portal' : '', onclick: () => choose(n) },
                    h('b', {}, String(i + 1)), short(n.portal && n.layer !== layerNumber ? `⟿ ${layerName(n.layer)}` : label(n), 48));
                button.style.setProperty('--c', colorOf(n));
                button.addEventListener('mouseenter', () => el?.classList.add('gardien-choice-hover'));
                button.addEventListener('mouseleave', () => el?.classList.remove('gardien-choice-hover'));
                return button;
            })] : []));
    }

    function setSpeed(k) {
        state.speed = k;
        bridge.setTempo(k);
        paint();
    }

    // Travelling vers le pas `step` (après chargement de sa dimension s'il est au bout d'un portail), pause de lecture
    // proportionnelle au texte, puis la suite. Un nouveau pas s'ajoute au parcours (et coupe l'éventuelle suite déjà
    // vue, comme un navigateur) ; `replay` rejoue un pas du parcours.
    async function go(step, { replay = false } = {}) {
        const run = ++state.run;
        state.choices = [];
        if (!replay) {
            state.trail = [...state.trail.slice(0, state.at + 1), { id: step.id, layer: step.layer }];
            state.at = state.trail.length - 1;
        }
        state.seen.add(step.id);
        document.querySelectorAll('.gardien-visiting').forEach(n => n.classList.remove('gardien-visiting'));
        paint();
        if (step.layer !== layerNumber) {
            say(`Portail : je passe dans « ${layerName(step.layer)} »`, 'guide');
            await bridge.enter(step.layer);
            if (run !== state.run) return;
        }
        const node = element(step);
        if (!node) return pause('Ce node n\'existe plus : ⏮ pour revenir');
        survey(node);
        node.classList.add('gardien-visiting');
        paint();
        const arrived = await bridge.visit(node);
        if (run !== state.run) return;
        if (!arrived) return state.playing ? pause('Tu as repris la main : ▶ pour continuer') : undefined;
        await dwell(run, 1400 + textOf(node).length * 35);
        if (run === state.run && state.playing) advance();
    }

    // La suite en lecture : le parcours déjà fait s'il y en a devant, sinon l'exploration.
    function advance() {
        if (state.at < state.trail.length - 1) return go(state.trail[++state.at], { replay: true });
        return next();
    }

    async function dwell(run, ms) {
        for (let t = 0; t < ms / state.speed; t += 100) {
            await wait(100);
            if (run !== state.run) return;
            while (!state.playing) {  // en pause : le temps de lecture reprend où il en était
                await wait(150);
                if (run !== state.run) return;
            }
        }
    }

    function next() {
        const options = open(here());
        if (options.length === 1 || (options.length && state.auto)) return go(options[0]);
        if (options.length > 1) {
            state.choices = options;
            return paint();
        }
        // Bout de branche : retour au dernier embranchement du parcours encore ouvert.
        for (let i = state.at - 1; i >= 0; i--) {
            if (open(state.trail[i]).length) {
                const fork = state.trail[i];
                say(`Retour à « ${short(label(fork), 40)} » : il reste des branches`, 'guide');
                return go(fork);
            }
        }
        state.playing = false;
        paint();
        say(`Visite terminée : ${state.seen.size} nodes parcourus. ⏮ ⏭ pour la revoir.`, 'guide');
        return null;
    }

    function choose(step) {
        if (!state.choices.includes(step)) return;
        state.playing = true;
        go(step);
    }

    // Un pas du parcours déjà fait, en pause (fil d'Ariane, ⏮, ⏭ dans le parcours).
    function jump(index) {
        if (index < 0 || index >= state.trail.length) return;
        state.at = index;
        state.playing = false;
        go(state.trail[index], { replay: true });
    }

    function previous() {
        jump(state.at - 1);
    }

    // Pas suivant à la main, sans attendre la fin du temps de lecture ; la lecture garde son état. Au bout du
    // parcours : l'exploration ; tout est vu : on suit quand même un lien (pas celui d'où l'on vient si possible).
    function forward() {
        if (state.choices.length) return go(state.choices[0]);
        if (!here() || ahead.disabled) return;
        state.run += 1;
        bridge.cut();
        if (state.at < state.trail.length - 1) return go(state.trail[++state.at], { replay: true });
        if (state.trail.some(n => open(n).length)) return next();
        const came = state.trail[state.at - 1];
        const links = state.next.get(here().id) || [];
        go(links.find(n => n.id !== came?.id) || links[0]);
    }

    function pause(message) {
        state.playing = false;
        bridge.cut();  // arrête le travelling en cours
        paint();
        if (message) {
            heading.textContent = message;
            body.textContent = '';
        }
    }

    function resume() {
        const step = here();
        if (!step) return;
        state.playing = true;
        paint();
        if (!state.choices.length) {
            // reprise : on recale la caméra sur le node (dans sa dimension), puis la suite
            if (!element(step)) return go(step, { replay: true });
            const run = ++state.run;
            bridge.visit(element(step)).then(ok => { if (ok && run === state.run && state.playing) advance(); });
        }
    }

    function stop() {
        state.run += 1;
        bridge.cut();
        bridge.setTempo(1);
        card.hidden = true;
        document.querySelectorAll('.gardien-visiting, .gardien-choice, .gardien-choice-hover')
            .forEach(n => n.classList.remove('gardien-visiting', 'gardien-choice', 'gardien-choice-hover'));
    }

    return {
        start(node) {
            if (!node) return;
            stop();
            selectedNodes.slice().forEach(n => nodeUnselection(n));  // la pastille du node se retire
            document.dispatchEvent(new MouseEvent('mouseup'));
            Object.assign(state, { trail: [], at: -1, seen: new Set(), known: new Set(), next: new Map(), info: new Map(), meta: new Map(), choices: [], playing: true });
            bridge.setTempo(state.speed);
            card.hidden = false;
            go({ id: node.id, layer: layerNumber });
        },
        stop,
    };
}
