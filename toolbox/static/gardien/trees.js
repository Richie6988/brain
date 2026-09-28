// Galerie de modèles : à côté des fonds dessinés de Nodz (SWOT, matrices…), de vraies arborescences faites de nodes
// et de liens de Nodz, à remplir aussitôt : arbre de décision, arbre généalogique, carte organique, organigramme,
// cycle PDCA, processus. Chaque modèle est une liste de nodes (coordonnées de Nodz, y vers le haut) et de liens ;
// la carte de la galerie en dessine l'aperçu, un clic la construit au centre de la vue (outils du pont : création,
// liens, sauvegarde et annulation de Nodz), puis la caméra recule pour tout montrer.

const PALETTE = ['#b89af2', '#1E90FF', '#33FF99', '#FFB84D', '#FF6B6B'];

// Arbre rangé : les feuilles à la suite sur l'axe transverse, chaque parent au milieu de ses enfants.
// `outline` : [texte, enfants?, options?] ; `step` : écart entre profondeurs ; `gap` : écart entre feuilles ;
// `axis` : 'right' (profondeur vers la droite), 'down' ou 'up'.
function tidy(outline, { step, gap, axis }) {
    const nodes = [], links = [];
    let slot = 0;
    (function place([text, kids = [], extra = {}], depth, parent) {
        const id = nodes.length;
        const node = { id, text, depth, ...extra };
        nodes.push(node);
        if (parent !== undefined) links.push([parent, id]);
        const ids = kids.map(kid => place(kid, depth + 1, id));
        node.across = ids.length ? (nodes[ids[0]].across + nodes[ids.at(-1)].across) / 2 : slot++ * gap;
        return id;
    })(outline, 0);
    nodes.forEach(n => {
        const along = n.depth * step;
        Object.assign(n, axis === 'right' ? { x: along, y: -n.across } : { x: n.across, y: axis === 'up' ? along : -along });
    });
    return { nodes, links };
}

// Carte organique : l'idée au centre, chaque branche sur une part d'angle selon ses feuilles, un anneau par
// profondeur ; un léger désordre fixe la rend vivante.
function radial(outline, ring) {
    const nodes = [], links = [];
    const leaves = ([, kids = []]) => kids.reduce((sum, kid) => sum + leaves(kid), 0) || 1;
    (function place(item, depth, from, to, parent) {
        const [text, kids = []] = item;
        const id = nodes.length;
        const angle = (from + to) / 2 + (depth ? Math.sin(id * 12.9898) * 0.08 : 0);
        const r = depth * ring * (1 + (depth ? Math.cos(id * 4.1) * 0.06 : 0));
        nodes.push({ id, text, depth, x: r * Math.cos(angle), y: r * Math.sin(angle) });
        if (parent !== undefined) links.push([parent, id]);
        const total = leaves(item);
        let start = from;
        kids.forEach(kid => {
            const share = ((to - from) * leaves(kid)) / total;
            place(kid, depth + 1, start, start + share, id);
            start += share;
        });
    })(outline, 0, Math.PI / 2, Math.PI / 2 + 2 * Math.PI);
    return { nodes, links };
}

function ring(texts, radius) {
    const nodes = texts.map((text, i) => {
        const angle = Math.PI / 2 - (2 * Math.PI * i) / texts.length;
        return { id: i, text, depth: i, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    return { nodes, links: nodes.map((n, i) => [i, (i + 1) % nodes.length]) };
}

function chain(texts, step) {
    const nodes = texts.map((text, i) => ({ id: i, text, depth: i, x: i * step, y: i % 2 ? -70 : 70 }));
    return { nodes, links: nodes.slice(1).map((n, i) => [i, i + 1]) };
}

const Q = { shape: 'square' };  // question : un carré, comme un losange de logigramme
export const TREES = [
    { key: 'decision', name: 'Arbre de décision', hint: 'question, options, issues', build: () => tidy(
        ['<b>Décision ?</b>', [
            ['Option A', [['Si ça marche', [['Résultat']]], ['Si ça échoue', [['Plan B']]]], Q],
            ['Option B', [['Si ça marche', [['Résultat']]], ['Si ça échoue', [['Plan B']]]], Q],
        ], Q], { step: 320, gap: 200, axis: 'right' }) },
    { key: 'family', name: 'Arbre généalogique', hint: 'moi, parents, grands-parents', build: () => tidy(
        ['<b>Moi</b>', [
            ['Père', [['Grand-père'], ['Grand-mère']]],
            ['Mère', [['Grand-père'], ['Grand-mère']]],
        ]], { step: 260, gap: 230, axis: 'up' }) },
    { key: 'organic', name: 'Carte organique', hint: 'une idée, des branches vivantes', build: () => radial(
        ['<b>Idée centrale</b>', [
            ['Pourquoi', [['Besoin'], ['Envie']]],
            ['Qui', [['Moi'], ['Les autres']]],
            ['Comment', [['Étapes'], ['Outils'], ['Aide']]],
            ['Quand', [['Bientôt'], ['Plus tard']]],
            ['Risques', [['Temps'], ['Argent']]],
        ]], 330) },
    { key: 'org', name: 'Organigramme', hint: 'direction, pôles, équipes', build: () => tidy(
        ['<b>Direction</b>', [
            ['Pôle 1', [['Équipe'], ['Équipe']]],
            ['Pôle 2', [['Équipe'], ['Équipe']]],
            ['Pôle 3', [['Équipe'], ['Équipe']]],
        ], Q], { step: 260, gap: 220, axis: 'down' }) },
    { key: 'cycle', name: 'Cycle PDCA', hint: 'planifier, faire, vérifier, agir', build: () => ring(
        ['<b>Planifier</b>', '<b>Faire</b>', '<b>Vérifier</b>', '<b>Agir</b>'], 300) },
    { key: 'process', name: 'Processus', hint: 'des étapes qui se suivent', build: () => chain(
        ['<b>Départ</b>', 'Étape 1', 'Étape 2', 'Étape 3', '<b>Arrivée</b>'], 300) },
];

// Nodes et liens du modèle, centrés sur (0, 0), avec couleur (par profondeur) et forme.
export function layout(tree) {
    const { nodes, links } = tree.build();
    // Un lien pile horizontal ou vertical perd son dégradé dans Nodz (boîte de hauteur nulle) : on l'incline à peine.
    links.forEach(([a, b]) => {
        if (Math.abs(nodes[a].y - nodes[b].y) < 1) nodes[b].y += 24;
        else if (Math.abs(nodes[a].x - nodes[b].x) < 1) nodes[b].x += 24;
    });
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    nodes.forEach(n => Object.assign(n, { x: n.x - cx, y: n.y - cy, color: PALETTE[n.depth % PALETTE.length] }));
    return { nodes, links, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function preview(tree) {
    const { nodes, links, width, height } = layout(tree);
    const k = 150 / Math.max(width, height, 1);
    const p = n => [100 + n.x * k, 100 - n.y * k];
    const lines = links.map(([a, b]) => { const [x1, y1] = p(nodes[a]), [x2, y2] = p(nodes[b]); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; });
    const dots = nodes.map(n => {
        const [x, y] = p(n);
        return n.shape === 'square' ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2" stroke="${n.color}"/>` : `<circle cx="${x}" cy="${y}" r="8" stroke="${n.color}"/>`;
    });
    return `<svg viewBox="0 0 200 200" aria-hidden="true"><g class="gt-lines">${lines.join('')}</g><g class="gt-dots">${dots.join('')}</g></svg>`;
}

export function createTrees({ bridge }) {
    const gallery = document.querySelector('#templates .templatesContent');
    if (!gallery) return;
    let built = 0;
    const title = Object.assign(document.createElement('h3'), { className: 'gt-trees-title', textContent: 'Arborescences : de vrais nodes, à remplir' });
    const backdrops = Object.assign(document.createElement('h3'), { className: 'gt-trees-title', textContent: 'Fonds de réflexion' });
    const cards = TREES.map(tree => {
        const card = Object.assign(document.createElement('button'), { type: 'button', className: 'template-tree', title: `${tree.name} : ${tree.hint}` });
        card.innerHTML = `${preview(tree)}<b>${tree.name}</b><small>${tree.hint}</small>`;
        card.addEventListener('click', () => build(tree));
        return card;
    });
    gallery.querySelector('.close-btn').after(title, ...cards, backdrops);

    async function build(tree) {
        closeGallery();
        const { nodes, links, width, height } = layout(tree);
        const center = bridge.center();
        const prefix = `tree${++built}-`;
        selectedNodes.slice().forEach(n => nodeUnselection(n));
        for (const n of nodes) {
            await bridge.perform({ op: 'create', ref: prefix + n.id, x: center.x + n.x, y: center.y + n.y, text: n.text, color: n.color, shape: n.shape });
        }
        for (const [a, b] of links) await bridge.perform({ op: 'link', source: prefix + a, target: prefix + b });
        await bridge.fit(width + 360, height + 360);
    }
}
