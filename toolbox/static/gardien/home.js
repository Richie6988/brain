// La dimension « Gardien » (toolbox/home.py) : la maison du Gardien, posée d'office à la première connexion (par le
// serveur, d'un bloc). Une racine
// et huit groupes rangés en arbre (Âme, Identité, Utilisateur, Mémoire, Compétences, Outils, Rêves, Échanges), chacun
// avec ses nodes : le Gardien y relit ses clés à chaque demande, l'humain le règle en réécrivant, ajoutant (relié sous un
// groupe) ou supprimant des nodes. Ses notes et ses rêves en attente s'y posent quand l'humain y entre.
// Rêves : après une période calme, la page envoie les derniers échanges du chat ; le serveur rêve en arrière-plan.

import { api } from './api.js';
import { explode } from './branches.js';
import { bulk } from './bulk.js';
import { t } from './i18n.js';

const COLORS = { soul: '#C77DFF', identity: '#FF9F45', user: '#4DD4C6', memory: '#33FF99', skills: '#FFD93D', tools: '#4D96FF',
    dreams: '#F15BB5', exchanges: '#1E90FF' };
const COLUMN = 700;    // notes et rêves : premières positions à droite de leur groupe, la vue éclatée les affine
const ROW = 300;
const QUIET = 10 * 60 * 1000;  // période calme avant un rêve
const ROLES = Object.fromEntries(['soul', 'identity', 'user', 'memory', 'skills', 'tools', 'dreams', 'exchanges'].map(key => [key, t(`home.role.${key}`)]));
const STOP = 1500;     // ms sur chaque groupe pendant le survol de la première visite

const escape = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
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
    // Notes et rêves posés dans bulk() : leurs enregistrements partent groupés à la fin.
    const create = async (ref, x, y, text, color, shape = 'circle') => {
        await bridge.perform({ op: 'create', ref, x: Math.round(x), y: Math.round(y), text, color, shape });
        return bridge.idOf(ref);
    };
    const link = (source, target) => bridge.perform({ op: 'link', source, target });
    // Vue éclatée de toute la maison (racine au centre, groupes en couronne), une fois les nodes à leur taille
    // (textfit.js les agrandit en 600 ms).
    const tidy = async () => {
        await wait(1500);
        const root = document.getElementById(data?.home?.root);
        if (root) await explode(root);
    };

    // Pose ce qui manque, d'un bloc : le serveur écrit la dimension, ses nodes et ses liens déjà rangés en arbre
    // (toolbox/home.py build), la page la charge comme toute dimension (une seule passe, au lieu d'une centaine de
    // créations à la suite), replie les familles d'outils, puis l'arbre s'ajuste aux tailles mesurées par textfit.
    async function install() {
        const { built, home } = await api.request('POST', 'toolbox/home', { build: true });
        data = { ...data, home };
        // Charger une dimension ne relit pas les compteurs : sans eux, le node suivant reprendrait un numéro du Gardien.
        nodeCounter = Math.max(Number(nodeCounter) || 0, built.counters.node);
        linkCounter = Math.max(Number(linkCounter) || 0, built.counters.link);
        layerCounter = Math.max(Number(layerCounter) || 0, built.counters.layer);
        if (!layers.some(l => Number(l.id) === built.layer)) layers.push({ id: built.layer, name: built.name });
        await bridge.enterLayer(built.layer, built.nodes.length > 0);
        // textfit puis le rangement réenregistrent les nodes : en quelques requêtes groupées, qui partent pendant que le
        // Gardien montre sa maison (on n'attend que l'arbre rangé).
        let arranged;
        const ready = new Promise(resolve => { arranged = resolve; });
        bulk(async () => {
            built.families.forEach(id => branches.fold(document.getElementById(id)));  // les outils se déplient famille par famille
            filters.mark(built.nodes, 'ai');
            if (built.added) await tidy();
            arranged();
        }).catch(() => arranged());
        await ready;
        return built.added;
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
            await tidy();
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

    // Première connexion, une fois le guide fermé (ready) : la maison se pose, le Gardien la montre en entier et dit ce
    // qu'elle garde, puis retour là où l'on était, à l'humain de créer. Pas sous automatisation (les bancs de navigation
    // pilotent un navigateur vierge), ni en arrivant par le lien d'un salon (la dimension y est celle de l'hôte).
    async function ensure(ready = () => Promise.resolve()) {
        if (!(await fetchHome()) || navigator.webdriver || new URLSearchParams(location.search).has('room')) return;
        if (layerOf() && Object.keys(data.home.groups).length >= data.seed.groups.length) return;
        await ready();
        await once(async () => {
            const back = layerNumber;
            say(t('home.settling'), 'guide');
            await install();
            await bridge.perform({ op: 'overview' });  // tout son cerveau sous les yeux
            say(t('home.brain'), 'guide');
            await wait(2500);
            // Le plan de navigation : la caméra passe de groupe en groupe, une légende pour chacun.
            let card = null;
            for (const { key, label } of data.seed?.groups || []) {
                const ref = data.home?.groups?.[key];
                if (!ref || !document.getElementById(ref)) continue;
                await bridge.perform({ op: 'focus', ref, zoom: 0.55 });
                card?.remove();
                card = say(`${label} · ${ROLES[key] || ''}`, 'guide');
                await wait(STOP);
            }
            card?.remove();
            await bridge.perform({ op: 'overview' });
            say(t('home.findIt'), 'guide');
            await wait(3000);
            await bridge.enterLayer(back);
            say(t('home.yourTurn'), 'guide');
        });
    }

    // Bouton du chat et de la bibliothèque : voyage dans la maison (et pose ce qui y manque).
    async function open() {
        if (!(await fetchHome())) return say(t('home.missing'), 'error');
        await once(async () => {
            const added = await install();
            const delivered = await deliver();
            await bridge.perform({ op: 'overview', text: delivered ? t(delivered > 1 ? 'home.newN' : 'home.new1', { n: delivered })
                : added ? t('home.house') : t('home.dimension') });
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
