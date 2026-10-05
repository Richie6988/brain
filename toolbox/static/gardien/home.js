// La dimension « Gardien » (toolbox/home.py) : la maison du Gardien, posée d'office à la première connexion. Une racine
// et huit groupes rangés en arbre (Âme, Identité, Utilisateur, Mémoire, Compétences, Outils, Rêves, Échanges), chacun
// avec ses nodes : le Gardien y relit ses clés à chaque demande, l'humain le règle en réécrivant, ajoutant (relié sous un
// groupe) ou supprimant des nodes. Ses notes et ses rêves en attente s'y posent quand l'humain y entre.
// Rêves : après une période calme, la page envoie les derniers échanges du chat ; le serveur rêve en arrière-plan.

import { api } from './api.js';
import { arrange } from './branches.js';
import { bulk } from './bulk.js';

const NAME = 'Gardien';
const COLORS = { soul: '#C77DFF', identity: '#FF9F45', user: '#4DD4C6', memory: '#33FF99', skills: '#FFD93D', tools: '#4D96FF',
    dreams: '#F15BB5', exchanges: '#1E90FF' };
const PALETTE = ['#4D96FF', '#33FF99', '#FF6B6B', '#FFD93D', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5', '#9BE15D', '#7FB3FF'];
const COLUMN = 700;    // premières positions, en colonnes (racine, groupes, nodes) : le rangement en arbre les affine
const ROW = 300;
const QUIET = 10 * 60 * 1000;  // période calme avant un rêve

const escape = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const html = text => String(text).split('\n').map(escape).join('<br>');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createHome({ bridge, say, filters, chat, branches }) {
    let data = null;        // dernière réponse de toolbox/home
    let busy = null;        // pose en cours (une à la fois)
    let seenLayer = null;

    const fetchHome = async () => {
        try {
            data = await api.request('GET', 'toolbox/home');
        } catch {
            await api.request('GET', 'toolbox/agents').catch(() => {});  // compte neuf : ses agents naissent ici
            data = await api.request('GET', 'toolbox/home').catch(() => null);
        }
        chat.unread(data?.unread || 0);
        return data;
    };
    const layerOf = () => layers.find(l => Number(l.id) === data?.home?.layer) || null;
    const at = id => {
        const node = id && document.getElementById(id);
        return node ? { x: parseFloat(node.getAttribute('x')) || 0, y: parseFloat(node.getAttribute('y')) || 0 } : null;
    };
    // Une centaine de nodes d'affilée, dans bulk() : leurs enregistrements partent groupés à la fin (plus de rafale
    // d'une requête par node, plus d'attente entre deux créations).
    const create = async (ref, x, y, text, color, shape = 'circle') => {
        await bridge.perform({ op: 'create', ref, x: Math.round(x), y: Math.round(y), text, color, shape });
        return bridge.idOf(ref);
    };
    const link = (source, target) => bridge.perform({ op: 'link', source, target });
    // Ranger en arbre (de gauche à droite) une fois les nodes à leur taille (textfit.js les agrandit en 600 ms).
    const tidy = async id => {
        await wait(1500);
        const node = document.getElementById(id);
        if (node) await arrange(node);
    };

    // Pose ce qui manque : la dimension, la racine, chaque groupe absent et ses nodes de départ.
    async function install() {
        const seed = data.seed;
        const placed = data.home || { groups: {}, tools: {} };
        const layer = layerOf();
        if (layer) await bridge.enterLayer(layer.id);
        else await bridge.newDimension(layers.some(l => l.name.toLowerCase() === NAME.toLowerCase()) ? `${NAME} 2` : NAME);
        const saved = { layer: Number(layerNumber), groups: {}, tools: {} };
        let root = at(placed.root) ? placed.root : null;
        await bulk(async () => {
            if (!root) {
                root = saved.root = await create('home-root', 0, 0, `<b>${NAME}</b><br><font size="2">Ma maison : réécris mes nodes pour me régler.</font>`, '#6848A6', 'square');
            }
            const origin = at(root);
            const families = [];
            let row = 0;  // ordre de départ, de haut en bas : l'arbre le garde
            const spot = depth => ({ x: origin.x + COLUMN * depth, y: origin.y - ROW * row++ });
            for (const { key, label, hint } of seed.groups) {
                if (at(placed.groups?.[key])) continue;
                const p = spot(1);
                const hub = saved.groups[key] = await create(`home-${key}`, p.x, p.y, `<b>${label}</b><br><font size="2">${escape(hint)}</font>`, COLORS[key], 'square');
                await link(root, hub);
                const child = async (ref, text, parent = hub, depth = 2, tint = COLORS[key]) => {
                    const q = spot(depth);
                    const id = await create(ref, q.x, q.y, html(text), tint, 'square');
                    await link(parent, id);
                    return id;
                };
                if (key === 'soul') await child('home-soul-1', seed.soul);
                if (key === 'identity') await child('home-identity-1', seed.identity);
                if (key === 'user') await child('home-user-1', seed.user);
                if (key === 'memory') saved.memory = await child('home-memory-1', `Mémoire du Gardien\n${seed.memory.map(f => `- ${f}`).join('\n')}`);
                if (key === 'skills') {
                    await child('home-skill-1', seed.skill);
                    saved.brain = await child('home-brain', seed.brain);
                }
                if (key === 'tools') {  // une famille par branche, ses outils derrière elle
                    for (const [f, family] of [...new Set(seed.tools.map(t => t.category))].entries()) {  // repliée : +N
                        const tint = PALETTE[f % PALETTE.length];
                        const fid = families[f] = await child(`home-family-${f}`, family, hub, 2, tint);
                        for (const tool of seed.tools.filter(t => t.category === family)) {
                            saved.tools[tool.op] = await child(`home-tool-${tool.op}`, `${tool.op}\n${tool.label}\n\n${tool.usage}`, fid, 3, tint);
                        }
                    }
                }
            }
            families.forEach(id => branches.fold(document.getElementById(id)));  // les outils se déplient famille par famille
            if (Object.keys(saved.groups).length) await tidy(root);
        });  // tout est enregistré : la carte de la maison peut partir
        data = await api.request('POST', 'toolbox/home', saved);
        filters.mark([saved.root, ...Object.values(saved.groups), saved.memory, saved.brain, ...Object.values(saved.tools)].filter(Boolean), 'ai');
        return Object.keys(saved.groups).length;
    }

    // Notes et rêves en attente : posés sous leur groupe, puis le groupe se range (dimension Gardien ouverte).
    async function deliver() {
        const posted = { letters: {}, dreams: {} };
        const place = async (key, items, kind, text) => {
            const hub = data.home?.groups?.[key];
            const centre = at(hub);
            if (!centre || !items.length) return;
            for (const [i, item] of items.entries()) {
                posted[kind][item.id] = await create(`home-${kind}-${item.id}`, centre.x + COLUMN, centre.y - ROW * (i + 1), text(item), COLORS[key]);
                await link(hub, posted[kind][item.id]);
            }
            await tidy(hub);
        };
        await bulk(async () => {
            await place('exchanges', data.letters, 'letters', l => `<font size="2">${escape(l.at)}</font><br>${l.html}${l.choices?.length ? `<br><i>${l.choices.map(escape).join(' / ')}</i>` : ''}`);
            await place('dreams', data.dreams, 'dreams', d => `<font size="2">${d.kind === 'souvenir' ? 'Souvenir' : 'Idée'} · ${escape(d.at)}</font><br>${escape(d.text)}`);
        });
        if (!Object.keys(posted.letters).length && !Object.keys(posted.dreams).length) return 0;
        data = await api.request('POST', 'toolbox/home', posted);
        filters.mark([...Object.values(posted.letters), ...Object.values(posted.dreams)], 'ai');
        chat.unread(data.unread);
        return Object.keys(posted.letters).length + Object.keys(posted.dreams).length;
    }

    const once = job => {
        busy = busy || job().finally(() => { busy = null; });
        return busy;
    };

    // Première connexion : la maison se pose, le Gardien dit ce qu'elle garde, puis retour là où l'on était, à l'humain de créer. Pas sous automatisation (les bancs de
    // navigation pilotent un navigateur vierge), ni en arrivant par le lien d'un salon (la dimension y est celle de l'hôte).
    async function ensure() {
        if (!(await fetchHome()) || navigator.webdriver || new URLSearchParams(location.search).has('room')) return;
        if (layerOf() && Object.keys(data.home.groups).length >= data.seed.groups.length) return;
        await once(async () => {
            const back = layerNumber;
            say('Je m\'installe dans ma dimension « Gardien »…', 'guide');
            await install();
            say('C\'est là que je stocke tous mes souvenirs : mon âme, ce que je sais de toi, mes outils, mes rêves. Retrouve-les quand tu veux depuis la dimension Gardien.', 'guide');
            await wait(4000);  // le temps de lire, la maison sous les yeux
            await bridge.enterLayer(back);
            say('Mais maintenant, c\'est à toi de créer.', 'guide');
        });
    }

    // Bouton du chat et de la bibliothèque : voyage dans la maison (et pose ce qui y manque).
    async function open() {
        if (!(await fetchHome())) return say('Le Gardien n\'est pas encore là : ouvre Agents & modèles.', 'error');
        await once(async () => {
            const added = await install();
            const delivered = await deliver();
            await bridge.perform({ op: 'overview', text: delivered ? `${delivered} nouveauté${delivered > 1 ? 's' : ''} : notes et rêves autour de leurs groupes.`
                : added ? 'Sa maison : réécris ses nodes pour le régler.' : 'La dimension du Gardien : chaque groupe se règle en réécrivant ses nodes.' });
        });
    }

    // Entrer dans la maison (liste des dimensions, voyage) y pose ce qui attend.
    setInterval(() => {
        if (isLoading || layerNumber === seenLayer) return;
        seenLayer = layerNumber;
        if (data?.home && Number(layerNumber) === data.home.layer && data.unread && !busy) once(deliver).catch(() => {});
    }, 800);

    // Rêves : après QUIET sans échange, les derniers messages partent au serveur, qui rêve (une fois par demi-heure au
    // plus) ; les rêves sont annoncés au prochain passage.
    let quiet = null;
    function heard() {
        clearTimeout(quiet);
        quiet = setTimeout(async () => {
            const history = chat.recent(20);
            if (!history.length) return;
            const { dreaming } = await api.request('POST', 'toolbox/dream', { history }).catch(() => ({}));
            if (dreaming) setTimeout(() => fetchHome().catch(() => {}), 3 * 60 * 1000);
        }, QUIET);
    }

    return { ensure, open, heard, refresh: () => fetchHome().catch(() => {}) };
}
