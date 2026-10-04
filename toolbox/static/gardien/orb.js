// Avatar du Gardien : un orbe de verre vivant, compagnon du pointeur. Deux yeux suivent le pointeur et clignent ; il
// respire au repos, tourbillonne quand le Gardien réfléchit, pulse quand il répond. Il flotte librement et rejoint le
// pointeur à distance quand celui-ci s'éloigne (il l'attend quand on s'en approche, pour se laisser cliquer) ; un clic
// ouvre le chat collé à lui, donc là où l'on est. Glissé, il reste où on le pose ; un double-clic le range au coin ou
// le rend compagnon. Sous automatisation (bancs du feel), il reste au coin : il ne passe jamais sous un clic de test.

const KEY = 'gardien-orb';
const SIZE = 50;
const GAP = 12;          // entre l'orbe et le chat
const OFFSET = 46;       // l'orbe se tient en bas à droite du pointeur
const NEAR = 150;        // pointeur plus près : l'orbe l'attend
const EASE = 0.08;       // part du chemin faite à chaque image

export function createOrb({ root, bubble, panel, close }) {
    let state = { mode: navigator.webdriver ? 'dock' : 'follow' };
    try {
        state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch { /* stockage indisponible */ }
    const eyes = [...bubble.querySelectorAll('.go-eye')];
    let pos = null, target = null, pointer = null, frame = 0, drag = null, moved = false;

    const store = () => {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch { /* stockage indisponible */ }
    };
    const clamp = (x, y) => ({ x: Math.min(Math.max(8, x), innerWidth - SIZE - 8), y: Math.min(Math.max(8, y), innerHeight - SIZE - 8) });

    // Le coin (comme avant) ou une position libre : l'orbe en fixed, le chat placé à côté de lui.
    function apply() {
        const free = state.mode !== 'dock';
        root.classList.toggle('free', free);
        if (!free) {
            root.style.left = root.style.top = '';
            pos = null;
        } else {
            pos = clamp(pos?.x ?? state.x ?? innerWidth - SIZE - 20, pos?.y ?? state.y ?? innerHeight - SIZE - 84);
            root.style.left = `${pos.x}px`;
            root.style.top = `${pos.y}px`;
        }
        place();
    }

    // Le chat ouvert se colle à l'orbe : au-dessus et à gauche de préférence, sinon dessous, toujours dans l'écran.
    function place() {
        if (panel.hidden || state.mode === 'dock') {
            panel.style.left = panel.style.top = '';
            return;
        }
        const w = panel.offsetWidth, hgt = panel.offsetHeight;
        const left = Math.min(Math.max(16, pos.x + SIZE - w), innerWidth - w - 16);
        const above = pos.y - GAP - hgt, below = pos.y + SIZE + GAP;
        const top = above >= 16 ? above : below + hgt <= innerHeight - 16 ? below : Math.max(16, innerHeight - hgt - 16);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    // Suivi : vers le pointeur tant qu'il est loin, puis immobile.
    function step() {
        frame = 0;
        if (!target || drag || !panel.hidden || state.mode !== 'follow') return;
        pos = { x: pos.x + (target.x - pos.x) * EASE, y: pos.y + (target.y - pos.y) * EASE };
        root.style.left = `${pos.x.toFixed(1)}px`;
        root.style.top = `${pos.y.toFixed(1)}px`;
        if (Math.hypot(target.x - pos.x, target.y - pos.y) > 0.5) frame = requestAnimationFrame(step);
        else {
            state.x = pos.x;
            state.y = pos.y;
            store();
        }
    }

    function look() {
        if (!pointer) return;
        const r = bubble.getBoundingClientRect();
        const dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(3.5, d / 40);
        eyes.forEach(eye => { eye.style.transform = `translate(${(dx / d * k).toFixed(2)}px, ${(dy / d * k).toFixed(2)}px)`; });
    }

    document.addEventListener('pointermove', event => {
        pointer = { x: event.clientX, y: event.clientY };
        look();
        if (drag) {
            moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
            if (moved) {
                pos = clamp(event.clientX - drag.dx, event.clientY - drag.dy);
                root.style.left = `${pos.x}px`;
                root.style.top = `${pos.y}px`;
                place();
            }
            return;
        }
        if (state.mode !== 'follow' || event.buttons || !pos) return;  // pas pendant un glissé de l'univers
        const c = { x: pos.x + SIZE / 2, y: pos.y + SIZE / 2 };
        if (Math.hypot(pointer.x - c.x, pointer.y - c.y) < NEAR) return;  // il attend qu'on le clique
        target = clamp(pointer.x + OFFSET - SIZE / 2, pointer.y + OFFSET - SIZE / 2);
        if (!frame) frame = requestAnimationFrame(step);
    });

    // Glisser l'orbe : il reste où on le pose (le clic qui suit n'ouvre pas le chat).
    bubble.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const r = bubble.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, dx: event.clientX - r.left, dy: event.clientY - r.top };
        moved = false;
    });
    window.addEventListener('pointerup', () => {
        if (!drag) return;
        drag = null;
        if (!moved) return;
        state = { mode: 'pin', x: pos.x, y: pos.y };
        root.classList.add('free');
        store();
    });
    bubble.addEventListener('click', event => {
        if (!moved) return;
        moved = false;
        event.stopImmediatePropagation();
    }, true);
    bubble.addEventListener('dblclick', () => {
        close();
        state = { mode: state.mode === 'dock' ? 'follow' : 'dock', x: pos?.x, y: pos?.y };
        store();
        apply();
    });
    window.addEventListener('resize', apply);

    // Clignement, à intervalles irréguliers.
    (function blink() {
        setTimeout(() => {
            bubble.classList.add('blink');
            setTimeout(() => bubble.classList.remove('blink'), 140);
            blink();
        }, 2500 + Math.random() * 4000);
    })();

    apply();
    return {
        place,
        speak() {
            bubble.classList.remove('speak');
            void bubble.offsetWidth;  // relance l'animation
            bubble.classList.add('speak');
        },
    };
}
