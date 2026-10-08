// Indicateurs de coin : Nodz réécrit leur nombre à chaque image d'un glissé ; quand il change vraiment, il
// sursaute. Web Animations (pas de classe ôtée puis remise) : relancer l'animation ne force plus un recalcul de toute
// la page à chaque changement, ce qui alourdissait chaque image des glissés et des zooms.
const BUMP = [{ scale: 1 }, { scale: 1.45, offset: 0.4 }, { scale: 1 }];
const TIMING = { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' };

export function createCorners() {
    document.querySelectorAll('.triangle-container .counter').forEach(counter => {
        let last = counter.textContent, bump = null;
        new MutationObserver(() => {
            if (counter.textContent === last) return;
            last = counter.textContent;
            bump?.cancel();
            bump = counter.animate(BUMP, TIMING);
        }).observe(counter, { childList: true });
    });
}
