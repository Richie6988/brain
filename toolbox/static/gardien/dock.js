// Barre du Gardien sur /universe : la demande part avec le contexte de la page, la réponse arrive
// en flux ; chaque action est exécutée par le pont avec les fonctions de Nodz, dans l'ordre.

import { api } from '../nodz/api.js';
import { bindLibrary } from '../nodz/library.js';
import { createBridge } from './bridge.js';

const form = document.getElementById('gardien-command');
const prompt = document.getElementById('gardien-prompt');
const reply = document.getElementById('gardien-reply');
let busy = false;

function line(text, kind = '') {
    const item = document.createElement('p');
    item.className = kind;
    item.textContent = text;
    reply.append(item);
    reply.hidden = false;
    reply.scrollTop = reply.scrollHeight;
    return item;
}

const bridge = createBridge({
    caption: text => line(text, 'guide'),
    covered: () => window.innerHeight - document.getElementById('gardien-dock').getBoundingClientRect().top,
});

async function submit() {
    const text = prompt.value.trim();
    if (!text || busy) return;
    busy = true;
    form.classList.add('busy');
    reply.replaceChildren();
    line(text, 'you');
    prompt.value = '';
    prompt.blur();
    const agents = new Map();  // référence → ligne de progression de l'agent
    let queue = Promise.resolve();
    let thinking = true;
    bridge.drift();
    try {
        await api.command({ prompt: text, context: bridge.context() }, (type, data) => {
            if (thinking && type !== 'start') {
                thinking = false;
                bridge.cut();  // fin de la réflexion : le recul s'arrête
            }
            if (type === 'text' || type === 'notice') line(data.text, type);
            else if (type === 'error') line(data.message, 'error');
            else if (type === 'agent') agents.set(data.ref, line(`${data.agent} : ${data.task}`, 'agent'));
            else if (type === 'agent_text') agents.get(data.ref)?.classList.add('working');
            else if (type === 'action') {
                queue = queue.then(() => bridge.perform(data)).catch(error => line(error.message, 'error'));
            }
        });
        await queue;
    } catch (error) {
        line(error.message, 'error');
    } finally {
        agents.forEach(item => item.classList.remove('working'));
        busy = false;
        form.classList.remove('busy');
    }
}

form.addEventListener('submit', event => {
    event.preventDefault();
    submit();
});
// Pendant la saisie, les raccourcis de Nodz (Espace, Suppr, Tab…) ne s'appliquent pas.
prompt.addEventListener('focus', () => { isTyping = true; });
prompt.addEventListener('blur', () => { isTyping = false; });
prompt.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
    } else if (event.key === 'Escape') {
        prompt.blur();
    }
});
prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = `${Math.min(prompt.scrollHeight, 140)}px`;
});
reply.addEventListener('mousedown', () => { reply.hidden = true; });
document.getElementById('library').addEventListener('keydown', event => event.stopPropagation());

bindLibrary();
