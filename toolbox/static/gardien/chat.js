// Chat du Gardien, en bas à droite : une bulle qui s'ouvre sur la conversation. On y écrit au Gardien
// sans passer par un node ; ses réponses s'y affichent et ses actions se jouent dans l'univers. Les
// échanges lancés depuis un node (pastille, Ctrl+Entrée) y apparaissent aussi. L'historique récent est
// gardé dans ce navigateur.

import { h } from './library.js';

const KEY = 'gardien-chat';
const KEEP = 60;

export function createChat({ onSend }) {
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch { /* stockage indisponible : conversation vide */ }
    const store = () => {
        try {
            localStorage.setItem(KEY, JSON.stringify(history.slice(-KEEP)));
        } catch { /* stockage indisponible */ }
    };

    const log = h('ol', { class: 'gc-log', 'aria-live': 'polite' });
    const status = h('p', { class: 'gc-status' });
    const input = h('textarea', { rows: 1, placeholder: 'Écris au Gardien…', 'aria-label': 'Message au Gardien' });
    const send = h('button', { type: 'submit', class: 'gc-send', title: 'Envoyer (Entrée)' }, '↑');
    const form = h('form', { class: 'gc-form' }, input, send);
    const panel = h('section', { class: 'gc-panel', hidden: true, role: 'dialog', 'aria-label': 'Chat du Gardien' },
        h('header', {}, h('i', { class: 'gc-avatar' }), h('div', {}, h('strong', {}, 'Gardien'), h('small', {}, 'Il agit dans ton univers')),
            h('button', { type: 'button', class: 'gc-clear', title: 'Effacer la conversation', onclick: clear }, 'Effacer'),
            h('button', { type: 'button', class: 'gc-close', title: 'Réduire', onclick: () => toggle(false) }, '×')),
        log, status, form);
    const bubble = h('button', { type: 'button', id: 'gardien-chat-button', title: 'Parler au Gardien', onclick: () => toggle() }, h('i', {}), h('b', { hidden: true }));
    const root = h('div', { id: 'gardien-chat' }, panel, bubble);
    document.body.append(root);

    // La saisie ne déclenche pas les raccourcis de Nodz (Espace crée un node, Suppr efface…).
    ['keydown', 'keyup', 'keypress'].forEach(type => panel.addEventListener(type, event => event.stopPropagation()));
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
        if (event.key === 'Escape') toggle(false);
    });
    input.addEventListener('input', grow);
    form.addEventListener('submit', event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || send.disabled) return;
        input.value = '';
        grow();
        onSend(text);
    });

    function grow() {
        input.style.height = 'auto';
        input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    }

    let unread = 0;
    function toggle(open = panel.hidden) {
        panel.hidden = !open;
        root.classList.toggle('open', open);
        if (open) {
            unread = 0;
            badge();
            log.scrollTop = log.scrollHeight;
            input.focus();
        }
    }
    function badge() {
        const b = bubble.querySelector('b');
        b.hidden = !unread;
        b.textContent = unread;
    }

    function line({ role, text, from }) {
        return h('li', { class: `gc-${role}` }, from ? h('small', {}, from) : null, h('p', {}, text));
    }
    function render() {
        log.replaceChildren(...(history.length ? history.map(line)
            : [h('li', { class: 'gc-hint' }, h('p', {}, 'Demande-lui de créer, relier, ranger, chercher sur le web, construire une matrice ou une frise, '
                + 'ou de te faire visiter une branche. Tu peux aussi lui envoyer un node avec sa pastille.'))]));
        log.scrollTop = log.scrollHeight;
    }
    function clear() {
        history = [];
        store();
        render();
    }

    render();
    return {
        // role : user, guardian, notice, error ; from : d'où vient le message (node N-12…)
        add(role, text, from) {
            if (!text) return;
            history.push({ role, text, from });
            history = history.slice(-KEEP);
            store();
            log.append(line({ role, text, from }));
            log.querySelector('.gc-hint')?.remove();
            log.scrollTop = log.scrollHeight;
            if (panel.hidden && role !== 'user') {
                unread += 1;
                badge();
            }
        },
        status(text) { status.textContent = text || ''; },
        busy(on) {
            send.disabled = on;
            root.classList.toggle('busy', on);
            if (!on) status.textContent = '';
        },
        open: () => toggle(true),
    };
}
