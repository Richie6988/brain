// Chat du Gardien, en bas à droite : une bulle qui s'ouvre sur la conversation. On y écrit au Gardien
// sans passer par un node ; ses réponses s'y affichent et ses actions se jouent dans l'univers. Les
// échanges lancés depuis un node (pastille, Ctrl+Entrée) y apparaissent aussi. Des nodes peuvent être
// joints au prochain message (multisélection) : le Gardien lit leur texte complet pour cette demande
// seulement. La réflexion du Gardien s'écrit en direct dans un bloc repliable ; chaque message se copie.
// L'historique récent est gardé dans ce navigateur.

import { h } from './library.js';

const KEY = 'gardien-chat';
const KEEP = 60;
const THINK_KEEP = 6000;  // caractères de réflexion gardés par message

export function createChat({ onSend, onMemory = () => {}, onGoto = () => {}, onExchanges = () => {} }) {
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
    let attached = [];  // nodes joints au prochain message
    const tray = h('div', { class: 'gc-attach' });
    const nodeText = node => node.children[0]?.children[0]?.innerText?.trim() || '(vide)';
    function renderTray() {
        const selection = (typeof selectedNodes !== 'undefined' ? selectedNodes : []).filter(n => n.isConnected);
        tray.replaceChildren(...(attached.length
            ? [h('span', { class: 'gc-chip', title: attached.map(n => `${n.id} : ${nodeText(n).slice(0, 60)}`).join('\n') },
                `${attached.length} node${attached.length > 1 ? 's' : ''} joint${attached.length > 1 ? 's' : ''} : `,
                attached.slice(0, 3).map(n => nodeText(n).slice(0, 18)).join(', ') + (attached.length > 3 ? '…' : ''),
                h('button', { type: 'button', title: 'Retirer', onclick: () => { attached = []; renderTray(); } }, '×'))]
            : selection.length ? [h('button', { type: 'button', class: 'gc-join', onclick: () => { attached = selection; renderTray(); input.focus(); } },
                `+ Joindre la sélection (${selection.length} node${selection.length > 1 ? 's' : ''})`)] : []));
    }
    // Correspondance : les notes que le Gardien a laissées, posées dans la dimension « Échanges » à l'ouverture.
    const exchanges = h('button', { type: 'button', class: 'gc-exchanges', title: 'Notes du Gardien (dimension Échanges) : réponds dans un node relié',
        onclick: () => { toggle(false); onExchanges(); } }, 'Échanges');
    const panel = h('section', { class: 'gc-panel', hidden: true, role: 'dialog', 'aria-label': 'Chat du Gardien' },
        h('header', {}, h('i', { class: 'gc-avatar' }), h('div', {}, h('strong', {}, 'Gardien'), h('small', {}, 'Il agit dans ton univers')),
            h('button', { type: 'button', title: 'Voir la mémoire du Gardien dans l\'univers (dimension Gardien)', onclick: () => { toggle(false); onMemory(); } }, 'Mémoire'),
            exchanges,
            h('button', { type: 'button', class: 'gc-clear', title: 'Effacer la conversation', onclick: clear }, 'Effacer'),
            h('button', { type: 'button', class: 'gc-close', title: 'Réduire', onclick: () => toggle(false) }, '×')),
        log, status, tray, form);
    const bubble = h('button', { type: 'button', id: 'gardien-chat-button', title: 'Parler au Gardien', onclick: () => toggle() }, h('i', {}), h('b', { hidden: true }));
    const root = h('div', { id: 'gardien-chat' }, panel, bubble);
    document.body.append(root);

    // Un clic ailleurs (univers, barre, autre fenêtre) referme la conversation ; la pastille, qui y joint des
    // nodes, la rouvre aussitôt.
    document.addEventListener('mousedown', event => {
        if (!panel.hidden && !root.contains(event.target) && !event.target.closest?.('#gardien-send')) toggle(false);
    }, true);
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
        onSend(text, attached.filter(n => n.isConnected).map(n => n.id));
        attached = [];  // contexte de cette demande seulement
        renderTray();
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
            renderTray();
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

    // Copie dans le presse-papiers ; sans accès (page non sécurisée), par une zone de texte temporaire.
    async function copy(text, button) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const area = h('textarea', { style: 'position:fixed;opacity:0' });
            area.value = text;
            document.body.append(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        button.classList.add('done');
        button.title = 'Copié';
        setTimeout(() => { button.classList.remove('done'); button.title = 'Copier'; }, 1200);
    }
    const copyButton = entry => {
        const button = h('button', { type: 'button', class: 'gc-copy', title: 'Copier' });
        button.addEventListener('click', () => copy(entry.text, button));
        return button;
    };

    // Réflexion du Gardien, comme Poséidon : son plan s'écrit en direct dans un bloc qui se replie à la fin.
    function thinking(entry) {
        const label = h('span', { class: 'gc-think-label' }, entry.label || 'Réflexion', entry.label ? null : h('i', { class: 'gc-dots' }, h('i'), h('i'), h('i')));
        const body = h('pre', {}, entry.text);
        const details = h('details', { open: !entry.label }, h('summary', {}, h('span', { class: 'gc-spark' }, '✦'), label), body);
        return h('li', { class: `gc-think${entry.label ? '' : ' live'}` }, details, copyButton(entry));
    }

    // Question du Gardien : ses choix sont des boutons ; un clic répond (comme un message écrit), une seule fois.
    function choices(entry) {
        if (!entry.choices?.length) return null;
        const row = h('div', { class: 'gc-choices' }, entry.choices.map(choice => {
            const button = h('button', { type: 'button', class: entry.answer === choice ? 'on' : '' }, choice);
            button.disabled = !!entry.answer;
            button.addEventListener('click', () => {
                entry.answer = choice;
                store();
                row.querySelectorAll('button').forEach(b => { b.disabled = true; b.classList.toggle('on', b === button); });
                onSend(choice, []);
            });
            return button;
        }));
        return row;
    }

    // Nodes créés ou modifiés par le Gardien : un lien par node, qui y voyage (même depuis une autre dimension).
    function refs(entry) {
        return h('li', { class: 'gc-links' }, h('small', {}, entry.text), h('div', {}, entry.items.map(item =>
            h('button', { type: 'button', title: `Aller à ${item.id}`, onclick: () => onGoto(item.id, item.layer) },
                h('b', {}, item.id), item.label ? ` ${item.label}` : ''))));
    }

    function line(entry) {
        if (entry.role === 'think') return thinking(entry);
        if (entry.role === 'links') return refs(entry);
        const { role, text, from } = entry;
        return h('li', { class: `gc-${role}${entry.choices ? ' gc-question' : ''}` }, from ? h('small', {}, from) : null, h('p', {}, text),
            choices(entry), role === 'notice' ? null : copyButton(entry));
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
        // role : user, guardian, notice, error ; from : d'où vient le message (node N-12…) ; choices : question
        add(role, text, from, choices) {
            if (!text) return;
            const entry = { role, text, from, ...(choices?.length ? { choices } : {}) };
            history.push(entry);
            history = history.slice(-KEEP);
            store();
            log.append(line(entry));
            log.querySelector('.gc-hint')?.remove();
            log.scrollTop = log.scrollHeight;
            if (panel.hidden && role !== 'user') {
                unread += 1;
                badge();
            }
        },
        // Bloc de réflexion en direct : append(fragment), puis end(libellé) le replie et le garde dans l'historique.
        think() {
            const entry = { role: 'think', text: '' };
            const li = thinking(entry);
            const body = li.querySelector('pre');
            log.append(li);
            log.querySelector('.gc-hint')?.remove();
            history.push(entry);
            return {
                append(piece) {
                    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
                    entry.text += piece;
                    body.textContent = entry.text;
                    body.scrollTop = body.scrollHeight;
                    if (stick) log.scrollTop = log.scrollHeight;
                },
                end(label) {
                    if (!entry.text) {
                        li.remove();
                        history = history.filter(e => e !== entry);
                        return;
                    }
                    entry.label = label;
                    entry.text = entry.text.slice(0, THINK_KEEP);
                    li.classList.remove('live');
                    li.querySelector('.gc-think-label').replaceChildren(label);
                    setTimeout(() => li.querySelector('details').removeAttribute('open'), 600);
                    history = history.slice(-KEEP);
                    store();
                },
            };
        },
        // Liens vers des nodes : items = [{ id, layer, label }].
        links(text, items) {
            if (!items.length) return;
            const entry = { role: 'links', text, items };
            history.push(entry);
            history = history.slice(-KEEP);
            store();
            log.append(refs(entry));
            log.scrollTop = log.scrollHeight;
        },
        // Derniers échanges (humain, Gardien) rappelés au Gardien : il suit la conversation.
        recent(n = 6) {
            return history.filter(e => e.role === 'user' || e.role === 'guardian').slice(-n).map(({ role, text }) => ({ role, text }));
        },
        // Notes du Gardien pas encore posées dans Échanges.
        unread(count) {
            exchanges.textContent = count ? `Échanges · ${count}` : 'Échanges';
            exchanges.classList.toggle('on', !!count);
        },
        status(text) { status.textContent = text || ''; },
        busy(on) {
            send.disabled = on;
            root.classList.toggle('busy', on);
            if (!on) status.textContent = '';
        },
        open: () => toggle(true),
        // Multisélection envoyée par la pastille : jointe au prochain message.
        attach(nodes) {
            attached = nodes;
            toggle(true);
            renderTray();
        },
    };
}
