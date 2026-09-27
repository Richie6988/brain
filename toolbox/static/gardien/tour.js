// Visite interactive d'une arborescence, comme une vidéo dont on choisit la suite : la caméra part d'un
// node et suit ses liens en travelling. À chaque embranchement, la visite s'arrête et propose les
// branches (« cette branche ou celle-ci ») ; au bout d'une branche, elle revient au dernier embranchement
// resté ouvert. Lecture / pause, vitesse, retour, mode auto (il choisit seul). Un geste sur l'univers
// (clic, molette) met la visite en pause ; rien n'est modifié dans Nodz.

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
    const state = { path: [], seen: new Set(), playing: false, auto: false, speed: 1, choices: [], run: 0 };

    const title = h('strong', {});
    const current = h('p', { class: 'gt-current' });
    const choices = h('div', { class: 'gt-choices' });
    const play = h('button', { type: 'button', class: 'gt-play', title: 'Lecture / pause (Espace)' });
    const back = h('button', { type: 'button', title: 'Node précédent (←)' }, '⏮');
    const auto = h('button', { type: 'button', class: 'gt-auto', title: 'Aux embranchements, choisir seul la première branche' }, 'Auto');
    const speeds = h('div', { class: 'gt-speeds' }, SPEEDS.map(k => h('button', { type: 'button', dataset: { speed: k }, onclick: () => setSpeed(k) }, `${k}×`)));
    const quit = h('button', { type: 'button', class: 'gt-quit', title: 'Quitter la visite (Échap)', onclick: stop }, '✕');
    const card = h('section', { id: 'gardien-tour', hidden: true, role: 'region', 'aria-label': 'Visite' },
        h('header', {}, h('span', { class: 'gt-dot' }), title, quit), current, choices,
        h('footer', {}, back, play, speeds, auto));
    document.body.append(card);

    play.addEventListener('click', () => (state.playing ? pause() : resume()));
    back.addEventListener('click', previous);
    auto.addEventListener('click', () => {
        state.auto = !state.auto;
        paint();
        if (state.auto && state.choices.length) choose(state.choices[0]);
    });

    // Raccourcis pendant la visite (sauf pendant une saisie) : Espace, ←, 1 à 9, Échap.
    document.addEventListener('keydown', event => {
        if (card.hidden || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
        const n = Number(event.key);
        if (event.key === ' ') state.playing ? pause() : resume();
        else if (event.key === 'Escape') stop();
        else if (event.key === 'ArrowLeft' || event.key === 'Backspace') previous();
        else if (n >= 1 && n <= state.choices.length) choose(state.choices[n - 1]);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();  // ni node créé par Espace, ni raccourci de Nodz
    }, true);

    const here = () => state.path[state.path.length - 1];
    const open = node => neighbours(node).filter(n => !state.seen.has(n.id));

    function paint() {
        const node = here();
        title.textContent = `Visite · ${state.seen.size} node${state.seen.size > 1 ? 's' : ''} vu${state.seen.size > 1 ? 's' : ''}`;
        current.textContent = node ? short(textOf(node), 160) : '';
        play.textContent = state.playing ? '⏸' : '▶';
        back.disabled = state.path.length < 2;
        auto.classList.toggle('on', state.auto);
        speeds.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === state.speed));
        document.querySelectorAll('.gardien-choice').forEach(n => n.classList.remove('gardien-choice'));
        choices.replaceChildren(...(state.choices.length ? [h('small', {}, `${state.choices.length} branches : laquelle ?`),
            ...state.choices.map((n, i) => {
                n.classList.add('gardien-choice');
                const button = h('button', { type: 'button', onclick: () => choose(n) }, h('b', {}, String(i + 1)), short(textOf(n), 48));
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

    // Travelling vers `node`, pause de lecture proportionnelle au texte, puis la suite.
    async function go(node, { back: returning = false } = {}) {
        const run = ++state.run;
        state.choices = [];
        if (!returning) state.path.push(node);
        state.seen.add(node.id);
        document.querySelectorAll('.gardien-visiting').forEach(n => n.classList.remove('gardien-visiting'));
        node.classList.add('gardien-visiting');
        paint();
        const arrived = await bridge.visit(node);
        if (run !== state.run) return;
        if (!arrived) return state.playing ? pause('Tu as repris la main : ▶ pour continuer') : undefined;
        await dwell(run, 1400 + textOf(node).length * 35);
        if (run === state.run && state.playing) next();
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
        // Bout de branche : retour au dernier embranchement encore ouvert.
        for (let i = state.path.length - 2; i >= 0; i--) {
            if (open(state.path[i]).length) {
                const fork = state.path[i];
                state.path.length = i + 1;
                say(`Retour à « ${short(textOf(fork), 40)} » : il reste des branches`, 'guide');
                return go(fork, { back: true });
            }
        }
        state.playing = false;
        paint();
        say(`Visite terminée : ${state.seen.size} nodes parcourus.`, 'guide');
    }

    function choose(node) {
        if (!state.choices.includes(node)) return;
        state.playing = true;
        go(node);
    }

    function previous() {
        if (state.path.length < 2) return;
        state.path.pop();
        go(here(), { back: true });
        state.playing = false;
        paint();
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
            bridge.visit(node).then(ok => { if (ok && run === state.run && state.playing) next(); });
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
            Object.assign(state, { path: [], seen: new Set(), choices: [], playing: true });
            bridge.setTempo(state.speed);
            card.hidden = false;
            go(node);
        },
        stop,
    };
}
