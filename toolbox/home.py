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

import html
import json
import math
import re
import time
from collections import defaultdict

from django.db import transaction
from django.db.models import Max

from nodzapp.models import Layer, Link, Node, Param

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
NAME = 'Gardien'
ROOT = 'Ma maison : réécris mes nodes pour me régler.'
MEMORY = 'Mémoire du Gardien'  # titre du node Mémoire (ignoré à la lecture des souvenirs)

# La même maison en anglais, pour un compte en anglais (mêmes clés de groupe).
EN = {
    'groups': {
        'soul': ('Soul', 'My character and my instructions. Rewrite this node, or add one linked here: I follow it.'),
        'identity': ('Identity', 'Who I am for you: my name, how I speak.'),
        'user': ('User', 'What I know about you. Write your name, your job, your projects, your preferences here.'),
        'memory': ('Memory', 'My memories, one per line. Link a dream here to turn it into a memory.'),
        'skills': ('Skills', 'My know-how: one node per skill ("when… do…").'),
        'tools': ('Tools', 'One node per tool and its instructions; delete a node to cut me off from the tool.'),
        'dreams': ('Dreams', "What I mull over when you ask me nothing. Link a dream to Memory to keep it, delete it otherwise."),
        'exchanges': ('Exchanges', 'My notes for you. Answer in a node linked to the note.'),
    },
    'soul': ("I am the Guardian of your universe. I think with you in nodes, clearly and plainly. "
             "I do what you ask, nothing more; I ask when it's ambiguous."),
    'identity': 'Name: Guardian\nTone: warm, precise, informal',
    'user': 'Write here who you are: first name, job, current projects, what you expect from me.',
    'skill': 'Minutes: when I give you meeting notes, make a tree Decisions, Actions (who, when), Open questions.',
    'name': 'Guardian',
    'root': 'My home: rewrite my nodes to tune me.',
    'memory': "Guardian's memory",
}


def texts(lang):
    """Textes de départ de la maison dans la langue `lang` : groupes (clé, nom, aide), âme, identité, utilisateur,
    compétence, nom de la dimension, racine, titre de la mémoire."""
    if lang == 'en':
        return {**EN, 'groups': [(key, *EN['groups'][key]) for key in KEYS]}
    return {'groups': GROUPS, 'soul': SOUL, 'identity': IDENTITY, 'user': USER, 'skill': SKILL, 'name': NAME, 'root': ROOT, 'memory': MEMORY}

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


# --- pose de la maison

COLORS = {'soul': '#C77DFF', 'identity': '#FF9F45', 'user': '#4DD4C6', 'memory': '#33FF99', 'skills': '#FFD93D', 'tools': '#4D96FF',
          'dreams': '#F15BB5', 'exchanges': '#1E90FF'}
PALETTE = ['#4D96FF', '#33FF99', '#FF6B6B', '#FFD93D', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5', '#9BE15D', '#7FB3FF']
COLUMN = 700   # écart entre deux profondeurs de l'arbre (unités de l'univers)
GAP = 60       # entre deux nodes d'une même colonne
RADIUS = 60    # rayon de départ : au chargement, textfit agrandit chaque node à son texte, d'un seul calcul


def _escape(text):
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _html(text):
    return '<br>'.join(_escape(line) for line in str(text).split('\n'))


def root_html(seed):
    return f'<b>{seed["name"]}</b><br><font size="2">{_escape(seed["root"])}</font>'


def hub_html(label, hint):
    return f'<b>{label}</b><br><font size="2">{_escape(hint)}</font>'


def memory_text(title, facts):
    return title + '\n' + '\n'.join(f'- {fact}' for fact in facts)


def tool_text(tool):
    return f"{tool['op']}\n{tool['label']}\n\n{tool['doc']}"


def _height(text):
    """Hauteur estimée d'un node d'après son texte (une ligne de 48 signes environ), pour espacer l'arbre avant que
    la page ne le mesure."""
    plain = re.sub(r'<[^>]+>', '', text.replace('<br>', '\n'))
    lines = sum(max(1, math.ceil(len(line) / 48)) for line in plain.split('\n'))
    return max(2 * RADIUS, 22 * lines + 40)


def build(user, guardian, seed):
    """Pose d'un bloc ce qui manque de la maison : la dimension, la racine, chaque groupe absent et ses nodes de départ
    (les outils rangés par famille, tout déplié). Nodes et liens sont écrits en une transaction, rangés en
    arbre de gauche à droite ; la page n'a plus qu'à charger la dimension (une seule passe, au lieu d'une centaine de
    créations à la suite). Hors quota : rien ne passe par save_node. Rend {layer, name, added, nodes, counters}."""
    with transaction.atomic():
        param = Param.objects.select_for_update().filter(user=user).first()
        placed = dict(mapping(guardian) or (guardian.brain or {}).get('home') or {})
        layer = Layer.objects.filter(user=user, layer_id=placed.get('layer')).first() if placed.get('layer') else None
        if layer is None:  # pas encore de maison, ou sa dimension a été supprimée : tout est à poser
            taken = {name.lower() for name in Layer.objects.filter(user=user).values_list('layer_name', flat=True)}
            layer_id = (Layer.objects.filter(user=user).aggregate(top=Max('layer_id'))['top'] or 0) + 1
            name = seed['name']
            layer = Layer.objects.create(user=user, layer_id=layer_id, layer_name=f'{name} 2' if name.lower() in taken else name)
            placed = {'layer': layer_id, 'groups': {}, 'tools': {}}
        existing = {f'N-{n.node_id}': n for n in Node.objects.filter(user=user, layer=layer, archive=False)}
        alive = lambda ref: ref in existing
        node_id = max(param.nodecounter if param else 0, Node.objects.filter(user=user).aggregate(top=Max('node_id'))['top'] or 0)
        link_id = max(param.linkcounter if param else 0, Link.objects.filter(user=user).aggregate(top=Max('link_id'))['top'] or 0)

        items, links = {}, []  # ref → {text, color, kids} ; (parent, enfant)

        def add(text, color, parent=None):
            nonlocal node_id
            node_id += 1
            ref = f'N-{node_id}'
            items[ref] = {'text': text, 'color': color, 'kids': [], 'h': _height(text)}
            if parent:
                links.append((parent, ref))
                if parent in items:
                    items[parent]['kids'].append(ref)
            return ref

        root = placed.get('root') if alive(placed.get('root')) else None
        new_root = root is None
        if new_root:
            root = placed['root'] = add(root_html(seed), '#6848A6')
        groups, tools_placed, added = dict(placed.get('groups') or {}), dict(placed.get('tools') or {}), []
        for key, label, hint in ((g['key'], g['label'], g['hint']) for g in seed['groups']):
            if alive(groups.get(key)):
                continue
            tint = COLORS[key]
            hub = groups[key] = add(hub_html(label, hint), tint, root)
            added.append(hub)
            child = lambda text, parent=hub, color=tint: add(_html(text), color, parent)
            if key == 'soul':
                child(seed['soul'])
            elif key == 'identity':
                child(seed['identity'])
            elif key == 'user':
                child(seed['user'])
            elif key == 'memory':
                placed['memory'] = child(memory_text(seed['memory_title'], seed['memory']))
            elif key == 'skills':
                child(seed['skill'])
                placed['brain'] = child(seed['brain'])
            elif key == 'tools':  # une famille par branche, ses outils derrière elle
                for f, family in enumerate(dict.fromkeys(t['category'] for t in seed['tools'])):
                    color = PALETTE[f % len(PALETTE)]
                    fid = add(_html(family), color, hub)
                    for tool in (t for t in seed['tools'] if t['category'] == family):
                        tools_placed[tool['op']] = add(_html(tool_text(tool)), color, fid)

        # Arbre de gauche à droite : une colonne par profondeur, les feuilles l'une sous l'autre, chaque parent au
        # milieu de ses enfants.
        spots = {}
        if new_root:
            origin = {'x': 0.0, 'y': 0.0}
        else:
            node = existing[root]
            origin = {'x': node.x_coordinate, 'y': node.y_coordinate}
        cursor = origin['y'] if new_root else min([n.y_coordinate for n in existing.values()] + [origin['y']]) - 2 * GAP

        def lay(ref, depth):
            nonlocal cursor
            item, x = items[ref], origin['x'] + COLUMN * depth
            if item['kids']:
                ys = [lay(kid, depth + 1) for kid in item['kids']]
                y = (ys[0] + ys[-1]) / 2
            else:
                y = cursor - item['h'] / 2
                cursor -= item['h'] + GAP
            spots[ref] = (x, y)
            return y

        if new_root:
            lay(root, 0)
        else:
            for hub in added:
                lay(hub, 1)

        touching = defaultdict(list)  # ref → (lien, voisin) : les attributs links et siblings de Nodz
        new_links = []
        for parent, kid in links:
            link_id += 1
            new_links.append(Link(user=user, link_id=link_id, linkA=parent, linkB=kid, layer=layer))
            touching[parent].append((f'L-{link_id}', kid))
            touching[kid].append((f'L-{link_id}', parent))
        Node.objects.bulk_create([Node(
            user=user, node_id=int(ref[2:]), layer=layer, x_coordinate=round(spots[ref][0]), y_coordinate=round(spots[ref][1]),
            type='text', color=item['color'], shape='square', radius=RADIUS, ratio=0, text_content=item['text'],
            links=json.dumps([l for l, _ in touching[ref]]), siblings=json.dumps([n for _, n in touching[ref]]),
            quantum='[]', canvas_content='[]', file_name='', notification='', image_content='', file='', preview='',
        ) for ref, item in items.items()])
        Link.objects.bulk_create(new_links)
        if not new_root and touching[root]:  # la racine déjà là gagne les liens de ses nouveaux groupes
            node = existing[root]
            node.links = json.dumps(json.loads(node.links or '[]') + [l for l, _ in touching[root]])
            node.siblings = json.dumps(json.loads(node.siblings or '[]') + [n for _, n in touching[root]])
            node.save(update_fields=['links', 'siblings'])
        if param:
            param.nodecounter, param.linkcounter = node_id, link_id
            param.layercounter = max(param.layercounter or 1, layer.layer_id)
            param.save(update_fields=['nodecounter', 'linkcounter', 'layercounter'])
        placed.update(groups=groups, tools=tools_placed)
        guardian.brain = {**(guardian.brain or {}), 'home': placed}
        guardian.save(update_fields=['brain'])
    # Les compteurs de la page (prochain node, lien, dimension) : charger une dimension ne les relit pas.
    return {'layer': layer.layer_id, 'name': layer.layer_name, 'added': len(added), 'nodes': list(items),
            'counters': {'node': node_id, 'link': link_id, 'layer': max(param.layercounter or 1, layer.layer_id) if param else layer.layer_id}}


# --- changement de langue

def _plain(text):
    """Texte d'un node sans balises ni espaces en trop : deux enregistrements du même texte se comparent égaux."""
    text = re.sub(r'<br\s*/?>|</div>|</p>', '\n', str(text or ''))
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', '', text)).split())


def relabel(user, guardian, lang):
    """Une maison posée dans l'autre langue passe dans `lang` : chaque node encore identique à son texte de départ
    (racine, groupes, âme, identité, utilisateur, compétence, familles et outils) est réécrit, le titre de la mémoire et
    le nom de la dimension aussi s'ils sont restés ceux de départ. Un node réécrit par l'humain ne change pas, rien n'est
    supprimé. Rend le nombre de nodes réécrits."""
    from . import tools, tools_en
    from .guardian import brain_text

    home = mapping(guardian)
    layer = home and Layer.objects.filter(user=user, layer_id=home.get('layer')).first()
    if not layer:
        return 0
    old, new = texts('fr' if lang == 'en' else 'en'), texts(lang)
    pairs = [(root_html(old), root_html(new))]
    pairs += [(hub_html(a[1], a[2]), hub_html(b[1], b[2])) for a, b in zip(old['groups'], new['groups'])]
    pairs += [(_html(old[key]), _html(new[key])) for key in ('soul', 'identity', 'user', 'skill')]
    other, mine = ('fr' if lang == 'en' else 'en'), lang
    for t in tools.TOOLS:
        before, after = tools_en.tool(t['op'], other), tools_en.tool(t['op'], mine)
        pairs += [(_html(tool_text({'op': t['op'], **before})), _html(tool_text({'op': t['op'], **after}))),
                  (_html(before['category']), _html(after['category']))]
    table = {_plain(a): b for a, b in pairs}
    changed = []
    for node in Node.objects.filter(user=user, layer=layer, archive=False):
        ref, text = f'N-{node.node_id}', None
        if ref == home.get('memory') and _plain(node.text_content).startswith(old['memory']):
            text = _html(memory_text(new['memory'], guardian.memory))
        elif ref == home.get('brain'):
            text = _html(brain_text(guardian))
        else:
            text = table.get(_plain(node.text_content))
        if text and text != node.text_content:
            node.text_content = text
            changed.append(node)
    Node.objects.bulk_update(changed, ['text_content'])
    if layer.layer_name == old['name']:
        layer.layer_name = new['name']
        layer.save(update_fields=['layer_name'])
    return len(changed)


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
