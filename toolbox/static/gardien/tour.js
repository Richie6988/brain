// Visite interactive d'une arborescence, comme une vidéo dont on choisit la suite : la caméra part d'un
// node et suit ses liens en travelling. À chaque embranchement, la visite s'arrête et propose les
// branches (« cette branche ou celle-ci ») ; au bout d'une branche, elle revient au dernier embranchement
// resté ouvert. Le parcours est gardé comme l'historique d'un navigateur : ⏮ et ⏭ (← →) y font autant
// d'allers-retours qu'on veut, le fil d'Ariane y saute d'un clic ; au bout du parcours, ⏭ explore la suite, et
// quand tout est vu, il continue de suivre les liens. Lecture / pause, vitesse, mode auto (il choisit seul).
// Un geste sur l'univers (clic, molette) met la visite en pause ; rien n'est modifié dans Nodz.

import { h } from './library.js';

const SPEEDS = [0.5, 1, 1.5, 2, 3];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = node => node?.children[0]?.children[0]?.innerText?.trim() || '';
const short = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text) || '(node vide)';

// Voisins d'un node par ses liens (attributs Node1 / Node2 des liens de Nodz).
function neighbours(node) {
    let ids = [];
    try {
        ids = JSON.parse(node.getAttribute('links') || '[]');
    } catch { /* node sans liens */ }
    return ids.map(id => document.getElementById(id)).filter(Boolean)
        .map(link => (link.getAttribute('Node1') === node.id ? link.getAttribute('Node2') : link.getAttribute('Node1')))
        .map(id => document.getElementById(id)).filter(n => n?.classList.contains('node-group'));
}

export function createTour({ bridge, say }) {
    // trail : chaque arrivée, dans l'ordre ; at : où l'on en est dans ce parcours (⏮ ⏭ s'y déplacent).
    const state = { trail: [], at: -1, seen: new Set(), total: 0, playing: false, auto: false, speed: 1, choices: [], run: 0 };

    const title = h('strong', {});
    const bar = h('i');
    const crumbs = h('nav', { class: 'gt-crumbs', 'aria-label': 'Parcours' });
    const swatch = h('span', { class: 'gt-swatch' });
    const text = h('span');
    const current = h('p', { class: 'gt-current' }, swatch, text);
    const choices = h('div', { class: 'gt-choices' });
    const play = h('button', { type: 'button', class: 'gt-play', title: 'Lecture / pause (Espace)' });
    const back = h('button', { type: 'button', title: 'Node précédent (←)' }, '⏮');
    const ahead = h('button', { type: 'button', title: 'Node suivant (→) ; à un embranchement, la première branche' }, '⏭');
    const auto = h('button', { type: 'button', class: 'gt-auto', title: 'Aux embranchements, choisir seul la première branche' }, 'Auto');
    const speeds = h('div', { class: 'gt-speeds' }, SPEEDS.map(k => h('button', { type: 'button', dataset: { speed: k }, onclick: () => setSpeed(k) }, `${k}×`)));
    const quit = h('button', { type: 'button', class: 'gt-quit', title: 'Quitter la visite (Échap)', onclick: stop }, '✕');
    const card = h('section', { id: 'gardien-tour', hidden: true, role: 'region', 'aria-label': 'Visite' },
        h('div', { class: 'gt-progress' }, bar),
        h('header', {}, h('span', { class: 'gt-dot' }), title, quit), crumbs, current, choices,
        h('footer', {}, h('div', { class: 'gt-transport' }, back, play, ahead), speeds, auto));
    document.body.append(card);

    play.addEventListener('click', () => (state.playing ? pause() : resume()));
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
    const open = node => neighbours(node).filter(n => !state.seen.has(n.id));
    const colorOf = node => node?.getAttribute('color') || '#b89af2';

    // Nodes atteignables depuis le départ : la barre de progression de la visite.
    function reachable(start) {
        const found = new Set([start.id]);
        for (let queue = [start]; queue.length;) {
            neighbours(queue.shift()).forEach(n => { if (!found.has(n.id)) { found.add(n.id); queue.push(n); } });
        }
        return found.size;
    }

    function paint() {
        const node = here();
        title.textContent = `Visite · ${state.seen.size} / ${state.total} node${state.total > 1 ? 's' : ''}`;
        bar.style.width = `${state.total ? (100 * state.seen.size) / state.total : 0}%`;
        swatch.style.background = colorOf(node);
        text.textContent = node ? short(textOf(node), 160) : '';
        play.textContent = state.playing ? '⏸' : '▶';
        back.disabled = state.at <= 0;
        ahead.disabled = !node || (state.at === state.trail.length - 1 && !neighbours(node).length);
        // Fil d'Ariane : les étapes autour de la position, chacune cliquable (aller-retour direct).
        const from = Math.max(0, state.at - 3), to = Math.min(state.trail.length, state.at + 3);
        crumbs.replaceChildren(...(from > 0 ? [h('span', {}, '…')] : []), ...state.trail.slice(from, to).map((n, k) => {
            const index = from + k;
            const crumb = h('button', { type: 'button', class: index === state.at ? 'on' : '', title: textOf(n) || '(node vide)',
                onclick: () => jump(index) }, short(textOf(n), 18));
            crumb.style.setProperty('--c', colorOf(n));
            return crumb;
        }), ...(to < state.trail.length ? [h('span', {}, '…')] : []));
        auto.classList.toggle('on', state.auto);
        speeds.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === state.speed));
        document.querySelectorAll('.gardien-choice').forEach(n => n.classList.remove('gardien-choice'));
        choices.replaceChildren(...(state.choices.length ? [h('small', {}, `${state.choices.length} branches : laquelle ?`),
            ...state.choices.map((n, i) => {
                n.classList.add('gardien-choice');
                const button = h('button', { type: 'button', onclick: () => choose(n) }, h('b', {}, String(i + 1)), short(textOf(n), 48));
                button.style.setProperty('--c', colorOf(n));
                button.addEventListener('mouseenter', () => n.classList.add('gardien-choice-hover'));
                button.addEventListener('mouseleave', () => n.classList.remove('gardien-choice-hover'));
                return button;
            })] : []));
    }

    function setSpeed(k) {
        state.speed = k;
        bridge.setTempo(k);
        paint();
    }

    // Travelling vers `node`, pause de lecture proportionnelle au texte, puis la suite. Un nouveau pas s'ajoute au
    // parcours (et coupe l'éventuelle suite déjà vue, comme un navigateur) ; `replay` rejoue un pas du parcours.
    async function go(node, { replay = false } = {}) {
        const run = ++state.run;
        state.choices = [];
        if (!replay) {
            state.trail = [...state.trail.slice(0, state.at + 1), node];
            state.at = state.trail.length - 1;
        }
        state.seen.add(node.id);
        document.querySelectorAll('.gardien-visiting').forEach(n => n.classList.remove('gardien-visiting'));
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
                say(`Retour à « ${short(textOf(fork), 40)} » : il reste des branches`, 'guide');
                return go(fork);
            }
        }
        state.playing = false;
        paint();
        say(`Visite terminée : ${state.seen.size} nodes parcourus. ⏮ ⏭ pour la revoir.`, 'guide');
        return null;
    }

    function choose(node) {
        if (!state.choices.includes(node)) return;
        state.playing = true;
        go(node);
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
        const links = neighbours(here());
        go(links.find(n => n !== came) || links[0]);
    }

    function pause(message) {
        state.playing = false;
        bridge.cut();  // arrête le travelling en cours
        paint();
        if (message) current.textContent = message;
    }

    function resume() {
        const node = here();
        if (!node) return;
        state.playing = true;
        paint();
        if (!state.choices.length) {
            // reprise : on recale la caméra sur le node, puis la suite
            const run = ++state.run;
            bridge.visit(node).then(ok => { if (ok && run === state.run && state.playing) advance(); });
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
            Object.assign(state, { trail: [], at: -1, seen: new Set(), total: reachable(node), choices: [], playing: true });
            bridge.setTempo(state.speed);
            card.hidden = false;
            go(node);
        },
        stop,
    };
}
