"""La dimension « Gardien » : la maison du Gardien, posée d'office dans l'univers, où il trouve toutes ses clés et où
l'humain le règle en réécrivant des nodes. Une racine et huit groupes (un node rectangle par groupe) ; tout node relié
sous un groupe, de proche en proche, en fait partie (le lien peut aller dans un sens ou dans l'autre ; la chaîne
s'arrête aux autres groupes et à la racine) :
- Âme : son caractère et ses consignes (relues comme ses consignes personnalisées) ;
- Identité : son nom, sa façon d'être ;
- Utilisateur : ce qu'il sait de l'humain ;
- Mémoire : ses souvenirs, un par ligne ; un rêve relié à Mémoire devient un souvenir ;
- Compétences : des savoir-faire écrits par l'humain (« quand… fais… ») ;
- Outils : un node par outil et son mode d'emploi ; supprimer le node coupe l'outil ;
- Rêves : ce qu'il propose après une période calme (souvenirs, idées), en attente d'être gardé ou supprimé ;
- Échanges : ses notes et les réponses de l'humain.
Les nodes de la page sont la seule source : le serveur relit la dimension à chaque demande.
"""

import json
import re
import time
from collections import defaultdict

from nodzapp.models import Layer, Link, Node

GROUPS = [
    ('soul', 'Âme', 'Mon caractère et mes consignes. Réécris ce node, ou ajoute-en un relié ici : je le suis.'),
    ('identity', 'Identité', 'Qui je suis pour toi : mon nom, ma façon de parler.'),
    ('user', 'Utilisateur', 'Ce que je sais de toi. Écris-y ton nom, ton métier, tes projets, tes préférences.'),
    ('memory', 'Mémoire', 'Mes souvenirs, un par ligne. Relie un rêve ici pour qu\'il devienne un souvenir.'),
    ('skills', 'Compétences', 'Mes savoir-faire : un node par compétence (« quand… fais… »).'),
    ('tools', 'Outils', 'Un node par outil et son mode d\'emploi ; supprime un node pour me couper l\'outil.'),
    ('dreams', 'Rêves', 'Ce que je remâche quand tu ne me demandes rien. Relie un rêve à Mémoire pour le garder, supprime-le sinon.'),
    ('exchanges', 'Échanges', 'Mes notes pour toi. Réponds dans un node relié à la note.'),
]
KEYS = [key for key, _, _ in GROUPS]
READ = ('soul', 'identity', 'user', 'skills')  # groupes dont le texte entre dans le prompt du Gardien

SOUL = ('Je suis le Gardien de ton univers. Je pense avec toi en nodes, clairement et sans détour. '
        'Je fais ce que tu demandes, rien de plus ; je demande quand c\'est ambigu.')
IDENTITY = 'Nom : Gardien\nTon : chaleureux, précis, tutoiement'
USER = 'Écris ici qui tu es : prénom, métier, projets en cours, ce que tu attends de moi.'
SKILL = ('Compte rendu : quand je te donne des notes de réunion, fais un arbre Décisions, Actions (qui, quand), '
         'Questions ouvertes.')

DREAMS = 12  # rêves gardés en attente
DREAM_TEXT = 200
DREAM_KINDS = ('souvenir', 'idée')
DREAM_SCHEMA = {
    'type': 'object', 'required': ['dreams'],
    'properties': {'dreams': {'type': 'array', 'maxItems': 5, 'items': {
        'type': 'object', 'required': ['kind', 'text'],
        'properties': {'kind': {'type': 'string', 'enum': list(DREAM_KINDS)}, 'text': {'type': 'string'}}}}},
}
DREAM_PROMPT = """Tu es le Gardien d'un univers de nodes, et tu rêves : personne ne te demande rien. Relis les derniers échanges
et ce que tu sais déjà. Propose au plus 5 rêves, courts (une phrase) :
- souvenir : un fait durable sur l'humain ou son travail, qui servira plus tard (pas ce que tu sais déjà) ;
- idée : un lien entre ses sujets, une piste qu'il n'a pas vue, une question à creuser.
Rien d'inventé : seulement ce que les échanges montrent. Aucun rêve si rien ne vaut la peine.
Réponds en JSON : {"dreams": [{"kind": "souvenir", "text": "..."}]}"""


def mapping(guardian):
    """La maison posée ({layer, root, groups: {clé: N-3}, memory, brain, tools: {op: N-40}}), ou None."""
    home = (guardian.brain or {}).get('home') if guardian else None
    return home if home and home.get('groups') else None


def _text(node):
    from .guardian import multiline

    return multiline(node.text_content)


def read(user, guardian):
    """Ce que la maison dit au Gardien : {texts: {groupe: [textes]}, memory: [souvenirs], tools: {op: texte ou None}},
    ou None si elle n'est pas posée (ou si sa dimension a disparu)."""
    from .guardian import memory_lines

    home = mapping(guardian)
    if not home:
        return None
    layer = Layer.objects.filter(user=user, layer_id=home.get('layer')).first()
    if layer is None:
        return None
    nodes = {f'N-{n.node_id}': n for n in Node.objects.filter(user=user, layer=layer, archive=False).order_by('node_id')}
    around = defaultdict(set)
    for a, b in Link.objects.filter(user=user, layer=layer, archive=False).values_list('linkA', 'linkB'):
        if a in nodes and b in nodes:
            around[a].add(b)
            around[b].add(a)
    hubs = {key: ref for key, ref in home['groups'].items() if ref in nodes}
    walls = set(hubs.values()) | {home.get('root')}
    groups = {}
    for key, hub in hubs.items():
        seen, queue = {hub}, [hub]
        while queue:
            for nxt in sorted(around[queue.pop(0)], key=lambda r: int(r[2:])):
                if nxt not in seen and nxt not in walls:
                    seen.add(nxt)
                    queue.append(nxt)
        groups[key] = sorted(seen - {hub}, key=lambda r: int(r[2:]))
    brain = home.get('brain')
    texts = {key: [t for t in (_text(nodes[r]) for r in groups.get(key, []) if r != brain) if t] for key in READ}
    facts = []
    for ref in groups.get('memory', []):
        facts += [f for f in memory_lines(_text(nodes[ref])) if f not in facts]
    tools = {op: (_text(nodes[ref]) if ref in nodes else None) for op, ref in (home.get('tools') or {}).items()}
    return {'texts': texts, 'memory': facts, 'tools': tools, 'groups': {k: hubs.get(k) for k in KEYS}}


def profile(state):
    """Le bloc du prompt système tiré de la maison : identité, ce qu'il sait de l'humain, ses compétences."""
    if not state:
        return ''
    texts = state['texts']
    parts = []
    if texts.get('identity'):
        parts.append('Ton identité :\n' + '\n'.join(texts['identity']))
    if texts.get('user'):
        parts.append('Ce que tu sais de l\'humain :\n' + '\n'.join(texts['user']))
    if texts.get('skills'):
        parts.append('Tes compétences (à suivre quand la demande s\'y prête) :\n' + '\n'.join(f'- {s}' for s in texts['skills']))
    return '\n'.join(parts)


def soul(state):
    """Consignes de l'âme (tous ses nodes), '' si aucune."""
    return '\n\n'.join(state['texts'].get('soul') or []) if state else ''


# --- rêves

def dream_items(raw, known):
    """Rêves lisibles d'une réponse du modèle, sans ceux déjà sus (mémoire, rêves en attente)."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        match = re.search(r'\{.*\}', raw or '', re.S)
        try:
            data = json.loads(match.group(0)) if match else {}
        except json.JSONDecodeError:
            data = {}
    lowered = {k.lower() for k in known}
    items = []
    for item in (data.get('dreams') or [])[:5] if isinstance(data, dict) else []:
        if not isinstance(item, dict):
            continue
        text = ' '.join(str(item.get('text') or '').split())[:DREAM_TEXT]
        kind = item.get('kind') if item.get('kind') in DREAM_KINDS else 'idée'
        if text and text.lower() not in lowered:
            lowered.add(text.lower())
            items.append({'kind': kind, 'text': text})
    return items


def keep_dreams(guardian, items):
    """Ajoute des rêves en attente (les plus anciens non posés tombent au-delà de DREAMS)."""
    dreams = list((guardian.brain or {}).get('dreams') or [])
    next_id = max((d['id'] for d in dreams), default=0) + 1
    stamp = time.strftime('%d/%m %H:%M')
    dreams += [{'id': next_id + i, 'at': stamp, **item} for i, item in enumerate(items)]
    guardian.brain = {**(guardian.brain or {}), 'dreams': dreams[-DREAMS:], 'dreamt': time.time()}
    guardian.save(update_fields=['brain'])
    return dreams[-DREAMS:]
