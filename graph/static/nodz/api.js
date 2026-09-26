// Client de /api/v1 : chargement d'un plan et sauvegarde incrémentale groupée (débounce).

const BASE = document.documentElement.dataset.base || '';

function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function request(method, path, body) {
    const response = await fetch(`${BASE}/api/v1/${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || response.statusText), { status: response.status, data });
    return data;
}

export const api = {
    layers: () => request('GET', 'layers'),
    graph: layerId => request('GET', `layers/${layerId}/graph`),
    changes: batch => request('POST', 'changes', batch),
};

// Envoie les changements du store au plus tard `delay` ms après la dernière modification.
// La version n'est pas envoyée : un seul client écrit à la fois (dernier écrit gagnant) ;
// la détection de conflit servira au multi-utilisateur.
export function createSync(store, { delay = 400, onError = console.error } = {}) {
    let timer = null;
    let inflight = Promise.resolve();

    function flush() {
        clearTimeout(timer);
        timer = null;
        if (!store.hasChanges()) return inflight;
        const batch = store.takeChanges();
        batch.nodes.upsert = batch.nodes.upsert.map(({ version, ...node }) => node);
        inflight = inflight.then(() => api.changes(batch)).then(result => {
            result.nodes.forEach(n => {
                const local = store.state.nodes.get(n.id);
                if (local) local.version = n.version;
            });
        }).catch(onError);
        return inflight;
    }

    store.on('*', event => {
        if (/:(changed|removed)$/.test(event) && !timer) timer = setTimeout(flush, delay);
    });
    return { flush };
}
