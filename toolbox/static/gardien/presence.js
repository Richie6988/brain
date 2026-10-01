// Présence du Gardien dans l'univers : quand il agit, son avatar glisse jusqu'au node qu'il crée, relie ou montre,
// comme le curseur d'un collaborateur, avec une étiquette de ce qu'il fait ; il s'efface quand il a fini.
// Purement visuel : il ne capte aucun geste (pointer-events: none), rien ne change dans Nodz.

export function createPresence() {
    const label = document.createElement('span');
    const avatar = document.createElement('div');
    avatar.id = 'gardien-presence';
    avatar.hidden = true;
    avatar.append(document.createElement('i'), label);
    document.body.append(avatar);
    let timer = null;

    function place(element) {
        const r = element.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
        // Coin haut droit du node, gardé dans la fenêtre (un node au bord de l'écran ne l'emporte pas dehors).
        const x = Math.min(Math.max(8, r.right - r.width * 0.15), innerWidth - avatar.offsetWidth - 8);
        const y = Math.min(Math.max(8, r.top + r.height * 0.15), innerHeight - 40);
        avatar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        return true;
    }

    return {
        // Au travail sur ce node (identifiant Nodz) : l'avatar y va, l'étiquette dit quoi.
        at(id, text) {
            const element = id && document.getElementById(id);
            if (!element || !place(element)) return;
            label.textContent = text || '';
            avatar.hidden = false;
            avatar.classList.add('working');
            clearTimeout(timer);
            timer = setTimeout(() => avatar.classList.remove('working'), 1200);
        },
        // Fini : l'avatar s'efface doucement.
        leave() {
            clearTimeout(timer);
            avatar.classList.remove('working');
            timer = setTimeout(() => { avatar.hidden = true; }, 2500);
        },
    };
}
