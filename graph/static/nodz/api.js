// Client de /api/v1 : chargement d'un plan et sauvegarde incrémentale groupée (débounce).

const BASE = document.documentElement.dataset.base || '';

function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function send(method, path, body) {
    return fetch(`${BASE}/api/v1/${path}`, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
        body: body ? JSON.stringify(body) : undefined,
    });
}

async function failure(response) {
    const data = await response.json().catch(() => ({}));
    return Object.assign(new Error(data.error || response.statusText), { status: response.status, data });
}

async function request(method, path, body) {
    const response = await send(method, path, body);
    if (!response.ok) throw await failure(response);
    return response.json();
}

// Réponse en flux SSE (POST) : onEvent(type, données) pour chaque événement.
async function stream(path, body, onEvent) {
    const response = await send('POST', path, body);
    if (!response.ok) throw await failure(response);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (type) onEvent(type, data ? JSON.parse(data) : {});
        }
    }
}

// Envoi d'un fichier (multipart) : renvoie {id, name, mime, size}.
async function upload(file) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${BASE}/api/v1/files`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': csrfToken() }, body: form,
    });
    if (!response.ok) throw await failure(response);
    return response.json();
}

export const api = {
    request,
    upload,
    fileUrl: (id, download = false) => `${BASE}/api/v1/files/${id}${download ? '?download=1' : ''}`,
    layers: () => request('GET', 'layers'),
    graph: layerId => request('GET', `layers/${layerId}/graph`),
    changes: batch => request('POST', 'changes', batch),
    command: (body, onEvent) => stream('toolbox/command', body, onEvent),
    toolbox: {
        status: () => request('GET', 'toolbox/status'),
        agents: () => request('GET', 'toolbox/agents'),
        updateAgent: (id, fields) => request('PATCH', `toolbox/agents/${id}`, fields),
        models: () => request('GET', 'toolbox/models'),
        download: file => request('POST', 'toolbox/models', file),
        deleteModel: id => request('DELETE', `toolbox/models/${id}`),
        recommendations: () => request('GET', 'toolbox/recommendations'),
        search: (q, sort) => request('GET', `toolbox/hub/search?${new URLSearchParams({ q, sort, limit: 30 })}`),
        files: repo => request('GET', `toolbox/hub/files?${new URLSearchParams({ repo })}`),
    },
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
