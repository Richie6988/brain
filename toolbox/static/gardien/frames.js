// Nodz recalcule les nodes à l'écran (dispatcher : parcours de tous les nodes et liens, ceux hors de la vue cachés)
// à chaque déplacement de la vue, soit jusqu'à 8 fois par cran de molette (4 pas de zoom, 2 déplacements chacun).
// Une seule fois par image suffit : les appels d'une même image sont regroupés, juste avant qu'elle soit dessinée.
export function createFrames() {
    const run = window.dispatcher;
    let pending = 0;
    window.dispatcher = () => {
        if (!pending) pending = requestAnimationFrame(() => { pending = 0; run(); });
    };
}
