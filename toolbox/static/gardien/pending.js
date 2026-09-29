// Une demande au Gardien reste liée à la dimension où elle est partie : si l'utilisateur change de
// dimension pendant la réponse, le Gardien continue, ses créations, liens et modifications attendent
// le retour dans cette dimension (gardés dans ce navigateur) et s'y appliquent alors ; ses mouvements de
// caméra ne dérangent pas l'utilisateur ailleurs.

const KEY = 'gardien-pending';
const CAMERA = new Set(['focus', 'overview', 'travel', 'goto', 'tour', 'frame']);

export function createPending({ bridge, say, onApplied = () => {} }) {
    let store = {};
    try {
        store = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch { /* stockage indisponible : l'attente vit le temps de la page */ }
    const keep = () => {
        try {
            localStorage.setItem(KEY, JSON.stringify(store));
        } catch { /* stockage indisponible */ }
    };
    let replaying = false;

    const here = home => layerNumber === home && !isLoading;

    // Identifiants Nodz à la place des références déjà connues (le node peut être rechargé entre-temps).
    const resolve = action => Object.fromEntries(Object.entries(action).map(([key, value]) =>
        (['ref', 'source', 'target'].includes(key) && typeof value === 'string' ? [key, bridge.idOf(value)] : [key, value])));

    async function replay(layer) {
        replaying = true;
        const actions = store[layer] || [];
        delete store[layer];
        keep();
        let done = 0;
        for (const action of actions) {
            try {
                await bridge.perform(action);
                done += 1;
            } catch { /* node supprimé entre-temps : on passe */ }
        }
        replaying = false;
        if (done) {
            say(`Le Gardien a posé ici ${done} élément${done > 1 ? 's' : ''} préparé${done > 1 ? 's' : ''} pendant ton absence.`, 'guide');
            onApplied(actions.filter(a => a.op === 'create').map(a => bridge.idOf(a.ref)));
        }
    }

    setInterval(() => {
        if (replaying || typeof layerNumber === 'undefined' || isLoading) return;
        if (store[layerNumber]?.length) replay(layerNumber);
    }, 500);

    return {
        // Exécute l'action dans la dimension `home`, ou la met en attente ; vrai si elle attend.
        async run(home, action) {
            if (here(home) && !store[home]?.length) return bridge.perform(action).then(() => false);
            if (CAMERA.has(action.op)) return false;
            (store[home] = store[home] || []).push(resolve(action));
            keep();
            return true;
        },
    };
}
