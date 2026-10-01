// Effets sonores de l'univers, synthétisés (WebAudio, aucun fichier) : une goutte qui monte pour un node créé, deux
// notes de verre pour un lien, un souffle qui descend pour une suppression, un arpège pour un portail, un accord doux
// quand le Gardien a fini. Les notes suivent une gamme pentatonique : des créations rapprochées (le Gardien qui pose
// 40 nodes) montent la gamme au lieu de se répéter, et restent consonantes. Seuls les gestes sonnent (l'historique
// les signale), jamais le chargement d'une dimension ni un Ctrl+Z rejoué. Bouton du menu : effets ou silence.

const KEY = 'gardien-sfx';
const VOLUME = 0.22;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];  // pentatonique majeure, demi-tons
const COMBO = 450;   // ms : une création dans ce délai monte d'un degré
const SPACING = 40;  // ms au plus serré entre deux sons d'un même genre

const hz = semitones => 440 * 2 ** ((semitones - 9) / 12) * 2;  // 0 = do5

export function createSfx() {
    let ctx = null, out = null, on = true, combo = 0, lastCreate = 0;
    const last = {};
    try {
        on = localStorage.getItem(KEY) !== 'off';
    } catch { /* stockage indisponible */ }

    // Le navigateur n'ouvre l'audio qu'après un geste : le contexte naît au premier clic ou à la première touche.
    function wake() {
        if (ctx) return ctx.state === 'suspended' ? ctx.resume() : null;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return null;
        ctx = new Context();
        out = ctx.createDynamicsCompressor();  // des dizaines de sons rapprochés ne saturent pas
        const master = ctx.createGain();
        master.gain.value = VOLUME;
        // Un écho court et feutré donne de l'espace sans traîner.
        const echo = ctx.createDelay(), feedback = ctx.createGain(), damp = ctx.createBiquadFilter();
        echo.delayTime.value = 0.11;
        feedback.gain.value = 0.22;
        damp.type = 'lowpass';
        damp.frequency.value = 2400;
        out.connect(master);
        out.connect(echo);
        echo.connect(damp);
        damp.connect(feedback);
        feedback.connect(echo);
        damp.connect(master);
        master.connect(ctx.destination);
        return null;
    }
    ['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, wake, { capture: true, passive: true }));

    // Une note : oscillateur, enveloppe (attaque, chute exponentielle), glissé de fréquence facultatif.
    function tone({ type = 'sine', from, to = from, at = 0, attack = 0.005, decay = 0.25, gain = 1 }) {
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator(), env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + Math.min(decay, 0.12));
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(gain, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        osc.connect(env).connect(out);
        osc.start(t);
        osc.stop(t + attack + decay + 0.05);
    }

    // Un souffle : bruit blanc filtré dont la fréquence glisse de `from` à `to`.
    function breath({ from, to, decay = 0.25, gain = 0.6, at = 0 }) {
        const t = ctx.currentTime + at;
        const length = Math.ceil(ctx.sampleRate * (decay + 0.05));
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(), band = ctx.createBiquadFilter(), env = ctx.createGain();
        noise.buffer = buffer;
        band.type = 'bandpass';
        band.Q.value = 1.4;
        band.frequency.setValueAtTime(from, t);
        band.frequency.exponentialRampToValueAtTime(to, t + decay);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(gain, t + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        noise.connect(band).connect(env).connect(out);
        noise.start(t);
        noise.stop(t + decay + 0.05);
    }

    const SOUNDS = {
        create() {  // goutte qui monte, un degré plus haut à chaque création rapprochée
            const now = performance.now();
            combo = now - lastCreate < COMBO ? Math.min(combo + 1, SCALE.length - 1) : 0;
            lastCreate = now;
            const note = hz(SCALE[combo]) * (1 + (Math.random() - 0.5) * 0.01);
            tone({ from: note * 0.55, to: note, decay: 0.18, gain: 0.9 });
            tone({ type: 'triangle', from: note * 2, decay: 0.12, gain: 0.18, at: 0.01 });
        },
        link() {  // deux notes de verre, une quinte
            tone({ type: 'triangle', from: hz(16), decay: 0.32, gain: 0.55 });
            tone({ type: 'sine', from: hz(23), decay: 0.45, gain: 0.45, at: 0.06 });
        },
        unlink() {  // petit déclic grave
            tone({ type: 'sine', from: hz(4), to: hz(-3), decay: 0.1, gain: 0.5 });
        },
        delete() {  // souffle qui descend, et sa note
            breath({ from: 2200, to: 260, decay: 0.26, gain: 0.55 });
            tone({ type: 'sine', from: hz(7), to: hz(-5), decay: 0.22, gain: 0.35 });
        },
        portal() {  // arpège qui s'ouvre vers une autre dimension
            [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'sine', from: hz(s), decay: 0.6 - i * 0.06, gain: 0.5, at: i * 0.07 }));
            breath({ from: 600, to: 5000, decay: 0.55, gain: 0.18 });
        },
        undo() { tone({ type: 'triangle', from: hz(9), to: hz(2), decay: 0.12, gain: 0.35 }); },
        redo() { tone({ type: 'triangle', from: hz(2), to: hz(9), decay: 0.12, gain: 0.35 }); },
        arrange() { breath({ from: 300, to: 3200, decay: 0.45, gain: 0.35 }); },
        done() {  // accord doux : le Gardien a fini
            [0, 4, 7].forEach((s, i) => tone({ type: 'triangle', from: hz(s), attack: 0.03, decay: 0.9, gain: 0.28, at: i * 0.04 }));
        },
    };

    function play(kind) {
        if (!on || !ctx || ctx.state !== 'running' || !SOUNDS[kind]) return;
        const now = performance.now();
        if (now - (last[kind] || 0) < SPACING) return;
        last[kind] = now;
        SOUNDS[kind]();
    }

    // Bouton du menu, à côté de la musique : effets sonores ou silence.
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menuBtn', id: 'sfxButton' });
    document.getElementById('soundButton')?.after(button);
    const show = () => {
        button.dataset.state = on ? 'on' : 'off';
        button.title = on ? 'Effets sonores' : 'Effets coupés';
    };
    button.addEventListener('click', () => {
        on = !on;
        try {
            localStorage.setItem(KEY, on ? 'on' : 'off');
        } catch { /* stockage indisponible */ }
        show();
        wake();
        play('link');
    });
    show();

    return { play };
}
