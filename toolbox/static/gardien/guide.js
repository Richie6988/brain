// Guide de Nodz : un parcours de découverte en cinq étapes, tous les raccourcis (souris et clavier, avec recherche) et
// ce que font le Gardien et l'IA, dans une fenêtre à onglets. Bouton « ? » du menu ou touche « ? » ; ouvert de lui-même
// à chaque entrée en invité et à la première connexion (pas sous automatisation : les bancs de navigation pilotent un
// navigateur vierge).

import { lang, langSwitch, t } from './i18n.js';
import { h } from './library.js';

const KEY = 'gardien-guide-seen';

// Illustrations des étapes : des SVG fixes (aucune donnée de l'utilisateur), stylés par gardien.css.
const SCENE = {
    idea: '<circle cx="60" cy="44" r="20" class="n on"/><path d="M52 44h16M60 36v16" class="t"/>'
        + '<path d="M96 70l8 8m-8-8v10m0-10h10" class="p"/>',
    link: '<circle cx="34" cy="44" r="15" class="n on"/><circle cx="96" cy="30" r="12" class="n"/><circle cx="92" cy="66" r="10" class="n"/>'
        + '<path d="M48 40l36-8M47 50l35 12" class="l"/>',
    portal: '<rect x="20" y="22" width="44" height="44" rx="6" class="n"/><rect x="40" y="12" width="44" height="44" rx="6" class="n"/>'
        + '<rect x="60" y="2" width="44" height="44" rx="6" class="n on"/><circle cx="82" cy="24" r="7" class="t"/>',
    ai: '<circle cx="30" cy="50" r="12" class="n on"/><circle cx="68" cy="22" r="9" class="n"/><circle cx="80" cy="58" r="9" class="n"/>'
        + '<circle cx="104" cy="36" r="7" class="n"/><path d="M41 44l19-16M42 52l29 5M76 25l21 9" class="l"/>'
        + '<path d="M18 16l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" class="t"/>',
    tidy: '<circle cx="22" cy="44" r="10" class="n on"/><circle cx="66" cy="20" r="8" class="n"/><circle cx="66" cy="44" r="8" class="n"/>'
        + '<circle cx="66" cy="68" r="8" class="n"/><path d="M32 44h26M30 38l28-16M30 50l28 16" class="l"/>'
        + '<path d="M92 32v24m-8-8l8 8 8-8" class="p"/>',
};

const STEPS_FR = [
    ['idea', 'Pose une idée', 'Chaque idée est un node. Double-clic dans le vide pour en créer un sous le pointeur, ou [Espace] au centre de la vue. '
        + 'Texte, image, fichier, dessin, code ou 3D : un node change de type sans perdre son texte.'],
    ['link', 'Relie tes idées', 'Tiens un node contre un autre une demi-seconde : au relâcher, ils sont reliés. Avec un node sélectionné, [Espace] '
        + 'crée un enfant relié ; avec plusieurs, il les relie. Un clic sur un lien te fait voyager à l\'autre bout.'],
    ['portal', 'Plonge dans une dimension', 'Chaque dimension est un univers à part. [Entrée] ouvre un portail : le node part détailler sa propre '
        + 'dimension. [Shift] liste les dimensions, la vue de côté (cube) les montre toutes à la fois.'],
    ['ai', 'Le Gardien pense avec toi', 'L\'IA de ton univers, locale ou par API. Sélectionne des nodes et ouvre la bulle en bas à droite, '
        + 'ou [Ctrl]+[Entrée] dans un node. Il crée, relie, range, cherche sur le web, dessine. Tout s\'annule par [Ctrl]+[Z].'],
    ['tidy', 'Range, invite, exporte', 'Branche ▾ sur un node range sa branche en arbre ou la replie. Inviter ouvre un salon en direct ; '
        + 'Importer / Exporter fait entrer et sortir tes cartes (Markdown, OPML, FreeMind, XMind, CSV, PDF).'],
];

// Raccourcis : [touche] devient une touche en relief.
const SHORTCUTS_FR = [
    ['Créer', [
        ['Double-clic dans le vide', 'Créer un node sous le pointeur'],
        ['[Espace]', 'Créer un node au centre ; un node sélectionné : un enfant relié ; plusieurs : les relier'],
        ['Tenir un node contre un autre', 'Au relâcher (0,5 s), les deux sont reliés'],
        ['[Entrée]', 'Ouvrir un portail : le node sélectionné part dans une nouvelle dimension'],
        ['Poignée du node', 'Redimensionner (largeur et hauteur pour un rectangle)'],
    ]],
    ['Naviguer', [
        ['Molette', 'Zoomer sur le pointeur'],
        ['[Shift] + molette', 'Faire défiler'],
        ['Glisser le vide', 'Déplacer l\'univers'],
        ['Pavé tactile', 'Deux doigts : déplacer ; pincer : zoomer'],
        ['Double-clic sur un node', 'Le centrer et zoomer dessus'],
        ['Clic sur un lien', 'Voyager jusqu\'au node de l\'autre bout'],
        ['[Tab]', 'Saut de zoom : vue d\'ensemble, puis retour'],
        ['[←] [↑] [→] [↓]', 'Déplacer la vue'],
        ['[Shift]', 'Liste des dimensions'],
        ['[Ctrl]+[F]', 'Recherche dans toutes les dimensions'],
    ]],
    ['Sélectionner et éditer', [
        ['Clic sur un node', 'Le sélectionner ; un second clic pour écrire dedans'],
        ['Glisser un node', 'Le déplacer, avec toute la sélection'],
        ['[Ctrl] + glisser le vide', 'Sélection rectangle'],
        ['[Ctrl]+[A]', 'Tout sélectionner'],
        ['[Ctrl]+[C] [Ctrl]+[X] [Ctrl]+[V]', 'Copier, couper, coller'],
        ['[X] + glisser', 'Couper les liens que le trait traverse (ou Ciseaux) ; un seul Ctrl+Z recoud le geste'],
        ['[Suppr]', 'Supprimer la sélection'],
        ['[Ctrl]+[Z] [Ctrl]+[Y]', 'Annuler, rétablir (tout geste, y compris ceux du Gardien)'],
        ['[Échap]', 'Fermer un panneau ; rafraîchir l\'affichage'],
        ['[?]', 'Ce guide'],
    ]],
    ['Gardien', [
        ['[Ctrl]+[Entrée] dans un node', 'L\'envoyer au Gardien'],
        ['/web /dessin /image', 'En tête du message : il part avec cet outil'],
        ['Visite : [←] [↑] [→] [↓] [Retour arrière] [Échap]', 'Prendre la flèche de cette direction, revenir, arrêter'],
        ['[C]', 'Mode compact : la sélection (sinon la dimension) rangée en texte net ; 1 Arbre, 2 Nuage, 3 Processus horizontal, 4 vertical ; C ou Échap : retour'],
    ]],
];

const CARDS_FR = [
    ['Dimension Gardien', 'Sa maison, posée d\'office : Âme, Identité, Utilisateur, Mémoire, Compétences, Outils, Rêves, Échanges. '
        + 'Il y relit ses clés à chaque demande : réécris un node, ajoute-en un relié sous un groupe ou supprime-le pour le régler. '
        + 'Menu ⋯ du chat : Dimension Gardien.'],
    ['Rêves', 'Après un moment calme, il relit vos derniers échanges et propose des souvenirs et des idées sous Rêves. '
        + 'Relie un rêve à Mémoire pour qu\'il le garde, supprime-le sinon : rien n\'entre en mémoire sans toi.'],
    ['Choisir ton IA', 'Agents & modèles, la pastille du HUD en haut : une IA externe par API avec ta clé, ou un modèle local depuis '
        + 'Hugging Face, recommandé selon ta machine. Ses outils et ses agents se règlent au même endroit.'],
    ['Chat', 'La bulle en bas à droite. Les nodes sélectionnés partent d\'eux-mêmes en contexte, × les retire. Avec deux nodes ou plus, '
        + 'l\'envoi est direct : la sélection est tout le contexte.'],
    ['Modes', 'Pensée : il pense en nodes. Profond : réflexion libre d\'abord. Auto : web, fichiers, agents et missions.'],
    ['Web, Dessin, Image', 'Les puces au-dessus de la saisie : recherche web sourcée, croquis du Gardien sur un node, image FLUX '
        + '(ou dessin si FLUX manque).'],
    ['Pastille d\'un node', 'Branche ▾ pour ranger sa branche en arbre ou la replier ; Sélection ▾ pour sélectionner sa lignée : '
        + 'Amont (ses parents), Aval (ses enfants) ou Tout ce qui lui est relié.'],
    ['Visite', 'Bouton du dock : de grosses flèches entourent le node sélectionné, une par lien. Survole-en une : l\'aperçu en haut '
        + 'montre le node où elle mène ; clique : la caméra y glisse. Un clic sur un autre node en fait le centre.'],
    ['Pastille d\'une sélection', 'Gardien · N nodes les joint au chat ; Ordonner : la physique les éclate puis les range.'],
    ['Importer / Exporter', 'Bouton du dock : une carte (Markdown, OPML, FreeMind, XMind) se pose en arbre, un tableau (CSV, Excel, JSON) '
        + 'en nodes, un CSV exporté par Nodz redonne ses nodes et ses liens ; la sélection, la dimension ou les filtres repartent en CSV, '
        + 'Markdown, OPML, FreeMind ou PDF.'],
    ['Salon', 'Bouton Inviter du dock : ta dimension s\'ouvre par un lien. Curseurs et gestes en direct, tout s\'enregistre chez toi ; '
        + 'Suivre cale ta caméra sur celle d\'un autre, l\'hôte peut exclure.'],
    ['Rappels', 'Bouton Rappel d\'un node, ou « rappelle-moi vendredi 9 h… » au Gardien : compte à rebours sur le node, notification '
        + 'à l\'échéance, et la cloche du dock les liste tous.'],
    ['Code', 'Un node de type code s\'exécute ; reliés, les nodes de code forment une chaîne et un node de sortie se recalcule.'],
    ['Filtre des pensées', 'Bouton du menu : les pensées du Gardien visibles, estompées ou masquées.'],
];

const STEPS_EN = [
    ['idea', 'Drop an idea', 'Every idea is a node. Double-click empty space to create one under the pointer, or [Space] at the center of the view. '
        + 'Text, image, file, drawing, code or 3D: a node changes type without losing its text.'],
    ['link', 'Link your ideas', 'Hold a node against another for half a second: on release, they are linked. With a node selected, [Space] '
        + 'creates a linked child; with several, it links them. A click on a link takes you to the other end.'],
    ['portal', 'Dive into a dimension', 'Each dimension is a universe of its own. [Enter] opens a portal: the node goes on to detail its own '
        + 'dimension. [Shift] lists the dimensions, the side view (cube) shows them all at once.'],
    ['ai', 'The Guardian thinks with you', 'The AI of your universe, local or by API. Select nodes and open the bubble at the bottom right, '
        + 'or [Ctrl]+[Enter] in a node. It creates, links, tidies, searches the web, draws. [Ctrl]+[Z] undoes it all.'],
    ['tidy', 'Tidy, invite, export', 'Branch on a node tidies its branch into a tree or folds it. Invite opens a live room; '
        + 'Import / Export brings your maps in and out (Markdown, OPML, FreeMind, XMind, CSV, PDF).'],
];

const SHORTCUTS_EN = [
    ['Create', [
        ['Double-click empty space', 'Create a node under the pointer'],
        ['[Space]', 'Create a node at the center; one node selected: a linked child; several: link them'],
        ['Hold a node against another', 'On release (0.5 s), the two are linked'],
        ['[Enter]', 'Open a portal: the selected node moves into a new dimension'],
        ['Node handle', 'Resize (width and height for a rectangle)'],
    ]],
    ['Navigate', [
        ['Wheel', 'Zoom on the pointer'],
        ['[Shift] + wheel', 'Scroll'],
        ['Drag empty space', 'Move the universe'],
        ['Touchpad', 'Two fingers: move; pinch: zoom'],
        ['Double-click a node', 'Center and zoom on it'],
        ['Click a link', 'Travel to the node at the other end'],
        ['[Tab]', 'Zoom jump: overview, then back'],
        ['[←] [↑] [→] [↓]', 'Move the view'],
        ['[Shift]', 'List of dimensions'],
        ['[Ctrl]+[F]', 'Search all dimensions'],
    ]],
    ['Select and edit', [
        ['Click a node', 'Select it; a second click to write in it'],
        ['Drag a node', 'Move it, with the whole selection'],
        ['[Ctrl] + drag empty space', 'Rectangle selection'],
        ['[Ctrl]+[A]', 'Select all'],
        ['[Ctrl]+[C] [Ctrl]+[X] [Ctrl]+[V]', 'Copy, cut, paste'],
        ['[X] + drag', 'Cut the links the stroke crosses (or Scissors); a single Ctrl+Z stitches the gesture back'],
        ['[Delete]', 'Delete the selection'],
        ['[Ctrl]+[Z] [Ctrl]+[Y]', 'Undo, redo (any gesture, including the Guardian\'s)'],
        ['[Esc]', 'Close a panel; refresh the display'],
        ['[?]', 'This guide'],
    ]],
    ['Guardian', [
        ['[Ctrl]+[Enter] in a node', 'Send it to the Guardian'],
        ['/web /dessin /image', 'At the start of the message: it goes with that tool'],
        ['Tour: [←] [↑] [→] [↓] [Backspace] [Esc]', 'Take the arrow in that direction, go back, stop'],
        ['[C]', 'Compact mode: the selection (or the dimension) tidied as clean text; 1 Tree, 2 Cloud, 3 Horizontal process, 4 vertical; C or Esc: back'],
    ]],
];

const CARDS_EN = [
    ['Guardian dimension', 'Its home, set up for you: Soul, Identity, User, Memory, Skills, Tools, Dreams, Exchanges. '
        + 'It rereads its keys on every request: rewrite a node, add one linked under a group or delete it to tune it. '
        + 'Chat ⋯ menu: Guardian dimension.'],
    ['Dreams', 'After a quiet while, it rereads your latest exchanges and suggests memories and ideas under Dreams. '
        + 'Link a dream to Memory for it to keep it, delete it otherwise: nothing goes into memory without you.'],
    ['Choose your AI', 'Agents & models, the HUD pill at the top: an external AI by API with your key, or a local model from '
        + 'Hugging Face, recommended for your machine. Its tools and agents are set in the same place.'],
    ['Chat', 'The bubble at the bottom right. Selected nodes go along as context by themselves, × removes them. With two nodes or more, '
        + 'sending is direct: the selection is the whole context.'],
    ['Modes', 'Thought: it thinks in nodes. Deep: free reflection first. Auto: web, files, agents and missions.'],
    ['Web, Drawing, Image', 'The chips above the input: sourced web search, the Guardian\'s sketch on a node, FLUX image '
        + '(or a drawing if FLUX is missing).'],
    ['Node pill', 'Branch to tidy its branch into a tree or fold it; Selection to select its lineage: '
        + 'Upstream (its parents), Downstream (its children) or Everything linked to it.'],
    ['Tour', 'Dock button: big arrows surround the selected node, one per link. Hover one: the preview at the top '
        + 'shows the node it leads to; click: the camera glides there. A click on another node makes it the center.'],
    ['Selection pill', 'Guardian · N nodes attaches them to the chat; Arrange: physics spreads them out, then tidies them.'],
    ['Import / Export', 'Dock button: a map (Markdown, OPML, FreeMind, XMind) lands as a tree, a table (CSV, Excel, JSON) '
        + 'as nodes, a CSV exported by Nodz restores its nodes and links; the selection, the dimension or the filters go out as CSV, '
        + 'Markdown, OPML, FreeMind or PDF.'],
    ['Room', 'Invite button in the dock: your dimension opens with a link. Live cursors and gestures, everything is saved on your side; '
        + 'Follow locks your camera on someone else\'s, the host can remove people.'],
    ['Reminders', 'A node\'s Reminder button, or "remind me Friday at 9…" to the Guardian: countdown on the node, notification '
        + 'when due, and the dock bell lists them all.'],
    ['Code', 'A code node runs; linked together, code nodes form a chain and an output node recomputes.'],
    ['Thought filter', 'Menu button: the Guardian\'s thoughts visible, faded or hidden.'],
];

const [STEPS, SHORTCUTS, CARDS] = lang() === 'en' ? [STEPS_EN, SHORTCUTS_EN, CARDS_EN] : [STEPS_FR, SHORTCUTS_FR, CARDS_FR];

const scene = markup => {
    const box = h('span', { class: 'gg-scene', 'aria-hidden': 'true' });
    box.innerHTML = `<svg viewBox="0 0 124 88" fill="none" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
    return box;
};
// « [Ctrl]+[Z] et du texte » : les crochets deviennent des touches, le reste reste du texte.
const keys = text => text.split(/(\[[^\]]+\])/).filter(Boolean).map(part =>
    part.startsWith('[') ? h('kbd', {}, part.slice(1, -1)) : part);

export function createGuide() {
    let step = 0;
    const dots = h('div', { class: 'gg-dots' }, STEPS.map((s, i) => h('button', { type: 'button', 'aria-label': t('guide.stepN', { n: i + 1 }), onclick: () => go(i) })));
    const stage = h('div', { class: 'gg-stage' });
    const prev = h('button', { type: 'button', class: 'gg-ghost', onclick: () => go(step - 1) }, t('guide.prev'));
    const next = h('button', { type: 'button', class: 'gg-primary', onclick: () => (step < STEPS.length - 1 ? go(step + 1) : close()) });
    const discover = h('div', { class: 'gg-discover' }, stage, h('footer', {}, dots, h('div', { class: 'gg-nav' }, prev, next)));

    const search = h('input', { type: 'search', class: 'gg-search', placeholder: t('guide.search'), 'aria-label': t('guide.searchLabel'),
        oninput: () => filter(search.value) });
    const groups = SHORTCUTS.map(([title, rows]) => h('section', { class: 'gg-group' }, h('h3', {}, title),
        rows.map(([combo, text]) => h('div', { class: 'gg-row', dataset: { find: `${combo} ${text}`.toLowerCase() } },
            h('span', { class: 'gg-keys' }, keys(combo)), h('span', {}, text)))));
    const empty = h('p', { class: 'gg-empty', hidden: true }, t('guide.none'));
    const shortcuts = h('div', { class: 'gg-shortcuts' }, search, h('div', { class: 'gg-groups' }, groups), empty);

    const cards = h('div', { class: 'gg-cards' }, CARDS.map(([title, text]) => h('article', {}, h('h3', {}, title), h('p', {}, text))));

    const tabs = [['discover', t('guide.discover'), discover], ['keys', t('guide.keys'), shortcuts], ['ai', t('guide.ai'), cards]];
    const panels = Object.fromEntries(tabs.map(([key, , body]) => [key, h('section', { class: 'gg-panel', dataset: { panel: key } }, body)]));
    const nav = h('nav', { class: 'gg-tabs', role: 'tablist' }, tabs.map(([key, label]) =>
        h('button', { type: 'button', role: 'tab', dataset: { tab: key }, onclick: () => show(key) }, label)));
    const windowEl = h('div', { class: 'gg-window', role: 'dialog', 'aria-label': t('guide.title'), tabindex: '-1' },
        h('header', {}, h('h2', {}, t('guide.name')), nav, langSwitch('gg-lang'), h('button', { type: 'button', class: 'gg-x', title: t('guide.close'), onclick: close }, '×')),
        Object.values(panels));
    const modal = h('div', { class: 'gl-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, windowEl);
    modal.addEventListener('keydown', event => {
        event.stopPropagation();  // pas de raccourci de Nodz derrière le guide
        if (event.key === 'Escape') close();
        else if (!panels.discover.hidden && event.target !== search && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
            go(step + (event.key === 'ArrowRight' ? 1 : -1));
        }
    });
    document.body.append(modal);

    function go(i) {
        step = Math.max(0, Math.min(STEPS.length - 1, i));
        const [art, title, text] = STEPS[step];
        stage.replaceChildren(scene(SCENE[art]),
            h('div', { class: 'gg-copy' }, h('small', {}, t('guide.stepOf', { n: step + 1, total: STEPS.length })), h('h3', {}, title), h('p', {}, keys(text))));
        stage.classList.remove('gg-in');
        void stage.offsetWidth;  // relance l'animation d'entrée
        stage.classList.add('gg-in');
        dots.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === step));
        prev.disabled = step === 0;
        next.textContent = step < STEPS.length - 1 ? t('guide.next') : t('guide.go');
    }
    function filter(query) {
        const q = query.trim().toLowerCase();
        groups.forEach(group => {
            const rows = [...group.querySelectorAll('.gg-row')];
            rows.forEach(row => { row.hidden = Boolean(q) && !row.dataset.find.includes(q); });
            group.hidden = rows.every(row => row.hidden);
        });
        empty.hidden = groups.some(group => !group.hidden);
    }
    function show(key) {
        nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
        Object.entries(panels).forEach(([k, panel]) => { panel.hidden = k !== key; });
    }
    function open(key = 'discover') {
        go(0);
        show(key);
        modal.hidden = false;
        windowEl.focus();  // la fenêtre, pas « Suivant » : sinon son anneau de focus restait affiché jusqu'au premier clic
        try {
            localStorage.setItem(KEY, '1');
        } catch { /* stockage indisponible */ }
    }
    let waiting = [];
    function close() {
        modal.hidden = true;
        waiting.splice(0).forEach(resolve => resolve());
    }
    // Résolue quand le guide est fermé (tout de suite s'il ne l'est pas) : l'accueil du Gardien attend que l'on ait lu.
    const closed = () => (modal.hidden ? Promise.resolve() : new Promise(resolve => waiting.push(resolve)));

    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'guideButton', title: t('guide.name') });
    document.getElementById('profileButton')?.before(button);
    button.addEventListener('click', () => open());
    document.addEventListener('keydown', event => {
        if (event.key !== '?' || !modal.hidden || isTyping || event.target.closest?.('input, textarea, [contenteditable]')) return;
        event.preventDefault();
        open();
    });

    // Une fois connecté : à chaque entrée en mode invité (GUEST), sinon à la première visite.
    function welcome() {
        let seen = true;
        try {
            seen = localStorage.getItem(KEY) === '1';
        } catch { /* stockage indisponible : pas d'ouverture d'office */ }
        const guest = typeof guestUser !== 'undefined' && guestUser;
        if ((guest || !seen) && !navigator.webdriver) open();
    }
    return { open, welcome, closed };
}
