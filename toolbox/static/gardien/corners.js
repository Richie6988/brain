// Indicateurs de coin : Nodz réécrit leur nombre à chaque image d'un glissé ; quand il change vraiment, il
// sursaute (classe gc-bump, modern.css).
export function createCorners() {
    document.querySelectorAll('.triangle-container .counter').forEach(counter => {
        let last = counter.textContent;
        new MutationObserver(() => {
            if (counter.textContent === last) return;
            last = counter.textContent;
            counter.classList.remove('gc-bump');
            void counter.offsetWidth;  // relance l'animation
            counter.classList.add('gc-bump');
        }).observe(counter, { childList: true });
    });
}
