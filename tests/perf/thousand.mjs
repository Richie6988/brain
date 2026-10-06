// Banc de performance à 1000 nodes : chargement d'une dimension par la chaîne de Nodz (displayNode, settleSquares,
// displayLink, comme load()), puis poids de la page et fluidité du déplacement, du zoom et du pincement.
//   NODZ_URL=http://127.0.0.1:8123/nodz node tests/perf/thousand.mjs [nombre de nodes]
// Données synthétiques (un arbre réparti sur environ 6000 × 6000) : ni quota ni enregistrement en jeu.
import { chromium } from 'playwright';

const BASE = (process.env.NODZ_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const COUNT = Number(process.argv[2]) || 1000;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${BASE}/universe`);
await page.click('#guestButton');
await page.waitForTimeout(3500);
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
};

const result = { nodes: COUNT };
result.load_ms = await page.evaluate(count => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const colors = ['#33FF99', '#1E90FF', '#C77DFF', '#FF9F45', '#4DD4C6', '#FFD93D'];
    const nodes = [], links = [];
    for (let i = 0; i < count; i++) {
        nodes.push({ node_id: 10000 + i, x_coordinate: Math.round(random() * 6000 - 3000), y_coordinate: Math.round(random() * 6000 - 3000),
            layer__layer_id: layerNumber, type: 'text', color: colors[i % colors.length], shape: i % 3 ? 'circle' : 'square', likes: 0,
            radius: 60, ratio: 0, rank: 0, quantum: '[]', text_content: `Idée ${i}<br>un peu de texte`, image_content: '', canvas_content: '[]',
            file: '', file_name: '', notification: '', lock: false });
        if (i) links.push({ link_id: 20000 + i, linkA: `N-${10000 + Math.floor(random() * i)}`, linkB: `N-${10000 + i}` });
    }
    const start = performance.now();
    isLoading = true;
    nodes.forEach(displayNode);
    if (typeof settleSquares === 'function') settleSquares();
    links.forEach(displayLink);
    isLoading = false;
    dispatcher();
    return Math.round(performance.now() - start);
}, COUNT);
await page.waitForTimeout(3000);
const m = await metrics();
Object.assign(result, await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length,
    per_node: document.querySelector('.node-group[id^="N-1"]').querySelectorAll('*').length + 1,
    gradients: document.querySelectorAll('linearGradient').length,
    iframes: document.querySelectorAll('iframe').length,
    canvas_mpx: Math.round([...document.querySelectorAll('canvas')].reduce((t, c) => t + c.width * c.height, 0) / 1e6),
})));
result.heap_mb = Math.round(m.JSHeapUsedSize / 1e6);
result.dom_nodes = m.Nodes;

await page.mouse.click(1250, 600);
const frames = (mode, level) => page.evaluate(([mode, level]) => new Promise(resolve => {
    const prev = currentZoom;  // la vue autour du centre de l'univers, au zoom demandé
    currentZoom = level;
    universe.setAttribute('transform', `translate(${centerX * (1 - level)}, ${centerY * (1 - level)}) scale(${level})`);
    root.setAttribute('x', 0); root.setAttribute('y', 0);
    dispatcher();
    zoomX = 0; zoomY = 0;
    let i = 0, last = performance.now();
    const times = [];
    requestAnimationFrame(function step(now) {
        times.push(now - last);
        last = now;
        if (mode === 'pan') dragUniverse(i % 20 < 10 ? 15 : -15, 0, false);
        else zoom({ deltaY: i % 20 < 10 ? 1 : -1 });
        if (++i < 60) requestAnimationFrame(step);
        else {
            times.shift();
            times.sort((a, b) => a - b);
            resolve({ median: +times[times.length >> 1].toFixed(1), p90: +times[Math.floor(times.length * 0.9)].toFixed(1), shown: [...document.querySelectorAll('.node-group')].filter(n => n.style.display !== 'none').length });
        }
    });
}), [mode, level]);
for (const level of [1, 0.4, 0.1]) {
    result[`pan_${level}`] = await frames('pan', level);
    result[`zoom_${level}`] = await frames('zoom', level);
}
await page.mouse.move(650, 450);
const before = await page.evaluate(() => Number(currentZoom));
await cdp.send('Input.synthesizePinchGesture', { x: 650, y: 450, scaleFactor: 2, relativeSpeed: 800, gestureSourceType: 'mouse' });
const ended = await page.evaluate(() => Number(currentZoom));
await page.waitForTimeout(200);
result.pinch = { before, ended, after_200ms: await page.evaluate(() => Number(currentZoom)) };
result.errors = errors;
console.log(JSON.stringify(result, null, 1));
await browser.close();
