// Création en masse : pendant bulk(job), les enregistrements de Nodz (POST save-node, un par node et par geste)
// s'accumulent au lieu de partir un par un ; à la fin, ils partent en quelques requêtes groupées (le serveur de Nodz
// accepte une liste de nodes et de liens, puis les réglages en dernier). Un même node enregistré dix fois ne part
// qu'une fois, dans son dernier état. Plus besoin d'espacer les créations pour ne pas noyer le serveur.
// window.nodzQuiet, vrai pendant ce temps : un node créé ne prend pas le focus et son texte posé ne rejoue pas la
// frappe (chacun forçait un recalcul de toute la page) ; textfit.js les met à leur taille ensuite, tous d'un coup.

const CHUNK = 150;  // nodes et liens par requête

let depth = 0;
let pending = new Map();  // 'n12' / 'l7' → objet ; 'params' → réglages (toujours envoyés en dernier)
let init = null;          // en-têtes de la dernière requête interceptée (jeton CSRF)
let url = null;
const send = window.fetch;

window.fetch = function (input, options = {}) {
    const target = typeof input === 'string' ? input : input?.url || '';
    if (!depth || !/\/save-node\/$/.test(target) || (options.method || 'GET').toUpperCase() !== 'POST') return send.call(this, input, options);
    try {
        JSON.parse(options.body).forEach(item => {
            if ('id' in item) pending.set(`n${item.id}`, item);
            else if ('linkid' in item) pending.set(`l${item.linkid}`, item);
            else pending.set('params', item);
        });
        url = input;
        init = options;
    } catch {
        return send.call(this, input, options);  // corps inattendu : il part tel quel
    }
    return Promise.resolve(new Response('{"message": "groupé"}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

async function flush() {
    const items = [...pending.entries()].filter(([key]) => key !== 'params').map(([, item]) => item);
    const params = pending.get('params');
    pending = new Map();
    // Les nodes avant les liens (un lien vérifie sa dimension), les réglages à la fin de chaque requête.
    items.sort((a, b) => ('id' in b) - ('id' in a));
    for (let i = 0; i < items.length; i += CHUNK) {
        const body = JSON.stringify([...items.slice(i, i + CHUNK), ...(params ? [params] : [])]);
        try {
            await send.call(window, url, { ...init, body, keepalive: false });
        } catch (error) {
            console.error('enregistrement groupé', error);
        }
    }
}

// Exécute job ; tout ce qu'il enregistre part groupé à la fin (les bulk imbriqués partent avec le plus extérieur).
export async function bulk(job) {
    depth += 1;
    window.nodzQuiet = true;
    try {
        return await job();
    } finally {
        depth -= 1;
        window.nodzQuiet = depth > 0;
        if (!depth && pending.size) await flush();
    }
}
