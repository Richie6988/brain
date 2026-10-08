// Compte gratuit (toolbox/quota.py) : 5 dimensions et 100 nodes, la dimension Gardien en plus ; Premium : illimité.
// Au plafond, créer s'arrête net (le geste est interrompu, rien de ce qui existe n'est touché) et une carte propose
// Premium : nodes et dimensions illimités, Gardien propulsé par l'IA, salons collaboratifs. Les compteurs viennent du
// serveur à la connexion, puis suivent les créations et suppressions ; le serveur refuse lui-même un node de trop.
// Jamais compté : un chargement de dimension, un node recréé avec son identifiant (couper / coller), la dimension
// Gardien (posée par le serveur, toolbox/home.py).

import { api } from './api.js';
import { h } from './library.js';
import { t } from './i18n.js';

const PERKS = [t('quota.perk1'), t('quota.perk2'), t('quota.perk3')];
const TITLES = { nodes: t('quota.nodes'), dimensions: t('quota.dimensions'), rooms: t('quota.rooms') };

export function createQuota({ onPremium }) {
    let state = null;  // { limited, nodes, dimensions, max_nodes, max_dimensions, home }

    const title = h('h3', {});
    const close = () => { modal.hidden = true; };
    const card = h('section', { class: 'gq-card', role: 'dialog', 'aria-label': t('quota.go') },
        h('button', { type: 'button', class: 'gq-x', title: t('rem.close'), onclick: close }, '×'),
        title,
        h('p', {}, t('quota.intro')),
        h('ul', {}, PERKS.map(perk => h('li', {}, perk))),
        h('p', { class: 'gq-why' }, t('quota.why')),
        h('div', { class: 'gq-actions' },
            h('button', { type: 'button', class: 'gq-go', onclick: () => { close(); onPremium(); } }, t('quota.go')),
            h('button', { type: 'button', onclick: close }, t('g.later'))));
    const modal = h('div', { class: 'gl-modal gq-modal', hidden: true, onmousedown: event => { if (event.target === modal) close(); } }, card);
    modal.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') close(); });
    document.body.append(modal);

    function offer(kind) {
        title.textContent = TITLES[kind];
        modal.hidden = false;
        card.querySelector('.gq-go').focus();
    }

    const refresh = () => api.request('GET', 'toolbox/quota').then(s => { state = s; return s; }).catch(() => state);
    const home = () => String(layerNumber) === String(state.home);
    const limited = () => Boolean(state?.limited);
    const full = kind => limited() && state[kind] >= state[`max_${kind}`];
    const stop = kind => {
        offer(kind);
        throw new Error(t(kind === 'nodes' ? 'quota.limitNodes' : 'quota.limitDims'));
    };

    // Un node neuf (sans identifiant imposé), hors chargement et hors dimension Gardien : compté, refusé au plafond.
    const createNode = window.createNode;
    window.createNode = function (...args) {
        const counted = args[2] === undefined && !isLoading && state && !home();
        if (counted && full('nodes')) stop('nodes');
        const node = createNode.apply(this, args);
        if (counted && limited()) state.nodes += 1;
        return node;
    };
    const deleteNode = window.deleteNode;
    window.deleteNode = function (nodes) {
        const gone = limited() && !isLoading ? Array.from(nodes).filter(n => String(n.getAttribute('layer')) !== String(state.home)).length : 0;
        const result = deleteNode.call(this, nodes);
        if (gone) state.nodes = Math.max(0, state.nodes - gone);
        return result;
    };
    const createNewLayer = window.createNewLayer;
    window.createNewLayer = function (...args) {
        if (full('dimensions')) stop('dimensions');
        const result = createNewLayer.apply(this, args);
        if (limited()) state.dimensions += 1;
        return result;
    };
    const deleteLayer = window.deleteLayer;
    window.deleteLayer = function (...args) {
        const result = deleteLayer.apply(this, args);
        setTimeout(refresh, 1500);  // suppression confirmée côté serveur : le compte repart du vrai nombre
        return result;
    };
    // Portail (Entrée sur une sélection) : Nodz copie les nodes avant d'ouvrir la dimension ; au plafond, on l'arrête
    // avant, que le node ne garde pas un anneau de portail sans dimension au bout.
    document.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !selectedNodes.length || isTyping || overlay || !full('dimensions')) return;
        if (JSON.parse(selectedNodes[selectedNodes.length - 1].getAttribute('quantum') || '[]').length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        offer('dimensions');
    }, true);

    // Chaque changement de dimension : le compte repart du serveur (dimension Gardien posée entre-temps, autre onglet).
    let seen = null;
    setInterval(() => {
        if (!state || isLoading || layerNumber === seen) return;
        seen = layerNumber;
        refresh();
    }, 1000);

    return { refresh, offer };
}
