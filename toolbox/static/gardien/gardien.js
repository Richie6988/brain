// Le Gardien dans Nodz (/universe) : pas de chat. Un node écrit est un message : Ctrl+Entrée
// l'envoie au Gardien (l'humain déclenche, rien ne part tout seul), qui répond dans l'univers
// (un node-réponse relié au message, et ses actions) avec les fonctions de Nodz. Le fil de suivi
// montre son plan à venir et l'étape en cours. Le bouton « Agents » de la barre
// de boutons ouvre la bibliothèque (agents, modèles, Hugging Face) ; la tour de contrôle (haut gauche)
// montre les ressources du serveur.

import { api } from './api.js';
import { createBridge } from './bridge.js';
import { createLibrary } from './library.js';
import { createMonitor } from './monitor.js';

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

const bridge = createBridge({ caption: text => say(text, 'guide') });
let guardian = null;  // l'agent orchestrateur de l'utilisateur
let asleep = false;   // le Gardien n'a pas de modèle : on le dit une fois, sans insister

const monitor = createMonitor({ onSignedOut: message => say(message, 'error') });
const library = createLibrary({
    monitor: monitor.panel('gm-window').root,
    onChange: state => {
        guardian = state.agents.find(a => a.role === 'orchestrator') || null;
        asleep = false;
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

async function ask(node, text) {
    let actions = Promise.resolve();
    try {
        if (!guardian) await loadGuardian();
        if (!guardian?.enabled || !guardian.model) {
            if (!asleep) say('Le Gardien dort : donne-lui un modèle dans Agents & modèles.', 'notice');
            asleep = true;
            return;
        }
        node.classList.add('gardien-thinking');
        follow.start();
        await api.command({ prompt: text, context: { ...bridge.context(), origin: node.id } }, (type, data) => {
            if (type === 'text' || type === 'notice') say(data.text, type);
            else if (type === 'queued') follow.step(data.position === 1 ? 'Tu es le prochain : le Gardien finit une autre demande' : `En file d'attente : ${data.position}e`, 'waiting');
            else if (type === 'plan') follow.plan(data.steps);
            // Intentions et gestes s'enchaînent : chaque étape s'affiche quand la page l'exécute.
            else if (type === 'intent') actions = actions.then(() => follow.step(data.text));
            else if (type === 'error') actions = actions.then(() => follow.step(data.message, 'error'));
            else if (type === 'agent') actions = actions.then(() => follow.step(`${data.agent} ${data.role === 'image' ? 'dessine' : 'écrit'} : ${data.task}`, 'agent'));
            else if (type === 'action') actions = actions.then(() => bridge.perform(data)).catch(error => follow.step(error.message, 'error'));
        });
        await actions;
        follow.end('Terminé');
    } catch (error) {
        follow.end(error.message);
        say(error.message, 'error');
    } finally {
        node.classList.remove('gardien-thinking');
    }
}

// Une fois par navigateur, au premier node écrit : comment parler au Gardien.
document.addEventListener('input', function hint(event) {
    if (!event.isTrusted || !event.target.isContentEditable || !event.target.closest?.('.node-group')) return;
    document.removeEventListener('input', hint, true);
    try {
        if (localStorage.getItem('gardien-hint')) return;
        localStorage.setItem('gardien-hint', '1');
    } catch { /* stockage indisponible : l'astuce revient à chaque visite */ }
    say('Astuce : Ctrl+Entrée dans un node pour l\'envoyer au Gardien.', 'notice');
}, true);

bridge.watchMessages((node, text) => {
    queue = queue.then(() => ask(node, text));
});
