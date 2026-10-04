// Importer / Exporter : tout ce qui entre dans l'univers ou en sort passe par le bouton Export du dock (celui de Nodz,
// sans bouton de plus : le dock garde sa largeur). Un seul panneau :
// - Importer un fichier : un dataset (CSV, TSV, JSON, Excel) ou une carte (Markdown, texte indenté, OPML, FreeMind,
//   XMind), posé dans la dimension ouverte (dataset.js).
// - Exporter la sélection, la dimension ou les nodes gardés par les filtres : CSV, Markdown, OPML, FreeMind ; et le PDF
//   de Nodz (son ancienne fenêtre d'export).
// Les nodes et leurs pastilles ne portent plus rien de tout cela.

import { FORMATS, forest } from './branches.js';
import { describe, download, stamp, toCsv } from './dataset.js';

const SCOPES = [['selection', 'Sélection'], ['dimension', 'Dimension'], ['filters', 'Filtres']];

export function createExchange({ dataset, filters }) {
    let scope = 'dimension', bypass = false;
    const make = (tag, props = {}, ...kids) => {
        const el = Object.assign(document.createElement(tag), props);
        el.append(...kids.flat().filter(k => k !== null && k !== undefined));
        return el;
    };
    const panel = make('section', { id: 'gardien-exchange', hidden: true });
    panel.setAttribute('aria-label', 'Importer / Exporter');
    const close = make('button', { type: 'button', className: 'gxx-x', title: 'Fermer (Échap)', textContent: '×', onclick: () => toggle(false) });
    const pick = make('button', { type: 'button', className: 'gxx-primary', textContent: 'Choisir un fichier…',
        onclick: () => { toggle(false); dataset.pick(); } });
    const scopes = make('div', { className: 'gxx-seg', role: 'group' });
    const formats = make('div', { className: 'gxx-formats' });
    const note = make('p', { className: 'gxx-note' });
    panel.append(
        make('header', {}, make('b', { textContent: 'Importer / Exporter' }), close),
        make('h4', { textContent: 'Importer' }),
        make('p', { className: 'gxx-note', textContent: 'Une carte (Markdown, texte indenté, OPML, FreeMind, XMind) se pose en arbre ; '
            + 'un tableau (CSV, TSV, JSON, Excel) : une ligne = un node, rangés par groupe. Dans la dimension ouverte.' }),
        pick,
        make('h4', { textContent: 'Exporter' }),
        scopes, formats, note);
    document.body.append(panel);

    const nameOf = () => (layers.find(l => l.id === layerNumber)?.name || 'nodz').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || 'nodz';
    const selection = () => selectedNodes.filter(n => n.isConnected);
    const available = key => key === 'selection' ? selection().length > 0 : key === 'filters' ? filters.refined() : true;

    function save(format) {
        const name = `${nameOf()}-${scope === 'selection' ? 'selection' : scope === 'filters' ? 'filtres' : 'carte'}`;
        if (format === 'csv') {
            const rows = scope === 'filters' ? filters.exportRows() : (scope === 'selection' ? selection() : [...universe.querySelectorAll('.node-group')]).map(describe);
            return download(`${name}-${stamp()}.csv`, toCsv(rows));
        }
        const [, ext, type, write] = FORMATS.find(([, e]) => e === format);
        const roots = forest(scope === 'selection' ? new Set(selection().map(n => n.id)) : null);
        download(`${name}.${ext}`, write(roots, nameOf()), `${type};charset=utf-8`);
    }

    // Le PDF de Nodz : son ancienne fenêtre, ouverte comme avant par le bouton.
    function pdf() {
        toggle(false);
        bypass = true;
        document.getElementById('exportButton')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        bypass = false;
    }

    function render() {
        if (!available(scope)) scope = selection().length ? 'selection' : 'dimension';
        scopes.replaceChildren(...SCOPES.map(([key, label]) => {
            const count = key === 'selection' ? ` (${selection().length})` : '';
            const b = make('button', { type: 'button', textContent: label + count, disabled: !available(key),
                title: key === 'filters' ? 'Les nodes cochés dans les Filtres, sinon ceux qu\'ils gardent, de toutes les dimensions (CSV)' : '',
                onclick: () => { scope = key; render(); } });
            b.classList.toggle('on', key === scope);
            return b;
        }));
        const tree = scope !== 'filters';  // les arbres se lisent dans la dimension ouverte ; les filtres traversent les dimensions
        formats.replaceChildren(
            make('button', { type: 'button', textContent: 'CSV', title: 'Tableau : texte, type, couleur, position, rappel, liens', onclick: () => save('csv') }),
            ...FORMATS.map(([label, ext]) => make('button', { type: 'button', textContent: label, disabled: !tree,
                title: `Carte en arbre (.${ext}) : XMind, MindNode, MindMeister, Obsidian…`, onclick: () => save(ext) })),
            make('button', { type: 'button', textContent: 'PDF', disabled: scope === 'filters', title: 'Le PDF de Nodz (sélection ou dimension)', onclick: pdf }));
        note.textContent = scope === 'filters' ? 'Les filtres traversent les dimensions : seul le CSV les exporte.' : '';
    }

    function toggle(on = panel.hidden) {
        panel.hidden = !on;
        if (on) render();
    }

    // Son libellé dit ce qu'il fait (Nodz y affichait « Save » en invité, « Export » sinon).
    const tooltip = window.createTooltip;
    window.createTooltip = (id, text) => tooltip(id, id === 'exportButton' ? 'Importer / Exporter' : text);

    // Le bouton Export du dock ouvre ce panneau à la place de l'ancienne fenêtre de Nodz (gardée pour le PDF).
    document.addEventListener('mousedown', event => {
        if (bypass || !event.target.closest?.('#exportButton') || !document.body.classList.contains('gardien-ready')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggle();
    }, true);
    document.addEventListener('mousedown', event => {
        if (!panel.hidden && !panel.contains(event.target) && !event.target.closest?.('#exportButton')) toggle(false);
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') toggle(false); });
    return { toggle };
}
