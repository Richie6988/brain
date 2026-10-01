// Thèmes de l'univers : Nuit (le noir d'origine) et Ardoise (gris-bleu sombre, sans éblouissement, les couleurs des
// nodes ressortent comme sur le noir). Le bouton jour / nuit de Nodz bascule de l'un à l'autre au lieu d'ouvrir l'ancien
// univers blanc : Nodz reste en mode sombre (`dark`), Ardoise n'est qu'une teinte, posée par la classe du body. Le choix
// est gardé par navigateur ; un compte qui avait choisi le blanc retrouve Ardoise.

const KEY = 'gardien-theme';

export function createTheme() {
    const button = document.getElementById('darkButton');
    if (!button) return;
    let slate = false;
    try {
        slate = localStorage.getItem(KEY) === 'slate';
    } catch { /* stockage indisponible */ }

    function show() {
        document.body.classList.toggle('gardien-slate', slate);
        button.style.transform = slate ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    // Avant le gestionnaire de Nodz (capture) : il ne passe plus en blanc. Au chargement, Nodz rejoue la préférence
    // enregistrée par un mousedown sans geste : `dark` vaut alors l'inverse de cette préférence.
    document.addEventListener('mousedown', event => {
        if (event.target !== button) return;
        event.stopImmediatePropagation();
        const legacyLight = !event.isTrusted && dark;  // préférence enregistrée : le blanc
        dark = true;
        if (event.isTrusted) slate = !slate;
        else if (legacyLight) slate = true;
        else return show();
        try {
            localStorage.setItem(KEY, slate ? 'slate' : 'night');
        } catch { /* stockage indisponible */ }
        show();
    }, true);
    document.addEventListener('mouseover', event => {
        if (event.target !== button) return;
        event.stopImmediatePropagation();
        window.createTooltip?.('darkButton', slate ? 'Thème Nuit' : 'Thème Ardoise');
    }, true);
    show();
}
