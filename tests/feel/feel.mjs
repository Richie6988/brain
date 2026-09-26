// Banc de test du « feel » de navigation (CLAUDE.md, section 3).
//   node tests/feel/feel.mjs --record    enregistre reference.json sur le code actuel
//   node tests/feel/feel.mjs             rejoue le scénario et compare à reference.json (tolérance 1e-3)
// Prérequis : serveur Nodz sur NODZ_URL (défaut http://127.0.0.1:8001). Chaque exécution passe par
// GUEST, qui crée un compte neuf et vide : le scénario part toujours du même état.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.NODZ_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const REFERENCE = fileURLToPath(new URL('./reference.json', import.meta.url));
const TOLERANCE = 1e-3;
const record = process.argv.includes('--record');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// État observable : transformation de l'univers, zoom, nodes du plan courant, sélection, plan.
const snapshot = () => page.evaluate(() => ({
    universe: document.getElementById('universe').getAttribute('transform'),
    zoom: Number(currentZoom),
    layer: layerNumber,
    nodes: [...document.querySelectorAll('.node-group')].map(n => [n.id, n.getAttribute('transform')]),
    selected: selectedNodes.map(n => n.id),
}));
// Molette : deltaY entier = pan à deux doigts, non entier = pinch (zoom.js).
const wheel = (x, y, deltaX, deltaY) => page.evaluate(([x, y, deltaX, deltaY]) => {
    svg.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaX, deltaY, bubbles: true, cancelable: true }));
}, [x, y, deltaX, deltaY]);
const ring = id => page.evaluate(id => {
    const r = document.getElementById(id).children[1].getBoundingClientRect();
    return { x: r.right - 3, y: r.top + r.height / 2 };
}, id);

const steps = [];
const step = async (name, action) => {
    await action();
    await page.waitForTimeout(400);
    steps.push({ name, ...(await snapshot()) });
};

await page.goto(`${BASE}/universe`);
await page.getByText('GUEST', { exact: true }).click();
await page.waitForTimeout(3500);

// Espace crée un node sous la souris ; le clic à vide sort du mode saisie du node précédent.
await step('création', async () => {
    for (const [x, y] of [[420, 330], [760, 300], [600, 520]]) {
        await page.mouse.click(x, y);
        await page.keyboard.press(' ');
        await page.waitForTimeout(300);
    }
    await page.mouse.click(1200, 740);
});
await step('pan molette', async () => { for (let i = 0; i < 3; i++) await wheel(640, 400, 30, -45); });
await step('zoom avant centré', async () => { for (let i = 0; i < 10; i++) await wheel(300, 250, 0, -1.5); });
await step('zoom arrière centré', async () => { for (let i = 0; i < 6; i++) await wheel(900, 600, 0, 1.5); });
await step('glisser univers', async () => {
    await page.mouse.move(1150, 720);
    await page.mouse.down();
    await page.mouse.move(1040, 660, { steps: 10 });
    await page.mouse.up();
});
const selectAll = async () => {
    await page.keyboard.down('Control');
    await page.mouse.move(60, 60);
    await page.mouse.down();
    await page.mouse.move(1220, 760, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Control');
};
await step('sélection rectangle', selectAll);
await step('drag sélection', async () => {
    const id = (await snapshot()).nodes[0][0];
    const p = await ring(id);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(p.x + 80, p.y + 50, { steps: 10 });
    await page.mouse.up();
});
// Après le drag, le texte du node a le focus : on resélectionne avant Entrée, comme un utilisateur.
await step('resélection', selectAll);
await step('téléportation', async () => {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4500);
});
await browser.close();

const result = { viewport: '1280x800', steps, errors };
if (record) {
    writeFileSync(REFERENCE, JSON.stringify(result, null, 2) + '\n');
    console.log(`reference.json enregistré : ${steps.length} étapes, ${errors.length} erreur(s) JS`);
    process.exit(0);
}

// Comparaison : mêmes chaînes, et nombres égaux à TOLERANCE près.
const numbers = s => (String(s).match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
const close = (a, b) => {
    const na = numbers(a), nb = numbers(b);
    return na.length === nb.length && na.every((v, i) => Math.abs(v - nb[i]) <= TOLERANCE);
};
const reference = JSON.parse(readFileSync(REFERENCE, 'utf8'));
const failures = [];
reference.steps.forEach((ref, i) => {
    const got = steps[i];
    if (!got) return failures.push(`${ref.name} : étape absente`);
    for (const key of ['universe', 'zoom', 'layer', 'selected']) {
        if (!close(JSON.stringify(ref[key]), JSON.stringify(got[key]))) failures.push(`${ref.name} / ${key} : attendu ${JSON.stringify(ref[key])}, obtenu ${JSON.stringify(got[key])}`);
    }
    if (ref.nodes.length !== got.nodes.length) failures.push(`${ref.name} / nodes : ${ref.nodes.length} attendus, ${got.nodes.length} obtenus`);
    else ref.nodes.forEach(([, t], j) => { if (!close(t, got.nodes[j][1])) failures.push(`${ref.name} / node ${j} : attendu ${t}, obtenu ${got.nodes[j][1]}`); });
});
if (errors.length) failures.push(`erreurs JS : ${errors.join(' | ')}`);
console.log(failures.length ? `ÉCHEC\n${failures.join('\n')}` : `OK : ${steps.length} étapes identiques à ${TOLERANCE} près`);
process.exit(failures.length ? 1 : 0);
