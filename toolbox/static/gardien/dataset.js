// Cartes des autres outils (Markdown, texte indenté, OPML, FreeMind / Freeplane, XMind) : un arbre posé tel quel,
// rangé de gauche à droite (branches.js). Données tabulaires. Export : des nodes (sélection, ou ceux que les filtres gardent) en CSV, ouvert tel quel par
// Excel (séparateur « ; », BOM UTF-8). Import automatique : un dataset (CSV, TSV, JSON, Excel) devient un arbre de
// nodes sans réglage : la colonne du libellé et, s'il y en a une, la colonne de regroupement sont devinées ; chaque
// ligne devient un node (son libellé en gras, quelques autres colonnes dessous), rangé autour de son groupe, les
// groupes autour d'un node racine au nom du fichier.

import { endpoint } from './api.js';
import { arrange, layout } from './branches.js';

const MAX_ROWS = 500;     // nodes posés au plus par import
const SHOWN_FIELDS = 3;   // colonnes affichées sous le libellé
const LABEL = /^(nom|name|titre|title|label|libell|intitul|text|texte|sujet|subject|produit|product|item)/i;
const GROUP = /^(cat[ée]gor|category|type|group|groupe|famille|family|statut|status|th[èe]me|topic|segment|r[ée]gion|pays|country)/i;
const COLORS = ['#4D96FF', '#33FF99', '#FFD93D', '#FF6B6B', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5'];

// --- export

const cell = value => {
    const text = String(value ?? '');
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows) {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    return '﻿' + [columns, ...rows.map(row => columns.map(c => row[c]))].map(line => line.map(cell).join(';')).join('\r\n');
}

export function download(name, text, type = 'text/csv;charset=utf-8') {
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    link.addEventListener('click', event => event.stopPropagation());  // pas l'avertissement « lien externe » de Nodz
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Ce que la page sait d'un node à l'écran : texte, type, couleur, forme, position, rappel, voisins.
export function describe(node) {
    const siblings = JSON.parse(node.getAttribute('siblings') || '[]');
    return {
        id: node.id, texte: (node.children[0]?.children[0]?.innerText || '').trim(), type: node.getAttribute('type'),
        couleur: node.getAttribute('color'), forme: node.getAttribute('shape'), x: Math.round(node.getAttribute('x')),
        y: Math.round(node.getAttribute('y')), rappel: node.getAttribute('notification') || '', verrou: node.getAttribute('lock') === '1' ? 'oui' : '',
        liens: siblings.join(' '),
    };
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

// --- import

// CSV ou TSV : le séparateur le plus présent hors guillemets dans la première ligne ; guillemets doublés, retours
// à la ligne dans une cellule.
export function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
    const separator = [';', '\t', ',', '|'].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const lines = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = false; else value += c;
        } else if (c === '"' && !value) quoted = true;
        else if (c === separator) { row.push(value); value = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(value);
            if (row.some(v => v.trim())) lines.push(row);
            row = []; value = '';
        } else value += c;
    }
    row.push(value);
    if (row.some(v => v.trim())) lines.push(row);
    const [head = [], ...body] = lines;
    const names = head.map((h, i) => h.trim() || `colonne ${i + 1}`);
    return body.map(values => Object.fromEntries(names.map((name, i) => [name, (values[i] ?? '').trim()])));
}

// Les lignes d'un fichier : objets {colonne: valeur}. Excel est lu par le serveur.
export async function readRows(file) {
    const name = file.name.toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(name)) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(endpoint('toolbox/dataset'), { method: 'POST', body: form, credentials: 'same-origin',
            headers: { 'X-CSRFToken': (document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/) || [])[1] || '' } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'fichier Excel illisible');
        return data.rows;
    }
    const text = await file.text();
    if (name.endsWith('.json')) {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
        return list.filter(r => r && typeof r === 'object').map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')])));
    }
    return parseDelimited(text);
}

// Les colonnes devinées : le libellé (nommé comme tel, sinon la colonne de texte la plus variée) et le regroupement
// (nommé comme tel, sinon une colonne de texte de 2 à 12 valeurs qui se répètent).
export function shape(rows) {
    const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const stats = columns.map(c => {
        const values = rows.map(r => r[c] ?? '').filter(Boolean);
        const numeric = values.length && values.every(v => !Number.isNaN(Number(String(v).replace(',', '.'))));
        return { c, distinct: new Set(values).size, filled: values.length, numeric };
    });
    const texts = stats.filter(s => !s.numeric && s.filled);
    const label = (texts.find(s => LABEL.test(s.c)) || [...texts].sort((a, b) => b.distinct - a.distinct)[0] || stats[0])?.c;
    const groupable = s => s.c !== label && !s.numeric && s.distinct >= 2 && s.distinct <= Math.min(12, Math.max(2, rows.length / 2));
    const group = (stats.find(s => GROUP.test(s.c) && groupable(s)) || stats.find(groupable))?.c || null;
    const details = columns.filter(c => c !== label && c !== group).slice(0, SHOWN_FIELDS);
    return { label, group, details };
}

const escape = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Anneaux autour d'un parent : 210 de place par node (un node de texte fait ~180 de large), chaque anneau plus large
// que le précédent.
const SLOT = 210;
const ring = k => 240 + SLOT * k;
const capacity = k => Math.max(6, Math.floor((2 * Math.PI * ring(k)) / SLOT));
function rings(count) {  // rayon du dernier anneau pour `count` nodes
    let k = 0;
    for (let left = count; left > capacity(k); left -= capacity(k)) k += 1;
    return ring(k);
}

// L'arbre posé dans la dimension, autour du centre de la vue : racine, groupes en cercle, lignes en anneaux.
export async function plant(rows, title, { bridge, center }) {
    const taken = rows.slice(0, MAX_ROWS);
    const { label, group, details } = shape(taken);
    const groups = new Map();
    taken.forEach(row => {
        const key = group ? row[group] || '(sans valeur)' : '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    const refs = [];
    const put = async (ref, x, y, text, color, form) => {
        await bridge.perform({ op: 'create', ref, x: Math.round(x), y: Math.round(y), text, color, shape: form });
        refs.push(ref);
    };
    await put('ds-root', center.x, center.y, `📊 <b>${escape(title)}</b><br>${taken.length} lignes${group ? ` · par ${escape(group)}` : ''}`, '#6848A6', 'square');
    const hubs = [...groups.keys()];
    // Groupes assez loin de la racine et les uns des autres pour que leurs anneaux ne se touchent pas.
    const reach = Math.max(...[...groups.values()].map(items => rings(items.length)));
    const spread = !group ? 0 : hubs.length < 2 ? reach + 320 : Math.max(reach + 320, (reach + 160) / Math.sin(Math.PI / hubs.length));
    let row = 0;
    for (const [g, key] of hubs.entries()) {
        const angle = (2 * Math.PI * g) / hubs.length - Math.PI / 2;
        const hub = { x: center.x + spread * Math.cos(angle), y: center.y + spread * Math.sin(angle) };
        const color = COLORS[g % COLORS.length];
        let parent = 'ds-root';
        if (group) {
            parent = `ds-g${g}`;
            await put(parent, hub.x, hub.y, `<b>${escape(key)}</b><br>${groups.get(key).length}`, color, 'square');
            await bridge.perform({ op: 'link', source: 'ds-root', target: parent });
        }
        let k = 0, slot = 0;
        for (const item of groups.get(key)) {
            const radius = ring(k), a = (2 * Math.PI * slot) / capacity(k) + k * 0.35;
            const ref = `ds-r${row++}`;
            const extra = details.filter(c => item[c]).map(c => `<br>${escape(c)} : ${escape(String(item[c]).slice(0, 60))}`).join('');
            await put(ref, hub.x + radius * Math.cos(a), hub.y + radius * Math.sin(a), `<b>${escape(String(item[label] ?? '').slice(0, 80) || '(vide)')}</b>${extra}`,
                group ? color : COLORS[row % COLORS.length]);
            await bridge.perform({ op: 'link', source: parent, target: ref });
            if (++slot >= capacity(k)) { k += 1; slot = 0; }
        }
    }
    return { refs, label, group, total: rows.length, placed: taken.length };
}

// --- cartes (arbres)

const OUTLINE = /\.(md|markdown|txt|opml|mm|xmind)$/i;
const MAX_TOPICS = 800;
const clean = text => String(text || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/(\*\*|__|`)/g, '').replace(/\s+/g, ' ').trim();

// Markdown (titres, listes) ou texte indenté (tabulations ou espaces) : la profondeur de chaque ligne fait l'arbre.
export function parseIndented(text, markdown) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !/^\s*(---|```|<!--)/.test(l));
    const headings = lines.map(l => l.match(/^(#{1,6})\s/)?.[1].length).filter(Boolean);
    const top = headings.length ? Math.min(...headings) : 1;
    const spaces = lines.map(l => l.match(/^( +)\S/)?.[1].length).filter(Boolean);
    const unit = spaces.length ? Math.min(...spaces) : 2;
    let base = 0;  // profondeur sous le dernier titre, où se rangent listes et paragraphes
    const items = lines.map(l => {
        const heading = markdown && l.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            base = heading[1].length - top + 1;
            return { depth: base - 1, text: clean(heading[2]) };
        }
        const indent = l.match(/^[\t ]*/)[0].replace(/\t/g, ' '.repeat(unit)).length;
        const bullet = l.trim().replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '');
        return { depth: (markdown ? base : 0) + Math.round(indent / unit), text: clean(bullet) };
    });
    return nest(items);
}

// Une liste à plat {depth, text} devient un arbre {text, kids} ; plusieurs racines : une racine commune.
function nest(items) {
    const root = { text: '', kids: [] }, stack = [{ depth: -1, node: root }];
    items.filter(i => i.text).forEach(({ depth, text }) => {
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
        const node = { text, kids: [] };
        stack[stack.length - 1].node.kids.push(node);
        stack.push({ depth, node });
    });
    return root.kids.length === 1 ? root.kids[0] : root;
}

function parseXml(text, tag, label) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('fichier XML illisible');
    const walk = el => ({ text: clean(label(el)), kids: [...el.children].filter(c => c.tagName === tag).map(walk) });
    const start = tag === 'outline' ? doc.querySelector('body') : doc.documentElement;
    const kids = [...(start?.children || [])].filter(c => c.tagName === tag).map(walk);
    return kids.length === 1 ? kids[0] : { text: doc.querySelector('head > title')?.textContent || '', kids };
}
const freemindText = el => el.getAttribute('TEXT') || [...el.children].find(c => c.tagName === 'richcontent')?.textContent || '';

// L'arbre d'un fichier de carte. XMind (une archive) est lu par le serveur.
export async function readOutline(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xmind')) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(endpoint('toolbox/outline'), { method: 'POST', body: form, credentials: 'same-origin',
            headers: { 'X-CSRFToken': (document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/) || [])[1] || '' } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'fichier XMind illisible');
        return data.tree;
    }
    const text = await file.text();
    if (name.endsWith('.opml')) return parseXml(text, 'outline', el => el.getAttribute('text') || el.getAttribute('title') || '');
    if (name.endsWith('.mm')) return parseXml(text, 'node', freemindText);
    return parseIndented(text, /\.(md|markdown)$/.test(name));
}

// L'arbre posé autour du centre de la vue, puis rangé avec la vraie taille de ses nodes.
export async function plantTree(root, title, { bridge, center }) {
    if (!root.text) root.text = title;
    let count = 0;
    const tag = (t, depth = 0) => {
        if (count >= MAX_TOPICS) return null;
        t.id = `ot-${count++}`;
        t.depth = depth;
        t.kids = t.kids.map(k => tag(k, depth + 1)).filter(Boolean);
        return t;
    };
    tag(root);
    const spots = layout(root, center, () => ({ w: 90, h: 45 }));
    const walk = async (t, parent) => {
        const p = spots.get(t.id);
        await bridge.perform({ op: 'create', ref: t.id, x: Math.round(p.x), y: Math.round(p.y),
            text: t.depth ? escape(t.text.slice(0, 300)) : `<b>${escape(t.text.slice(0, 300))}</b>`,
            color: COLORS[Math.min(t.depth, COLORS.length - 1)], shape: t.depth < 2 ? 'square' : undefined });
        if (parent) await bridge.perform({ op: 'link', source: parent, target: t.id });
        for (const k of t.kids) await walk(k, t.id);
    };
    await walk(root, null);
    const rootNode = document.getElementById(bridge.idOf(root.id));
    if (rootNode) await arrange(rootNode);
    return { refs: [...spots.keys()], placed: count };
}

// Import d'un fichier (panneau Importer / Exporter, exchange.js) : choisir un fichier, l'arbre se pose, la caméra le cadre.
// Pas de bouton de plus dans le dock : il en changerait la largeur, et le dock est la zone des gestes de l'univers.
export function createDataset({ bridge, say, onDone = () => {} }) {
    const picker = Object.assign(document.createElement('input'), { type: 'file', hidden: true,
        accept: '.csv,.tsv,.json,.xlsx,.xlsm,.md,.markdown,.txt,.opml,.mm,.xmind' });
    document.body.append(picker);
    picker.addEventListener('change', async () => {
        const file = picker.files[0];
        picker.value = '';
        if (!file) return;
        try {
            if (OUTLINE.test(file.name)) {  // une carte : son arbre tel quel
                const root = await readOutline(file);
                say(`Import de la carte ${file.name}…`);
                const done = await plantTree(root, file.name.replace(/\.[^.]+$/, ''), { bridge, center: bridge.center() });
                say(`${done.placed} nodes posés, rangés en arbre${done.placed >= MAX_TOPICS ? ` (${MAX_TOPICS} au plus)` : ''}.`);
                return onDone(done.refs);
            }
            const rows = await readRows(file);
            if (!rows.length) return say(`${file.name} : aucune ligne lue.`, 'error');
            say(`Import de ${file.name} : ${Math.min(rows.length, MAX_ROWS)} nodes…`);
            const done = await plant(rows, file.name.replace(/\.[^.]+$/, ''), { bridge, center: bridge.center() });
            say(`${done.placed} nodes posés (libellé : ${done.label}${done.group ? `, groupés par ${done.group}` : ''})`
                + (done.total > done.placed ? ` ; ${done.total - done.placed} lignes laissées (${MAX_ROWS} au plus)` : '') + '.');
            onDone(done.refs);
        } catch (error) {
            say(`${file.name} : ${error.message}`, 'error');
        }
    });
    return { pick: () => picker.click() };
}
