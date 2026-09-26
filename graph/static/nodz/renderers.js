// Un renderer par type de contenu : mount(node, api) → élément HTML, update(el, node).
// Seul le type actif d'un node est monté ; les autres états restent dans node.payload.

const html = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);

export const renderers = {
    text: {
        mount(node, { dispatch }) {
            const editor = html('div', { className: 'node-text', contentEditable: 'true', spellcheck: false });
            editor.node = node;
            editor.innerHTML = node.payload.text?.html || '';
            editor.addEventListener('blur', () => {
                const current = editor.node;
                if (editor.innerHTML !== (current.payload.text?.html || '')) dispatch('update_node', { id: current.id, text: editor.innerHTML });
            });
            editor.addEventListener('keydown', event => {
                if (event.key === 'Escape') editor.blur();
                event.stopPropagation();  // la saisie ne déclenche pas les raccourcis de l'univers
            });
            return editor;
        },
        update(editor, node) {
            editor.node = node;
            if (document.activeElement !== editor) editor.innerHTML = node.payload.text?.html || '';
        },
    },
    // Types dont le renderer arrive dans une prochaine étape (image, fichier, vidéo, audio, 3D, code).
    fallback: {
        mount(node) {
            return html('div', { className: 'node-placeholder', textContent: node.content_type });
        },
        update(el, node) {
            el.textContent = node.content_type;
        },
    },
};
