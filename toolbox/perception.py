"""Perception du Gardien : chaque node de Nodz lui arrive en un seul objet, à la manière du graphe v2.

Un objet par node, sur une ligne JSON, avec tout ce qu'il faut pour agir sans relire : type, texte (entier dans
un budget, sinon `plus` dit combien il en reste), voisins par lien, portail, auteur (`par` : "humain", "moi" pour
ce que le Gardien a créé, "message" pour un message qu'on lui a écrit), date de modification, position,
apparence. Il écrit avec le même objet (op `put`). Les valeurs restent stables d'une demande à l'autre (date du
jour et non « il y a 3 min », positions arrondies) : llama.cpp réutilise sa lecture du prompt.

Sources : la page (état vivant, nodes pas encore sauvés compris), la base v1 (fichiers, portails, dates) et les
marques d'origine (NodeMark).
"""

import html
import json
import re

from nodzapp.models import Layer, Node

from .models import NodeMark

TEXT_NODE = 400  # caractères par node du contexte
TEXT_FULL = 2000  # node sélectionné, joint ou cité : texte entier jusque-là
TEXT_TOTAL = 6000  # tous les nodes non sélectionnés ensemble ; au-delà, `plus` indique le reste
BY = {NodeMark.Origin.AI: 'moi', NodeMark.Origin.MESSAGE: 'message'}
TYPES = {'text': 'texte', 'image': 'image', 'file': 'fichier', 'canvas': 'dessin'}
DEFAULT_COLOR, DEFAULT_SHAPE = '#33FF99', 'circle'


def number(ref):
    ref = str(ref or '')
    return int(ref[2:]) if ref.startswith('N-') and ref[2:].isdigit() else None


FONT = re.compile(r'(?is)<font\b([^>]*)>((?:(?!<font\b).)*?)</font>')
SIZES = {'1': ',,', '2': ',,', '6': '^^', '7': '^^^'}


def font(match):
    """Une balise font (boutons couleur et taille de Nodz) dans la syntaxe du Gardien."""
    attrs, inner = match.group(1), match.group(2)
    color = re.search(r'color\s*=\s*["\']?(#[0-9a-fA-F]{3,6})', attrs)
    size = re.search(r'size\s*=\s*["\']?(\d)', attrs)
    if color:
        inner = f'[{color.group(1)}]{inner}[/]'
    mark = SIZES.get(size.group(1), '') if size else ''
    return f'{mark}{inner}{mark}'


def readable(markup):
    """Texte d'un node avec ses retours à la ligne, sa mise en forme dans la syntaxe du Gardien (**gras**, *italique*,
    __souligné__, [#couleur]…[/], ^^grand^^), sans autres balises."""
    text = markup or ''
    for _ in range(5):  # balises font imbriquées : de l'intérieur vers l'extérieur
        text, found = FONT.subn(font, text)
        if not found:
            break
    for tags, mark in ((('b', 'strong'), '**'), (('i', 'em'), '*'), (('u',), '__')):
        text = re.sub(rf'(?is)<({"|".join(tags)})\b[^>]*>(.*?)</\1>', lambda m, mark=mark: f'{mark}{m.group(2)}{mark}', text)
    text = re.sub(r'(?i)<br\s*/?>|</(div|p|li|h\d)>', '\n', text)
    text = html.unescape(re.sub(r'<[^>]+>', '', text))
    return '\n'.join(' '.join(line.split()) for line in text.splitlines() if line.strip())


def portals(raw, names):
    """Nodes (et leur dimension) vers lesquels un node a un portail (champ quantum de v1)."""
    try:
        items = json.loads(raw or '[]')
    except json.JSONDecodeError:
        return []
    targets = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and (item.get('node') or item.get('id')):
            target = str(item.get('node') or item.get('id'))
            target = target if target.startswith('N-') else f'N-{target}'
            layer = names.get(item.get('layer'))
            targets.append(f'{target} ({layer})' if layer else target)
    return targets


class Perception:
    def __init__(self, user):
        self.user = user
        self.names = dict(Layer.objects.filter(user=user).values_list('layer_id', 'layer_name'))

    def rows(self, ids):
        numbers = [n for n in map(number, ids) if n is not None]
        rows = {f'N-{n.node_id}': n for n in Node.objects.filter(user=self.user, archive=False, node_id__in=numbers)
                .only('node_id', 'type', 'layer', 'file_name', 'file_text_content', 'text_content', 'quantum', 'modified_at',
                      'image_content', 'x_coordinate', 'y_coordinate', 'color', 'shape')}
        marks = dict(NodeMark.objects.filter(owner=self.user, node_id__in=numbers).values_list('node_id', 'origin'))
        return rows, marks

    def objects(self, page, links, full=(), limits=None, scale=1.0):
        """Objets des nodes de la page (dans l'ordre donné), texte entier pour ceux de `full` ; `scale` réduit les
        budgets de texte quand le contexte du modèle déborde."""
        rows, marks = self.rows([n['id'] for n in page])
        neighbours = {}
        for a, b in links:
            neighbours.setdefault(a, []).append(b)
            neighbours.setdefault(b, []).append(a)
        budget, out = int(TEXT_TOTAL * scale), []
        for n in page:
            ref, row = n['id'], rows.get(n['id'])
            cap = int((limits or {}).get(ref, TEXT_FULL) * scale) if ref in full else min(int(TEXT_NODE * scale), max(budget, 0))
            obj = self.describe(ref, row, marks.get(number(ref)), page=n, cap=cap)
            if ref not in full:
                budget -= len(obj.get('texte', ''))
            obj['liens'] = sorted(set(neighbours.get(ref, [])), key=lambda r: number(r) or 0) or None
            out.append({k: v for k, v in obj.items() if v not in (None, [], '')})
        return out

    def outside(self, refs):
        """Objets de nodes cités mais absents de la page (autre dimension), depuis la base."""
        rows, marks = self.rows(refs)
        out = []
        for ref in refs:
            row = rows.get(ref)
            if row is None:
                out.append({'id': ref, 'introuvable': True})
                continue
            obj = self.describe(ref, row, marks.get(number(ref)), cap=TEXT_FULL)
            obj['dimension'] = self.names.get(row.layer.layer_id) if row.layer_id else None
            out.append({k: v for k, v in obj.items() if v not in (None, [], '')})
        return out

    def describe(self, ref, row, mark, page=None, cap=TEXT_NODE):
        page = page or {}
        kind = page.get('type') or (row.type if row else 'text')
        text = readable(page.get('text')) if page.get('text') is not None else readable(row.text_content if row else '')
        if kind == 'file' and row is not None:  # un fichier : son nom et le texte qu'on en a extrait
            text = '\n'.join(filter(None, [row.file_name or '', (row.file_text_content or '').strip()]))
        elif kind == 'image' and not text:
            text = '(image)'
        elif kind == 'canvas' and not text:
            text = '(dessin)'
        cut = max(0, len(text) - cap)
        color = page.get('color') or (row.color if row else None)
        shape = page.get('shape') or (row.shape if row else None)
        x, y = page.get('x', row.x_coordinate if row else 0), page.get('y', row.y_coordinate if row else 0)
        return {
            'id': ref,
            'type': TYPES.get(kind, kind) if kind != 'text' else None,  # texte par défaut
            'texte': (text[:cap] + ('…' if cut else '')) or '(vide)',
            'plus': cut or None,  # caractères non montrés : read_file pour tout lire
            'par': BY.get(mark, 'humain'),
            'modifié': row.modified_at.strftime('%d/%m') if row else 'non sauvé',
            'pos': [round(x or 0), round(y or 0)],
            'couleur': color if color and color != DEFAULT_COLOR else None,
            'forme': shape if shape and shape != DEFAULT_SHAPE else None,
            'verrou': True if page.get('lock') else None,
            'portail': portals(row.quantum, self.names) if row else None,
        }


def lines(objects):
    return [json.dumps(o, ensure_ascii=False, separators=(', ', ': ')) for o in objects]
