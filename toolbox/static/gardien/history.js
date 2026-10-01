// Historique universel de /universe : Ctrl+Z annule, Ctrl+Y (ou Ctrl+Maj+Z) rétablit, quel que soit l'auteur du
// geste (souris, clavier, Gardien). Tout changement de node passe par save() de Nodz, toute création par
// createNode, toute suppression par deleteNode / deleteLink / deleteTemplates, toute liaison par createLink : on
// les enveloppe pour noter, par node, l'état d'avant et l'état d'après. Les notes d'un même geste (300 ms) ou
// d'une même demande au Gardien forment une transaction, qu'un Ctrl+Z défait d'un coup.
// Dans un texte en cours de frappe, Ctrl+Z reste celui du navigateur.

const FIELDS = ['x', 'y', 'type', 'color', 'shape', 'ratio', 'layer', 'textcontent', 'imagecontent', 'canvascontent',
    'filename', 'file', 'lock', 'notification'];
const IDLE = 300;      // ms sans nouvelle note : le geste est fini
const TYPING = 5000;   // frappe sur un même node : les sauvegardes successives restent une seule transaction
const LIMIT = 200;     // transactions gardées
const SETTLE = 400;    // ms après un Ctrl+Z : les retouches différées de Nodz (tailles, aperçus) ne sont pas des gestes

export function createHistory({ onGesture = () => {} } = {}) {  // onGesture(genre) : un geste vient d'avoir lieu (effets sonores)
    const known = new Map();   // id du node → dernier état sauvegardé
    const fresh = new Set();   // nodes créés depuis leur dernière sauvegarde
    const done = [], undone = [];
    let open = null, timer = 0, held = 0, replaying = 0, deleting = 0, settled = 0;

    const byId = id => document.getElementById(id);
    const snap = node => {
        const state = { r: node.children[1].getAttribute('r') };
        FIELDS.forEach(f => { state[f] = node.getAttribute(f); });
        state.x = Math.round(state.x);
        state.y = Math.round(state.y);
        return state;
    };
    const differs = (a, b) => a.r !== b.r || FIELDS.some(f => a[f] !== b[f]);
    // Taper change le texte et, avec lui, la taille du node.
    const typing = (a, b) => a.textcontent !== b.textcontent && !FIELDS.some(f => f !== 'textcontent' && a[f] !== b[f]);
    const quiet = () => replaying || deleting || isLoading || quantum || performance.now() < settled;

    function close() {
        clearTimeout(timer);
        if (!held) open = null;
    }

    function note(entry) {
        undone.length = 0;
        const last = done[done.length - 1];
        if (!open && last && entry.kind === 'node' && last.entries.length === 1 && last.entries[0].id === entry.id
            && entry.after && last.entries[0].after && typing(last.entries[0].after, entry.after) && performance.now() - last.at < TYPING) {
            open = last;
        }
        if (!open) {
            open = { entries: [], at: 0 };
            done.push(open);
            if (done.length > LIMIT) done.shift();
        }
        const merged = open.entries.find(e => e.kind === 'node' && entry.kind === 'node' && e.id === entry.id);
        if (merged) Object.assign(merged, { after: entry.after, clone: entry.clone || merged.clone });
        else open.entries.push(entry);
        open.at = performance.now();
        clearTimeout(timer);
        timer = setTimeout(close, IDLE);
    }

    // Retire un node et ses liens de la page seulement : il renaît aussitôt dans un autre état, même id.
    function detach(node) {
        JSON.parse(node.getAttribute('links') || '[]').forEach(id => {
            const link = byId(id);
            if (!link) return;
            const other = byId(link.getAttribute('Node1') === node.id ? link.getAttribute('Node2') : link.getAttribute('Node1'));
            if (other) {
                other.setAttribute('links', JSON.stringify(JSON.parse(other.getAttribute('links') || '[]').filter(l => l !== id)));
                other.setAttribute('siblings', JSON.stringify(JSON.parse(other.getAttribute('siblings') || '[]').filter(n => n !== node.id)));
            }
            byId(`grad${id}`)?.remove();
            link.remove();
        });
        node.remove();
    }

    // Amène un node (ou un lien, ou des gabarits) dans l'état noté ; null : absent.
    function reach(entry, state) {
        if (entry.kind === 'link') {
            const link = byId(entry.id);
            const a = byId(entry.a), b = byId(entry.b);
            if (state && !link && a && b) {
                createLink(a, b, entry.id);
                save(a);
                save(b);
            } else if (!state && link) deleteLink(link);
            return;
        }
        if (entry.kind === 'templates') {
            if (state) restoreTemplates(entry.clones);
            else deleteTemplates(entry.ids.map(byId).filter(Boolean));
            return;
        }
        const node = byId(entry.id);
        if (!state) {
            if (!node) return;
            entry.clone = node.cloneNode(true);
            deleteNode([node]);
            selectedNodes.length = 0;
            return;
        }
        const source = node ? node.cloneNode(true) : entry.clone;
        if (!source) return;
        FIELDS.forEach(f => { if (state[f] === null) source.removeAttribute(f); else source.setAttribute(f, state[f]); });
        source.children[1].setAttribute('r', state.r);
        if (node) {
            selectedNodes.splice(0, selectedNodes.length, ...selectedNodes.filter(n => n !== node));
            if (currentNode === node) currentNode = null;
            detach(node);
        }
        restoreNodes([source]);
        const reborn = byId(entry.id);
        if (reborn) [reborn, ...JSON.parse(reborn.getAttribute('siblings') || '[]').map(byId).filter(Boolean)].forEach(n => save(n));
    }

    function replay(transaction, forward) {
        const entries = forward ? transaction.entries : [...transaction.entries].reverse();
        replaying += 1;
        try {
            entries.forEach(entry => {
                try {
                    reach(entry, forward ? entry.after : entry.before);
                } catch (error) {
                    console.error('historique :', error);
                }
            });
        } finally {
            replaying -= 1;
            settled = performance.now() + SETTLE;
        }
        document.activeElement?.blur();
    }

    function undo() {
        clearTimeout(timer);
        open = null;
        const transaction = done.pop();
        if (!transaction) return;
        onGesture('undo');
        replay(transaction, false);
        undone.push(transaction);
    }

    function redo() {
        clearTimeout(timer);
        open = null;
        const transaction = undone.pop();
        if (!transaction) return;
        onGesture('redo');
        replay(transaction, true);
        done.push(transaction);
    }

    // --- les fonctions de Nodz, enveloppées (les scripts classiques les appellent par leur nom global)

    const nodz = { createNode, save, deleteNode, createLink, deleteLink, deleteTemplates, load };

    window.createNode = function (...args) {
        const node = nodz.createNode(...args);
        if (!quiet()) {
            fresh.add(node.id);
            onGesture('create');
        }
        return node;
    };

    window.save = function (node, tunnel) {
        const now = snap(node);
        const before = known.get(node.id);
        known.set(node.id, now);
        if (!quiet() && !admin) {
            if (fresh.delete(node.id) && !before) note({ kind: 'node', id: node.id, before: null, after: now });
            else if (before && differs(before, now)) note({ kind: 'node', id: node.id, before, after: now });
        }
        return nodz.save(node, tunnel);
    };

    window.deleteNode = function (nodes) {
        const list = Array.from(nodes);
        if (!quiet() && list.length) onGesture('delete');
        if (!quiet()) list.forEach(node => note({ kind: 'node', id: node.id, before: known.get(node.id) || snap(node), after: null, clone: node.cloneNode(true) }));
        deleting += 1;
        try {
            return nodz.deleteNode(nodes);
        } finally {
            deleting -= 1;
            list.forEach(node => { known.delete(node.id); fresh.delete(node.id); });
        }
    };

    window.createLink = function (a, b, id) {
        const result = nodz.createLink(a, b, id);
        if (!id && !quiet()) onGesture('link');
        if (!id && !quiet()) note({ kind: 'link', id: `L-${linkCounter}`, a: a.id, b: b.id, before: false, after: true });
        return result;
    };

    window.deleteLink = function (link) {
        if (!quiet()) onGesture('unlink');
        if (!quiet()) note({ kind: 'link', id: link.id, a: link.getAttribute('Node1'), b: link.getAttribute('Node2'), before: true, after: false });
        return nodz.deleteLink(link);
    };

    window.deleteTemplates = function (templates) {
        if (!quiet()) note({ kind: 'templates', ids: templates.map(t => t.id), clones: templates.map(t => t.cloneNode(true)), before: true, after: false });
        return nodz.deleteTemplates(templates);
    };

    // Changer de dimension repart d'un historique vide, comme Nodz le faisait.
    window.load = function (...args) {
        done.length = 0;
        undone.length = 0;
        open = null;
        return nodz.load(...args);
    };

    document.querySelectorAll('.node-group').forEach(node => known.set(node.id, snap(node)));

    document.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || isTyping) return;
        if (event.target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
        const key = event.key.toLowerCase();
        const back = key === 'z' && !event.shiftKey;
        if (!back && key !== 'y' && !(key === 'z' && event.shiftKey)) return;
        event.preventDefault();
        isCtrlPressed = false;
        if (back) undo();
        else redo();
    });

    return {
        undo,
        redo,
        // Une demande au Gardien : tout ce qu'il pose jusqu'à end() s'annule d'un seul Ctrl+Z.
        begin() {
            close();
            open = null;
            held += 1;
        },
        end() {
            held = Math.max(0, held - 1);
            if (!held) close();
        },
    };
}
