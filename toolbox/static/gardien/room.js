// Salons multijoueur. L'hôte ouvre sa dimension par un lien (bouton Partager) ; ceux qui le suivent voient son
// univers, les curseurs nommés de chacun et chaque geste en direct, et peuvent l'éditer. Le navigateur de l'hôte fait
// autorité : chaque sauvegarde de Nodz (/save-node/, /delete/) part aussi dans le salon ; l'hôte applique celles des
// autres et les enregistre dans son univers ; un invité n'écrit jamais rien sur le serveur pendant le salon, ni dans
// son propre univers. Le serveur relaie et signe chaque message de son auteur (toolbox/rooms.py). Tout ce qui vient
// d'un autre compte est nettoyé avant d'entrer dans la page (texte du node, couleur, image, dessin).
// Chacun choisit son pseudo et son avatar (gardés dans ce navigateur) : le serveur les nettoie et garde seul l'identité
// du compte et la marque d'hôte.

import { api } from './api.js';

const BASE = document.documentElement.dataset.base || '';
const COLORS = ['#FF6B6B', '#FFD93D', '#33FF99', '#4D96FF', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5'];
// Avatars du salon : une couleur et un dessin chacun (la liste est aussi celle du serveur, rooms.AVATARS).
const AVATARS = {
    fox: ['Renard', '#FF9F45', '<path d="M4 5l4 4h8l4-4-1 9-7 6-7-6z"/><circle cx="9.5" cy="12" r=".8"/><circle cx="14.5" cy="12" r=".8"/>'],
    owl: ['Chouette', '#C77DFF', '<circle cx="8.5" cy="11" r="3"/><circle cx="15.5" cy="11" r="3"/><path d="M5 6l3 2M19 6l-3 2M11 15l1 2 1-2"/>'],
    cat: ['Chat', '#4DD4C6', '<path d="M5 4l3 5h8l3-5v10a7 6 0 0 1-14 0z"/><path d="M9 13h.01M15 13h.01M10 16l2 1 2-1"/>'],
    bot: ['Robot', '#4D96FF', '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M10 16h4"/>'],
    star: ['Étoile', '#FFD93D', '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'],
    leaf: ['Feuille', '#33FF99', '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l8-8"/>'],
    wave: ['Vague', '#7FB3FF', '<path d="M3 14c3-4 6-4 9 0s6 4 9 0M3 9c3-4 6-4 9 0s6 4 9 0"/>'],
    flame: ['Flamme', '#FF6B6B', '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-3 0-5 0-7z"/>'],
};
const glyph = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${(AVATARS[key] || AVATARS.star)[2]}</svg>`;
const PROFILE = 'gardien-room-profile';
const BLOCK = 10000;  // plage d'identifiants de nodes et de liens propre à chaque invité : pas de collision
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'A',
    'CODE', 'PRE', 'H1', 'H2', 'H3', 'SUB', 'SUP', 'BLOCKQUOTE', 'HR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'LINK', 'META', 'IMG', 'VIDEO', 'AUDIO']);

// Texte d'un node venu d'un autre compte : seulement la mise en forme de Nodz (gras, couleurs, listes, liens web).
export function clean(markup) {
    const doc = new DOMParser().parseFromString(`<body>${markup ?? ''}</body>`, 'text/html');  // inerte : rien ne s'exécute
    const walk = parent => [...parent.children].forEach(el => {
        const tag = el.tagName.toUpperCase();
        if (DROP.has(tag)) return el.remove();
        walk(el);
        if (!TAGS.has(tag)) return el.replaceWith(...el.childNodes);
        [...el.attributes].forEach(({ name }) => {
            const kept = name === 'style' || (tag === 'FONT' && ['color', 'size', 'face'].includes(name)) || (tag === 'A' && name === 'href');
            if (!kept) el.removeAttribute(name);
        });
        if (/url\(|expression|javascript:|@import/i.test(el.getAttribute('style') || '')) el.removeAttribute('style');
        if (tag === 'A') {
            if (!/^https?:\/\//i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }
    });
    walk(doc.body);
    return doc.body.innerHTML;
}

const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const localUrl = value => (typeof value === 'string' && (/^\/(?!\/)/.test(value) || value.startsWith(`${location.origin}/`) || /^data:image\/(png|jpe?g|gif|webp);/.test(value)) ? value : '');
const drawing = value => {
    try {
        const parsed = JSON.parse(value || '[]');
        return typeof parsed === 'object' && parsed ? JSON.stringify(parsed) : '[]';
    } catch {
        return '[]';
    }
};

export function createRoom({ bridge, say }) {
    let socket = null, me = null, room = null, role = null, applying = 0, layer = null, following = null, moving = false;
    // Mon pseudo et mon avatar : choisis une fois, gardés dans ce navigateur (vide : le nom du compte).
    let profile = { name: '', avatar: Object.keys(AVATARS)[Math.floor(Math.random() * 8)] };
    try {
        profile = { ...profile, ...JSON.parse(localStorage.getItem(PROFILE) || '{}') };
    } catch { /* stockage indisponible : un avatar au hasard pour cette visite */ }
    const colorOf = who => AVATARS[who.avatar]?.[1] || COLORS[who.id % COLORS.length];
    let hostLayer = null;  // chez un invité : la dimension de l'hôte (son numéro), celle de toutes les vues du salon
    const here = () => (role === 'member' ? hostLayer : layerNumber);
    const people = new Map();  // id du compte → { name, host, color, cursor, at, view }
    const slots = new Map();   // id d'un invité → son rang (sa plage d'identifiants)
    const byId = id => document.getElementById(id);
    const send = message => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };

    // --- relais des sauvegardes de Nodz ; un invité n'écrit rien sur le serveur (seuls le Gardien et la déconnexion passent)
    const nativeFetch = window.fetch;
    window.fetch = (url, options = {}) => {
        if (!socket && role !== 'member') return nativeFetch(url, options);
        const path = String(url).split('?')[0], method = (options.method || 'GET').toUpperCase();
        if (method === 'POST' && !applying && typeof options.body === 'string') {
            if (path.endsWith('/save-node/')) send({ t: 'save', data: JSON.parse(options.body) });
            else if (path.endsWith('/delete/')) send({ t: 'delete', data: JSON.parse(options.body) });
        }
        if (role === 'member' && method !== 'GET' && !/\/api\/v1\/|\/logout\//.test(path)) {
            return Promise.resolve(new Response('{"message":"salon"}', { headers: { 'Content-Type': 'application/json' } }));
        }
        return nativeFetch(url, options);
    };

    // --- l'univers des autres, appliqué sans être renvoyé ; chez l'hôte, enregistré
    function quietly(fn) {
        const loading = isLoading;
        applying += 1;
        isLoading = true;  // ni sauvegarde ni historique pendant la pose
        try {
            fn();
        } finally {
            isLoading = loading;
            applying -= 1;
        }
    }

    // Un node décrit comme dans une sauvegarde de Nodz : posé (ou remplacé) avec ses champs vérifiés.
    function place(d, trusted) {
        const id = `N-${parseInt(d.id, 10)}`;
        if (!/^N-\d+$/.test(id)) return null;
        const old = byId(id);
        if (old?.contains(document.activeElement)) return null;  // quelqu'un écrit dans ce node ici : sa frappe d'abord
        const keep = name => old?.getAttribute(name) ?? '';
        const node = {
            node_id: parseInt(d.id, 10), x_coordinate: number(d.x), y_coordinate: number(d.y),
            radius: Math.min(2000, Math.max(10, number(d.radius) || 60)), ratio: number(d.ratio),
            type: /^[a-z0-9_-]{1,20}$/.test(d.type || '') ? d.type : 'text',
            color: /^#[0-9a-f]{3,8}$/i.test(d.color || '') ? d.color : '#33FF99',
            shape: ['circle', 'square', 'none'].includes(d.shape) ? d.shape : 'circle',
            layer__layer_id: layerNumber, text_content: clean(d.textContent),
            image_content: d.imgContent === keep('imagecontent') ? keep('imagecontent') : localUrl(d.imgContent),
            canvas_content: drawing(d.canvasContent),
            // Fichiers et portails : ceux de l'univers de l'hôte ; un invité ne les change pas.
            file_name: trusted ? String(d.fileName || '') : keep('filename'), file: trusted ? String(d.file || '') : keep('file'),
            quantum: trusted ? drawing(d.quantum) : keep('quantum') || '[]',
            notification: /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/.test(d.notification || '') ? d.notification : '',
            lock: String(d.lock) === '1' || d.lock === true,
        };
        if (old) {
            JSON.parse(old.getAttribute('links') || '[]').map(byId).filter(Boolean).forEach(link => {
                const other = byId(link.getAttribute('Node1') === id ? link.getAttribute('Node2') : link.getAttribute('Node1'));
                if (other) {
                    other.setAttribute('links', JSON.stringify(JSON.parse(other.getAttribute('links') || '[]').filter(l => l !== link.id)));
                    other.setAttribute('siblings', JSON.stringify(JSON.parse(other.getAttribute('siblings') || '[]').filter(n => n !== id)));
                }
                byId(`grad${link.id}`)?.remove();
                link.remove();
            });
            selectedNodes.splice(0, selectedNodes.length, ...selectedNodes.filter(n => n !== old));
            if (currentNode === old) currentNode = null;
            old.remove();
        }
        displayNode(node);
        return byId(id);
    }

    function tie(l) {
        const id = `L-${parseInt(l.linkid, 10)}`, a = byId(l.linkA), b = byId(l.linkB);
        if (/^L-\d+$/.test(id) && !byId(id) && a?.classList.contains('node-group') && b?.classList.contains('node-group')) createLink(a, b, id);
    }

    function apply(data, trusted) {
        if (!Array.isArray(data)) return;
        let node = null;
        quietly(() => {
            const entry = data.find(d => d && 'id' in d);
            if (entry) node = place(entry, trusted);
            data.filter(d => d && 'linkid' in d).forEach(tie);
        });
        if (role === 'host' && node) {
            applying += 1;
            try {
                save(node);  // dans l'univers de l'hôte, sans le renvoyer au salon
            } finally {
                applying -= 1;
            }
        }
    }

    // Un node verrouillé ne se supprime que par l'hôte : chez l'hôte, la suppression venue d'un autre est ignorée (le
    // node et ses liens restent, son auteur les reçoit de nouveau) ; chez un invité, elle est refusée sur place.
    const locked = node => node?.getAttribute('lock') === '1';
    let erase = nodes => deleteNode(nodes);  // la vraie suppression de Nodz (un invité remplace deleteNode)
    function remove(data, sender) {
        if (!Array.isArray(data)) return;
        if (role === 'host' && !sender?.host) {
            const kept = data.filter(d => d && 'id' in d).map(d => byId(`N-${parseInt(d.id, 10)}`)).filter(locked);
            if (kept.length) {
                const ties = new Set(kept.flatMap(n => JSON.parse(n.getAttribute('links') || '[]')).map(id => parseInt(id.slice(2), 10)));
                data = data.filter(d => !(d && (kept.some(n => n.id === `N-${parseInt(d.id, 10)}`) || ties.has(parseInt(d.linkid, 10)))));
                kept.forEach(n => send({ t: 'save', to: sender.id, data: [describe(n), ...JSON.parse(n.getAttribute('links') || '[]').map(byId).filter(Boolean)
                    .map(l => ({ linkid: parseInt(l.id.slice(2), 10), linkA: l.getAttribute('Node1'), linkB: l.getAttribute('Node2') }))] }));
                say(`${sender.name} voulait supprimer un node verrouillé : il reste.`);
            }
        }
        applying += 1;
        try {
            const nodes = data.filter(d => d && 'id' in d).map(d => byId(`N-${parseInt(d.id, 10)}`)).filter(n => n?.classList.contains('node-group'));
            if (nodes.length) erase(nodes);
            else data.filter(d => d && 'linkid' in d).map(d => byId(`L-${parseInt(d.linkid, 10)}`)).filter(Boolean).forEach(deleteLink);
            // Chez l'hôte, la suppression est aussi enregistrée telle quelle : un lien déjà retiré de la page (node
            // reposé entre-temps) n'aurait sinon jamais été archivé.
            if (role === 'host') {
                deleteFetch(data.filter(d => d && ('id' in d || 'linkid' in d)).map(d => ('id' in d ? { id: parseInt(d.id, 10) } : { linkid: parseInt(d.linkid, 10) }))
                    .filter(d => Number.isInteger(d.id ?? d.linkid)));
            }
        } finally {
            applying -= 1;
        }
    }

    // --- l'état complet de la dimension de l'hôte, pour un invité qui arrive (ou quand l'hôte change de dimension)
    const view = () => {
        const a = { x: (0 - centerX + parseFloat(root.getAttribute('x'))) / currentZoom, y: -(0 - centerY - parseFloat(root.getAttribute('y'))) / currentZoom };
        const b = { x: (innerWidth - centerX + parseFloat(root.getAttribute('x'))) / currentZoom, y: -(innerHeight - centerY - parseFloat(root.getAttribute('y'))) / currentZoom };
        return { x0: a.x, x1: b.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    };
    const describe = node => ({
        id: parseInt(node.id.slice(2), 10), x: Math.round(node.getAttribute('x')), y: Math.round(node.getAttribute('y')),
        type: node.getAttribute('type'), color: node.getAttribute('color'), shape: node.getAttribute('shape'),
        radius: node.children[1].getAttribute('r'), ratio: node.getAttribute('ratio') || 0, textContent: node.getAttribute('textcontent'),
        imgContent: node.getAttribute('imagecontent'), canvasContent: node.getAttribute('canvascontent'), fileName: node.getAttribute('filename'),
        file: node.getAttribute('file'), quantum: node.getAttribute('quantum'), notification: node.getAttribute('notification'), lock: node.getAttribute('lock'),
    });
    function share(to) {
        if (!slots.has(to) && to) slots.set(to, slots.size + 1);
        const top = Math.max(Number(nodeCounter) || 0, Number(linkCounter) || 0);
        send({
            t: 'state', to, base: to ? top + BLOCK * slots.get(to) : undefined, view: view(), layer: layerNumber,
            dimension: layers.find(l => l.id === layerNumber)?.name || '',
            nodes: [...universe.querySelectorAll('.node-group')].map(describe),
            links: [...universe.querySelectorAll('.link')].map(l => ({ linkid: parseInt(l.id.slice(2), 10), linkA: l.getAttribute('Node1'), linkB: l.getAttribute('Node2') })),
        });
    }
    function settle(m) {
        quietly(() => {
            rebootUniverse();
            (m.nodes || []).forEach(d => place(d, true));
            (m.links || []).forEach(tie);
        });
        if (m.base) nodeCounter = linkCounter = m.base;
        layer = m.dimension;
        hostLayer = m.layer;
        render();
        // Nouvelle dimension : on suit toujours la même personne (sa dernière vue dans cette dimension), sinon la vue de l'hôte.
        const leader = people.get(following);
        if (leader?.view && leader.layer === hostLayer) follow(leader.view);
        else if (m.view) bridge.frame(m.view, 0);
    }

    // --- présence : curseurs nommés, vues (pour « suivre »)
    const overlay = document.createElement('div');
    overlay.id = 'gardien-room-cursors';
    document.body.append(overlay);
    function meet(who) {
        if (!who || who.id === me?.id) return null;
        if (!people.has(who.id)) {
            const cursor = document.createElement('div');
            cursor.className = 'gsal-cursor';
            cursor.innerHTML = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M1 1l14 9-6.5 1.5L5.5 19z"/></svg><span><i></i><b></b></span>';
            cursor.hidden = true;
            overlay.append(cursor);
            people.set(who.id, { ...who, cursor });
        }
        const person = people.get(who.id);
        if (!person.color || person.name !== who.name || person.avatar !== who.avatar) dress(Object.assign(person, who, { color: colorOf(who) }));
        return person;
    }
    // Pseudo, avatar et couleur sur le curseur et dans la liste (un « profile » les change en route).
    function dress(person) {
        person.cursor.style.setProperty('--gsal-color', person.color);
        person.cursor.querySelector('i').innerHTML = person.avatar ? glyph(person.avatar) : '';
        person.cursor.querySelector('b').textContent = person.name;
        render();
    }
    function forget(id) {
        people.get(id)?.cursor.remove();
        people.delete(id);
        if (following === id) following = null;
        render();
    }
    (function draw() {
        people.forEach(p => {
            if (!p.at) return;
            const x = p.at.x * currentZoom - parseFloat(root.getAttribute('x')) + centerX;
            const y = -p.at.y * currentZoom + parseFloat(root.getAttribute('y')) + centerY;
            p.cursor.hidden = false;
            p.cursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        });
        requestAnimationFrame(draw);
    })();
    let lastCursor = 0, lastView = '';
    document.addEventListener('pointermove', event => {
        if (!socket || performance.now() - lastCursor < 50) return;
        lastCursor = performance.now();
        const x = (event.clientX - centerX + parseFloat(root.getAttribute('x'))) / currentZoom;
        const y = -(event.clientY - centerY - parseFloat(root.getAttribute('y'))) / currentZoom;
        send({ t: 'cursor', x: Math.round(x), y: Math.round(y) });
    });
    setInterval(() => {
        if (!socket || isLoading) return;  // pendant un chargement de dimension, la vue ne veut rien dire
        if (role === 'host' && layer !== null && layer !== layerNumber) {  // l'hôte change de dimension : le salon le suit
            layer = layerNumber;
            share();  // l'état d'abord, puis la vue : on ne suit jamais quelqu'un dans une dimension qu'on n'a pas
        }
        const v = view(), key = JSON.stringify([...Object.values(v).map(Math.round), here()]);
        if (key !== lastView) send({ t: 'view', ...v, layer: here() });
        lastView = key;
    }, 700);
    // La caméra rejoint la dernière vue reçue ; une vue arrivée pendant le travelling est jouée juste après.
    let next = null;
    async function follow(v) {
        next = v;
        if (moving) return;
        moving = true;
        try {
            while (next && following) {
                const target = next;
                next = null;
                await bridge.frame(target, 0);
            }
        } finally {
            moving = false;
        }
    }

    // Frappe en direct : le texte d'un node apparaît chez les autres pendant qu'on l'écrit (au plus tous les 120 ms,
    // la dernière frappe toujours envoyée).
    let typing = null, typed = 0;
    document.addEventListener('input', event => {
        const node = event.target.isContentEditable && event.target.closest?.('.node-group');
        if (!socket || !node) return;
        typing = { t: 'type', id: node.id, html: event.target.innerHTML };
        typed ||= setTimeout(() => {
            typed = 0;
            send(typing);
        }, 120);
    }, true);

    function receive(m) {
        const who = m.from?.id === me?.id ? null : m.from;
        if (m.t === 'welcome') {
            me = m.me;
            room = { ...room, ...m.room };
            role = me.host ? 'host' : 'member';
            layer = role === 'host' ? layerNumber : layer;
            send({ t: 'hello' });
            return render();
        }
        const person = meet(who);
        if (!person) return;
        if (m.t === 'join') say(`${who.name} entre dans le salon.`);
        else if (m.t === 'profile') render();  // meet() a déjà repris son pseudo et son avatar
        else if (m.t === 'hello') {
            send({ t: 'view', ...view(), layer: here() });  // il nous voit aussitôt
            if (role === 'host' && !who.host) share(who.id);
        } else if (m.t === 'leave') {
            say(who.host ? "L'hôte a quitté le salon : tes gestes ne seront plus enregistrés." : `${who.name} quitte le salon.`);
            forget(who.id);
        } else if (m.t === 'state' && role === 'member') settle(m);
        else if (m.t === 'save') apply(m.data, who.host);
        else if (m.t === 'delete') remove(m.data, who);
        else if (m.t === 'type') {
            const input = byId(String(m.id))?.children[0]?.children[0];
            if (input && input !== document.activeElement && input.closest('.node-group')) input.innerHTML = clean(m.html);
        } else if (m.t === 'cursor') person.at = { x: number(m.x), y: number(m.y) };
        else if (m.t === 'view') {
            person.view = { x0: number(m.x0), x1: number(m.x1), y0: number(m.y0), y1: number(m.y1) };
            person.layer = m.layer;
            // Seulement dans la même dimension ; sinon l'état de la nouvelle dimension arrive et la caméra le rejoindra.
            if (following === who.id && person.layer === here()) follow(person.view);
        } else if (m.t === 'kick') {
            if (m.user === me.id) end('Tu as été exclu du salon.');
            else forget(m.user);
        } else if (m.t === 'close') end("L'hôte a fermé le salon.");
    }

    function connect(token) {
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        const chosen = new URLSearchParams({ name: profile.name, avatar: profile.avatar });
        socket = new WebSocket(`${scheme}://${location.host}${BASE}/ws/room/${encodeURIComponent(token)}/?${chosen}`);
        socket.addEventListener('message', event => {
            try {
                receive(JSON.parse(event.data));
            } catch (error) {
                console.error('salon :', error);
            }
        });
        socket.addEventListener('close', () => {
            if (!socket) return;
            socket = null;
            if (role === 'member') end('Connexion au salon perdue.');
            render();
        });
    }

    function end(message) {
        const open = socket;
        socket = null;
        open?.close();
        people.forEach((_, id) => forget(id));
        if (message) say(message);
        render();
    }

    // --- panneau du salon (bouton Partager de Nodz)
    const panel = document.createElement('section');
    panel.id = 'gardien-room';
    panel.hidden = true;
    panel.innerHTML = '<header><b>Salon</b><span class="gsal-where"></span><button type="button" class="gsal-x" title="Fermer">×</button></header>'
        + '<div class="gsal-me"><div class="gsal-avatars" role="radiogroup" aria-label="Mon avatar"></div>'
        + '<input class="gsal-name" maxlength="24" placeholder="Mon pseudo (sinon le nom du compte)" aria-label="Mon pseudo"></div>'
        + '<p class="gsal-intro">Ouvre cette dimension à d\'autres : ils voient ton univers, vos curseurs et chaque geste en direct, et peuvent l\'éditer. Tout s\'enregistre chez toi.</p>'
        + '<div class="gsal-link"><input readonly aria-label="Lien du salon"><button type="button" class="gsal-copy">Copier le lien</button></div>'
        + '<ul class="gsal-people"></ul>'
        + '<div class="gsal-actions"><button type="button" class="gsal-open">Ouvrir un salon</button><button type="button" class="gsal-end">Fermer le salon</button><button type="button" class="gsal-leave">Quitter le salon</button></div>';
    document.body.append(panel);
    const $ = selector => panel.querySelector(selector);
    // Choisir son avatar et son pseudo : gardés ici, envoyés au salon s'il est ouvert.
    function choose(changes) {
        profile = { ...profile, ...changes };
        try {
            localStorage.setItem(PROFILE, JSON.stringify(profile));
        } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
        if (me) {
            me = { ...me, avatar: profile.avatar, name: profile.name.trim().replace(/\s+/g, ' ').slice(0, 24) || me.name };
            send({ t: 'profile', name: profile.name, avatar: profile.avatar });
        }
        render();
    }
    $('.gsal-avatars').append(...Object.entries(AVATARS).map(([key, [label, color]]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.avatar = key;
        button.title = label;
        button.setAttribute('role', 'radio');
        button.style.setProperty('--gsal-color', color);
        button.innerHTML = glyph(key);
        button.addEventListener('click', () => choose({ avatar: key }));
        return button;
    }));
    $('.gsal-name').value = profile.name;
    $('.gsal-name').addEventListener('change', event => choose({ name: event.target.value }));
    $('.gsal-name').addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    const link = () => room && `${location.origin}${BASE}/universe?room=${encodeURIComponent(room.token)}`;
    function render() {
        const live = !!socket, host = role !== 'member';
        const hostName = [...people.values()].find(p => p.host)?.name || room?.host || '';  // son pseudo dès qu'il est là
        $('.gsal-where').textContent = !room ? '' : host ? ` · ${layers.find(l => l.id === layerNumber)?.name || ''}` : ` de ${hostName}${layer ? ` · ${layer}` : ''}`;
        $('.gsal-intro').hidden = live || !host;
        $('.gsal-link').hidden = !live || !host;
        $('.gsal-link input').value = link() || '';
        $('.gsal-open').hidden = live || !host;
        $('.gsal-end').hidden = !live || !host;
        $('.gsal-leave').hidden = host;
        panel.querySelectorAll('.gsal-avatars button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.avatar === profile.avatar)));
        const list = $('.gsal-people');
        list.replaceChildren();
        if (live && me) list.append(row({ ...me, color: colorOf(me) }, true));
        people.forEach((p, id) => list.append(row({ ...p, id })));
        const button = byId('shareButton');
        button?.classList.toggle('gardien-room-live', live);
        button?.setAttribute('data-count', live ? String(people.size + 1) : '');
    }
    function row(p, self = false) {
        const item = document.createElement('li');
        const dot = document.createElement('i');
        dot.style.setProperty('--gsal-color', p.color);
        dot.innerHTML = p.avatar ? glyph(p.avatar) : '';
        const name = document.createElement('span');
        name.textContent = `${p.name}${p.host ? ' · hôte' : ''}${self ? ' (toi)' : ''}`;
        item.append(dot, name);
        if (!self) {
            const look = document.createElement('button');
            look.type = 'button';
            look.textContent = following === p.id ? 'Suivi' : 'Suivre';
            look.title = 'Ta caméra suit la sienne ; un clic de plus arrête';
            look.classList.toggle('on', following === p.id);
            look.addEventListener('click', () => {
                following = following === p.id ? null : p.id;
                if (following && p.view && p.layer === here()) follow(p.view);
                render();
            });
            item.append(look);
            if (role === 'host') {
                const kick = document.createElement('button');
                kick.type = 'button';
                kick.textContent = 'Exclure';
                kick.addEventListener('click', () => {
                    send({ t: 'kick', user: p.id });
                    forget(p.id);
                });
                item.append(kick);
            }
        }
        return item;
    }
    // Suivre s'arrête dès qu'on bouge soi-même la caméra (molette, glissé).
    svg.addEventListener('wheel', event => { if (event.isTrusted && following) { following = null; render(); } }, { passive: true });
    svg.addEventListener('mousedown', event => { if (event.isTrusted && following) { following = null; render(); } });

    $('.gsal-x').addEventListener('click', () => { panel.hidden = true; });
    $('.gsal-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link());
            say('Lien du salon copié.');
        } catch {
            $('.gsal-link input').select();
        }
    });
    $('.gsal-open').addEventListener('click', async () => {
        try {
            room = (await api.request('POST', 'toolbox/rooms', {})).room;
            role = 'host';
            connect(room.token);
            render();
        } catch (error) {
            say(`Salon : ${error.message}`, 'error');
        }
    });
    $('.gsal-end').addEventListener('click', async () => {
        send({ t: 'close' });
        end();
        room = null;
        await api.request('DELETE', 'toolbox/rooms').catch(() => {});
        render();
    });
    $('.gsal-leave').addEventListener('click', () => { location.href = `${BASE}/universe`; });
    document.addEventListener('click', event => {
        if (event.target.closest?.('#shareButton') && document.body.classList.contains('gardien-ready')) {
            event.preventDefault();
            event.stopImmediatePropagation();  // à la place de l'ancien lien de partage (copie en lecture)
            panel.hidden = !panel.hidden;
            render();
        }
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') panel.hidden = true; });

    return {
        // Une fois connecté : rejoindre le salon du lien (?room=), ou reprendre le sien s'il est resté ouvert.
        async start() {
            const token = new URLSearchParams(location.search).get('room');
            while (isLoading) await new Promise(resolve => setTimeout(resolve, 100));  // l'univers de connexion d'abord
            try {
                if (token) {
                    const found = await api.request('GET', `toolbox/rooms/${encodeURIComponent(token)}`);
                    room = { token, name: found.name, host: found.host };
                    role = found.mine ? 'host' : 'member';
                    if (role === 'member') {
                        // Dans un salon, la dimension est celle de l'hôte : changer de dimension attend la sortie du salon.
                        // Toutes les portes : liste des dimensions, nouvelle dimension, portail, voyage.
                        const stay = () => say("Dans un salon, la dimension est celle de l'hôte : quitte le salon pour revenir chez toi.");
                        window.load = window.onLayerSelect = window.createNewLayer = stay;
                        const original = window.deleteNode;
                        erase = original;
                        window.deleteNode = nodes => {
                            const free = [...nodes].filter(n => !locked(n));
                            if (free.length < nodes.length) say("Node verrouillé : seul l'hôte peut le supprimer.");
                            if (free.length) original(free);
                        };
                        quietly(rebootUniverse);
                        say(`Salon de ${found.host} : connexion…`);
                    }
                    connect(token);
                } else {
                    room = (await api.request('GET', 'toolbox/rooms')).room;
                    if (room) {
                        role = 'host';
                        connect(room.token);
                    }
                }
            } catch (error) {
                say(token ? 'Salon fermé ou introuvable.' : `Salon : ${error.message}`, 'error');
            }
            render();
        },
    };
}
