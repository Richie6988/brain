// Le Gardien dans Nodz (/universe) : pas de chat. Un node écrit est un message : la pastille « Gardien »
// près du node (ou Ctrl+Entrée) l'envoie au Gardien (l'humain déclenche, rien ne part tout seul), qui répond dans l'univers
// (un node-réponse relié au message, et ses actions) avec les fonctions de Nodz. Le fil de suivi
// montre son plan à venir et l'étape en cours. Le bouton « Agents » de la barre
// de boutons ouvre la bibliothèque (agents, modèles, Hugging Face) ; la tour de contrôle (haut gauche)
// montre les ressources du serveur.

import { createAdmin } from './admin.js';
import { api } from './api.js';
import { createBridge } from './bridge.js';
import { createChat } from './chat.js';
import { createDimensions } from './dimensions.js';
import { createFilters } from './filters.js';
import { createLibrary } from './library.js';
import { createMonitor } from './monitor.js';
import { createTour } from './tour.js';

const toast = document.getElementById('gardien-toast');

// Messages courts du Gardien (légendes de visite, agents au travail, erreurs), au style de Nodz.
function say(text, kind = '') {
    const line = document.createElement('p');
    line.className = kind;
    line.textContent = text;
    toast.append(line);
    setTimeout(() => line.classList.add('fade'), kind === 'guide' ? 6000 : 4500);
    setTimeout(() => line.remove(), kind === 'guide' ? 7000 : 5500);
    return line;
}

// Fil de suivi : plan annoncé, étape en cours, étapes faites ; s'efface après la réponse.
const follow = (() => {
    const card = document.createElement('aside');
    card.id = 'gardien-follow';
    card.setAttribute('aria-live', 'polite');
    card.hidden = true;
    const now = document.createElement('p');
    const done = document.createElement('ol');
    const next = document.createElement('ol');
    card.append(now, done, next);
    document.getElementById('button-container').after(card);
    let timer = null;
    const item = (text, className = '') => Object.assign(document.createElement('li'), { textContent: text, className });
    return {
        start() {
            clearTimeout(timer);
            card.hidden = false;
            card.classList.remove('fade', 'finished');
            now.textContent = 'Le Gardien réfléchit…';
            done.replaceChildren();
            next.replaceChildren();
        },
        plan(steps) { next.replaceChildren(...steps.map(step => item(step))); },
        step(text, className = '') {
            if (now.textContent && !now.classList.contains('idle') && !now.classList.contains('waiting')) done.append(item(now.textContent));
            while (done.children.length > 3) done.firstChild.remove();
            now.textContent = text;
            now.className = className;
            // L'étape prévue qui commence quitte la liste « à venir » (mots proches : relie / relier).
            const stems = value => value.toLowerCase().split(/[^\p{L}\d]+/u).filter(w => w.length > 3).map(w => w.slice(0, 5));
            const words = new Set(stems(text));
            const match = [...next.children].find(li => stems(li.textContent).some(w => words.has(w)));
            if (match) match.remove();
        },
        end(text) {
            this.step(text, 'idle');
            next.replaceChildren();
            card.classList.add('finished');
            timer = setTimeout(() => { card.classList.add('fade'); timer = setTimeout(() => { card.hidden = true; }, 900); }, 5000);
        },
    };
})();

// Un geste commencé sur l'univers (sélection rectangle, glissé) traverse les éléments flottants du Gardien
// (chat, pastille, lecteur de visite) : le relâcher par-dessus ne le coupe pas.
svg.addEventListener('mousedown', () => document.body.classList.add('gardien-gesture'), true);
window.addEventListener('mouseup', () => requestAnimationFrame(() => document.body.classList.remove('gardien-gesture')), true);

// Chat et filtres n'apparaissent qu'une fois connecté (LOGIN ou GUEST de Nodz).
const signedIn = setInterval(() => {
    if (typeof isLoggedIn === 'undefined' || !isLoggedIn) return;
    document.body.classList.add('gardien-ready');
    clearInterval(signedIn);
}, 400);

const filters = createFilters();
createDimensions();  // recherche, épinglées et nombre de nodes dans la liste des dimensions
createAdmin({ say });  // consoles des boutons administrateur (Console IA, Utilisateurs)
const bridge = createBridge({ caption: text => say(text, 'guide'), onTour: node => tour.start(node), onAttach: nodes => chat.attach(nodes) });
const tour = createTour({ bridge, say });
let guardian = null;  // l'agent orchestrateur de l'utilisateur

// Le Gardien dans l'univers : dimension « Gardien » avec le node Prompt système, le node Outils, un node par
// famille puis un node par outil (nom, rôle, comment l'appeler). Le Gardien relit ces nodes à chaque demande.
const escape = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const PALETTE = ['#4D96FF', '#33FF99', '#FF6B6B', '#FFD93D', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5', '#9BE15D', '#7FB3FF', '#FFB3C6', '#B8F2E6', '#E0AAFF', '#FFE066'];

async function installBrain() {
    const map = await api.request('GET', 'toolbox/brain-map');
    say('Le Gardien s\'installe dans la dimension « Gardien »…', 'guide');
    await bridge.enterDimension('Gardien');
    const make = async (ref, x, y, text, tint, shape = 'circle') => {
        await bridge.perform({ op: 'create', ref, x, y, text: text.split('\n').map(escape).join('<br>'), color: tint, shape });
        return bridge.idOf(ref);
    };
    const link = (source, target) => bridge.perform({ op: 'link', source, target });
    // En arbre : Prompt système à gauche, Outils au centre, une famille par ligne suivie de ses outils.
    // Aucun lien parfaitement horizontal : le dégradé d'un lien de Nodz ne s'y affiche pas.
    const categories = [...new Set(map.tools.map(t => t.category))];
    const ROW = 950;
    const top = ((categories.length - 1) * ROW) / 2;
    const prompt = await make('brain-prompt', -3200, 400, `Prompt système\n\n${map.guidelines}`, '#f3ee58', 'square');
    await make('brain-tools', 0, 0, 'Outils du Gardien', '#6848A6');
    await link('brain-prompt', 'brain-tools');
    const ids = {};
    for (const [k, category] of categories.entries()) {
        const cy = top - k * ROW + 140;
        const tint = PALETTE[k % PALETTE.length];
        const cref = `brain-cat-${k}`;
        await make(cref, 1500, cy, category, tint);
        await link('brain-tools', cref);
        for (const [i, tool] of map.tools.filter(t => t.category === category).entries()) {
            const ref = `brain-tool-${tool.op}`;
            ids[tool.op] = await make(ref, 2500 + i * 800, cy + (i % 2 ? -220 : 220), `${tool.op}\n${tool.label}\n\n${tool.usage}`, tint);
            await link(i ? `brain-tool-${map.tools.filter(t => t.category === category)[i - 1].op}` : cref, ref);
        }
    }
    await api.request('POST', 'toolbox/brain-map', { prompt, tools: ids });
    filters.mark([prompt, ...Object.values(ids)], 'ai');
    await bridge.perform({ op: 'overview', text: 'Le Gardien est dans l\'univers : réécris ses nodes pour changer ses consignes et ses outils.' });
}

const monitor = createMonitor({ onSignedOut: message => say(message, 'error') });
const library = createLibrary({
    onInstallBrain: () => { library.close(); installBrain().catch(error => say(error.message, 'error')); },
    monitor: monitor.panel('gm-window').root,
    onChange: state => {
        guardian = state.agents.find(a => a.role === 'orchestrator') || null;
    },
});

const button = document.getElementById('agentsButton');
button.addEventListener('click', () => library.open());
button.addEventListener('mouseover', () => createTooltip('agentsButton', 'Agents & modèles'));

// Tour de contrôle : les gestes la traversent (sélection, glissé) ; son en-tête ouvre la bibliothèque.
const tower = monitor.panel('gm-hud');
tower.head.addEventListener('click', () => library.open('library'));
document.getElementById('button-container').after(tower.root);  // sous les popups de Nodz, comme la barre

async function loadGuardian() {
    const { agents } = await api.request('GET', 'toolbox/agents');
    guardian = agents.find(a => a.role === 'orchestrator') || null;
}

// Un message à la fois : les réponses s'enchaînent dans l'ordre d'écriture.
let queue = Promise.resolve();

// Une demande au Gardien, depuis un node (node = le message) ou depuis le chat (node = null). Les deux
// s'affichent dans le chat ; depuis un node, les réponses courtes passent aussi en toast.
async function ask(node, text, attached = []) {
    let actions = Promise.resolve();
    chat.add('user', text, node ? `node ${node.id}` : attached.length ? `${attached.length} nodes joints` : '');
    if (typeof admin !== 'undefined' && admin) return chat.add('notice', 'Univers d\'un autre compte, en lecture : le Gardien n\'y agit pas.');
    const reply = (kind, message) => {
        chat.add(kind === 'text' ? 'guardian' : kind, message);
        if (node) say(message, kind);
    };
    chat.busy(true);
    try {
        if (!guardian) await loadGuardian();
        if (!guardian?.enabled || !guardian.model) {
            reply('notice', 'Le Gardien dort : donne-lui un modèle dans Agents & modèles.');
            return;
        }
        node?.classList.add('gardien-thinking');
        if (node) filters.mark([node.id], 'message');
        follow.start();
        chat.status('Le Gardien réfléchit…');
        const created = [];
        let timing = null;
        const context = bridge.context();
        await api.command({ prompt: text, context: { ...context, ...(node ? { origin: node.id } : {}), ...(attached.length ? { attached } : {}) } }, (type, data) => {
            if (type === 'text' || type === 'notice') reply(type, data.text);
            else if (type === 'queued') {
                const where = data.position === 1 ? 'Tu es le prochain : le Gardien finit une autre demande' : `En file d'attente : ${data.position}e`;
                follow.step(where, 'waiting');
                chat.status(where);
            } else if (type === 'plan') follow.plan(data.steps);
            else if (type === 'timing') timing = data;
            // Intentions et gestes s'enchaînent : chaque étape s'affiche quand la page l'exécute.
            else if (type === 'intent') actions = actions.then(() => { follow.step(data.text); chat.status(data.text); });
            else if (type === 'error') actions = actions.then(() => { follow.step(data.message, 'error'); chat.add('error', data.message); });
            else if (type === 'agent') actions = actions.then(() => follow.step(`${data.agent} ${data.role === 'image' ? 'dessine' : 'écrit'} : ${data.task}`, 'agent'));
            else if (type === 'action') {
                actions = actions.then(() => bridge.perform(data)).catch(error => follow.step(error.message, 'error'));
                if (data.op === 'create') created.push(data.ref);
            }
        });
        await actions;
        filters.mark(created.map(bridge.idOf), 'ai');
        follow.end(timing ? `Terminé en ${Math.round(timing.total_s)} s` : 'Terminé');
        // Où passe le temps : lecture du prompt (avant le premier mot) et génération, par appel au modèle.
        if (timing) chat.add('notice', `${Math.round(timing.total_s)} s · ${timing.calls} appel${timing.calls > 1 ? 's' : ''} au modèle · `
            + `lecture du prompt ${Math.round(timing.wait_s)} s${timing.prompt_tokens ? ` (${timing.prompt_tokens} jetons)` : ''}`
            + `${timing.speed ? ` · ${timing.speed} jetons/s` : ''}`);
    } catch (error) {
        follow.end(error.message);
        reply('error', error.message);
    } finally {
        node?.classList.remove('gardien-thinking');
        chat.busy(false);
    }
}

const chat = createChat({ onSend: (text, attached) => { queue = queue.then(() => ask(null, text, attached)); } });

// Une fois par navigateur, au premier node écrit : comment parler au Gardien.
document.addEventListener('input', function hint(event) {
    if (!event.isTrusted || !event.target.isContentEditable || !event.target.closest?.('.node-group')) return;
    document.removeEventListener('input', hint, true);
    try {
        if (localStorage.getItem('gardien-hint')) return;
        localStorage.setItem('gardien-hint', '1');
    } catch { /* stockage indisponible : l'astuce revient à chaque visite */ }
    say('Astuce : la pastille « Gardien » à côté du node (ou Ctrl+Entrée) l\'envoie au Gardien.', 'notice');
}, true);

bridge.watchMessages((node, text) => {
    queue = queue.then(() => ask(node, text));
});
