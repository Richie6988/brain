"""Gabarits que le Gardien construit avec des nodes : matrice, kanban, frise, pyramide, arbre, liste, et la
structure organique d'un raisonnement (organic : un plan libre qui pousse en étoile autour de son idée).

Un gabarit est une liste de nodes (clé, position relative, texte, rôle) et de liens entre clés, en
coordonnées de Nodz (y vers le haut) ; le Gardien le pose dans un coin libre de la dimension. Aucun lien
parfaitement horizontal ou vertical : le dégradé d'un lien de Nodz ne s'y affiche pas. Les modèles connus de
la galerie (SWOT, Eisenhower, Ishikawa…) se posent avec l'op schema : la page les construit (schemas.js).
"""

import math
import re
import zlib

LAYOUTS = ['matrix', 'kanban', 'timeline', 'pyramid', 'tree', 'list']
# Modèles de la galerie (clés de toolbox/static/gardien/schemas.js), faits de nodes et de liens.
SCHEMAS = ['decision', 'family', 'organic', 'org', 'why', 'swot', 'eisenhower', 'bcg', 'ansoff', 'tows', 'm3x3', 'bmc',
           'porter', 'pestel', 'ikigai', 'smart', 'pdca', 'process', 'timeline', 'kanban', 'design', 'aida', 'maslow', 'ishikawa']
SCHEMA_SPAN = 700  # place réservée autour d'un modèle posé
STEP = 300  # entre deux centres de nodes (rayon 85, marge comprise)
MAX_NODES = 60
MAX_ORGANIC = 80  # un raisonnement développé peut compter plus d'idées qu'un gabarit


class LayoutError(ValueError):
    pass


def _texts(values, limit=MAX_NODES):
    return [str(v).strip() for v in values or [] if str(v).strip()][:limit]


def _node(key, x, y, text, role):
    return {'key': key, 'x': round(x), 'y': round(y), 'text': text, 'role': role}


def matrix(title, rows, cols, cells):
    """Titre dans le coin, en-têtes de colonnes en haut, de lignes à gauche, une case par croisement."""
    if not rows or not cols:
        raise LayoutError('une matrice demande des lignes (rows) et des colonnes (cols)')
    nodes = [_node('t', 0, 0, title, 'title')] if title else []
    nodes += [_node(f'c{j + 1}', (j + 1) * STEP, 0, c, 'header') for j, c in enumerate(cols)]
    nodes += [_node(f'r{i + 1}', 0, -(i + 1) * STEP, r, 'header') for i, r in enumerate(rows)]
    for i in range(len(rows)):
        for j in range(len(cols)):
            text = cells[i][j] if i < len(cells) and j < len(cells[i]) else ''
            nodes.append(_node(f'r{i + 1}c{j + 1}', (j + 1) * STEP, -(i + 1) * STEP, str(text), 'cell'))
    return nodes, []


def kanban(title, cols, cells):
    """Une colonne par étape, ses cartes empilées dessous."""
    if not cols:
        raise LayoutError('un kanban demande des colonnes (cols)')
    width = STEP * 1.25
    nodes = [_node('t', (len(cols) - 1) * width / 2, STEP * 0.9, title, 'title')] if title else []
    for j, col in enumerate(cols):
        nodes.append(_node(f'c{j + 1}', j * width, 0, col, 'header'))
        for k, card in enumerate(_texts(cells[j] if j < len(cells) else [], 12)):
            nodes.append(_node(f'c{j + 1}.{k + 1}', j * width, -(k + 1) * STEP * 0.85, card, 'cell'))
    return nodes, []


def timeline(title, items):
    """Étapes de gauche à droite, en zigzag, reliées dans l'ordre."""
    if not items:
        raise LayoutError('une frise demande des étapes (items)')
    nodes = [_node(f'i{k + 1}', k * STEP, 70 if k % 2 else -70, text, 'item') for k, text in enumerate(items)]
    links = [(f'i{k}', f'i{k + 1}') for k in range(1, len(items))]
    if title:
        nodes.insert(0, _node('t', -STEP, 160, title, 'title'))
        links.insert(0, ('t', 'i1'))
    return nodes, links


def pyramid(title, items):
    """Du sommet (premier élément) à la base, un étage par élément, chacun relié au suivant."""
    if not items:
        raise LayoutError('une pyramide demande des étages (items)')
    nodes = [_node(f'i{k + 1}', 45 if k % 2 else -45, -k * STEP * 0.8, text, 'item') for k, text in enumerate(items)]
    links = [(f'i{k}', f'i{k + 1}') for k in range(1, len(items))]
    if title:
        nodes.insert(0, _node('t', STEP * 1.1, STEP * 0.5, title, 'title'))
        links.insert(0, ('t', 'i1'))
    return nodes, links


def tree(title, items):
    """Arbre écrit en lignes indentées (2 espaces ou un « - » par niveau) ; racine en haut, feuilles en bas."""
    parsed = []
    for line in items:  # niveau : 2 espaces d'indentation ; une puce « - » ou « * » en tête est ignorée
        raw = str(line).replace('\t', '  ').rstrip()
        text = raw.strip().lstrip('-*• ').strip()
        if text:
            parsed.append(((len(raw) - len(raw.lstrip(' '))) // 2, text))
    if not parsed:
        raise LayoutError('un arbre demande des lignes (items)')
    shift = 0 if title else 1  # sans titre, les éléments de premier niveau sont les racines
    parents, entries = {}, []
    for index, (depth, text) in enumerate(parsed):
        level = depth + 1 - shift
        parent = next((entries[j][0] for j in range(index - 1, -1, -1) if entries[j][1] < level), 't' if title and level > 0 else None)
        key = f'i{index + 1}'
        entries.append((key, level, text))
        parents[key] = parent
    children = {}
    for key, _, _ in entries:
        children.setdefault(parents[key], []).append(key)
    level_of = {key: level for key, level, _ in entries}
    xs, slot = {}, [0]

    def place(key):  # feuilles de gauche à droite, parent au milieu de ses enfants
        kids = children.get(key, [])
        for kid in kids:
            place(kid)
        if kids:
            xs[key] = sum(xs[k] for k in kids) / len(kids)
        else:
            xs[key] = slot[0] * STEP
            slot[0] += 1
    roots = children.get('t' if title else None, [])
    for root in roots:
        place(root)
    nodes = [_node(key, xs[key], -level * STEP, text, 'item') for key, level, text in entries]
    links = [(parents[key], key) for key, _, _ in entries if parents[key]]
    if title:
        nodes.insert(0, _node('t', sum(xs[r] for r in roots) / len(roots) if roots else 0, 0, title, 'title'))
    by_key = {n['key']: n for n in nodes}
    for a, b in links:  # un enfant pile sous son parent : léger décalage pour garder le dégradé du lien
        if by_key[a]['x'] == by_key[b]['x']:
            by_key[b]['x'] += 50
    return nodes, links


def listing(title, items):
    """Éléments en colonne, légèrement décalés, chacun relié au titre."""
    if not items:
        raise LayoutError('une liste demande des éléments (items)')
    nodes = [_node(f'i{k + 1}', STEP + (40 if k % 2 else -40), -k * STEP * 0.8, text, 'item') for k, text in enumerate(items)]
    links = []
    if title:
        nodes.insert(0, _node('t', 0, STEP * 0.6, title, 'title'))
        links = [('t', f'i{k + 1}') for k in range(len(items))]
    return nodes, links


def outline(text):
    """Plan libre en (profondeur, texte) : une idée par ligne ; la profondeur vient de l'indentation (2 espaces ou une
    tabulation), des puces (-, *, •, 1.) ou des titres (#, ##). La première ligne est la racine (profondeur 0)."""
    items = []
    for raw in str(text or '').replace('\t', '  ').splitlines():
        body = raw.strip()
        if not body:
            continue
        indent = (len(raw) - len(raw.lstrip(' '))) // 2
        heading = re.match(r'(#{1,6})\s+(.*)', body)
        bullet = re.match(r'(?:[-*•+]|\d+[.)])\s+(.*)', body)
        if heading:
            depth, body = len(heading[1]) - 1, heading[2]
        elif bullet:
            depth, body = indent + 1, bullet[1]
        else:
            depth = indent
        items.append((0 if not items else max(1, depth), body.strip()[:300]))
    return [item for item in items if item[1]][:MAX_ORGANIC]


def organic(text):
    """Un raisonnement en étoile : l'idée au centre, chaque branche sur une part d'angle proportionnelle à ses feuilles,
    un anneau par profondeur, élargi pour que les nodes ne se touchent pas ; un léger désordre fixe (tiré du texte)
    rend la forme vivante, et aucun lien n'est pile horizontal ou vertical (dégradé des liens de Nodz)."""
    items = outline(text)
    if not items:
        raise LayoutError('une structure organique demande un plan (une idée par ligne, indentée)')
    parents, stack = [None], [0]  # stack : indices des ancêtres de la ligne courante
    for index, (depth, _) in enumerate(items[1:], 1):
        while len(stack) > 1 and items[stack[-1]][0] >= depth:
            stack.pop()
        parents.append(stack[-1])
        stack.append(index)
    children = {}
    for index, parent in enumerate(parents):
        if parent is not None:
            children.setdefault(parent, []).append(index)
    level = [0] * len(items)
    for index in range(1, len(items)):
        level[index] = level[parents[index]] + 1
    leaves = [0] * len(items)
    for index in range(len(items) - 1, -1, -1):
        leaves[index] = sum(leaves[k] for k in children.get(index, [])) or 1
    angles, spans = {0: 0.0}, {0: (0.0, 2 * math.pi)}

    def spread(index):
        start, end = spans[index]
        kids = children.get(index, [])
        total, width = sum(leaves[k] for k in kids), end - start
        for kid in kids:
            share = width * leaves[kid] / total
            spans[kid] = (start, start + share)
            angles[kid] = start + share / 2
            start += share
            spread(kid)
    spread(0)
    rings, radius = [0.0], 0.0
    for d in range(1, max(level) + 1):  # anneau assez grand pour que sa part d'angle la plus étroite fasse STEP
        narrowest = min(spans[i][1] - spans[i][0] for i in range(len(items)) if level[i] == d)
        radius = max(radius + STEP * 1.1, STEP * 1.15 / narrowest)
        rings.append(radius)
    nodes, links = [], []
    for index, (_, body) in enumerate(items):
        noise = zlib.crc32(body.encode()) % 1000 / 1000 - 0.5  # même texte, même place
        angle = angles[index] + noise * 0.12
        if index and abs(math.sin(2 * angle)) < 0.05:  # lien horizontal ou vertical : on l'incline un peu
            angle += 0.08
        r = rings[level[index]] * (1 + noise * 0.1)
        key = 't' if index == 0 else f'n{index}'
        branch = index
        while branch and parents[branch]:
            branch = parents[branch]
        nodes.append({**_node(key, r * math.cos(angle), r * math.sin(angle), body, 'title' if index == 0 else 'item'),
                      'depth': level[index], 'branch': children.get(0, []).index(branch) if index else 0})  # rang de la branche
        if index:
            links.append(('t' if parents[index] == 0 else f'n{parents[index]}', key))
    return nodes, links


def build(layout, title='', rows=(), cols=(), cells=(), items=()):
    """Nodes (positions relatives) et liens d'un gabarit ; LayoutError si la description ne suffit pas."""
    title = str(title or '').strip()
    rows, cols = _texts(rows, 12), _texts(cols, 12)
    cells = [list(r) if isinstance(r, (list, tuple)) else [r] for r in cells or []]
    items = [str(i) for i in items or [] if str(i).strip()][:MAX_NODES]
    if layout == 'matrix':
        result = matrix(title, rows, cols, cells)
    elif layout == 'kanban':
        result = kanban(title, cols, cells)
    elif layout == 'timeline':
        result = timeline(title, items)
    elif layout == 'pyramid':
        result = pyramid(title, items)
    elif layout == 'tree':
        result = tree(title, items)
    elif layout == 'list':
        result = listing(title, items)
    else:
        raise LayoutError(f"gabarit inconnu : {layout!r} ({', '.join(LAYOUTS)})")
    if len(result[0]) > MAX_NODES:
        raise LayoutError(f'gabarit trop grand ({len(result[0])} nodes, {MAX_NODES} au plus)')
    return result
