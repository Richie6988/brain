// IDE des nodes de code : une fenêtre CodeMirror (Python, JavaScript, Bash, HTML) au-dessus de l'univers, ouverte d'un
// clic sur le node de code (ou par « IDE » dans sa barre) et refermée d'un clic en dehors ; le ▶ de la barre exécute le
// code sans ouvrir l'IDE. Le code vit dans
// le texte du node (<code data-lang>), donc il se sauvegarde, se recharge et se copie comme un texte ; l'enregistrer
// étire le node en rectangle à sa taille. Le résultat de la dernière exécution s'affiche dans le node, sous le code
// (sortie de la console, ou page rendue pour le HTML, dans une iframe isolée).
// HTML : visionneuse à côté de l'éditeur, mise à jour pendant la frappe.
// Exécution au choix :
// - dans le navigateur : JavaScript dans une iframe isolée (sandbox, sans accès à la page), Python avec Pyodide dans
//   un Web Worker (copie locale dans static/vendor/pyodide si elle existe, sinon le CDN jsdelivr) ;
// - sur le serveur (route toolbox/run) : dans l'espace de travail confiné de l'utilisateur, réservé à
//   l'administrateur avec GUARDIAN_SHELL=1, comme le shell du Gardien.
// Chaîne de code : des nodes de code reliés (Node1 → Node2) forment un programme. Un node s'exécute après le code de
// ses nodes en amont (même langage), dans le même espace : variables et fonctions passent d'un node à l'autre. Un node
// non-code relié en aval d'un node de code est une sortie : il affiche le résultat de la chaîne et se recalcule seul
// quand un code en amont est enregistré, exécuté ou relié.

import { api } from './api.js';

const CM = `${NODZ_BASE}/static/vendor/codemirror-5.65.18`;
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const LANGUAGES = [['python', 'Python'], ['javascript', 'JavaScript'], ['bash', 'Bash'], ['html', 'HTML']];
const MODES = { python: 'python', javascript: 'javascript', bash: 'shell', html: 'htmlmixed' };
const PREVIEW_DELAY = 400;  // ms de pause dans la frappe avant de rafraîchir la visionneuse HTML
const OUTPUT_LINES = 12;    // lignes de sortie montrées dans le node
const BROWSER_TIMEOUT = 30_000;

let loading = null;
function loadEditor() {
    const script = src => new Promise((resolve, reject) => {
        const el = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`${src} introuvable`)) });
        document.head.append(el);
    });
    loading ??= (async () => {
        document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${CM}/codemirror.css` }));
        await script(`${CM}/codemirror.js`);
        for (const extra of ['mode/python', 'mode/javascript', 'mode/shell', 'mode/xml', 'mode/css', 'mode/htmlmixed', 'addon/matchbrackets', 'addon/closebrackets', 'addon/comment', 'addon/active-line']) {
            await script(`${CM}/${extra}.js`);
        }
    })();
    return loading;
}

// JavaScript isolé : iframe sandbox (scripts seulement, origine opaque), console renvoyée par postMessage.
function runJavaScript(code, print) {
    return new Promise(resolve => {
        const frame = Object.assign(document.createElement('iframe'), { hidden: true });
        frame.setAttribute('sandbox', 'allow-scripts');
        const finish = status => {
            window.removeEventListener('message', listen);
            clearTimeout(timer);
            frame.remove();
            resolve(status);
        };
        const listen = event => {
            if (event.source !== frame.contentWindow) return;
            const { kind, text } = event.data || {};
            if (kind === 'done') finish('ok');
            else if (kind === 'fail') { print(text, 'err'); finish('erreur'); }
            else print(text, kind === 'err' ? 'err' : 'out');
        };
        const timer = setTimeout(() => { print(`délai dépassé (${BROWSER_TIMEOUT / 1000} s)`, 'err'); finish('délai'); }, BROWSER_TIMEOUT);
        window.addEventListener('message', listen);
        const bootstrap = `<script>
const send = (kind, args) => parent.postMessage({ kind, text: args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ') }, '*');
console.log = (...a) => send('out', a); console.info = console.log; console.warn = (...a) => send('err', a); console.error = (...a) => send('err', a);
(async () => { ${code}\n })().then(() => parent.postMessage({ kind: 'done' }, '*'), e => parent.postMessage({ kind: 'fail', text: String(e && e.stack || e) }, '*'));
<\/script>`;
        frame.srcdoc = bootstrap;
        document.body.append(frame);
    });
}

// Python : Pyodide dans un Worker gardé entre deux exécutions (son chargement prend quelques secondes).
let python = null;
async function pyodideBase() {
    const local = `${location.origin}${NODZ_BASE}/static/vendor/pyodide/`;
    try {
        if ((await fetch(`${local}pyodide.js`, { method: 'HEAD' })).ok) return local;
    } catch { /* hors ligne ou absent : le CDN */ }
    return PYODIDE_CDN;
}
async function runPython(code, print) {
    if (!python) {
        const base = await pyodideBase();
        const source = `importScripts('${base}pyodide.js');
let py = null;
onmessage = async ({ data }) => {
  try {
    if (!py) { py = await loadPyodide({ indexURL: '${base}' }); postMessage({ kind: 'ready' }); }
    py.setStdout({ batched: text => postMessage({ kind: 'out', text }) });
    py.setStderr({ batched: text => postMessage({ kind: 'err', text }) });
    const result = await py.runPythonAsync(data.code);
    if (result !== undefined && result !== null) postMessage({ kind: 'out', text: String(result) });
    postMessage({ kind: 'done' });
  } catch (e) { postMessage({ kind: 'fail', text: String(e.message || e) }); }
};`;
        python = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
        print(`Chargement de Python dans le navigateur (${base === PYODIDE_CDN ? 'CDN' : 'copie locale'})…`, 'info');
    }
    const worker = python;
    return new Promise(resolve => {
        const timer = setTimeout(() => {  // boucle infinie : le Worker est arrêté (le prochain en recharge un)
            worker.terminate();
            python = null;
            print(`délai dépassé (${BROWSER_TIMEOUT / 1000} s)`, 'err');
            resolve('délai');
        }, BROWSER_TIMEOUT * 2);
        worker.onmessage = ({ data }) => {
            if (data.kind === 'ready') return print('Python prêt.', 'info');
            if (data.kind === 'done' || data.kind === 'fail') {
                clearTimeout(timer);
                if (data.kind === 'fail') print(data.text, 'err');
                resolve(data.kind === 'done' ? 'ok' : 'erreur');
                return;
            }
            print(data.text, data.kind);
        };
        worker.onerror = event => { clearTimeout(timer); print(event.message || 'Python indisponible', 'err'); python = null; resolve('erreur'); };
        worker.postMessage({ code });
    });
}

// Exécute du code (hors HTML, rendu par la visionneuse) : navigateur pour JavaScript et Python, serveur sinon ou sur
// demande (Bash ne tourne que là). Rend 'ok' ou la raison de l'échec ; la sortie passe par print.
async function runCode(lang, code, place, print) {
    try {
        if (place === 'server' || lang === 'bash') {
            const r = await api.request('POST', 'toolbox/run', { language: lang, code });
            if (r.stdout) print(r.stdout, 'out');
            if (r.stderr) print(r.stderr, 'err');
            return r.code === 0 ? 'ok' : `code ${r.code ?? '?'}`;
        }
        if (lang === 'javascript') return await runJavaScript(code, print);
        return await runPython(code, print);
    } catch (error) {
        print(error.message, 'err');
        return 'erreur';
    }
}

export function createIde({ say }) {
    const h = (tag, props = {}, ...children) => {
        const el = Object.assign(document.createElement(tag), props);
        el.append(...children);
        return el;
    };
    const language = h('select', { title: 'Langage' }, ...LANGUAGES.map(([value, label]) => h('option', { value }, label)));
    const where = h('select', { title: "Où l'exécuter" }, h('option', { value: 'browser' }, 'Navigateur'), h('option', { value: 'server' }, 'Serveur'));
    const run = h('button', { type: 'button', className: 'gi-run', title: 'Exécuter (Ctrl+Entrée)' }, '▶ Exécuter');
    const clear = h('button', { type: 'button', title: 'Vider la console' }, 'Vider');
    const done = h('button', { type: 'button', className: 'gi-save', title: 'Enregistrer dans le node et fermer (Échap)' }, 'Enregistrer');
    const title = h('strong');
    const host = h('div', { className: 'gi-editor' });
    const preview = h('iframe', { className: 'gi-preview', title: 'Visionneuse HTML' });
    preview.setAttribute('sandbox', 'allow-scripts');  // origine opaque : la page ne touche ni Nodz ni ses cookies
    const out = h('pre', { className: 'gi-console' });
    const status = h('span', { className: 'gi-status' });
    const box = h('section', { id: 'gardien-ide', hidden: true, role: 'dialog', ariaLabel: 'IDE' },
        h('header', {}, h('span', { className: 'gi-logo' }, '</>'), title, language, where, run, clear, done),
        h('div', { className: 'gi-main' }, host, preview), h('footer', {}, h('span', {}, 'Console'), status), out);
    document.body.append(box);

    let editor = null, node = null, output = null, previewTimer = 0;
    const print = (text, kind = 'out') => {
        out.append(h('span', { className: kind }, `${text}`.replace(/\n?$/, '\n')));
        out.scrollTop = out.scrollHeight;
        if (output && kind !== 'info') output.push(`${text}`.replace(/\n$/, ''));
    };
    const codeOf = target => target?.children[0]?.children[0]?.querySelector('code');
    const links = () => [...document.querySelectorAll('.link')];
    const ends = (link, side) => document.getElementById(link.getAttribute(side));
    // Les nodes de code en amont de `target` (même langage), du plus lointain au plus proche, chacun une fois.
    function upstream(target, lang, seen = new Set([target.id])) {
        return links().filter(l => l.getAttribute('Node2') === target.id).map(l => ends(l, 'Node1'))
            .filter(n => n && !seen.has(n.id) && codeOf(n)?.dataset.lang === lang)
            .flatMap(n => (seen.add(n.id), [...upstream(n, lang, seen), n]));
    }
    // Le programme d'un node : le code de la chaîne en amont, puis le sien.
    const program = (target, lang, own) => [...upstream(target, lang).map(n => codeOf(n).textContent), own].join('\n');
    const html = () => language.value === 'html';
    const showLanguage = () => {
        editor?.setOption('mode', MODES[language.value]);
        box.classList.toggle('html', html());
        if (html()) preview.srcdoc = editor?.getValue() || '';
    };
    // Le clic qui sélectionne un node déjà sélectionné met son texte en édition 300 ms plus tard (Nodz) : l'IDE garde la main.
    const guarded = new WeakSet();

    async function open(target) {
        node = target;
        await loadEditor();
        const code = codeOf(node);
        language.value = code?.dataset.lang || 'python';
        title.textContent = `Code · ${node.id}`;
        box.hidden = false;
        if (!editor) {
            editor = window.CodeMirror(host, { theme: 'nodz', lineNumbers: true, indentUnit: 4, tabSize: 4, matchBrackets: true,
                autoCloseBrackets: true, styleActiveLine: true, extraKeys: { 'Ctrl-Enter': execute_, 'Cmd-Enter': execute_, 'Ctrl-/': 'toggleComment', Esc: close } });
            editor.on('change', () => {
                clearTimeout(previewTimer);
                if (html()) previewTimer = setTimeout(() => { preview.srcdoc = editor.getValue(); }, PREVIEW_DELAY);
            });
        }
        editor.setValue(code ? code.textContent : '');
        showLanguage();
        editor.refresh();
        editor.focus();
        const input = node.children[0].children[0];
        if (!guarded.has(input)) {
            guarded.add(input);
            input.addEventListener('focus', () => { if (!box.hidden && node?.children[0].children[0] === input) editor.focus(); });
        }
    }

    // Le résultat montré dans le node : la page rendue (HTML) ou les dernières lignes de la console.
    function rendered(lang, source, lines) {
        if (lang === 'html') {
            const frame = document.createElement('iframe');
            frame.className = 'code-output';
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.setAttribute('srcdoc', source);
            return frame;
        }
        const pre = document.createElement('pre');
        pre.className = 'code-output';
        pre.textContent = lines.length ? lines.join('\n').split('\n').slice(-OUTPUT_LINES).join('\n') : '(aucune sortie)';
        return pre;
    }

    // Le code retourne dans le node (texte échappé sous <code>), suivi du résultat de la dernière exécution (celui
    // d'avant s'il n'y en a pas eu), et le node devient un rectangle à sa taille, puis Nodz sauve.
    function write(node, lang, source, shown) {
        if (!node?.isConnected) return;
        const code = document.createElement('code');
        code.dataset.lang = lang;
        code.textContent = source;
        const input = node.children[0].children[0];
        const kept = shown || input.querySelector('.code-output');
        input.replaceChildren(code, ...(kept ? [kept] : []));
        node.setAttribute('textcontent', input.innerHTML);
        const lines = source.split('\n');
        const below = !kept ? 0 : kept.tagName === 'IFRAME' ? 210 : kept.textContent.split('\n').length * 15.5 + 14;
        const w = Math.min(640, Math.max(kept?.tagName === 'IFRAME' ? 340 : 180, Math.max(...lines.map(l => l.length)) * 7.4 + 24));
        const hgt = Math.min(720, Math.max(60, lines.length * 15.5 + 16 + below));
        for (let i = 0; i < 3 && node.getAttribute('shape') !== 'square'; i++) {  // un rectangle, comme un bloc de code
            const previous = [...selectedNodes];
            previous.forEach(n => nodeUnselection(n));
            nodeSelection(node);
            node.tools.type.children[5].children[0].click();
            nodeUnselection(node);
            previous.forEach(n => nodeSelection(n));
        }
        node.setAttribute('ratio', (w / hgt).toFixed(4));
        nodeSizing(node, w, hgt);
        save(node);
    }

    function close() {
        const target = node;
        if (editor) write(target, language.value, editor.getValue());
        box.hidden = true;
        node = null;
        if (target) refresh(target);
    }

    // Bouton ▶ de la barre du node : le code du node (après sa chaîne en amont) tourne sans ouvrir l'IDE, son résultat
    // s'écrit dans le node, puis ses sorties en aval se recalculent.
    async function runNode(target) {
        const code = codeOf(target);
        if (!code?.textContent.trim()) return;
        const lang = code.dataset.lang || 'python';
        const lines = [];
        if (lang !== 'html') await runCode(lang, program(target, lang, code.textContent), 'browser', text => lines.push(`${text}`.replace(/\n$/, '')));
        write(target, lang, code.textContent, rendered(lang, code.textContent, lines));
        await refresh(target);
    }

    // Les sorties en aval de `start` (lui compris et les nodes de code qui le suivent) : chaque node non-code relié à un
    // node de code reçoit le résultat de la chaîne qui y mène, exécutée dans le navigateur.
    let refreshing = Promise.resolve();
    function refresh(start) {
        refreshing = refreshing.then(async () => {
            const lang = codeOf(start)?.dataset.lang;
            if (!lang || lang === 'html' || lang === 'bash') return;
            const code = [start], outputs = new Map();  // sortie → nodes de code qui l'alimentent
            for (let i = 0; i < code.length; i++) {
                links().filter(l => l.getAttribute('Node1') === code[i].id).map(l => ends(l, 'Node2')).filter(Boolean).forEach(next => {
                    if (codeOf(next)) {
                        if (codeOf(next).dataset.lang === lang && !code.includes(next)) code.push(next);
                    } else if (next.getAttribute('type') === 'text') {
                        outputs.set(next, [...(outputs.get(next) || []), code[i]]);
                    }
                });
            }
            for (const [target, sources] of outputs) {
                const lines = [];
                for (const source of sources) {
                    await runCode(lang, program(source, lang, codeOf(source).textContent), 'browser', text => lines.push(`${text}`.replace(/\n$/, '')));
                }
                const pre = rendered(lang, '', lines);
                const input = target.children[0].children[0];
                input.replaceChildren(pre);
                target.setAttribute('textcontent', input.innerHTML);
                save(target);
            }
        }).catch(error => say(`Sortie de code : ${error.message}`, 'error'));
        return refreshing;
    }

    async function execute_() {
        if (!editor || run.disabled) return;
        const code = editor.getValue();
        if (!code.trim()) return;
        run.disabled = true;
        const started = performance.now();
        const place = html() ? 'visionneuse' : where.value === 'server' ? 'serveur' : 'navigateur';
        print(`▶ ${LANGUAGES.find(([v]) => v === language.value)[1]} · ${place}`, 'info');
        output = [];
        let result = 'ok';
        if (html()) preview.srcdoc = code;
        else result = await runCode(language.value, program(node, language.value, code), where.value, print);
        status.textContent = `${result === 'ok' ? 'terminé' : result} en ${Math.round(performance.now() - started)} ms`;
        status.className = `gi-status ${result === 'ok' ? 'ok' : 'bad'}`;
        run.disabled = false;
        write(node, language.value, code, rendered(language.value, code, output));
        output = null;
        refresh(node);
        editor.focus();  // write resélectionne le node pour le mettre en rectangle : on rend la main à l'éditeur
    }

    language.addEventListener('change', showLanguage);
    run.addEventListener('click', execute_);
    clear.addEventListener('click', () => { out.replaceChildren(); status.textContent = ''; });
    done.addEventListener('click', close);
    box.addEventListener('keydown', event => event.stopPropagation());  // la saisie ne déclenche pas les raccourcis de Nodz
    // Un clic hors de la fenêtre l'enregistre et la ferme.
    document.addEventListener('pointerdown', event => { if (!box.hidden && !box.contains(event.target)) close(); }, true);
    // Un lien créé à la main depuis un node de code (pas au chargement : Nodz passe alors son id) : ses sorties se calculent.
    const nodzLink = window.createLink;
    window.createLink = function (a, b, id) {
        const link = nodzLink(a, b, id);
        if (!id && codeOf(a)) refresh(a);
        return link;
    };
    document.addEventListener('gardien-code', ({ detail }) => {
        const task = detail.action === 'run' ? runNode(detail.node) : open(detail.node);
        task.catch(error => say(`${detail.action === 'run' ? 'Exécution' : 'IDE'} : ${error.message}`, 'error'));
    });
    return { open, close };
}
