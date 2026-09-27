// Client de /api/v1 pour le Gardien : requêtes JSON et flux SSE de ses réponses.

const BASE = document.documentElement.dataset.base || '';
// URL absolue : sur /universe, base.js préfixe déjà les fetch('/...') ; une URL complète n'est jamais préfixée deux fois.
const endpoint = path => `${window.location.origin}${BASE}/api/v1/${path}`;

function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)nodz_csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function send(method, path, body) {
    return fetch(endpoint(path), {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
        body: body ? JSON.stringify(body) : undefined,
    });
}

export const SIGNED_OUT = 'Session expirée (mot de passe changé ou déconnexion) : recharge la page avec Ctrl+Maj+R puis reconnecte-toi avec LOGIN.';

async function failure(response) {
    const data = await response.json().catch(() => ({}));
    const message = response.status === 401 ? SIGNED_OUT : data.error || response.statusText;
    return Object.assign(new Error(message), { status: response.status, data });
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

export const api = {
    request,
    command: (body, onEvent) => stream('toolbox/command', body, onEvent),
};
