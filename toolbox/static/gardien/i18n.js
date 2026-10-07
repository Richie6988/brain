// Langue de l'interface : français ou anglais. Choix du compte (#log data-lang, posé par la vue universe), sinon celui
// gardé dans ce navigateur (clé partagée avec la page d'accueil), sinon la langue du navigateur. t('module.clé', {nom})
// rend le texte ; un texte absent en anglais retombe sur le français. Changer de langue enregistre le choix et recharge
// la page : la session reprend (vue universe), toutes les interfaces se reconstruisent dans la nouvelle langue.

import fr from './locales/fr.js';
import en from './locales/en.js';

const KEY = 'nodz-lang';
const DICTS = { fr, en };
const stored = () => {
    try {
        return localStorage.getItem(KEY);
    } catch {
        return null;  // stockage indisponible
    }
};
const browser = () => ((navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
const log = document.getElementById('log');
const account = log?.dataset.resume ? log.dataset.lang || '' : null;  // langue du compte, connue si la session reprend
const current = [account, stored()].find(l => DICTS[l]) || browser();
document.documentElement.lang = current;

export const lang = () => current;
export const locale = () => (current === 'en' ? 'en-GB' : 'fr-FR');  // dates et heures

export function t(key, vars = {}) {
    const text = DICTS[current][key] ?? fr[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? vars[name] : all));
}
window.nodzT = t;  // pour les scripts de Nodz hors modules (interface.js)

// Recharge pour une nouvelle langue : un témoin d'onglet demande à la page de reprendre la session ouverte, sans le
// panneau CONNEXION / INVITÉ (un rechargement fait par l'utilisateur, lui, le montre).
const reload = () => {
    try {
        sessionStorage.setItem('nodz-resume', '1');
    } catch { /* stockage indisponible : le panneau s'affiche */ }
    (window.top || window).location.reload();
};
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('nodz_csrftoken') },
    body: JSON.stringify(body) });

// Enregistre le choix (navigateur et compte, s'il y en a un) puis recharge.
export async function setLang(next) {
    if (!DICTS[next] || next === current) return;
    try {
        localStorage.setItem(KEY, next);
    } catch { /* stockage indisponible */ }
    if (typeof isLoggedIn !== 'undefined' && isLoggedIn) await post('/save-profile/', { language: next }).catch(() => {});
    reload();
}

// Une fois connecté : la langue du compte s'applique (rechargement si elle diffère), sinon celle de cette page (choix
// gardé ou langue du navigateur) devient celle du compte, pour les textes du serveur. Une session reprise a déjà donné
// la langue du compte (#log).
export async function syncAccount() {
    let saved = account;
    if (saved === null) {
        const data = await post('/get-profile/', {}).then(r => r.json()).catch(() => null);
        saved = data?.profile?.find(p => p.name === 'language')?.value ?? '';
    }
    if (DICTS[saved] && saved !== current) {
        try {
            localStorage.setItem(KEY, saved);
        } catch { /* stockage indisponible */ }
        reload();
    } else if (!DICTS[saved]) {
        await post('/save-profile/', { language: current }).catch(() => {});
    }
}

// Textes posés dans le HTML (gabarits) : data-i18n (texte), data-i18n-html, data-i18n-title, data-i18n-placeholder.
export function translateDom(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

// Bascule FR | EN (guide, profil) : deux boutons, l'actif en surbrillance.
export function langSwitch(className = 'nz-lang') {
    const box = document.createElement('div');
    box.className = className;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Langue / Language');
    ['fr', 'en'].forEach(l => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = l.toUpperCase();
        b.classList.toggle('on', l === current);
        b.addEventListener('click', () => setLang(l));
        box.append(b);
    });
    return box;
}
