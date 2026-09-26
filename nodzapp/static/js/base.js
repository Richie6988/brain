// Préfixe d'URL (vide en local, ex. '/nodz' derrière paintit) : les appels fetch('/...') le reçoivent ici.
const NODZ_BASE = document.documentElement.dataset.base || '';

const nativeFetch = window.fetch.bind(window);
window.fetch = (url, options) =>
    nativeFetch(typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? NODZ_BASE + url : url, options);
