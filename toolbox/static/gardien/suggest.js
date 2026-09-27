// Le Gardien propose sans agir : pendant une pause de l'humain (une minute sans geste), il fait le tour de la
// dimension ouverte (nodes vides, nodes sans lien, textes en double) et, s'il trouve quelque chose, le propose dans
// le chat avec des choix. Il ne modifie rien : un choix part au Gardien comme un message (la proposition, avec les
// identifiants, est dans les échanges récents) ; « Plus tard » reste ici. Une même trouvaille n'est proposée qu'une fois.

const IDLE_MS = 60_000;
export const LATER = 'Plus tard';

const textOf = node => (node.children[0]?.children[0]?.innerText || '').trim();
const linksOf = node => {
    try {
        return JSON.parse(node.getAttribute('links') || '[]');
    } catch {
        return [];
    }
};
const list = ids => ids.slice(0, 8).join(', ') + (ids.length > 8 ? '…' : '');

// Ce qui mérite d'être rangé dans la dimension ouverte.
export function survey() {
    const nodes = [...document.querySelectorAll('.node-group')];
    const empty = nodes.filter(n => (n.getAttribute('type') || 'text') === 'text' && !textOf(n)).map(n => n.id);
    const alone = nodes.length >= 3 ? nodes.filter(n => textOf(n) && !linksOf(n).length).map(n => n.id) : [];
    const byText = {};
    nodes.forEach(n => {
        const key = textOf(n).toLowerCase().replace(/\s+/g, ' ');
        if (key) (byText[key] = byText[key] || []).push(n.id);
    });
    const twins = Object.entries(byText).filter(([, ids]) => ids.length > 1);
    return { empty, alone, twins };
}

export function createSuggestions({ chat, busy }) {
    let last = Date.now();
    const proposed = new Set();  // trouvailles déjà proposées (pour cette page)
    ['pointermove', 'keydown', 'wheel', 'pointerdown'].forEach(type => document.addEventListener(type, () => { last = Date.now(); }, true));

    setInterval(() => {
        if (Date.now() - last < IDLE_MS || busy() || typeof isLoading === 'undefined' || isLoading || (typeof admin !== 'undefined' && admin)) return;
        if (!document.body.classList.contains('gardien-ready') || !document.getElementById('gardien-tour')?.hidden) return;
        const { empty, alone, twins } = survey();
        const key = `${layerNumber}|${empty}|${alone}|${twins.map(([, ids]) => ids)}`;
        if ((!empty.length && !alone.length && !twins.length) || proposed.has(key)) return;
        proposed.add(key);
        const name = layers.find(l => l.id === layerNumber)?.name || 'cette dimension';
        const lines = [
            empty.length && `- ${empty.length} node${empty.length > 1 ? 's' : ''} vide${empty.length > 1 ? 's' : ''} : ${list(empty)}`,
            ...twins.slice(0, 3).map(([, ids]) => `- « ${textOf(document.getElementById(ids[0])).slice(0, 40)} » en ${ids.length} exemplaires : ${list(ids)}`),
            alone.length && `- ${alone.length} node${alone.length > 1 ? 's' : ''} sans lien : ${list(alone)}`,
        ].filter(Boolean);
        const choices = [empty.length && 'Supprime les nodes vides', twins.length && 'Fusionne les doublons', alone.length && 'Relie les nodes isolés', LATER].filter(Boolean);
        chat.add('guardian', `Pendant ta pause, j'ai fait le tour de « ${name} » :\n${lines.join('\n')}\nJe m'en occupe ?`, 'proposition', choices);
    }, 10_000);
}
