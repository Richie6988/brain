// Guide de Nodz : présentation du produit et tous les contrôles (souris, clavier, Gardien et IA), dans un panneau à
// onglets. Bouton « ? » du menu ou touche « ? » ; ouvert de lui-même à chaque entrée en invité et à la première connexion (pas sous automatisation :
// les bancs de navigation pilotent un navigateur vierge).

import { h } from './library.js';

const KEY = 'gardien-guide-seen';

const PRESENTATION = [
    ['Nodz', 'Un mind map multidimensionnel : tes idées sont des nodes, reliés par des liens, posés dans des dimensions '
        + 'que relient des portails. On zoome de la vue d\'ensemble jusqu\'au détail, on voyage de lien en lien.'],
    ['Nodes', 'Texte, image, fichier, dessin, code, 3D : un node change de type sans perdre son texte, qui sert à la recherche.'],
    ['Dimensions', 'Chaque dimension est un univers à part. Un portail (Entrée sur un node) en ouvre une nouvelle pour '
        + 'détailler ce node ; la vue de côté (cube) les montre toutes à la fois.'],
    ['Le Gardien', 'L\'IA de ton univers, locale (sur ta machine) ou par API. Il pense en nodes autour de ce que tu '
        + 'sélectionnes, crée, relie, range, supprime, voyage entre dimensions, cherche sur le web, produit images, '
        + 'présentations et documents. Tout ce qu\'il fait s\'annule par Ctrl+Z.'],
    ['Choisir ton IA', 'Agents & modèles (pastille du HUD en haut) : 1. une IA externe par API avec ta clé, ou '
        + '2. un modèle local depuis Hugging Face, recommandé selon ta machine.'],
];

const MOUSE = [
    ['Double-clic dans le vide', 'Créer un node sous le pointeur'],
    ['Double-clic sur un node', 'Le centrer et zoomer dessus'],
    ['Clic sur un node', 'Le sélectionner ; un second clic pour écrire dedans'],
    ['Glisser un node', 'Le déplacer, avec toute la sélection'],
    ['Glisser le vide', 'Déplacer l\'univers'],
    ['Ctrl + glisser dans le vide', 'Sélection rectangle'],
    ['Molette', 'Zoomer sur le pointeur'],
    ['Shift + molette', 'Faire défiler'],
    ['Pavé tactile', 'Deux doigts : déplacer ; pincer : zoomer'],
    ['Tenir un node contre un autre (0,5 s)', 'Au relâcher, les deux sont reliés'],
    ['Clic sur un lien', 'Voyager jusqu\'au node de l\'autre bout'],
    ['X maintenu + glisser (ou Ciseaux)', 'Couper les liens que le trait traverse ; un seul Ctrl+Z recoud le geste'],
    ['Poignée du node', 'Redimensionner (largeur et hauteur pour un rectangle)'],
];

const KEYBOARD = [
    ['Espace', 'Créer un node au centre de la vue ; un node sélectionné : un enfant relié sous le pointeur ; plusieurs : les relier'],
    ['Entrée', 'Ouvrir un portail : le node sélectionné part dans une nouvelle dimension'],
    ['Tab', 'Saut de zoom : vue d\'ensemble, puis retour'],
    ['Flèches', 'Déplacer la vue'],
    ['Shift', 'Liste des dimensions'],
    ['Ctrl+F', 'Recherche dans toutes les dimensions'],
    ['Ctrl+A', 'Tout sélectionner'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copier, couper, coller'],
    ['Suppr', 'Supprimer la sélection'],
    ['Ctrl+Z / Ctrl+Y', 'Annuler, rétablir (tout geste, y compris ceux du Gardien)'],
    ['Ctrl+Entrée dans un node', 'L\'envoyer au Gardien'],
    ['Échap', 'Fermer un panneau ; rafraîchir l\'affichage'],
    ['?', 'Ce guide'],
];

const GARDIEN = [
    ['Pastille d\'un node', 'Gardien (lui envoyer), Visite (parcours de la branche), ▲ Amont / ▼ Aval (étendre la '
        + 'sélection au node et à sa seule lignée, parents ou enfants)'],
    ['Pastille d\'une sélection', 'Gardien · N nodes (les joindre au chat), Ordonner (la physique les éclate puis les range)'],
    ['Chat', 'Bulle en bas à droite. Les nodes sélectionnés partent d\'eux-mêmes en contexte ; × les retire'],
    ['Modes', 'Pensée : il pense en nodes ; Profond : réflexion libre d\'abord ; Auto : web, fichiers, agents et missions'],
    ['Bulle avec 2 nodes ou plus', 'Envoi direct : la sélection est tout le contexte'],
    ['Web, Dessin, Image', 'Puces au-dessus de la saisie, ou /web, /dessin, /image en tête du message : le prochain message part avec '
        + 'cet outil (recherche web sourcée, croquis du Gardien sur un node, image FLUX ou dessin si FLUX manque)'],
    ['Visite', 'Espace : pause ; ← / → : précédent, suivant ; Échap : arrêter'],
    ['Filtre des pensées', 'Bouton du menu : pensées visibles, estompées ou masquées'],
    ['Code', 'Un node de type code s\'exécute ; reliés, les nodes de code forment une chaîne et un node de sortie se recalcule'],
    ['Agents & modèles', 'Pastille du HUD : choisir l\'IA, ses outils et ses agents'],
    ['Rappels', 'Bouton Rappel d\'un node (calendrier), ou « rappelle-moi vendredi 9 h… » au Gardien. Compte à rebours au-dessus du node, '
        + 'notification à l\'échéance ; la cloche du dock les liste tous (report, retrait, voyage)'],
    ['Salon', 'Bouton Partager du dock : ouvre ta dimension par un lien. Les autres voient ton univers, vos curseurs et chaque geste en '
        + 'direct, et l\'éditent ; tout s\'enregistre chez toi. Suivre : ta caméra suit la sienne ; l\'hôte peut exclure'],
];

const table = rows => h('dl', { class: 'gg-list' }, rows.flatMap(([key, text]) => [h('dt', {}, key), h('dd', {}, text)]));

export function createGuide() {
    const tabs = [['intro', 'Présentation', h('div', { class: 'gg-intro' }, PRESENTATION.map(([title, text]) =>
        h('section', {}, h('h3', {}, title), h('p', {}, text))))],
    ['mouse', 'Souris', table(MOUSE)], ['keys', 'Clavier', table(KEYBOARD)], ['ai', 'Gardien et IA', table(GARDIEN)]];
    const panels = Object.fromEntries(tabs.map(([key, , body]) => [key, h('section', { class: 'gl-panel', dataset: { panel: key } }, body)]));
    const nav = h('nav', { class: 'gl-tabs' }, tabs.map(([key, label]) =>
        h('button', { type: 'button', dataset: { tab: key }, onclick: () => show(key) }, label)));
    const windowEl = h('div', { class: 'gl-window gg-window', role: 'dialog', 'aria-label': 'Guide de Nodz' },
        h('header', {}, h('h2', {}, 'Guide'), nav, h('button', { type: 'button', class: 'gl-close', title: 'Fermer', onclick: close }, 'Fermer')),
        Object.values(panels));
    const modal = h('div', { class: 'gl-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, windowEl);
    modal.addEventListener('keydown', event => {
        event.stopPropagation();  // pas de raccourci de Nodz derrière le guide
        if (event.key === 'Escape') close();
    });
    document.body.append(modal);

    function show(key) {
        nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
        Object.entries(panels).forEach(([k, panel]) => { panel.hidden = k !== key; });
    }
    function open(key = 'intro') {
        show(key);
        modal.hidden = false;
        nav.querySelector('button.active')?.focus();
        try {
            localStorage.setItem(KEY, '1');
        } catch { /* stockage indisponible */ }
    }
    function close() { modal.hidden = true; }

    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'guideButton', title: 'Guide' });
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
    return { open, welcome };
}
