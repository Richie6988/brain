// Galerie de modèles : des schémas faits uniquement de nodes et de liens de Nodz, à remplir aussitôt (arborescences,
// matrices, outils de stratégie, processus). Chaque modèle est une liste de nodes (coordonnées de Nodz, y vers le haut,
// forme, rayon éventuel) et de liens ; la carte de la galerie en dessine l'aperçu, un clic le construit au centre de la
// vue (outils du pont : création, liens, taille, sauvegarde et annulation de Nodz), puis la caméra recule pour tout
// montrer. Le Gardien pose les mêmes modèles (op `schema`). « Mes modèles », en tête de la galerie : une sélection de
// nodes et de leurs liens, enregistrée sur le serveur, se repose comme un modèle de la galerie.

import { api } from './api.js';

const PALETTE = ['#b89af2', '#1E90FF', '#33FF99', '#FFB84D', '#FF6B6B'];
const Q = { shape: 'square' };  // titre, question, en-tête : un carré

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

// Étoile : l'idée au centre, chaque branche sur une part d'angle selon ses feuilles (avec 4 branches, la première en
// haut à gauche puis dans le sens inverse des aiguilles : les quadrants d'une matrice), un anneau par profondeur ;
// un léger désordre fixe la rend vivante (sauf `calm`).
function radial(outline, ring, { calm = false } = {}) {
    const nodes = [], links = [];
    const leaves = ([, kids = []]) => kids.reduce((sum, kid) => sum + leaves(kid), 0) || 1;
    (function place(item, depth, from, to, parent) {
        const [text, kids = [], extra = {}] = item;
        const id = nodes.length;
        const wobble = depth && !calm;
        const angle = (from + to) / 2 + (wobble ? Math.sin(id * 12.9898) * 0.08 : 0);
        const r = depth * ring * (1 + (wobble ? Math.cos(id * 4.1) * 0.06 : 0));
        nodes.push({ id, text, depth, x: r * Math.cos(angle), y: r * Math.sin(angle), ...extra });
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

// Matrice 2×2 autour d'un centre : quadrants haut gauche, haut droite, bas gauche, bas droite, chacun avec ses idées
// vers l'extérieur.
function quadrants(title, [tl, tr, bl, br]) {
    const item = text => [text, [['Idée'], ['Idée']], Q];
    return radial([title, [item(tl), item(bl), item(br), item(tr)], Q], 300, { calm: true });
}

// Treillis : en-têtes de colonnes en haut, de lignes à gauche, cases au croisement ; chaque case reliée à sa voisine
// de gauche et du dessus (décalage alterné : aucun lien pile horizontal ou vertical).
function lattice(title, rows, cols, fill, step = 280) {
    const nodes = [], links = [], at = {};
    const add = (i, j, text, extra = {}) => {
        at[`${i},${j}`] = nodes.length;
        nodes.push({ id: nodes.length, text, depth: i && j ? 2 : i || j ? 1 : 0, x: i * step + (j % 2) * 16, y: -j * step + (i % 2) * 16, ...extra });
    };
    add(0, 0, title, Q);
    cols.forEach((c, i) => add(i + 1, 0, c, Q));
    rows.forEach((r, j) => add(0, j + 1, r, Q));
    rows.forEach((r, j) => cols.forEach((c, i) => add(i + 1, j + 1, fill(j, i))));
    Object.entries(at).forEach(([key, id]) => {
        const [i, j] = key.split(',').map(Number);
        if (i) links.push([at[`${i - 1},${j}`], id]);
        if (j && !i) links.push([at[`0,${j - 1}`], id]);
        if (j && i) links.push([at[`${i},${j - 1}`], id]);
    });
    return { nodes, links };
}

function ring(texts, radius) {
    const nodes = texts.map((text, i) => {
        const angle = Math.PI / 2 - (2 * Math.PI * i) / texts.length;
        return { id: i, text, depth: i, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    return { nodes, links: nodes.map((n, i) => [i, (i + 1) % nodes.length]) };
}

// Chaîne : de gauche à droite en léger zigzag, ou de haut en bas (`down`). `sizes` : rayon de chaque node ; l'écart
// grandit alors avec les rayons voisins (jamais de chevauchement).
function chain(texts, step, { down = false, sizes = [] } = {}) {
    let along = 0;
    const nodes = texts.map((text, i) => {
        if (i) along += Math.max(step, (sizes[i - 1] || 90) + (sizes[i] || 90) + 50);
        return { id: i, text, depth: i, ...(sizes[i] ? { radius: sizes[i] } : {}),
            ...(down ? { x: i % 2 ? 40 : -40, y: -along } : { x: along, y: i % 2 ? -70 : 70 }) };
    });
    return { nodes, links: nodes.slice(1).map((n, i) => [i, i + 1]) };
}

// Colonnes : un en-tête par colonne et ses cartes empilées dessous (kanban) ; en-têtes reliés de gauche à droite.
function columns(heads, cards, step = 320) {
    const nodes = [], links = [];
    heads.forEach((head, c) => {
        const top = nodes.length;
        nodes.push({ id: top, text: head, depth: 0, x: c * step, y: 0, ...Q });
        if (c) links.push([top - cards[c - 1].length - 1, top]);
        cards[c].forEach((card, k) => {
            nodes.push({ id: nodes.length, text: card, depth: c + 1, x: c * step + (k % 2 ? 30 : -30), y: -(k + 1) * 220 });
            links.push([nodes.length - 2, nodes.length - 1]);
        });
    });
    return { nodes, links };
}

// Arête de poisson : l'effet à droite, les vertèbres de l'arête centrale, deux causes (dessus, dessous) par vertèbre.
function fishbone(effect, causes) {
    const pairs = Math.ceil(causes.length / 2);
    const nodes = [{ id: 0, text: effect, depth: 0, x: (pairs + 1) * 300, y: 0, ...Q }], links = [];
    let previous = null;
    for (let k = 0; k < pairs; k++) {
        const spine = nodes.length;
        nodes.push({ id: spine, text: '•', depth: 1, x: (k + 1) * 300, y: k % 2 ? 14 : -14, radius: 26 });  // vide, Nodz le garderait grand
        if (previous !== null) links.push([previous, spine]);
        previous = spine;
        causes.slice(2 * k, 2 * k + 2).forEach((cause, side) => {
            nodes.push({ id: nodes.length, text: cause, depth: 2, x: (k + 1) * 300 - 170, y: side ? -260 : 260 });
            links.push([nodes.length - 1, spine]);
        });
    }
    links.push([previous, 0]);
    return { nodes, links };
}

// Business Model Canvas : les 9 blocs à leur place, reliés dans le sens de la valeur.
function canvas() {
    const B = (id, text, x, y, depth) => ({ id, text, depth, x, y, ...(id === 4 ? Q : {}) });
    const nodes = [
        B(0, 'Partenaires clés', -640, 120, 1), B(1, 'Activités clés', -320, 260, 2), B(2, 'Ressources clés', -320, -20, 2),
        B(3, 'Structure de coûts', -520, -380, 4), B(4, '<b>Proposition de valeur</b>', 0, 120, 0),
        B(5, 'Relations clients', 320, 260, 2), B(6, 'Canaux', 320, -20, 2), B(7, 'Segments de clientèle', 640, 120, 1),
        B(8, 'Sources de revenus', 520, -380, 3),
    ];
    return { nodes, links: [[0, 1], [0, 2], [1, 4], [2, 4], [4, 5], [4, 6], [5, 7], [6, 7], [0, 3], [2, 3], [7, 8]] };
}

// Ikigai : les quatre cercles, leurs quatre intersections, l'ikigai au centre.
function ikigai() {
    const outer = [['Ce que tu aimes', 0, 520], ['Ce en quoi tu es doué', -520, 0], ['Ce dont le monde a besoin', 520, 0], ['Ce pour quoi tu peux être payé', 0, -520]];
    const inner = [['Passion', -260, 260, 0, 1], ['Mission', 260, 260, 0, 2], ['Profession', -260, -260, 1, 3], ['Vocation', 260, -260, 2, 3]];
    const nodes = [{ id: 0, text: '<b>Ikigai</b>', depth: 0, x: 0, y: 0, ...Q }];
    outer.forEach(([text, x, y]) => nodes.push({ id: nodes.length, text, depth: 1, x, y }));
    const links = [];
    inner.forEach(([text, x, y, a, b]) => {
        const id = nodes.length;
        nodes.push({ id, text, depth: 2, x, y });
        links.push([a + 1, id], [b + 1, id], [id, 0]);
    });
    return { nodes, links };
}

// Frise : les dates sur l'axe, un événement au-dessus ou au-dessous de chacune.
function timeline(dates) {
    const nodes = [], links = [];
    dates.forEach((date, k) => {
        nodes.push({ id: nodes.length, text: `<b>${date}</b>`, depth: 0, x: k * 320, y: k % 2 ? 12 : -12, ...Q });
        if (k) links.push([nodes.length - 3, nodes.length - 1]);
        nodes.push({ id: nodes.length, text: 'Événement', depth: 2, x: k * 320 + 40, y: k % 2 ? -240 : 240 });
        links.push([nodes.length - 2, nodes.length - 1]);
    });
    return { nodes, links };
}

const withIdeas = text => [text, [['Idée'], ['Idée']]];

export const FAMILIES = ['Arborescences', 'Matrices', 'Stratégie', 'Processus'];
export const SCHEMAS = [
    { key: 'decision', family: 'Arborescences', name: 'Arbre de décision', hint: 'question, options, issues', build: () => tidy(
        ['<b>Décision ?</b>', [
            ['Option A', [['Si ça marche', [['Résultat']]], ['Si ça échoue', [['Plan B']]]], Q],
            ['Option B', [['Si ça marche', [['Résultat']]], ['Si ça échoue', [['Plan B']]]], Q],
        ], Q], { step: 320, gap: 200, axis: 'right' }) },
    { key: 'family', family: 'Arborescences', name: 'Arbre généalogique', hint: 'moi, parents, grands-parents', build: () => tidy(
        ['<b>Moi</b>', [['Père', [['Grand-père'], ['Grand-mère']]], ['Mère', [['Grand-père'], ['Grand-mère']]]]],
        { step: 260, gap: 230, axis: 'up' }) },
    { key: 'organic', family: 'Arborescences', name: 'Carte organique', hint: 'une idée, des branches vivantes', build: () => radial(
        ['<b>Idée centrale</b>', [
            ['Pourquoi', [['Besoin'], ['Envie']]], ['Qui', [['Moi'], ['Les autres']]], ['Comment', [['Étapes'], ['Outils'], ['Aide']]],
            ['Quand', [['Bientôt'], ['Plus tard']]], ['Risques', [['Temps'], ['Argent']]],
        ]], 330) },
    { key: 'org', family: 'Arborescences', name: 'Organigramme', hint: 'direction, pôles, équipes', build: () => tidy(
        ['<b>Direction</b>', [1, 2, 3].map(k => [`Pôle ${k}`, [['Équipe'], ['Équipe']]]), Q], { step: 260, gap: 220, axis: 'down' }) },
    { key: 'why', family: 'Arborescences', name: '5 pourquoi', hint: 'du problème à la cause racine', build: () => chain(
        ['<b>Problème</b>', 'Pourquoi ?', 'Pourquoi ?', 'Pourquoi ?', 'Pourquoi ?', 'Pourquoi ?', '<b>Cause racine</b>'], 220, { down: true }) },

    { key: 'swot', family: 'Matrices', name: 'SWOT', hint: 'forces, faiblesses, opportunités, menaces', build: () => quadrants(
        '<b>SWOT</b>', ['Forces', 'Faiblesses', 'Opportunités', 'Menaces']) },
    { key: 'eisenhower', family: 'Matrices', name: 'Eisenhower', hint: 'urgent × important', build: () => quadrants(
        '<b>Priorités</b>', ['Faire<br>urgent, important', 'Planifier<br>important', 'Déléguer<br>urgent', 'Abandonner']) },
    { key: 'bcg', family: 'Matrices', name: 'Matrice BCG', hint: 'vedettes, dilemmes, vaches à lait', build: () => quadrants(
        '<b>Portefeuille</b>', ['Vedettes', 'Dilemmes', 'Vaches à lait', 'Poids morts']) },
    { key: 'ansoff', family: 'Matrices', name: 'Ansoff', hint: 'produits × marchés', build: () => lattice('<b>Croissance</b>',
        ['Marchés actuels', 'Nouveaux marchés'], ['Produits actuels', 'Nouveaux produits'],
        (j, i) => [['Pénétration', 'Développement de produits'], ['Développement de marchés', 'Diversification']][j][i]) },
    { key: 'tows', family: 'Matrices', name: 'TOWS', hint: 'stratégies croisées SO, ST, WO, WT', build: () => lattice('<b>TOWS</b>',
        ['Opportunités', 'Menaces'], ['Forces', 'Faiblesses'], (j, i) => [['SO : attaquer', 'WO : renforcer'], ['ST : défendre', 'WT : éviter']][j][i]) },
    { key: 'm3x3', family: 'Matrices', name: 'Matrice 3×3', hint: 'trois lignes, trois colonnes', build: () => lattice('<b>Matrice</b>',
        ['Ligne 1', 'Ligne 2', 'Ligne 3'], ['Colonne 1', 'Colonne 2', 'Colonne 3'], () => '…', 250) },

    { key: 'bmc', family: 'Stratégie', name: 'Business Model Canvas', hint: 'les 9 blocs du modèle économique', build: canvas },
    { key: 'porter', family: 'Stratégie', name: '5 forces de Porter', hint: 'rivalité et forces du marché', build: () => radial(
        ['<b>Rivalité du secteur</b>', ['Nouveaux entrants', 'Pouvoir des fournisseurs', 'Produits de substitution', 'Pouvoir des clients']
            .map(force => [force, [['…']]]), Q], 300, { calm: true }) },
    { key: 'pestel', family: 'Stratégie', name: 'PESTEL', hint: 'politique, économique, social…', build: () => radial(
        ['<b>Environnement</b>', ['Politique', 'Économique', 'Social', 'Technologique', 'Écologique', 'Légal'].map(withIdeas), Q], 300) },
    { key: 'ikigai', family: 'Stratégie', name: 'Ikigai', hint: 'aimer, savoir, besoin, payé', build: ikigai },
    { key: 'smart', family: 'Stratégie', name: 'Objectif SMART', hint: 'spécifique, mesurable, atteignable…', build: () => radial(
        ['<b>Objectif</b>', ['Spécifique', 'Mesurable', 'Atteignable', 'Réaliste', 'Temporel'].map(t => [t]), Q], 300, { calm: true }) },

    { key: 'pdca', family: 'Processus', name: 'Cycle PDCA', hint: 'planifier, faire, vérifier, agir', build: () => ring(
        ['<b>Planifier</b>', '<b>Faire</b>', '<b>Vérifier</b>', '<b>Agir</b>'], 300) },
    { key: 'process', family: 'Processus', name: 'Processus', hint: 'des étapes qui se suivent', build: () => chain(
        ['<b>Départ</b>', 'Étape 1', 'Étape 2', 'Étape 3', '<b>Arrivée</b>'], 300) },
    { key: 'timeline', family: 'Processus', name: 'Frise chronologique', hint: 'dates et événements', build: () => timeline(['2024', '2025', '2026', '2027']) },
    { key: 'kanban', family: 'Processus', name: 'Kanban', hint: 'à faire, en cours, fait', build: () => columns(
        ['<b>À faire</b>', '<b>En cours</b>', '<b>Fait</b>'], [['Tâche', 'Tâche', 'Tâche'], ['Tâche', 'Tâche'], ['Tâche']]) },
    { key: 'design', family: 'Processus', name: 'Design thinking', hint: 'empathie, définir, idéer, prototyper, tester', build: () => chain(
        ['Empathie', 'Définir', 'Idéer', 'Prototyper', 'Tester'], 300) },
    { key: 'aida', family: 'Processus', name: 'Entonnoir AIDA', hint: 'attention, intérêt, désir, action', build: () => chain(
        ['<b>Attention</b>', '<b>Intérêt</b>', '<b>Désir</b>', '<b>Action</b>'], 280, { down: true, sizes: [150, 125, 100, 75] }) },
    { key: 'maslow', family: 'Processus', name: 'Pyramide de Maslow', hint: 'des besoins vitaux à l\'accomplissement', build: () => chain(
        ['<b>Accomplissement</b>', 'Estime', 'Appartenance', 'Sécurité', 'Physiologiques'], 260, { down: true, sizes: [100, 110, 125, 140, 155] }) },
    { key: 'ishikawa', family: 'Processus', name: 'Ishikawa', hint: 'causes et effet (6M)', build: () => fishbone(
        '<b>Effet</b>', ['Main-d\'œuvre', 'Méthodes', 'Matériel', 'Matière', 'Milieu', 'Mesure']) },
];

// Exemples à remplacer quand le Gardien remplit une case avec des idées.
const PLACEHOLDERS = new Set(['idée', '…', 'tâche', 'événement', 'équipe', 'grand-père', 'grand-mère']);
const plain = html => html.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim().toLowerCase();

// Remplissage par le Gardien (op schema) : `title` remplace le node central ; `fill` associe l'intitulé d'une case à un
// texte (la case change de texte, en gras si elle l'était) ou à une liste d'idées, qui prennent la place et les liens
// des exemples de la case (Idée, Tâche, …) ; les idées en plus se posent en éventail autour d'elle.
function applyFill({ nodes, links }, fill = {}, title = '') {
    const bold = (old, text) => (/^<b>/.test(old) && !/^<b>/.test(text) ? `<b>${text}</b>` : text);
    if (title) nodes[0].text = bold(nodes[0].text, title);
    const wanted = new Map(Object.entries(fill).map(([label, value]) => [label.trim().toLowerCase(), value]));
    let next = nodes.length;
    const removed = new Set();
    for (const slot of [...nodes]) {
        const value = wanted.get(plain(slot.text));
        if (value === undefined) continue;
        if (!Array.isArray(value)) {
            slot.text = bold(slot.text, value);
            continue;
        }
        // Exemples de la case : atteints depuis elle en ne traversant que des exemples (colonne de kanban comprise).
        const examples = [], parentOf = new Map();
        for (let queue = [slot.id]; queue.length;) {
            const from = queue.shift();
            links.filter(([a, b]) => a === from && !removed.has(b) && PLACEHOLDERS.has(plain(nodes.find(n => n.id === b)?.text || ''))).forEach(([, b]) => {
                if (parentOf.has(b)) return;
                parentOf.set(b, from);
                examples.push(nodes.find(n => n.id === b));
                queue.push(b);
            });
        }
        examples.forEach(n => removed.add(n.id));
        const made = new Map();  // exemple remplacé → nouvelle idée
        const out = [slot.x, slot.y], len = Math.hypot(...out) || 1;
        value.forEach((text, k) => {
            const spot = examples[k];
            const angle = Math.atan2(out[1] / len, out[0] / len) + ((k - examples.length) - (value.length - examples.length - 1) / 2) * 0.45;
            const node = { id: next++, text, depth: slot.depth + 1,
                ...(spot ? { x: spot.x, y: spot.y } : { x: slot.x + 280 * Math.cos(angle), y: slot.y + 280 * Math.sin(angle) }) };
            nodes.push(node);
            const parent = spot ? parentOf.get(spot.id) : slot.id;
            links.push([made.get(parent) ?? parent, node.id]);
            if (spot) made.set(spot.id, node.id);
        });
    }
    // Renumérotés : l'identifiant redevient la position dans la liste
    const kept = nodes.filter(n => !removed.has(n.id));
    const index = new Map(kept.map((n, i) => [n.id, i]));
    return { nodes: kept.map((n, i) => ({ ...n, id: i })),
        links: links.filter(([a, b]) => index.has(a) && index.has(b)).map(([a, b]) => [index.get(a), index.get(b)]) };
}

// Nodes et liens du modèle, centrés sur (0, 0), avec couleur (par profondeur) et forme.
export function layout(schema, fill, title) {
    const { nodes, links } = applyFill(schema.build(), fill, title);
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

function preview(schema) {
    return drawing(layout(schema));
}

// Aperçu de nodes posés (x, y relatifs, y vers le haut) et de leurs liens.
function drawing({ nodes, links, width, height }) {
    const k = 150 / Math.max(width, height, 1);
    const p = n => [100 + n.x * k, 100 - n.y * k];
    const lines = links.map(([a, b]) => { const [x1, y1] = p(nodes[a]), [x2, y2] = p(nodes[b]); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; });
    const dots = nodes.map(n => {
        const [x, y] = p(n), r = n.radius ? Math.max(3, Math.min(14, n.radius / 10)) : 7;
        return n.shape === 'square' ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="2" stroke="${n.color}"/>` : `<circle cx="${x}" cy="${y}" r="${r}" stroke="${n.color}"/>`;
    });
    return `<svg viewBox="0 0 200 200" aria-hidden="true"><g class="gt-lines">${lines.join('')}</g><g class="gt-dots">${dots.join('')}</g></svg>`;
}

export function createSchemas({ bridge }) {
    const gallery = document.querySelector('#templates .templatesContent');
    let built = 0;
    gallery.querySelector('.close-btn').after(...FAMILIES.flatMap(family => [
        Object.assign(document.createElement('h3'), { className: 'gt-trees-title', textContent: family }),
        ...SCHEMAS.filter(s => s.family === family).map(schema => {
            const card = Object.assign(document.createElement('button'), { type: 'button', className: 'template-tree', title: `${schema.name} : ${schema.hint}` });
            card.innerHTML = `${preview(schema)}<b>${schema.name}</b><small>${schema.hint}</small>`;
            card.addEventListener('click', () => {
                closeGallery();
                build(schema.key, bridge.center(), true);
            });
            return card;
        }),
    ]));

    // --- Mes modèles : enregistrer la sélection, la reposer, la retirer (deux clics, sans confirm()).
    const mine = Object.assign(document.createElement('div'), { className: 'gt-mine' });
    gallery.querySelector('.close-btn').after(Object.assign(document.createElement('h3'), { className: 'gt-trees-title', textContent: 'Mes modèles' }), mine);
    let saved = [];
    function selection() {
        const list = selectedNodes.filter(n => n.isConnected);
        const at = list.map(n => ({ x: Number(n.getAttribute('x')), y: Number(n.getAttribute('y')) }));
        const cx = at.reduce((t, p) => t + p.x, 0) / (list.length || 1), cy = at.reduce((t, p) => t + p.y, 0) / (list.length || 1);
        const index = new Map(list.map((n, i) => [n.id, i]));
        const nodes = list.map((n, i) => {
            const square = n.getAttribute('shape') === 'square';
            return { x: at[i].x - cx, y: at[i].y - cy, text: n.children[0].children[0].innerHTML, color: n.getAttribute('color') || '',
                shape: square ? 'square' : n.getAttribute('shape') === 'none' ? 'none' : '',
                radius: square ? Number(n.children[2].getAttribute('width')) / 2 : Number(n.children[1].getAttribute('r')) };
        });
        const links = [...document.querySelectorAll('.link')].map(l => [index.get(l.getAttribute('Node1')), index.get(l.getAttribute('Node2'))])
            .filter(([a, b]) => a !== undefined && b !== undefined);
        return { nodes, links };
    }
    // Centré sur son cadre (l'aperçu et la pose le supposent), avec ses dimensions.
    const measured = model => {
        const xs = model.nodes.map(n => n.x), ys = model.nodes.map(n => n.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        return { ...model, nodes: model.nodes.map(n => ({ ...n, x: n.x - cx, y: n.y - cy, color: n.color || PALETTE[0] })),
            width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };
    function renderMine() {
        const count = selectedNodes.filter(n => n.isConnected).length;
        const name = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Nom du modèle', maxLength: 60 });
        const keep = Object.assign(document.createElement('button'), { type: 'button', className: 'gt-keep', textContent: 'Enregistrer',
            disabled: !count });
        name.addEventListener('keydown', event => {
            event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de Nodz
            if (event.key === 'Enter') keep.click();
        });
        keep.addEventListener('click', async () => {
            if (!name.value.trim()) return name.focus();
            try {
                saved = (await api.request('POST', 'toolbox/gallery', { name: name.value.trim(), ...selection() })).models;
                renderMine();
            } catch (error) {
                note.textContent = error.message;
            }
        });
        const note = Object.assign(document.createElement('small'), { textContent: count
            ? `${count} node${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}, avec leurs liens`
            : 'Sélectionne des nodes (Ctrl + glisser) pour en faire un modèle' });
        const form = Object.assign(document.createElement('div'), { className: 'gt-save' });
        form.append(Object.assign(document.createElement('b'), { textContent: '+ Nouveau modèle' }), note, name, keep);
        mine.replaceChildren(form, ...saved.map(model => {
            const card = Object.assign(document.createElement('div'), { className: 'template-tree gt-own', title: `${model.name} : ${model.nodes.length} nodes` });
            card.innerHTML = `${drawing(measured(model))}<b></b><small>${model.nodes.length} nodes · ${model.links.length} liens</small>`;
            card.querySelector('b').textContent = model.name;
            card.addEventListener('click', () => {
                closeGallery();
                place(measured(model), bridge.center());
            });
            const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'gt-remove', textContent: '×', title: 'Retirer ce modèle' });
            remove.addEventListener('click', async event => {
                event.stopPropagation();
                if (!remove.dataset.armed) {
                    remove.dataset.armed = '1';
                    remove.textContent = 'Retirer ?';
                    setTimeout(() => { delete remove.dataset.armed; remove.textContent = '×'; }, 3000);
                    return;
                }
                saved = (await api.request('DELETE', `toolbox/gallery?${new URLSearchParams({ id: model.id })}`)).models;
                renderMine();
            });
            card.append(remove);
            return card;
        }));
    }
    // À chaque ouverture de la galerie : la sélection du moment et les modèles gardés sur le serveur.
    document.getElementById('templateButton')?.addEventListener('click', async () => {
        renderMine();
        try {
            saved = (await api.request('GET', 'toolbox/gallery')).models;
            renderMine();
        } catch { /* hors ligne : la galerie de base reste */ }
    });

    // Pose des nodes (x, y relatifs) et leurs liens autour de `at`, puis la caméra recule pour tout montrer.
    async function place({ nodes, links, width, height }, at) {
        const prefix = `schema${++built}-`;
        selectedNodes.slice().forEach(n => nodeUnselection(n));
        for (const [i, n] of nodes.entries()) {
            await bridge.perform({ op: 'create', ref: prefix + i, x: at.x + n.x, y: at.y + n.y, text: n.text, color: n.color, shape: n.shape });
            if (n.radius && n.radius !== 60) await bridge.perform({ op: 'style', ref: prefix + i, radius: n.radius });
        }
        for (const [a, b] of links) await bridge.perform({ op: 'link', source: prefix + a, target: prefix + b });
        await bridge.fit(width + 360, height + 360);
    }

    // Construit le modèle `key` centré sur `at` (coordonnées de Nodz), rempli par `fill` et `title` (Gardien) ;
    // `fit` : la caméra recule pour tout montrer.
    async function build(key, at, fit = false, fill = {}, title = '') {
        const schema = SCHEMAS.find(s => s.key === key);
        if (!schema) throw new Error(`schéma inconnu : ${key}`);
        const { nodes, links, width, height } = layout(schema, fill, title);
        const prefix = `schema${++built}-`;
        selectedNodes.slice().forEach(n => nodeUnselection(n));
        for (const n of nodes) {
            await bridge.perform({ op: 'create', ref: prefix + n.id, x: at.x + n.x, y: at.y + n.y, text: n.text, color: n.color, shape: n.shape });
            if (n.radius) await bridge.perform({ op: 'style', ref: prefix + n.id, radius: n.radius });
        }
        for (const [a, b] of links) await bridge.perform({ op: 'link', source: prefix + a, target: prefix + b });
        if (fit) await bridge.fit(width + 360, height + 360);
        return { width, height };
    }
    return { build };
}
