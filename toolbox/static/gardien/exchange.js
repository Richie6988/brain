// Importer / Exporter : tout ce qui entre dans l'univers ou en sort passe par le bouton Export du dock (celui de Nodz,
// sans bouton de plus : le dock garde sa largeur). Un seul panneau :
// - Importer un fichier : un dataset (CSV, TSV, JSON, Excel) ou une carte (Markdown, texte indenté, OPML, FreeMind,
//   XMind), posé dans la dimension ouverte (dataset.js).
// - Exporter la sélection, la dimension ou les nodes gardés par les filtres : CSV, Markdown, OPML, FreeMind ; et le PDF
//   de Nodz (son ancienne fenêtre d'export).
// Les nodes et leurs pastilles ne portent plus rien de tout cela.

import { FORMATS, forest } from './branches.js';
import { describe, download, stamp, toCsv } from './dataset.js';
import { t } from './i18n.js';

const SCOPES = [['selection', t('pill.pick')], ['dimension', t('xx.dimension')], ['filters', t('fx.filters')]];

export function createExchange({ dataset, filters }) {
    let scope = 'dimension', bypass = false;
    const make = (tag, props = {}, ...kids) => {
        const el = Object.assign(document.createElement(tag), props);
        el.append(...kids.flat().filter(k => k !== null && k !== undefined));
        return el;
    };
    const panel = make('section', { id: 'gardien-exchange', hidden: true });
    panel.setAttribute('aria-label', t('xx.title'));
    const close = make('button', { type: 'button', className: 'gxx-x', title: t('fx.close'), textContent: '×', onclick: () => toggle(false) });
    const pick = make('button', { type: 'button', className: 'gxx-primary', textContent: t('xx.pick'),
        onclick: () => { toggle(false); dataset.pick(); } });
    const scopes = make('div', { className: 'gxx-seg', role: 'group' });
    const formats = make('div', { className: 'gxx-formats' });
    const note = make('p', { className: 'gxx-note' });
    panel.append(
        make('header', {}, make('b', { textContent: t('xx.title') }), close),
        make('h4', { textContent: t('xx.import') }),
        make('p', { className: 'gxx-note', textContent: t('xx.importNote') }),
        pick,
        make('h4', { textContent: t('xx.export') }),
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
                title: key === 'filters' ? t('xx.filtersTitle') : '',
                onclick: () => { scope = key; render(); } });
            b.classList.toggle('on', key === scope);
            return b;
        }));
        const tree = scope !== 'filters';  // les arbres se lisent dans la dimension ouverte ; les filtres traversent les dimensions
        formats.replaceChildren(
            make('button', { type: 'button', textContent: 'CSV', title: t('xx.csvTitle'), onclick: () => save('csv') }),
            ...FORMATS.map(([label, ext]) => make('button', { type: 'button', textContent: label, disabled: !tree,
                title: t('xx.treeTitle', { ext }), onclick: () => save(ext) })),
            make('button', { type: 'button', textContent: 'PDF', disabled: scope === 'filters', title: t('xx.pdfTitle'), onclick: pdf }));
        note.textContent = scope === 'filters' ? t('xx.filtersNote') : '';
    }

    function toggle(on = panel.hidden) {
        panel.hidden = !on;
        if (on) render();
    }

    // Son libellé dit ce qu'il fait (Nodz y affichait « Save » en invité, « Export » sinon).
    const tooltip = window.createTooltip;
    window.createTooltip = (id, text) => tooltip(id, id === 'exportButton' ? t('xx.title') : text);

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
