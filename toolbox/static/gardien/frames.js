// Écritures des boucles d'image (poignée, barre du node, pastilles) : seulement quand la valeur change. Réécrire
// à l'identique hidden ou un style relançait le calcul du style de toute la page à chaque image, même au repos.
const written = new WeakMap();
export function show(el, visible) {
    if (el.hidden === visible) el.hidden = !visible;
}
export function setStyle(el, prop, value) {
    const last = written.get(el) || written.set(el, {}).get(el);
    if (last[prop] === value) return;
    last[prop] = value;
    el.style.setProperty(prop, value);
}
