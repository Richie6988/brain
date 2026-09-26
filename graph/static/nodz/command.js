// Barre de commande : la demande part au Gardien, sa réponse arrive en flux. Les changements
// sont appliqués au store au fil de l'eau et forment un seul pas d'annulation.

import { api } from './api.js';
import { createCamera } from './camera.js';

export function bindCommand({ svg, store, viewport, sync }) {
    const form = document.getElementById('command');
    const prompt = document.getElementById('prompt');
    const reply = document.getElementById('reply');
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

    const camera = createCamera({
        svg, store, viewport,
        dispatch: (name, params) => store.dispatch(name, params),
        caption: text => line(text, 'guide'),
        covered: () => window.innerHeight - document.getElementById('dock').getBoundingClientRect().top,
    });

    function grow() {
        prompt.style.height = 'auto';
        prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`;
    }

    async function submit() {
        const text = prompt.value.trim();
        if (!text || busy) return;
        busy = true;
        form.classList.add('busy');
        reply.replaceChildren();
        line(text, 'you');
        prompt.value = '';
        grow();
        const inverses = [];
        const drafts = new Map();  // node → ligne de progression de l'agent
        const created = [];
        let guided = false;
        camera.cancel();
        camera.drift();
        try {
            await sync.flush();
            await api.command({
                prompt: text,
                layer: store.state.layerId,
                selection: store.state.selection,
                view: viewport.toUniverse(window.innerWidth / 2, window.innerHeight / 2),
            }, (type, data) => {
                if (type !== 'start' && type !== 'agent_text') camera.stopDrift();
                if (type === 'text' || type === 'notice') line(data.text, type);
                else if (type === 'camera') {
                    guided = true;
                    camera.play([data]);
                }
                else if (type === 'error') line(data.message, 'error');
                else if (type === 'agent') drafts.set(data.node, line(`${data.agent} : ${data.task}`, 'agent'));
                else if (type === 'agent_text') drafts.get(data.node)?.classList.add('working');
                else if (type === 'changes') {
                    created.push(...data.nodes.filter(n => !store.state.nodes.has(n.id)).map(n => n.id));
                    const inverse = store.applyRemote(data);
                    if (inverse) inverses.push(inverse);
                }
            });
        } catch (error) {
            line(error.message, 'error');
        } finally {
            camera.stopDrift();
            if (!guided && created.length) camera.follow(created);
            drafts.forEach(item => item.classList.remove('working'));
            store.record(inverses);
            busy = false;
            form.classList.remove('busy');
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        submit();
    });
    prompt.addEventListener('input', grow);
    prompt.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
        } else if (event.key === 'Escape') {
            prompt.blur();
        }
    });
    reply.addEventListener('click', () => { reply.hidden = true; });
    // Revenir au canevas rend les raccourcis (Ctrl+Z annule toute la réponse du Gardien).
    document.getElementById('nodz').addEventListener('pointerdown', () => prompt.blur());

    // Clavier virtuel (mobile) : la barre reste au-dessus.
    const vv = window.visualViewport;
    if (vv) {
        vv.addEventListener('resize', () => {
            const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
            document.documentElement.style.setProperty('--keyboard', `${keyboard}px`);
        });
    }
}
