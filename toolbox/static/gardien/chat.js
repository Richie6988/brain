// Chat du Gardien, en bas à droite : une bulle qui s'ouvre sur la conversation. On y écrit au Gardien
// sans passer par un node ; ses réponses s'y affichent et ses actions se jouent dans l'univers. Les
// échanges lancés depuis un node (pastille, Ctrl+Entrée) y apparaissent aussi. Des nodes peuvent être
// joints au prochain message (multisélection) : le Gardien lit leur texte complet pour cette demande
// seulement. La réflexion du Gardien s'écrit en direct dans un bloc repliable ; chaque message se copie.
// L'historique récent est gardé dans ce navigateur.
// Deux modes : Pensée (par défaut) : le chat est une barre de contexte, l'IA pense à voix haute en nodes autour du node
// source et ne répond que dans l'univers ; Automatisation : l'ancien Gardien agentique (web, fichiers, agents, missions).

import { h } from './library.js';

const KEY = 'gardien-chat';
const MODE_KEY = 'gardien-mode';
const PLACEHOLDER = { think: 'Consigne optionnelle, puis Entrée…', deep: 'Consigne optionnelle, puis Entrée…', auto: 'Écris au Gardien…' };
const HINT = {
    think: 'Sélectionne un node (ou joins-en avec Filtres), ajoute une consigne si tu veux, puis Entrée : la pensée du Gardien '
        + 'pousse en nodes autour du node, et ses résultats s\'y rattachent.',
    deep: 'Mode Profond : le Gardien pense d\'abord librement (étincelles bleues), puis sa pensée pousse en nodes, avec '
        + 'ses doutes, ses pistes écartées et les mots qu\'il a failli dire.',
    auto: 'Demande-lui de créer, relier, ranger, chercher sur le web, construire une matrice ou une frise, '
        + 'ou de te faire visiter une branche. Tu peux aussi lui envoyer un node avec sa pastille.',
};
const KEEP = 60;
const THINK_KEEP = 6000;  // caractères de réflexion gardés par message
// Suggestions en pastilles au-dessus de la saisie : un clic pose la demande dans le champ, à compléter ou envoyer.
const IDEAS = ['Résume cette dimension', 'Relie les idées proches', 'Fais un SWOT de ', 'Range en kanban'];

export function createChat({ onSend, onStop = () => {}, onMemory = () => {}, onGoto = () => {}, onExchanges = () => {}, onMode = () => {} }) {
    let mode = 'think';
    try {
        mode = ['auto', 'deep'].includes(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'think';
    } catch { /* stockage indisponible : mode Pensée */ }
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
    const statusText = h('span');
    const status = h('div', { class: 'gc-status' }, h('i', { class: 'gc-dots' }, h('i'), h('i'), h('i')), statusText);
    const ideas = h('div', { class: 'gc-ideas' }, IDEAS.map(idea => h('button', { type: 'button', onclick: () => {
        input.value = idea;
        grow();
        input.focus();
        input.setSelectionRange(idea.length, idea.length);
        ideas.hidden = true;
    } }, idea.trim())));
    const input = h('textarea', { rows: 1, placeholder: PLACEHOLDER[mode], 'aria-label': 'Message au Gardien' });
    const send = h('button', { type: 'submit', class: 'gc-send', title: 'Envoyer (Entrée)' }, '↑');
    const form = h('form', { class: 'gc-form' }, input, send);
    let attached = [];  // nodes joints au prochain message (pastille, sélecteur de contexte)
    let ignored = '';  // sélection retirée du contexte par ×, tant qu'elle ne change pas
    let working = false;  // une demande est en cours : le bouton d'envoi l'arrête
    const tray = h('div', { class: 'gc-attach' });
    const nodeText = node => node.children[0]?.children[0]?.innerText?.trim() || '(vide)';
    const item = node => ({ id: node.id, text: nodeText(node) });  // un node joint : son id et son texte (autre dimension comprise)
    const selection = () => (typeof selectedNodes !== 'undefined' ? selectedNodes : []).filter(n => n.isConnected);
    const signature = nodes => nodes.map(n => n.id).sort().join(',');
    // Le contexte de la prochaine demande : les nodes joints, plus la sélection en cours, sans clic (× la retire).
    function context() {
        const chosen = selection();
        const nodes = [...attached, ...(chosen.length && signature(chosen) !== ignored ? chosen.map(item) : [])];
        return nodes.filter((n, i) => nodes.findIndex(m => m.id === n.id) === i);
    }
    function renderTray() {
        const nodes = context();
        tray.replaceChildren(...(nodes.length
            ? [h('span', { class: 'gc-chip', title: nodes.map(n => `${n.id} : ${n.text.slice(0, 60)}`).join('\n') },
                `${nodes.length} node${nodes.length > 1 ? 's' : ''} en contexte : `,
                nodes.slice(0, 3).map(n => (n.text || '(vide)').slice(0, 18)).join(', ') + (nodes.length > 3 ? '…' : ''),
                h('button', { type: 'button', title: 'Retirer du contexte', onclick: () => { attached = []; ignored = signature(selection()); renderTray(); } }, '×'))]
            : []));
    }
    // La sélection change (clic, rectangle, Ctrl+A, amont / aval) : le contexte suit, chat ouvert.
    ['mouseup', 'keyup'].forEach(type => document.addEventListener(type, () => setTimeout(() => { if (!panel.hidden) renderTray(); }), true));
    // Correspondance : les notes que le Gardien a laissées, posées dans la dimension « Échanges » à l'ouverture.
    const exchanges = h('button', { type: 'button', class: 'gc-exchanges', title: 'Notes du Gardien (dimension Échanges) : réponds dans un node relié',
        onclick: () => { toggle(false); onExchanges(); } }, 'Échanges');
    // Mémoire, Échanges, Effacer : dans le menu ⋯ de l'en-tête (il s'allume quand des notes attendent).
    const menu = h('div', { class: 'gc-menu', hidden: true },
        h('button', { type: 'button', title: 'Voir la mémoire du Gardien dans l\'univers (dimension Gardien)', onclick: () => { toggle(false); onMemory(); } }, 'Mémoire'),
        exchanges,
        h('button', { type: 'button', class: 'gc-clear', title: 'Effacer la conversation', onclick: () => { menu.hidden = true; clear(); } }, 'Effacer'));
    const more = h('button', { type: 'button', class: 'gc-more', title: 'Plus', onclick: () => { menu.hidden = !menu.hidden; } }, '⋯');
    const state = h('small', { class: 'gc-state' }, 'en ligne');
    const modes = h('div', { class: 'gc-mode', role: 'group', 'aria-label': 'Mode du Gardien' },
        h('button', { type: 'button', 'data-mode': 'think', title: 'Pensée : l\'IA pense à voix haute en nodes, autour du node source' }, 'Pensée'),
        h('button', { type: 'button', 'data-mode': 'deep', title: 'Profond : réflexion libre d\'abord, puis la pensée (plus long)' }, 'Profond'),
        h('button', { type: 'button', 'data-mode': 'auto', title: 'Automatisation : web, fichiers, agents et missions' }, 'Auto'));
    modes.addEventListener('click', event => {
        const next = event.target.closest?.('button')?.dataset.mode;
        if (!next || next === mode) return;
        mode = next;
        try {
            localStorage.setItem(MODE_KEY, mode);
        } catch { /* stockage indisponible */ }
        showMode();
        onMode(mode);
    });
    function showMode() {
        modes.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
        input.placeholder = PLACEHOLDER[mode];
        log.querySelector('.gc-hint p')?.replaceChildren(HINT[mode]);
    }
    const panel = h('section', { class: 'gc-panel', hidden: true, role: 'dialog', 'aria-label': 'Chat du Gardien' },
        h('header', {}, h('i', { class: 'gc-avatar' }), h('div', {}, h('strong', {}, 'Gardien'), state), modes,
            h('span', { class: 'gc-more-wrap' }, more, menu),
            h('button', { type: 'button', class: 'gc-close', title: 'Réduire', onclick: () => toggle(false) }, '×')),
        log, status, tray, ideas, form);
    // Deux nodes ou plus sélectionnés (Pensée, Profond) : la pastille envoie aussitôt, la sélection est le contexte.
    const bubble = h('button', { type: 'button', id: 'gardien-chat-button', title: 'Gardien', onclick: () => {
        if (mode !== 'auto' && !working && selection().length > 1) onSend('Pense à partir de ces nodes.', [], true);
        else toggle();
    } }, h('i', {}), h('b', { hidden: true }));
    const root = h('div', { id: 'gardien-chat' }, panel, bubble);
    document.body.append(root);

    // Un clic ailleurs (univers, barre, autre fenêtre) referme la conversation ; la pastille, qui y joint des
    // nodes, la rouvre aussitôt.
    document.addEventListener('mousedown', event => {
        if (!panel.hidden && !root.contains(event.target) && !event.target.closest?.('#gardien-send')) toggle(false);
        if (!more.parentNode.contains(event.target)) menu.hidden = true;
    }, true);
    // La saisie ne déclenche pas les raccourcis de Nodz (Espace crée un node, Suppr efface…).
    ['keydown', 'keyup', 'keypress'].forEach(type => panel.addEventListener(type, event => event.stopPropagation()));
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!working) form.requestSubmit();  // Entrée n'arrête jamais le Gardien : seul le bouton stop
        }
        if (event.key === 'Escape') toggle(false);
    });
    input.addEventListener('input', () => {
        grow();
        ideas.hidden = working || !!input.value.trim();
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (working) return onStop();  // pendant une réflexion, le bouton d'envoi est le stop
        const nodes = context();
        // Pensée : la consigne est optionnelle, un node en contexte suffit.
        const text = input.value.trim() || (mode !== 'auto' && nodes.length ? 'Pense à partir de ce node.' : '');
        if (!text) return;
        input.value = '';
        grow();
        onSend(text, nodes.map(n => n.id));
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
            : [h('li', { class: 'gc-hint' }, h('p', {}, HINT[mode]))]));
        log.scrollTop = log.scrollHeight;
    }
    function clear() {
        history = [];
        store();
        render();
    }

    render();
    showMode();
    return {
        mode: () => mode,
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
            more.classList.toggle('on', !!count);
        },
        status(text) { statusText.textContent = text || 'le Gardien écrit'; },
        busy(on) {
            working = on;
            send.textContent = on ? '■' : '↑';
            send.title = on ? 'Arrêter le Gardien' : 'Envoyer (Entrée)';
            send.classList.toggle('stop', on);
            root.classList.toggle('busy', on);
            status.classList.toggle('on', on);
            state.textContent = on ? 'réfléchit…' : 'en ligne';
            ideas.hidden = on || !!input.value.trim();
            statusText.textContent = on ? 'le Gardien écrit' : '';
        },
        open: () => toggle(true),
        // Nodes joints (pastille, sélecteur de contexte) : [{ id, text }], de toutes les dimensions.
        attach(items) {
            attached = items;
            toggle(true);
            renderTray();
        },
    };
}
