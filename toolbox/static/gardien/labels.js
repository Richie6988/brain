// Libellés des icônes au style HYPERSPACE : petites capitales monospace sous l'icône survolée, à la place des
// infobulles. Couvre les infobulles SVG de Nodz (createTooltip / deleteTooltip, remplacées) et l'attribut title
// des icônes (boutons sans texte ou presque), repris en data-label pour que le navigateur n'affiche plus le sien.

import { lang } from './i18n.js';
// Textes de Nodz : traduits en français ; en anglais, Share devient Invite (les salons).
const FRENCH = {
    'Styled link': 'Liens stylés', 'Neutral link': 'Liens neutres', 'No link': 'Sans liens', 'Back to origin': 'Origine',
    'Dimensions': 'Dimensions', 'Set new origin': 'Drapeau', 'Full screen': 'Plein écran', 'Template gallery': 'Galerie',
    'Share': 'Inviter', 'Save': 'Sauver', 'Export': 'Exporter', 'Profile': 'Profil', 'Dark': 'Sombre', 'Light': 'Clair',
    'Sound On': 'Son', 'Sound Off': 'Muet', 'Font size': 'Taille', 'Double-click': 'Double-clic', 'Draw circle': 'Cercle',
    'Draw line': 'Trait', 'Erase': 'Gomme', 'Clear canvas': 'Tout effacer', 'Undo': 'Annuler', 'Redo': 'Rétablir',
    'Line size': 'Épaisseur', 'Line color': 'Couleur', 'Download file': 'Télécharger',
};
const NAMES = lang() === 'fr' ? FRENCH : { Share: 'Invite' };
const ICON = 'button, [role=button], img, select, input[type=range]';
const SHORT = 4;  // au-delà, le bouton porte son texte : il garde son infobulle

export function createLabels() {
    const label = document.createElement('div');
    label.id = 'gardien-label';
    label.hidden = true;
    document.body.append(label);

    let fromNodz = false;  // libellé posé par createTooltip : seul deleteTooltip l'efface (son mouseout arrive après le survol suivant)
    function show(element, text, nodz = false) {
        const first = String(text).split('\n')[0].trim();
        if (!element || !first) return;
        label.textContent = NAMES[first] || first;
        label.hidden = false;
        fromNodz = nodz;
        const box = element.getBoundingClientRect();
        const room = window.innerHeight - box.bottom;
        const x = Math.min(Math.max(box.left + box.width / 2 - label.offsetWidth / 2, 4), window.innerWidth - label.offsetWidth - 4);
        label.style.left = `${x}px`;
        label.style.top = `${room >= label.offsetHeight + 6 ? box.bottom + 4 : box.top - label.offsetHeight - 4}px`;
    }
    const hide = () => { label.hidden = true; };

    window.createTooltip = (id, text) => show(document.getElementById(id), text, true);
    window.deleteTooltip = () => { if (fromNodz) hide(); };

    document.addEventListener('pointerover', event => {
        const icon = event.target.closest?.(ICON);
        if (!icon) return;
        if (icon.title && (icon.textContent || '').trim().length <= SHORT) {
            icon.dataset.label = icon.title;
            icon.removeAttribute('title');
        }
        if (icon.dataset.label) show(icon, icon.dataset.label);
    });
    document.addEventListener('pointerout', event => {
        if (event.target.closest?.('[data-label]') && !event.relatedTarget?.closest?.('[data-label]')) hide();
    });
    document.addEventListener('pointerdown', hide, true);
}
