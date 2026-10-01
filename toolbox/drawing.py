"""Dessins de l'Illustrateur sans modèle d'image : un modèle de texte dessine.

Vectoriel : il écrit un SVG, nettoyé ici par liste blanche (éléments de dessin seulement, ni script, ni objet étranger,
ni attribut d'événement, ni lien hors du document) puis posé comme image. Croquis : il rend des traits en JSON, convertis
en opérations du canvas de Nodz (type path / circle, 750 × 750 px), que la page trace sous les yeux.
"""

import re
import uuid
import xml.etree.ElementTree as ET

from . import imaging

SVG_NS = 'http://www.w3.org/2000/svg'
TAGS = {'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient',
        'radialgradient', 'stop', 'text', 'tspan', 'title'}
ATTRS = {'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
         'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
         'fill-opacity', 'stroke-opacity', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
         'gradienttransform', 'fx', 'fy', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'fill-rule',
         'preserveaspectratio'}
CASE = {'viewbox': 'viewBox', 'gradientunits': 'gradientUnits', 'gradienttransform': 'gradientTransform',
        'preserveaspectratio': 'preserveAspectRatio'}  # le SVG distingue majuscules et minuscules
URL = re.compile(r'url\(\s*([^)]*)\)', re.I)
CANVAS = 750  # côté du canvas d'un node de Nodz
MAX_BYTES = 200_000


class DrawingError(Exception):
    pass


def _clean_value(name, value):
    """Une valeur d'attribut sûre, ou None : url() seulement vers un dégradé du document (#id)."""
    value = str(value)
    if any(not ref.strip(' \'"').startswith('#') for ref in URL.findall(value)):
        return None
    if re.search(r'javascript:|expression\(|@import', value, re.I):
        return None
    return value[:4000]


def sanitize_svg(text):
    """Le premier <svg> du texte, réduit aux éléments et attributs de dessin ; DrawingError s'il n'y en a pas."""
    match = re.search(r'<svg\b.*?</svg>', text or '', re.S | re.I)
    if not match or len(match.group(0)) > MAX_BYTES:
        raise DrawingError('aucun dessin SVG lisible dans la réponse')
    try:
        root = ET.fromstring(match.group(0))
    except ET.ParseError as e:
        raise DrawingError(f'SVG mal formé : {e}') from None

    def local(tag):
        return tag.rsplit('}', 1)[-1].lower()

    def clean(element):
        for child in list(element):
            if not isinstance(child.tag, str) or local(child.tag) not in TAGS:
                element.remove(child)
            else:
                clean(child)
        for name in list(element.attrib):
            key = local(name)
            value = _clean_value(key, element.attrib[name]) if key in ATTRS else None
            del element.attrib[name]
            if value is not None:
                element.set(CASE.get(key, key), value)

    if local(root.tag) != 'svg':
        raise DrawingError('le dessin doit être un <svg>')
    clean(root)
    if 'viewBox' not in root.attrib:
        root.set('viewBox', '0 0 400 400')
    ET.register_namespace('', SVG_NS)
    body = ET.tostring(root, encoding='unicode')
    if 'xmlns=' not in body.split('>', 1)[0]:
        body = body.replace('<svg', f'<svg xmlns="{SVG_NS}"', 1)
    return body


def save_svg(user, svg):
    """Enregistre le SVG nettoyé avec les images de l'utilisateur ; rend son nom."""
    name = f'{uuid.uuid4().hex}.svg'
    (imaging.output_dir(user) / name).write_text(svg, encoding='utf-8')
    return name


SKETCH_SCHEMA = {
    'type': 'object', 'required': ['strokes'],
    'properties': {
        'strokes': {'type': 'array', 'items': {'type': 'object', 'required': ['points'], 'properties': {
            'color': {'type': 'string'}, 'width': {'type': 'number'},
            'points': {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'number'}}}}}},
        'circles': {'type': 'array', 'items': {'type': 'object', 'required': ['x', 'y', 'r'], 'properties': {
            'color': {'type': 'string'}, 'width': {'type': 'number'}, 'x': {'type': 'number'}, 'y': {'type': 'number'},
            'r': {'type': 'number'}}}},
    },
}
COLOR = re.compile(r'^#[0-9a-fA-F]{3,8}$')


def sketch_operations(data):
    """Traits et cercles du modèle → opérations du canvas de Nodz, bornées au canvas ; DrawingError si rien."""
    clamp = lambda v: max(0.0, min(float(CANVAS), float(v)))
    color = lambda c: c if isinstance(c, str) and COLOR.match(c) else '#ffffff'
    width = lambda w: max(1.0, min(24.0, float(w))) if isinstance(w, (int, float)) else 4.0
    ops = []
    for stroke in (data or {}).get('strokes') or []:
        points = [p for p in stroke.get('points') or [] if isinstance(p, list) and len(p) == 2
                  and all(isinstance(v, (int, float)) for v in p)][:400]
        if len(points) >= 2:
            ops.append({'type': 'path', 'color': color(stroke.get('color')), 'lineWidth': width(stroke.get('width')),
                        'points': [{'x': clamp(x), 'y': clamp(y)} for x, y in points]})
    for c in (data or {}).get('circles') or []:
        if all(isinstance(c.get(k), (int, float)) for k in ('x', 'y', 'r')):
            ops.append({'type': 'circle', 'color': color(c.get('color')), 'lineWidth': width(c.get('width')),
                        'center': [{'x': clamp(c['x']), 'y': clamp(c['y'])}], 'radius': max(1.0, min(CANVAS / 2, float(c['r'])))})
    if not ops:
        raise DrawingError('aucun trait dans le croquis')
    return ops[:300]
