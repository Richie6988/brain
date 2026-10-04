"""Rappels de Nodz : une date posée sur un node (champ `notification`, « jj-mm-aaaa hh:mm », heure locale de
l'humain, comme le calendrier de Nodz l'écrit). Listés pour toutes les dimensions (le chargement de Nodz ne donne que
ceux à moins d'une semaine), posés, déplacés ou retirés par la page ou par le Gardien.
"""

import html
import re
from datetime import datetime

from nodzapp.models import Node

FORMAT = '%d-%m-%Y %H:%M'  # celui du calendrier de Nodz
READ = (FORMAT, '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M', '%Y-%m-%dT%H:%M:%S', '%d/%m/%Y %H:%M', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y')


class ReminderError(ValueError):
    pass


def parse(text):
    """Une date de rappel lue sous les formes courantes (ISO, française, avec ou sans heure : 9 h par défaut)."""
    text = ' '.join(str(text or '').split())
    text = re.sub(r'(\d{1,2})\s*h\s*(\d{0,2})$', lambda m: f"{m[1]}:{m[2] or '00'}", text)  # « 9h », « 14 h 30 »
    for fmt in READ:
        try:
            when = datetime.strptime(text, fmt)
        except ValueError:
            continue
        return when.replace(hour=9) if '%H' not in fmt else when
    raise ReminderError(f'date illisible : {text!r} (attendu AAAA-MM-JJ HH:MM)')


def stored(text):
    """La date d'un node, ou None (vide ou illisible : un vieux rappel abîmé ne casse pas la liste)."""
    try:
        return datetime.strptime(text, FORMAT) if text else None
    except ValueError:
        return None


def plain(markup, limit=80):
    text = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', markup or '')).split())
    return text[:limit - 1] + '…' if len(text) > limit else text


def listing(user):
    """Tous les rappels de l'humain, du plus proche au plus lointain : [{id, layer, dimension, at, text}]."""
    items = []
    for node in Node.objects.filter(user=user, archive=False).exclude(notification='').exclude(notification__isnull=True).select_related('layer'):
        when = stored(node.notification)
        if when:
            items.append({'id': f'N-{node.node_id}', 'layer': node.layer.layer_id, 'dimension': node.layer.layer_name or str(node.layer.layer_id),
                          'at': when.strftime('%Y-%m-%dT%H:%M'), 'text': plain(node.text_content) or node.file_name or '(node vide)'})
    return sorted(items, key=lambda r: r['at'])


def put(user, ref, when):
    """Pose (when : datetime) ou retire (None) le rappel d'un node en base ; rend la valeur écrite."""
    number = str(ref or '').removeprefix('N-')
    if not number.isdigit():
        raise ReminderError(f'node inconnu : {ref!r}')
    value = when.strftime(FORMAT) if when else ''
    if not Node.objects.filter(user=user, archive=False, node_id=int(number)).update(notification=value):
        raise ReminderError(f'node introuvable : {ref}')
    return value
