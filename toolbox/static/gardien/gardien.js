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
import { createCompact } from './compact.js';
import { createCorners } from './corners.js';
import { createCutter } from './cutter.js';
import { createDataset } from './dataset.js';
import { createExchange } from './exchange.js';
import { createIde } from './ide.js';
import { createDimensions } from './dimensions.js';
import { createFilters } from './filters.js';
import { createFrames } from './frames.js';
import { createGrab } from './grab.js';
import { createGuide } from './guide.js';
import { createHome } from './home.js';
import { createHistory } from './history.js';
import { createLabels } from './labels.js';
import { createLibrary } from './library.js';
import { createLinkJump } from './linkjump.js';
import { createLinkDrop } from './linkdrop.js';
import { createMonitor } from './monitor.js';
import { createNodebar } from './nodebar.js';
import { createPending } from './pending.js';
import { createPhysics } from './physics.js';
import { createQuota } from './quota.js';
import './portal.js';  // window.portalRing : l'anneau vivant des portails, que Nodz pose en créant un node
import { createReminders } from './reminders.js';
import { createRoom } from './room.js';
import { createSchemas } from './schemas.js';
import { createSearch } from './search.js';
import { createSfx } from './sfx.js';
import { createSide } from './side.js';
import { createSpark } from './spark.js';
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
    guardianHome.ensure().catch(() => {});  // dimension Gardien posée d'office ; notes et rêves en attente
    reminders.refresh();
    dimensions.refresh();
    library.refresh().catch(() => {});  // IA locale ou non : la tour CPU/GPU s'affiche ou se cache
    quota.refresh();
    if (typeof guestUser !== 'undefined' && guestUser) chat.guest();  // chaque invité part d'un chat vide
    guide.welcome();  // première visite : le guide s'ouvre
    room.start();  // salon du lien (?room=) ou le sien resté ouvert
}, 400);

const joined = node => ({ id: node.id, text: (node.children[0]?.children[0]?.innerText || '').trim() });  // node joint au chat
const branches = createBranches({ say });  // replier, ranger en arbre (menu Branche de la pastille)
const filters = createFilters({ onAttach: items => chat.attach(items) });  // sélecteur de contexte au-dessus du dock
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
createFrames();  // nodes à l'écran recalculés une fois par image, pas à chaque pas de zoom
createLinkJump();  // près d'un lien, une grosse flèche (style de la visite) y voyage d'un clic
createAdmin({ say });  // consoles des boutons administrateur (Console IA, Utilisateurs)
const bridge = createBridge({ caption: text => say(text, 'guide'), onTour: node => tour.start(node), onAttach: nodes => chat.attach(nodes.map(joined)),
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
// Visite : bouton du dock, à partir du node sélectionné (le dernier d'une multisélection).
const visitButton = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'visitButton', title: 'Visite' });
document.getElementById('originButton')?.after(visitButton);
visitButton.addEventListener('click', () => {
    const node = selectedNodes.filter(n => n.isConnected).at(-1);
    if (node) tour.start(node);
    else say('Sélectionne le node d\'où part la visite.');
});
const compact = createCompact({ bridge, say });  // mode compact : sélection ou dimension rangée en arbre, nuage ou processus, en texte net (C)
const room = createRoom({ bridge, say, onPremiumOnly: () => quota.offer('rooms') });  // salons multijoueur : bouton Partager, curseurs, gestes en direct
const dataset = createDataset({ bridge, say, onDone: refs => bridge.perform({ op: 'frame', refs }) });  // import de cartes et de tableaux
createExchange({ dataset, filters });  // bouton Export du dock : tout l'import et l'export
createSearch({ bridge });  // recherche du dock : toutes les dimensions, compteur x / y, résultat allumé
const schemas = createSchemas({ bridge });  // galerie de modèles : schémas faits de nodes et de liens
const ide = createIde({ say });  // IDE des nodes de code, exécution dans le navigateur ou sur le serveur
bridge.useIde(ide);  // le Codeur du Gardien y écrit et y exécute son code
createSide({ bridge, say, filters });  // vue de côté : X = numéro de dimension, Y = Y
const pending = createPending({ bridge, say, onApplied: ids => filters.mark(ids, 'ai') });  // changer de dimension n'interrompt pas le Gardien
let guardian = null;  // l'agent orchestrateur de l'utilisateur
const timeline = createHistory({ onGesture: kind => sfx.play(kind) });  // Ctrl+Z / Ctrl+Y sur tout geste, du clavier, de la souris ou du Gardien
const quota = createQuota({ onPremium: () => library.open('start') });  // compte gratuit : 5 dimensions, 100 nodes ; au-delà, Premium (après l'historique : un node refusé n'y entre pas)
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

const monitor = createMonitor({ onSignedOut: message => say(message, 'error') });
const library = createLibrary({
    onOpenHome: () => { library.close(); guardianHome.open().catch(error => say(error.message, 'error')); },
    monitor: monitor.panel('gm-window').root,
    onChange: state => {
        guardian = state.agents.find(a => a.role === 'orchestrator') || null;
        tower.root.classList.toggle('gm-off', !state.local);  // la tour CPU/GPU ne sert qu'à qui fait tourner un modèle sur cette machine
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
    await compact.off();  // le Gardien agit sur la carte éclatée
    chat.busy(true);
    timeline.begin();
    // Réflexion en direct : le plan que le modèle écrit, fragment par fragment (un fragment ≈ un jeton).
    let think = null, round = 0, pieces = 0, thinkStart = 0;
    try {
        if (!guardian) await loadGuardian();
        if (!guardian?.enabled || !guardian.model) {
            chat.offer('Je dors : pour penser avec toi, il me faut un grand modèle. Passe Premium, ou branche ton IA par API avec ta clé.',
                'Réveiller le Gardien', () => library.open('start'));
            if (node) say('Le Gardien dort : Premium ou ta clé API le réveillent (Agents & modèles, Mon IA).', 'notice');
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
            else if (type === 'note') actions = actions.then(() => { chat.add('guardian', `Note laissée dans la dimension Gardien (Échanges) : ${data.text}`, '', data.choices); guardianHome.refresh(); });
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
        guardianHome.heard();  // une période calme commence : il rêvera après
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
    onHome: () => guardianHome.open().catch(error => say(error.message, 'error')),
    onGoto: (ref, layer) => bridge.perform({ op: 'goto', ref, layer }).catch(() => say(`${ref} n'existe plus`, 'error')),
});
const guardianHome = createHome({ bridge, say, filters, chat, branches });  // dimension Gardien : ses clés, réglées en réécrivant ses nodes

// Premier clic sur le Gardien (une fois par navigateur) : Mon IA et ses trois offres (gratuit lent, gratuit avec sa clé,
// Premium) avant le chat. Pas sous automatisation (les bancs ouvrent le chat) ni dans un salon.
document.getElementById('gardien-chat-button').addEventListener('click', event => {
    try {
        if (localStorage.getItem('gardien-offers') || navigator.webdriver || new URLSearchParams(location.search).has('room')) return;
        localStorage.setItem('gardien-offers', '1');
    } catch { return; }
    event.stopImmediatePropagation();
    library.open('start');
}, true);

// Retour de Stripe (?premium=ok ou annule) : un mot, puis l'adresse redevient propre.
const paid = new URLSearchParams(location.search).get('premium');
if (paid) {
    say(paid === 'ok' ? 'Merci ! Ton Gardien Premium s\'active dans un instant ; un e-mail te le confirme.' : 'Paiement annulé : rien n\'a changé.', 'guide');
    history.replaceState(null, '', location.pathname);
    if (paid === 'ok') setTimeout(() => library.refresh().catch(() => {}), 4000);  // le webhook de Stripe arrive en quelques secondes
}


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
createSpark({ bridge, onSpark: (node, text) => { queue = queue.then(() => ask(node, text)); } });  // dimension vide : une première idée qui pousse
