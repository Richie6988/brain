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
import { createCorners } from './corners.js';
import { createIde } from './ide.js';
import { createDimensions } from './dimensions.js';
import { createFilters } from './filters.js';
import { createLibrary } from './library.js';
import { createMonitor } from './monitor.js';
import { createNodebar } from './nodebar.js';
import { createPending } from './pending.js';
import { createPresence } from './presence.js';
import { createSchemas } from './schemas.js';
import { createSide } from './side.js';
import { LATER, createSuggestions } from './suggest.js';
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
    // Préchauffage : le modèle du Gardien lit ses consignes en arrière-plan, la première demande ira plus vite.
    api.request('POST', 'toolbox/warm', {}).catch(() => {});
    refreshLetters();  // notes du Gardien en attente dans Échanges
}, 400);

const filters = createFilters();
createDimensions();  // recherche, épinglées et nombre de nodes dans la liste des dimensions
createNodebar();  // barre d'outils du node, à la place des barres SVG de Nodz
createCorners();  // le nombre des indicateurs de coin sursaute quand il change
createAdmin({ say });  // consoles des boutons administrateur (Console IA, Utilisateurs)
const bridge = createBridge({ caption: text => say(text, 'guide'), onTour: node => tour.start(node), onAttach: nodes => chat.attach(nodes),
    onSchema: (type, at, fill, title) => schemas.build(type, at, false, fill, title) });
const tour = createTour({ bridge, say });
const schemas = createSchemas({ bridge });  // galerie de modèles : schémas faits de nodes et de liens
createIde({ say });  // IDE des nodes de code, exécution dans le navigateur ou sur le serveur
createSide({ bridge, say, filters });  // vue de côté : X = numéro de dimension, Y = Y
const pending = createPending({ bridge, say, onApplied: ids => filters.mark(ids, 'ai') });  // changer de dimension n'interrompt pas le Gardien
let guardian = null;  // l'agent orchestrateur de l'utilisateur
const presence = createPresence();  // l'avatar du Gardien là où il travaille

// Le Gardien dans l'univers : dimension « Gardien » avec le node Prompt système, le node Outils, un node par
// famille puis un node par outil (nom, rôle, comment l'appeler). Le Gardien relit ces nodes à chaque demande.
const escape = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const PALETTE = ['#4D96FF', '#33FF99', '#FF6B6B', '#FFD93D', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5', '#9BE15D', '#7FB3FF', '#FFB3C6', '#B8F2E6', '#E0AAFF', '#FFE066'];

async function installBrain() {
    const map = await api.request('GET', 'toolbox/brain-map');
    const placed = map.universe || {};
    say('Le Gardien s\'installe dans la dimension « Gardien »…', 'guide');
    await bridge.enterDimension('Gardien');
    const here = id => (id && document.getElementById(id) ? id : null);  // pièce déjà posée dans cette dimension
    const make = async (ref, x, y, text, tint, shape = 'circle') => {
        await bridge.perform({ op: 'create', ref, x, y, text: text.split('\n').map(escape).join('<br>'), color: tint, shape });
        return bridge.idOf(ref);
    };
    const link = (source, target) => bridge.perform({ op: 'link', source, target });
    const saved = {};
    // En arbre : Prompt système à gauche, Outils au centre, une famille par ligne suivie de ses outils.
    // Aucun lien parfaitement horizontal : le dégradé d'un lien de Nodz ne s'y affiche pas.
    let prompt = here(placed.prompt);
    if (!prompt) {
        const categories = [...new Set(map.tools.map(t => t.category))];
        const ROW = 950;
        const top = ((categories.length - 1) * ROW) / 2;
        prompt = saved.prompt = await make('brain-prompt', -3200, 400, `Prompt système\n\n${map.guidelines}`, '#f3ee58', 'square');
        await make('brain-tools', 0, 0, 'Outils du Gardien', '#6848A6');
        await link(prompt, 'brain-tools');
        saved.tools = {};
        for (const [k, category] of categories.entries()) {
            const cy = top - k * ROW + 140;
            const tint = PALETTE[k % PALETTE.length];
            const cref = `brain-cat-${k}`;
            await make(cref, 1500, cy, category, tint);
            await link('brain-tools', cref);
            for (const [i, tool] of map.tools.filter(t => t.category === category).entries()) {
                const ref = `brain-tool-${tool.op}`;
                saved.tools[tool.op] = await make(ref, 2500 + i * 800, cy + (i % 2 ? -220 : 220), `${tool.op}\n${tool.label}\n\n${tool.usage}`, tint);
                await link(i ? `brain-tool-${map.tools.filter(t => t.category === category)[i - 1].op}` : cref, ref);
            }
        }
    }
    // Mémoire (un souvenir par ligne, relue à chaque demande) et Cerveau (réécrit par le Gardien), sous le prompt.
    if (!here(placed.memory)) {
        saved.memory = await make('brain-memory', -4300, -900, `Mémoire du Gardien\n${map.memory.map(fact => `- ${fact}`).join('\n')}`, '#33FF99', 'square');
        await link(prompt, saved.memory);
    }
    if (!here(placed.brain)) {
        saved.brain = await make('brain-state', -2000, -1200, map.brain, '#C77DFF', 'square');
        await link(prompt, saved.brain);
    }
    await api.request('POST', 'toolbox/brain-map', saved);
    filters.mark([saved.prompt, saved.memory, saved.brain, ...Object.values(saved.tools || {})].filter(Boolean), 'ai');
    await bridge.perform({ op: 'overview', text: 'Le Gardien est dans l\'univers : réécris ses nodes pour changer ses consignes, ses outils et sa mémoire.' });
}

// Correspondance : la dimension « Échanges ». Les notes du Gardien pas encore posées y deviennent des nodes, en
// spirale autour d'une racine ; l'humain répond dans un node relié à une note, que le Gardien relit ensuite.
async function refreshLetters() {
    try {
        chat.unread((await api.request('GET', 'toolbox/letters')).unread);
    } catch { /* pas encore de Gardien */ }
}

async function openExchanges() {
    const data = await api.request('GET', 'toolbox/letters');
    await bridge.enterDimension('Échanges');
    const here = id => (id && document.getElementById(id) ? id : null);
    const saved = { posted: {} };
    let root = here(data.root);
    if (!root) {
        await bridge.perform({ op: 'create', ref: 'exchanges-root', x: 0, y: 0, color: '#6848A6', shape: 'square',
            text: '<b>Échanges</b><br>Les notes du Gardien : réponds dans un node relié à la note.' });
        root = saved.root = bridge.idOf('exchanges-root');
    }
    const at = document.getElementById(root);
    const [ox, oy] = [parseFloat(at.getAttribute('x')) || 0, parseFloat(at.getAttribute('y')) || 0];
    let k = data.letters.filter(l => here(l.node)).length;
    for (const letter of data.letters.filter(l => !here(l.node))) {
        const angle = 0.4 + k * 0.95, radius = 420 + 90 * k++;  // spirale : les plus récentes plus loin
        const choices = letter.choices?.length ? `<br><i>${letter.choices.map(escape).join(' / ')}</i>` : '';
        await bridge.perform({ op: 'create', ref: `letter-${letter.id}`, x: Math.round(ox + radius * Math.cos(angle)), y: Math.round(oy + radius * Math.sin(angle)),
            text: `<font size="2">${escape(letter.at)}</font><br>${letter.html}${choices}`, color: '#1E90FF' });
        await bridge.perform({ op: 'link', source: root, target: `letter-${letter.id}` });
        saved.posted[letter.id] = bridge.idOf(`letter-${letter.id}`);
    }
    await api.request('POST', 'toolbox/letters', saved);
    filters.mark(Object.values(saved.posted), 'ai');
    chat.unread(0);
    await bridge.perform({ op: 'overview', text: Object.keys(saved.posted).length ? 'Les notes du Gardien : réponds dans un node relié.' : 'Aucune nouvelle note.' });
}

// Bouton « Mémoire » du chat : voyage jusqu'au node Mémoire du Gardien (l'installe s'il manque).
async function showMemory() {
    const map = await api.request('GET', 'toolbox/brain-map');
    const ref = map.universe?.memory;
    const gardien = layers.find(l => l.name.toLowerCase() === 'gardien');
    if (!ref || !gardien) return installBrain();
    await bridge.perform({ op: 'goto', ref, layer: gardien.id, zoom: 1.2, text: 'Sa mémoire : un souvenir par ligne, à réécrire ou effacer.' });
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
    const history = chat.recent();  // la conversation jusqu'ici : le Gardien la suit
    chat.add('user', text, node ? `node ${node.id}` : attached.length ? `${attached.length} nodes joints` : '');
    if (typeof admin !== 'undefined' && admin) return chat.add('notice', 'Univers d\'un autre compte, en lecture : le Gardien n\'y agit pas.');
    const reply = (kind, message) => {
        chat.add(kind === 'text' ? 'guardian' : kind, message);
        if (node) say(message, kind);
    };
    chat.busy(true);
    // Réflexion en direct : le plan que le modèle écrit, fragment par fragment (un fragment ≈ un jeton).
    let think = null, round = 0, pieces = 0, thinkStart = 0;
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
        const created = [], changed = [];
        let timing = null, stopped = false;
        const home = layerNumber;  // la demande reste liée à cette dimension
        let away = false;
        const perform = data => pending.run(home, data).then(waiting => {
            if (!waiting || away) return;
            away = true;
            const name = layers.find(l => l.id === home)?.name || 'sa dimension';
            chat.add('notice', `Tu as changé de dimension : le Gardien continue ; ce qu'il pose attend ton retour dans « ${name} ».`);
        });
        const thought = ({ round: r, text: piece }) => {
            if (!think) {
                think = chat.think();
                thinkStart = performance.now();
            }
            if (r !== round) think.append(`\n\n· tour ${r + 1} ·\n`);
            round = r;
            pieces += 1;
            think.append(piece);
        };
        const context = bridge.context();
        let doing = '';  // dernière intention annoncée : l'étiquette de l'avatar du Gardien
        await api.command({ prompt: text, context: { ...context, ...(node ? { origin: node.id } : {}), ...(attached.length ? { attached } : {}),
            ...(history.length ? { history } : {}) } }, (type, data) => {
            if (type === 'thinking') thought(data);
            else if (type === 'stopped') stopped = true;
            else if (type === 'text' || type === 'notice') reply(type, data.text);
            else if (type === 'queued') {
                const where = data.position === 1 ? 'Tu es le prochain : le Gardien finit une autre demande' : `En file d'attente : ${data.position}e`;
                follow.step(where, 'waiting');
                chat.status(where);
            } else if (type === 'plan') follow.plan(data.steps);
            else if (type === 'timing') timing = data;
            // Intentions et gestes s'enchaînent : chaque étape s'affiche quand la page l'exécute.
            else if (type === 'intent') actions = actions.then(() => { follow.step(data.text); chat.status(data.text); doing = data.text; });
            // Note pour plus tard : annoncée dans le chat, posée dans Échanges quand l'humain l'ouvre.
            else if (type === 'note') actions = actions.then(() => { chat.add('guardian', `Note laissée dans Échanges : ${data.text}`, '', data.choices); refreshLetters(); });
            // Question à l'humain : ses choix sont des boutons dans le chat, qui s'ouvre.
            else if (type === 'ask') actions = actions.then(() => { chat.add('guardian', data.text, '', data.choices); chat.open(); if (node) say(data.text, 'text'); });
            else if (type === 'error') actions = actions.then(() => { follow.step(data.message, 'error'); chat.add('error', data.message); });
            else if (type === 'agent') actions = actions.then(() => follow.step(`${data.agent} ${data.role === 'image' ? 'dessine' : 'écrit'} : ${data.task}`, 'agent'));
            else if (type === 'action') {
                actions = actions.then(() => perform(data))
                    .then(() => presence.at(bridge.idOf(data.ref || data.target || data.source), doing))
                    .catch(error => follow.step(error.message, 'error'));
                if (data.op === 'create') created.push(data.ref);
                else if (['update', 'style'].includes(data.op)) changed.push(data.ref);
            }
        });
        think?.end(`${stopped ? 'Arrêté après' : 'A réfléchi'} (${pieces} jetons, ${Math.round((performance.now() - thinkStart) / 1000)} s)`);
        think = null;
        await actions;
        if (stopped) {
            follow.end('Arrêté');
            chat.add('notice', 'Gardien arrêté : ce qu\'il avait déjà posé reste (Ctrl+Z pour l\'annuler).');
            return;
        }
        filters.mark(created.map(bridge.idOf).filter(id => id.startsWith('N-')), 'ai');
        // Liens vers ce que le Gardien a posé ou retouché : un clic y voyage.
        const item = id => ({ id, layer: home, label: (document.getElementById(id)?.children[0]?.children[0]?.innerText || '').trim().slice(0, 28) });
        const made = [...new Set(created.map(bridge.idOf).filter(id => id.startsWith('N-')))];
        const touched = [...new Set(changed.map(bridge.idOf).filter(id => id.startsWith('N-') && !made.includes(id)))];
        chat.links(`${made.length} node${made.length > 1 ? 's' : ''} créé${made.length > 1 ? 's' : ''} :`, made.map(item));
        chat.links(`${touched.length} node${touched.length > 1 ? 's' : ''} modifié${touched.length > 1 ? 's' : ''} :`, touched.map(item));
        follow.end(timing ? `Terminé en ${Math.round(timing.total_s)} s` : 'Terminé');
        // Où passe le temps : lecture du prompt (avant le premier mot) et génération, par appel au modèle.
        if (timing) chat.add('notice', `${Math.round(timing.total_s)} s · ${timing.calls} appel${timing.calls > 1 ? 's' : ''} au modèle · `
            + `lecture du prompt ${Math.round(timing.wait_s)} s${timing.prompt_tokens ? ` (${timing.prompt_tokens} jetons)` : ''}`
            + `${timing.speed ? ` · ${timing.speed} jetons/s` : ''}`);
        // Le modèle ne tient pas dans la RAM libre : il relit le disque à chaque mot écrit, c'est là que part le temps.
        const go = n => String(n).replace('.', ',');
        if (timing?.memory) chat.add('guardian', `Je suis lent parce que mon modèle (${go(timing.memory.model_gb)} Go) ne tient pas dans `
            + `la mémoire libre (${go(timing.memory.free_gb)} Go) : je relis le disque à chaque mot. Donne-moi un modèle d'environ `
            + `${go(timing.memory.advice_gb)} Go ou moins dans Agents & modèles (un 3B ou un 1.5B en Q4), ou branche un modèle par API : `
            + 'j\'écrirai bien plus vite.', 'mémoire');
    } catch (error) {
        think?.end('Réflexion interrompue');
        follow.end(error.message);
        reply('error', error.message);
    } finally {
        node?.classList.remove('gardien-thinking');
        presence.leave();
        chat.busy(false);
    }
}

const chat = createChat({
    onSend: (text, attached) => {
        if (text === LATER) return chat.add('notice', 'D\'accord, je n\'y touche pas.');  // une proposition écartée : rien à demander
        queue = queue.then(() => ask(null, text, attached));
    },
    // Stop : le serveur coupe le modèle à son prochain jeton ; la lecture du prompt, elle, va à son terme avant.
    onStop: () => {
        chat.status('Arrêt demandé : le Gardien s\'arrête à son prochain mot…');
        api.request('POST', 'toolbox/command/stop').catch(error => chat.add('error', error.message));
    },
    onMemory: () => showMemory().catch(error => chat.add('error', error.message)),
    onGoto: (ref, layer) => bridge.perform({ op: 'goto', ref, layer }).catch(() => say(`${ref} n'existe plus`, 'error')),
    onExchanges: () => openExchanges().catch(error => say(error.message, 'error')),
});

createSuggestions({ chat, busy: () => document.getElementById('gardien-chat')?.classList.contains('busy') });  // propose, n'agit pas

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
