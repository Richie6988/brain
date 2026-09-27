"""Lecture de l'en-tête d'un fichier GGUF : architecture, nombre de couches, contexte d'entraînement.

Seules les métadonnées sont lues (jamais les poids) et la lecture s'arrête dès que les clés
utiles sont trouvées ; le résultat est gardé en mémoire tant que le fichier ne change pas.
"""

import struct
from pathlib import Path

SCALARS = {0: '<B', 1: '<b', 2: '<H', 3: '<h', 4: '<I', 5: '<i', 6: '<f', 7: '<?', 10: '<Q', 11: '<q', 12: '<d'}
STRING, ARRAY = 8, 9
_cache = {}


def _read(f, fmt):
    size = struct.calcsize(fmt)
    data = f.read(size)
    if len(data) != size:
        raise ValueError('fichier tronqué')
    return struct.unpack(fmt, data)[0]


def _string(f):
    return f.read(_read(f, '<Q')).decode('utf-8', 'replace')


def _value(f, kind):
    if kind in SCALARS:
        return _read(f, SCALARS[kind])
    if kind == STRING:
        return _string(f)
    if kind == ARRAY:
        inner, count = _read(f, '<I'), _read(f, '<Q')
        if inner in SCALARS:  # tableau de nombres : sauté d'un bloc
            f.seek(struct.calcsize(SCALARS[inner]) * count, 1)
        else:
            for _ in range(count):
                _value(f, inner)
        return None
    raise ValueError(f'type GGUF inconnu : {kind}')


def info(path):
    """{architecture, layers, context_length, embedding, heads, kv_heads} ou {} si le fichier n'est pas lisible."""
    try:
        stat = Path(path).stat()
    except (OSError, TypeError):
        return {}
    key = (str(path), stat.st_mtime, stat.st_size)
    if key not in _cache:
        _cache[key] = _parse(path)
    return _cache[key]


def _parse(path):
    found = {}
    try:
        with open(path, 'rb') as f:
            if f.read(4) != b'GGUF':
                return {}
            version = _read(f, '<I')
            _read(f, '<Q' if version >= 2 else '<I')  # nombre de tenseurs
            count = _read(f, '<Q' if version >= 2 else '<I')
            for _ in range(count):
                name, kind = _string(f), _read(f, '<I')
                value = _value(f, kind)
                if name == 'general.architecture':
                    found['architecture'] = value
                elif name.endswith('.block_count'):
                    found['layers'] = int(value)
                elif name.endswith('.context_length'):
                    found['context_length'] = int(value)
                elif name.endswith('.embedding_length'):
                    found['embedding'] = int(value)
                elif name.endswith('.attention.head_count'):
                    found['heads'] = int(value) if isinstance(value, int) else None
                elif name.endswith('.attention.head_count_kv'):
                    found['kv_heads'] = int(value) if isinstance(value, int) else None
                if name.startswith('tokenizer.') and 'layers' in found:
                    break  # les métadonnées du modèle précèdent celles du tokenizer (tableaux lourds)
    except (OSError, ValueError, struct.error):
        pass
    return found
