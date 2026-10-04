// Le Gardien dans Nodz (/universe) : pas de chat. Un node écrit est un message : la pastille « Gardien »
// près du node (ou Ctrl+Entrée) l'envoie au Gardien (l'humain déclenche, rien ne part tout seul), qui répond dans l'univers
// (un node-réponse relié au message, et ses actions) avec les fonctions de Nodz. Le fil de suivi
// montre son plan à venir et l'étape en cours. Le bouton « Agents » de la barre
// de boutons ouvre la bibliothèque (agents, modèles, Hugging Face) ; la tour de contrôle (haut gauche)
// montre les ressources du serveur.

import { createAdmin } from './admin.js';
import { api } from './api.js';
import { createBranches } from './branches.js';
import { createBridge } from './bridge.js';
import { createChat } from './chat.js';
import { createCorners } from './corners.js';
import { createCutter } from './cutter.js';
import { createDataset, describe, download, stamp, toCsv } from './dataset.js';
import { createIde } from './ide.js';
import { createDimensions } from './dimensions.js';
import { createFilters } from './filters.js';
import { createGrab } from './grab.js';
import { createGuide } from './guide.js';
import { createHistory } from './history.js';
import { createLabels } from './labels.js';
import { createLibrary } from './library.js';
import { createLinkDrop } from './linkdrop.js';
import { createMonitor } from './monitor.js';
import { createNodebar } from './nodebar.js';
import { createPending } from './pending.js';
import { createPhysics } from './physics.js';
import './portal.js';  // window.portalRing : l'anneau vivant des portails, que Nodz pose en créant un node
import { createReminders } from './reminders.js';
import { createRoom } from './room.js';
import { createSchemas } from './schemas.js';
import { createSearch } from './search.js';
import { createSfx } from './sfx.js';
import { createSide } from './side.js';
import { createTextFit } from './textfit.js';
import { createThoughts } from './thoughts.js';
import { createTheme } from './theme.js';
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

// Fil de suivi : la mascotte le dit, dans la bulle de l'orbe (réflexion en direct, puis chaque geste) ; plus de
// liste d'étapes dans la pastille des jauges.
const follow = {
    start() { chat.mascot.say('Je réfléchis…'); },
    step(text) { chat.mascot.say(text); },
    end(text) { chat.mascot.say(text); },
};

// Un geste commencé sur l'univers (sélection rectangle, glissé) traverse les éléments flottants du Gardien
// (chat, pastille, lecteur de visite) : le relâcher par-dessus ne le coupe pas.
svg.addEventListener('mousedown', () => document.body.classList.add('gardien-gesture'), true);
window.addEventListener('mouseup', () => requestAnimationFrame(() => document.body.classList.remove('gardien-gesture')), true);

// Échap ferme la fenêtre de Nodz ouverte au-dessus de l'univers (galerie de modèles, profil, export, smileys,
// calendrier), comme les panneaux du Gardien ; avant, la galerie restait ouverte et couvrait le dock.
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.overlay')].filter(o => o.style.display && o.style.display !== 'none').pop();
    if (!open) return;
    open.style.display = 'none';
    overlay = false;
});

// Chat et filtres n'apparaissent qu'une fois connecté (LOGIN ou GUEST de Nodz).
const signedIn = setInterval(() => {
    if (typeof isLoggedIn === 'undefined' || !isLoggedIn) return;
    document.body.classList.add('gardien-ready');
    clearInterval(signedIn);
    // Préchauffage : le modèle du Gardien lit ses consignes en arrière-plan, la première demande ira plus vite.
    api.request('POST', 'toolbox/warm', { mode: chat.mode() }).catch(() => {});
    refreshLetters();  // notes du Gardien en attente dans Échanges
    reminders.refresh();
    dimensions.refresh();
    if (typeof guestUser !== 'undefined' && guestUser) chat.guest();  // chaque invité part d'un chat vide
    guide.welcome();  // première visite : le guide s'ouvre
    room.start();  // salon du lien (?room=) ou le sien resté ouvert
}, 400);

const joined = node => ({ id: node.id, text: (node.children[0]?.children[0]?.innerText || '').trim() });  // node joint au chat
const branches = createBranches({ say, download });  // replier, ranger en arbre, exporter Markdown / OPML / FreeMind
const filters = createFilters({ onAttach: items => chat.attach(items), onImport: () => dataset.pick(), mapExports: () => branches.exportItems() });  // sélecteur de contexte au-dessus du dock
const dimensions = createDimensions();  // recherche, épinglées et nombre de nodes dans la liste des dimensions
createNodebar();  // barre d'outils du node, à la place des barres SVG de Nodz
createGrab();  // zone de saisie du node allumée au survol
createTextFit();  // le texte d'un node n'est jamais rogné : le node grandit juste assez
createCorners();  // le nombre des indicateurs de coin sursaute quand il change
createLabels();  // libellés d'icônes au style HYPERSPACE, à la place des infobulles
createThoughts();  // filtre des pensées de l'IA dans le dock : visibles, estompées, masquées
createTheme();  // bouton jour / nuit : Nuit ou Ardoise (gris-bleu sombre), plus d'univers blanc
const sfx = createSfx();  // effets sonores des gestes : création, lien, suppression, portail…
const guide = createGuide();  // présentation et tous les contrôles : bouton « ? » du menu, touche « ? »
createLinkDrop();  // un node tenu contre un autre une demi-seconde s'y relie au relâcher
createAdmin({ say });  // consoles des boutons administrateur (Console IA, Utilisateurs)
const bridge = createBridge({ caption: text => say(text, 'guide'), onTour: node => tour.start(node), onAttach: nodes => chat.attach(nodes.map(joined)),
    onExport: nodes => download(`nodz-selection-${stamp()}.csv`, toCsv(nodes.map(describe))),
    onBranch: (node, anchor) => branches.open(node, anchor),
    onSchema: (type, at, fill, title) => schemas.build(type, at, false, fill, title), onFree: node => physics.add(node),
    onArrange: nodes => { nodes.forEach(n => nodeUnselection(n)); sfx.play('arrange'); physics.arrange(nodes); },
    // Le code du Codeur échoue : le Gardien le reprend une fois (pas de boucle de corrections).
    onCodeError: (node, error) => {
        if (fixed.has(node.id)) return chat.add('notice', `Le code de ${node.id} échoue encore : ${error.split('\n').pop()}`);
        fixed.add(node.id);
        queue = queue.then(() => ask(node, `Le code de ce node (${node.id}) échoue à l'exécution :\n${error}\nCorrige-le : `
            + `confie-le au Codeur (delegate, ref ${node.id}).`, [], true));
    } });
const fixed = new Set();  // nodes de code déjà renvoyés une fois au Gardien pour correction
const reminders = createReminders({ bridge, say, sfx });  // rappels : compte à rebours, notifications, panneau de la cloche
const tour = createTour({ bridge, say });
const room = createRoom({ bridge, say });
const dataset = createDataset({ bridge, say, onDone: refs => bridge.perform({ op: 'frame', refs }) });  // import automatique (Filtres)  // salons multijoueur : bouton Partager, curseurs, gestes en direct
createSearch({ bridge });  // recherche du dock : toutes les dimensions, compteur x / y, résultat allumé
const schemas = createSchemas({ bridge });  // galerie de modèles : schémas faits de nodes et de liens
const ide = createIde({ say });  // IDE des nodes de code, exécution dans le navigateur ou sur le serveur
bridge.useIde(ide);  // le Codeur du Gardien y écrit et y exécute son code
createSide({ bridge, say, filters });  // vue de côté : X = numéro de dimension, Y = Y
const pending = createPending({ bridge, say, onApplied: ids => filters.mark(ids, 'ai') });  // changer de dimension n'interrompt pas le Gardien
let guardian = null;  // l'agent orchestrateur de l'utilisateur
const timeline = createHistory({ onGesture: kind => sfx.play(kind) });  // Ctrl+Z / Ctrl+Y sur tout geste, du clavier, de la souris ou du Gardien
// Ouvrir une dimension (portail, Entrée sur un node) : l'arpège du passage.
const nodzNewLayer = window.createNewLayer;
window.createNewLayer = (...args) => {
    sfx.play('portal');
    return nodzNewLayer(...args);
};
const physics = createPhysics({ timeline });
createCutter({ timeline });  // X maintenu ou Ciseaux : un trait tranche les liens qu'il traverse  // les nodes posés par l'IA se repoussent et se posent sous les yeux

// Maj, Espace, Suppr, Tab, Ctrl+Z… sont des raccourcis de Nodz tant qu'on n'écrit pas. Écrire, c'est avoir le focus
// dans un champ, où qu'il soit (chat, recherche, panneaux, IDE), pas seulement dans le texte d'un node.
const EDITABLE = 'textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor, '
    + 'input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=color], [type=file])';
const editable = element => !!element?.closest?.(EDITABLE);
document.addEventListener('focusin', event => { if (editable(event.target)) isTyping = true; });
document.addEventListener('focusout', event => { if (editable(event.target) && !editable(event.relatedTarget)) isTyping = false; });
// Un clic dans le texte déjà en cours d'écriture remet isTyping à faux (Nodz) sans changer le focus : Maj ouvrait
// alors la liste des dimensions. Un clic dans le texte d'un node, c'est écrire (après les écouteurs de Nodz).
document.addEventListener('mouseup', event => {
    if (event.target.closest?.('.node-group [contenteditable="true"]')) setTimeout(() => { if (editable(document.activeElement)) isTyping = true; });
}, true);

// Un clic (sans glisser) sur un node : vu de haut, on y descend en travelling ; de près, un node de code ouvre son
// IDE. Vu de haut, un clic sur sa poignée de taille descend aussi. Les autres outils gardent leur clic (couleur, type…).
const ALTITUDE = 0.45;  // zoom sous lequel on est « en altitude »
let press = null;
svg.addEventListener('pointerdown', event => {
    const node = event.target.closest?.('.node-group');
    const tool = node && Object.values(node.tools || {}).some(t => t?.contains?.(event.target));
    press = event.button === 0 && node && !tool && !event.ctrlKey && !event.shiftKey
        ? { node, x: event.clientX, y: event.clientY, at: performance.now(), high: Number(currentZoom) < ALTITUDE } : null;
}, true);
svg.addEventListener('pointerup', event => {
    const target = press;
    press = null;
    if (!target || Math.hypot(event.clientX - target.x, event.clientY - target.y) > 5 || performance.now() - target.at > 400) return;
    clickNode(target.node, target.high);
}, true);
document.addEventListener('gardien-node-click', ({ detail }) => { if (Number(currentZoom) < ALTITUDE) clickNode(detail.node, true); });
function clickNode(node, high) {
    if (high) bridge.perform({ op: 'focus', ref: node.id, zoom: 1 }).catch(() => {});
    else if (node.getAttribute('type') === 'code') ide.open(node).catch(error => say(`IDE : ${error.message}`, 'error'));
}

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
// s'affichent dans le chat ; depuis un node, les réponses courtes passent aussi en toast. Contexte rechargé à chaque
// demande : depuis le chat, avec la conversation ; directe (un node, la pastille sur une sélection), sans elle, et le
// serveur ne montre que ces nodes-là.
async function ask(node, text, attached = [], direct = !!node, tool = null) {  // tool : web, draw, image (outil imposé, mode Pensée)
    let actions = Promise.resolve();
    const history = chat.recent();  // la conversation jusqu'ici : le Gardien la suit
    chat.add('user', text, node ? `node ${node.id}` : attached.length ? `${attached.length} node${attached.length > 1 ? 's' : ''} en contexte` : '');
    if (typeof admin !== 'undefined' && admin) return chat.add('notice', 'Univers d\'un autre compte, en lecture : le Gardien n\'y agit pas.');
    const reply = (kind, message) => {
        chat.add(kind === 'text' ? 'guardian' : kind, message);
        if (node) say(message, kind);
    };
    chat.busy(true);
    timeline.begin();
    // Réflexion en direct : le plan que le modèle écrit, fragment par fragment (un fragment ≈ un jeton).
    let think = null, round = 0, pieces = 0, thinkStart = 0;
    try {
        if (!guardian) await loadGuardian();
        if (!guardian?.enabled || !guardian.model) {
            chat.offer('Le Gardien dort : il lui faut une IA, par API (ta clé) ou sur ta machine.', 'Choisir mon IA', () => library.open('start'));
            if (node) say('Le Gardien dort : choisis-lui une IA dans Agents & modèles.', 'notice');
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
        const now = new Date();  // l'heure de l'humain : ses rappels (« vendredi 9 h »)
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} `
            + `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}, ${now.toLocaleDateString('fr-FR', { weekday: 'long' })}`;
        await api.command({ prompt: text, context: { ...context, now: stamp, mode: tool ? 'think' : chat.mode(), ...(tool ? { tool } : {}), ...(node ? { origin: node.id } : {}), ...(attached.length ? { attached } : {}),
            source: direct ? 'node' : 'chat', ...(history.length && !direct ? { history } : {}) } }, (type, data) => {
            if (type === 'thinking') {
                thought(data);
                if (tool || chat.mode() !== 'auto') chat.mascot.muse(data.text);  // sa réflexion, en direct sur la mascotte (en Auto : du JSON brut)
            }
            else if (type === 'stopped') stopped = true;
            else if (type === 'text' || type === 'notice') reply(type, data.text);
            else if (type === 'queued') {
                const where = data.position === 1 ? 'Tu es le prochain : le Gardien finit une autre demande' : `En file d'attente : ${data.position}e`;
                follow.step(where, 'waiting');
                chat.status(where);
            }
            else if (type === 'timing') timing = data;
            // Intentions et gestes s'enchaînent : chaque étape s'affiche quand la page l'exécute.
            else if (type === 'intent') actions = actions.then(() => { follow.step(data.text); chat.status(data.text); });
            // Note pour plus tard : annoncée dans le chat, posée dans Échanges quand l'humain l'ouvre.
            else if (type === 'note') actions = actions.then(() => { chat.add('guardian', `Note laissée dans Échanges : ${data.text}`, '', data.choices); refreshLetters(); });
            // Question à l'humain : ses choix sont des boutons dans le chat, qui s'ouvre.
            else if (type === 'ask') actions = actions.then(() => { chat.add('guardian', data.text, '', data.choices); chat.open(); if (node) say(data.text, 'text'); });
            else if (type === 'error') actions = actions.then(() => { follow.step(data.message, 'error'); chat.add('error', data.message); });
            else if (type === 'agent') actions = actions.then(() => follow.step(`${data.agent} ${data.role === 'image' ? 'dessine' : 'écrit'} : ${data.task}`, 'agent'));
            else if (type === 'action') {
                actions = actions.then(() => perform(data))
                    .then(() => chat.mascot.visit(bridge.idOf(data.ref || data.target || data.source)))
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
        const m = timing?.memory;
        if (m?.no_cuda) chat.add('guardian', `Je tourne sur le processeur : une carte NVIDIA est là, mais llama-cpp-python est compilé `
            + 'sans CUDA. Agents & modèles, Bibliothèque : « Compiler avec CUDA », et j\'écrirai bien plus vite.', 'mémoire');
        else if (m) chat.add('guardian', `Je suis lent parce que mon modèle (${go(m.model_gb)} Go) ne tient ${m.vram_gb ? 'ni' : 'pas'} dans la mémoire libre `
            + `(${go(m.free_gb)} Go)${m.vram_gb ? ` ni dans la carte graphique (${go(m.vram_gb)} Go libres)` : ''} : je relis le disque `
            + `à chaque mot. Donne-moi un modèle d'environ ${go(m.advice_gb)} Go ou moins dans Agents & modèles`
            + `${m.vram_gb ? ', il tiendra entier sur la carte graphique' : ' (un 3B ou un 1.5B en Q4)'}, ou branche un modèle par API : `
            + 'j\'écrirai bien plus vite.', 'mémoire');
        if (!stopped) sfx.play('done');
    } catch (error) {
        think?.end('Réflexion interrompue');
        follow.end(error.message);
        reply('error', error.message);
    } finally {
        node?.classList.remove('gardien-thinking');
        chat.mascot.rest();
        timeline.end();
        chat.busy(false);
    }
}

const chat = createChat({
    // Changer de mode : le modèle lit en arrière-plan le prompt système de ce mode.
    onMode: mode => api.request('POST', 'toolbox/warm', { mode }).catch(() => {}),
    onSend: (text, attached, direct = false, tool = null) => {
        if (text === 'Plus tard') return chat.add('notice', 'D\'accord, je n\'y touche pas.');  // une note écartée : rien à demander au modèle
        queue = queue.then(() => ask(null, text, attached, direct, tool));
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
