// Le Gardien dans Nodz (/universe) : pas de chat. Un node écrit est un message : quand
// l'utilisateur le quitte, son texte part au Gardien, qui répond dans l'univers (un node-réponse
// relié au message, et ses actions) avec les fonctions de Nodz. Le bouton « Agents » de la barre
// de boutons ouvre la bibliothèque (agents, modèles, Hugging Face) ; la tour de contrôle (haut gauche)
// montre les ressources du serveur.

import { api } from '../nodz/api.js';
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

const bridge = createBridge({ caption: text => say(text, 'guide') });
let guardian = null;  // l'agent orchestrateur de l'utilisateur
let asleep = false;   // le Gardien n'a pas de modèle : on le dit une fois, sans insister

const monitor = createMonitor();
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
    const agents = new Map();
    let actions = Promise.resolve();
    try {
        if (!guardian) await loadGuardian();
        if (!guardian?.enabled || !guardian.model) {
            if (!asleep) say('Le Gardien dort : donne-lui un modèle dans Agents & modèles.', 'notice');
            asleep = true;
            return;
        }
        node.classList.add('gardien-thinking');
        await api.command({ prompt: text, context: { ...bridge.context(), origin: node.id } }, (type, data) => {
            if (type === 'text' || type === 'notice') say(data.text, type);
            else if (type === 'error') say(data.message, 'error');
            else if (type === 'agent') agents.set(data.ref, say(`${data.agent} écrit : ${data.task}`, 'agent'));
            else if (type === 'action') actions = actions.then(() => bridge.perform(data)).catch(error => say(error.message, 'error'));
        });
        await actions;
    } catch (error) {
        say(error.message, 'error');
    } finally {
        node.classList.remove('gardien-thinking');
    }
}

bridge.watchMessages((node, text) => {
    queue = queue.then(() => ask(node, text));
});
