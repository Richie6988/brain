"""Le Gardien : orchestrateur garant de l'intégrité de l'univers.

Il ne touche pas aux données lui-même : la page Nodz (v1, /universe) lui envoie le contexte du plan
(nodes, liens, plans, sélection) ; il réfléchit avec le modèle de son agent (JSON contraint par
grammaire) et renvoie des actions validées que la page exécute avec les fonctions de Nodz
(createNode, createLink, focusNode, dragUniverse, zoom…), donc avec sa sauvegarde et son feel.
Il place les nouveaux nodes sans chevauchement, délègue la production aux agents de la
bibliothèque et publie leur résultat dans le node visé. Chaque demande est tracée par un AIRun.
"""

import html
import json
import logging
import math
import random
import re
import time

from django.db.models import Count, Q

from graph.models import AIRun
from nodzapp.models import Link, Node

from . import broker as priorities
from . import imaging, layouts, perception, prompts, tools, web, workspace
from .iaqua import IaquaOps
from .engine import EngineUnavailable
from .errors import PlanError
from .models import Agent, LocalModel

logger = logging.getLogger(__name__)

RADIUS = 85  # rayon d'un node texte de Nodz une fois dimensionné (nodeSizing 120 × 120)
IMAGE_RADIUS = 180  # node image (nodeSizing 250 × 250)
MAX_CONTEXT_NODES = 40  # nodes proches de la vue dans le prompt (chaque jeton du prompt coûte sur CPU)
ATTACHED_TEXT, ATTACHED_TOTAL = 2000, 8000  # nodes joints à la demande : texte complet, dans cette limite
MAX_ATTACHED_AWAY = 30  # nodes joints d'autres dimensions (lus en base)
# build : noms de gabarit qu'un modèle écrit en français ou par synonyme
LAYOUT_ALIASES = {'liste': 'list', 'frise': 'timeline', 'chronologie': 'timeline', 'arbre': 'tree', 'pyramide': 'pyramid',
                  'matrice': 'matrix', 'tableau': 'matrix', 'table': 'matrix', 'grid': 'matrix', 'board': 'kanban'}
HISTORY, HISTORY_TEXT = 6, 200  # derniers échanges du chat rappelés au Gardien (il suit la conversation)
MAX_ROUNDS = 4  # un tour de plus après chaque lecture (inventaire, web, recherche, fichier)
TYPES = ['text', 'image', 'file', 'canvas']  # types de node de Nodz
SHAPES = ['circle', 'square', 'none']
LAYOUT_NAMES = {'matrix': 'la matrice', 'kanban': 'le kanban', 'timeline': 'la frise', 'pyramid': 'la pyramide', 'tree': "l'arbre", 'list': 'la liste'}
OPS = [t['op'] for t in tools.TOOLS]  # catalogue commun Nodz + iAqua (tools.py)
ROLES = [Agent.Role.TEXT, Agent.Role.CODE, Agent.Role.TOOLS]  # rôles qu'un agent créé par le Gardien peut prendre
MAX_MEMORY = 30
LETTERS = 50  # notes gardées dans la correspondance (les plus anciennes s'effacent)
BRANCHES = ['#4D96FF', '#33FF99', '#FF6B6B', '#FFD93D', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5']  # une couleur par branche (grow)
HEX_COLOR = re.compile(r'#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}')


# Réponse imposée au modèle : chaque champ des actions est déclaré avec son type. Une grammaire qui laisse les
# champs libres (clés et valeurs quelconques) rend l'échantillonnage de llama.cpp très lent : ne pas l'alléger.
PLAN_SCHEMA = {
    'type': 'object',
    'required': ['plan', 'say', 'actions'],
    'properties': {
        # plan court : sur CPU, chaque jeton écrit coûte (moins d'une seconde à plusieurs), la grammaire le borne
        'plan': {'type': 'array', 'items': {'type': 'string', 'maxLength': 60}, 'maxItems': 3},
        'say': {'type': 'string'},
        'actions': {
            'type': 'array',
            'items': {
                'type': 'object',
                'required': ['op'],
                'properties': {
                    'op': {'type': 'string', 'enum': OPS},
                    'ref': {'type': 'string'},
                    'near': {'type': 'string'},
                    'text': {'type': 'string'},
                    'source': {'type': 'string'},
                    'target': {'type': 'string'},
                    'color': {'type': 'string'},
                    'shape': {'type': 'string', 'enum': SHAPES},
                    'radius': {'type': 'number'},
                    'lock': {'type': 'boolean'},
                    'content_type': {'type': 'string', 'enum': TYPES},
                    'name': {'type': 'string'},
                    'agent': {'type': 'string'},
                    'model': {'type': 'string'},
                    'task': {'type': 'string'},
                    'zoom': {'type': 'number'},
                    'query': {'type': 'string'},
                    'url': {'type': 'string'},
                    'children': {'type': 'array', 'items': {'type': 'string'}},
                    'choices': {'type': 'array', 'items': {'type': 'string'}},  # ask : réponses proposées à l'humain
                    'links': {'type': 'array', 'items': {'type': 'string'}},  # put : voisins à relier
                    # gabarits (build, template_save, schema)
                    'layout': {'type': 'string', 'enum': layouts.LAYOUTS},
                    'type': {'type': 'string', 'enum': layouts.SCHEMAS},
                    # schema : intitulé d'une case du modèle → nouveau texte, ou idées posées autour d'elle
                    'fill': {'type': 'object', 'additionalProperties': {'anyOf': [{'type': 'string'}, {'type': 'array', 'items': {'type': 'string'}}]}},
                    **{k: {'type': 'array', 'items': {'type': 'string'}} for k in ('rows', 'cols', 'items')},
                    'cells': {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'string'}}},
                    'template': {'type': 'string'},
                    'save_as': {'type': 'string'},
                    'description': {'type': 'string'},
                    'prompt': {'type': 'string'},
                    'role': {'type': 'string', 'enum': ROLES},
                    'enabled': {'type': 'boolean'},
                    # outils d'iAqua (valeurs libres en texte : JSON accepté là où il le faut)
                    **{k: {'type': 'string'} for k in (
                        'title', 'acceptance_criteria', 'project', 'priority', 'status', 'task_id', 'field', 'value', 'expr',
                        'action', 'schedule_id', 'vision', 'goal', 'mission_id', 'project_name', 'new_value', 'kind', 'content',
                        'skill_id', 'summary', 'triggers', 'outcome', 'section_path', 'field_path', 'event_type', 'path',
                        'search_text', 'replace_text', 'message', 'filename', 'markdown', 'to', 'subject', 'body', 'command',
                        'cwd', 'code', 'test_input', 'input', 'server', 'arguments')},
                    **{k: {'type': 'number'} for k in ('budget', 'limit', 'strength', 'timeout')},
                    **{k: {'type': 'boolean'} for k in ('run', 'abort')},
                    **{k: {'type': 'array', 'items': {'type': 'string'}} for k in ('steps', 'files', 'packages', 'names', 'paths')},
                    'slides': {'type': 'array', 'items': {'type': 'object', 'properties': {
                        'title': {'type': 'string'}, 'body': {'type': 'string'}, 'bullets': {'type': 'array', 'items': {'type': 'string'}}}}},
                },
            },
        },
    },
}

# Partie technique du Gardien (format et outils) : fixe. Ses consignes (prompts.GUARDIAN ou celles de
# l'utilisateur) s'y ajoutent.
SYSTEM = """Nodz : une carte de nodes (idées) reliés, sur des dimensions (plans) reliées par des portails ; tes travellings
de caméra guident l'utilisateur. Il t'écrit dans un node (le node message) ; tu réponds uniquement en JSON :
{"plan": ["étape", ...], "say": ce que tu as fait, "actions": [...]}.
`plan` : les étapes de CETTE réponse, chacune avec ses actions maintenant ; jamais de promesse pour plus tard.
Simple question : `plan` et `actions` vides, `say` répond. `say` s'écrit dans un node relié au message : au passé
(« J'ai relié… »), jamais « je vais ». Nodes existants : identifiant N-12 ; nouveaux : new1, new2...
Tu lis chaque node comme un objet JSON (texte, liens, auteur, position) et l'écris pareil : put.
Pour plus tard (idée, rappel, question pas urgente) : note, que l'humain lit dans la dimension Échanges ; à trancher
tout de suite : ask. Texte des nodes mis en forme : **gras**, *italique*, __souligné__, [#FF6B6B]couleur[/],
^^grand^^, ^^^très grand^^^, ,,petit,, ; emojis bienvenus.
Exemples (imite leur forme) :
« bonjour » → {"plan": [], "say": "Bonjour ! Je peux créer, relier, ranger tes nodes ou te faire visiter. Que veux-tu faire ?", "actions": []}
« ajoute Voyage relié à N-3 » → {"plan": ["Créer Voyage relié à N-3"], "say": "J'ai créé « Voyage » relié à N-3.", "actions": [{"op":"put","ref":"new1","near":"N-3","text":"Voyage","links":["N-3"]}]}
« mets N-5 en rouge et relie-le à N-2 » → {"plan": ["Changer N-5"], "say": "N-5 est rouge et relié à N-2.", "actions": [{"op":"put","ref":"N-5","color":"#FF6B6B","links":["N-2"]}]}
« fais un SWOT de mon café » → {"plan": ["Poser le SWOT rempli"], "say": "J'ai posé le SWOT de ton café.", "actions": [{"op":"schema","type":"swot","title":"**Mon café**","fill":{"Forces":["Emplacement"],"Menaces":["Loyer en hausse"]}}]}
« arbre de compétences d'un jeu » → {"plan": ["Construire l'arbre"], "say": "J'ai construit l'arbre.", "actions": [{"op":"build","layout":"tree","items":["Compétences","  Combat","    Épée","  Magie"],"title":"Compétences"}]}
« explique la photosynthèse » → {"plan": ["Déployer l'explication"], "say": "J'ai déployé l'explication en étoile.", "actions": [{"op":"grow","text":"^^🌱 **Photosynthèse**^^\n- ☀️ **Lumière** : la [#33FF99]chlorophylle[/]\n  - Phase claire : *ATP*\n- 🌬️ **Oxygène** rejeté"}]}
« résume N-12 » (son texte complet est donné) → {"plan": [], "say": "N-12 dit que…", "actions": []}
« fais quelque chose avec ça » (ambigu) → {"plan": [], "say": "", "actions": [{"op":"ask","text":"Je le résume ou j'en fais une carte mentale ?","choices":["Résumer","Carte mentale"]}]}
{tools}
Tes consignes :
{guidelines}
Agents équipés :
{agents}
{memory}"""

# --- Mode Pensée (par défaut dans l'univers) : Nodz est la façon de parler de l'IA. Elle pense à voix haute, et chaque
# pensée devient aussitôt un node discret, relié à la précédente, qui pousse depuis le node source ; puis elle crée ses
# résultats avec les outils de création, chacun rattaché à la pensée qui l'a produit. Pas de chat, pas d'automatisation
# (web, fichiers, agents, missions : mode Automatisation, la boucle de handle()).
THINK_OPS = ['put', 'grow', 'build', 'schema', 'link', 'portal']
MAX_THOUGHTS = 6
THOUGHT_RADIUS = 60      # place d'une pensée (petit node sans cadre)
THOUGHT_COLOR = '#8B7FC8'  # couleur de la pensée : ses liens
THOUGHT_INK = '#C9BEF2'    # son texte, clair et discret
# Champs des actions de création seulement : une grammaire plus petite s'échantillonne plus vite.
THINK_FIELDS = ('ref', 'near', 'text', 'source', 'target', 'color', 'shape', 'children', 'links', 'layout', 'type', 'fill',
                'rows', 'cols', 'items', 'cells', 'title', 'name')
THINK_SCHEMA = {
    'type': 'object',
    'required': ['thoughts', 'actions'],  # les pensées d'abord : elles s'écrivent (et poussent) avant les résultats
    'properties': {
        'thoughts': {'type': 'array', 'items': {'type': 'string', 'maxLength': 110}, 'maxItems': MAX_THOUGHTS},
        'actions': {'type': 'array', 'items': {'type': 'object', 'required': ['op'], 'properties': {
            'op': {'type': 'string', 'enum': THINK_OPS},
            **{k: PLAN_SCHEMA['properties']['actions']['items']['properties'][k] for k in THINK_FIELDS}}}},
    },
}

THINK_SYSTEM = """Nodz est ta façon de parler : tout ce que tu écris devient des nodes dans l'univers de l'utilisateur, autour du
node source (indiqué à la fin du message). Il n'y a pas de chat : tu ne réponds qu'en nodes. Réponds uniquement en JSON :
{"thoughts": ["pas 1", "pas 2", ...], "actions": [...]}.
thoughts : ta chaîne de pensée, dans l'ordre, 2 à 6 pas de moins de 14 mots. Chacun devient aussitôt un petit node relié au
précédent (t1, t2…) : on te voit penser.
actions : ce que tu crées ensuite, avec une vue d'ensemble de tes pensées : chaque résultat se rattache à la pensée qui l'a
produit (near et links vers t…) ou à un autre résultat (new…).
- put : un node résultat {"op":"put","ref":"new1","text":"…","near":"t2","links":["t2"],"color":"#hex","shape":"circle|square","children":["sous-idée"]}
- grow : une explication en arbre {"op":"grow","text":"titre\n- idée\n  - détail"}
- build : un gabarit {"op":"build","layout":"tree|list|kanban|timeline|matrix|pyramid","title":"…","items":["…"]} (kanban : cols et items ; matrix : rows, cols, cells)
- schema : un modèle rempli {"op":"schema","type":"swot","title":"…","fill":{"Forces":["idée"]}} ; modèles : {schemas}
- link : relier deux nodes (N-…, t…, new…)
- portal : un sujet qui mérite son propre espace ; le résultat devient un portail vers une nouvelle dimension qui porte ce nom
  {"op":"portal","ref":"new1","name":"Voyage au Japon"} (en dernier ; on pensera ce sujet là-bas)
L'univers est fait de dimensions : des plans séparés, chacun avec ses nodes (la liste est dans le message). Tu es dans
celle du node source et tu y crées. Un portail relie deux dimensions : le même node existe des deux côtés (champ
"portail" d'un node) ; un node joint d'une autre dimension indique la sienne.
Mise en forme : **gras**, *italique*, [#FF6B6B]couleur[/], ^^grand^^ ; emojis bienvenus.
Exemples (imite leur forme) :
« bonjour » → {"thoughts":["Un salut, pas encore de sujet"],"actions":[{"op":"put","ref":"new1","text":"👋 Bonjour ! Donne-moi un node et une consigne : j'y penserai ici.","near":"t1","links":["t1"]}]}
« des noms pour mon café » → {"thoughts":["Un café : chaleur, rencontre","Trois pistes : jeu de mots, lieu, émotion","Garder les plus courts"],"actions":[{"op":"put","ref":"new1","text":"☕ **Noms**","near":"t3","links":["t3"],"color":"#FFD93D","children":["Grain de Folie","Le Comptoir","Tasse & Toi"]}]}
« SWOT de mon café » → {"thoughts":["Interne : emplacement, petite salle","Externe : loyers, concurrence"],"actions":[{"op":"schema","type":"swot","title":"**Mon café**","fill":{"Forces":["Emplacement"],"Faiblesses":["Petite salle"],"Menaces":["Loyer en hausse"]}}]}
Tes consignes :
{guidelines}
{memory}"""


class ThoughtStream:
    """Pensées complètes au fil du flux JSON : chaque chaîne terminée du tableau "thoughts", dès qu'elle arrive."""

    START = re.compile(r'"thoughts"\s*:\s*\[')
    ITEM = re.compile(r'\s*,?\s*("(?:[^"\\]|\\.)*")')

    def __init__(self):
        self.buffer, self.at, self.closed = '', None, False

    def feed(self, piece):
        self.buffer += piece
        if self.closed:
            return []
        if self.at is None:
            start = self.START.search(self.buffer)
            if not start:
                return []
            self.at = start.end()
        found = []
        while item := self.ITEM.match(self.buffer, self.at):
            found.append(json.loads(item.group(1)))
            self.at = item.end()
        self.closed = self.buffer[self.at:].lstrip().startswith(']')
        return found

def plain(markup, length=120):
    """Texte lisible d'un contenu HTML de node (pour le prompt)."""
    return html.unescape(' '.join(re.sub(r'<[^>]+>', ' ', markup or '').split()))[:length]


def salvage(raw):
    """Plan JSON coupé en route : garde `say` et `plan` s'ils sont complets (sans les actions, peut-être
    tronquées ou répétées) ; None si `say` ne l'est pas."""
    string = r'"(?:[^"\\]|\\.)*"'
    say = re.search(r'"say"\s*:\s*(' + string + ')', raw)
    if not say:
        return None
    plan = re.search(r'"plan"\s*:\s*(\[\s*(?:' + string + r'\s*,?\s*)*\])', raw)
    try:
        return {'plan': json.loads(plan.group(1)) if plan else [], 'say': json.loads(say.group(1)), 'actions': []}
    except json.JSONDecodeError:
        return None


def node_id(ref):
    """Numéro Nodz d'un identifiant N-12, ou None."""
    ref = str(ref or '')
    return int(ref[2:]) if ref.startswith('N-') and ref[2:].isdigit() else None


def memory_lines(text):
    """Souvenirs écrits dans le node « Mémoire » : un par ligne, puces et titre ignorés."""
    lines = [' '.join(line.strip().lstrip('-*• ').split()) for line in (text or '').splitlines()]
    return [line[:200] for line in lines if line and line.lower() not in ('mémoire', 'mémoire du gardien')][-MAX_MEMORY:]


def brain_text(agent):
    """Le cerveau du Gardien tel qu'il s'affiche dans son node « Cerveau » (lu par read_my_brain)."""
    brain = agent.brain or {}
    templates = brain.get('templates') or {}
    lines = ['Cerveau du Gardien', '(réécrit par le Gardien ; ses souvenirs sont dans le node Mémoire)', '',
             f"Gabarits gardés : {', '.join(f'{name} ({t.get('layout')})' for name, t in templates.items()) or 'aucun'}"]
    lines += [f'{key} : {json.dumps(value, ensure_ascii=False)[:300]}' for key, value in brain.items() if key not in ('universe', 'templates', 'letters')]
    return '\n'.join(lines)


def write_node(user, ref, text):
    """Réécrit le texte d'un node de l'univers en base (il s'affiche à la prochaine visite de sa dimension)."""
    number = node_id(ref)
    if number is None:
        return False
    markup = '<br>'.join(html.escape(line) for line in text.split('\n'))
    return bool(Node.objects.filter(user=user, archive=False, node_id=number).update(text_content=markup))


def multiline(markup):
    """Texte d'un node de Nodz avec ses retours à la ligne (consignes et modes d'emploi écrits dans l'univers)."""
    text = re.sub(r'(?i)<br\s*/?>|</(div|p|li)>', '\n', markup or '')
    return html.unescape(re.sub(r'<[^>]+>', '', text)).strip()


# Mise en forme que le Gardien écrit dans le texte d'un node, rendue comme les boutons de Nodz la produisent
# (gras, italique, souligné, couleur, taille). Le texte est échappé d'abord : aucune balise libre ne passe.
MARKUP = [
    (re.compile(r'\*\*(.+?)\*\*'), r'<b>\1</b>'),
    (re.compile(r'__(.+?)__'), r'<u>\1</u>'),
    (re.compile(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])'), r'<i>\1</i>'),
    (re.compile(r'\[(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\](.+?)\[/\]'), r'<font color="\1">\2</font>'),
    (re.compile(r'\^\^\^(.+?)\^\^\^'), r'<font size="7">\1</font>'),
    (re.compile(r'\^\^(.+?)\^\^'), r'<font size="6">\1</font>'),
    (re.compile(r',,(.+?),,'), r'<font size="2">\1</font>'),
]


def text_html(text):
    lines = [html.escape(line, quote=False) for line in text.strip().split('\n')]
    for pattern, markup in MARKUP:
        lines = [pattern.sub(markup, line) for line in lines]
    return '<br>'.join(lines)


def code_html(text):
    match = re.search(r'```[\w+-]*\n(.*?)```', text, re.S)
    return f'<pre>{html.escape((match.group(1) if match else text).strip(chr(10)))}</pre>'


def short(text, length=40):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= length else text[:length - 1] + '…'


def intent(action, nodes):
    """Ce que le Gardien s'apprête à faire, en une phrase (fil de suivi de l'utilisateur)."""
    name = lambda ref: f"« {short(nodes[ref]['text'], 24)} »" if nodes.get(ref, {}).get('text') else (ref or '?')
    op = action.get('op')
    return {
        'ask': lambda a: 'Je te pose une question',
        'note': lambda a: 'Je te laisse une note dans Échanges',
        'grow': lambda a: f"Je fais pousser « {short(str(a.get('text', '')).strip().splitlines()[0] if str(a.get('text', '')).strip() else '')} »",
        'put': lambda a: f"J'écris {name(a.get('ref'))}" if str(a.get('ref', '')).startswith('N-') else f"Je crée « {short(a.get('text'))} »",
        'create': lambda a: f"Je crée « {short(a.get('text'))} »",
        'update': lambda a: f"Je réécris {name(a.get('ref'))}",
        'style': lambda a: f"Je change l'apparence de {name(a.get('ref'))}",
        'set_type': lambda a: f"Je passe {name(a.get('ref'))} en {a.get('content_type')}",
        'link': lambda a: f"Je relie {name(a.get('source'))} à {name(a.get('target'))}",
        'unlink': lambda a: f"Je détache {name(a.get('source'))} de {name(a.get('target'))}",
        'portal': lambda a: f"J'ouvre un portail vers « {short(a.get('name'))} »",
        'archive': lambda a: f"Je supprime {name(a.get('ref'))} (Ctrl+Z pour annuler)",
        'cleanup': lambda a: 'Je fais le ménage des nodes vides',
        'build': lambda a: f"Je construis {LAYOUT_NAMES.get(a.get('layout'), 'le gabarit')} « {short(a.get('title') or a.get('template'))} »",
        'template_save': lambda a: f"Je garde le gabarit « {short(a.get('name'))} »",
        'templates': lambda a: 'Je relis mes gabarits',
        'template_delete': lambda a: f"J'oublie le gabarit « {short(a.get('name'))} »",
        'schema': lambda a: f"Je pose le modèle {a.get('type')}",
        'tour': lambda a: f"Je te fais visiter la branche de {name(a.get('ref'))}",
        'mindmap': lambda a: f"Je dessine une carte mentale autour de « {short(a.get('text') or nodes.get(a.get('ref'), {}).get('text'))} »",
        'delegate': lambda a: f"Je confie à {a.get('agent')} : {short(a.get('task'), 60)}",
        'plug_agent': lambda a: f"Je branche {a.get('model')} sur {a.get('agent')}",
        'create_agent': lambda a: f"Je crée l'agent {a.get('name')}",
        'update_agent': lambda a: f"Je règle l'agent {a.get('agent')}",
        'remember': lambda a: f"Je retiens : {short(a.get('text'), 60)}",
        'forget': lambda a: f"J'oublie ce qui parle de « {short(a.get('text'))} »",
        'inventory': lambda a: 'Je fais l\'inventaire des dimensions, agents et modèles',
        'search_nodes': lambda a: f"Je cherche « {short(a.get('query'))} » dans tes nodes",
        'read_file': lambda a: f"Je lis le document de {name(a.get('ref'))}",
        'web_search': lambda a: f"Je cherche sur le web : {short(a.get('query'), 60)}",
        'web_fetch': lambda a: f"Je lis {short(a.get('url'), 60)}",
        'focus': lambda a: f"Je t'emmène vers {name(a.get('ref'))}",
        'overview': lambda a: 'Je prends du recul sur tout le plan',
        'travel': lambda a: f"Cap sur la dimension « {short(a.get('name'))} »",
        'goto': lambda a: f"Je t'emmène vers {a.get('ref')}",
    }.get(op, lambda a: str(op))(action)


def free_spot(anchor, occupied, radius=RADIUS):
    """Premier emplacement libre sur des anneaux autour de `anchor` (aucun chevauchement).

    `occupied` : points (x, y) ou (x, y, rayon) ; sans rayon, celui d'un node texte."""
    gap = max(radius, RADIUS) * 2 + 70
    clear = lambda x, y, p: math.dist((x, y), p[:2]) >= radius + (p[2] if len(p) > 2 else RADIUS) + 55
    for ring in range(1, 12):
        steps = 6 * ring
        for i in range(steps):
            # Jamais pile sur un axe : le dégradé d'un lien de Nodz ne s'affiche pas s'il est vertical ou horizontal.
            angle = 2 * math.pi * i / steps + math.pi / 2 + 0.35
            x, y = anchor[0] + ring * gap * math.cos(angle), anchor[1] + ring * gap * math.sin(angle)
            if all(clear(x, y, p) for p in occupied):
                return round(x), round(y)
    return round(anchor[0] + gap), round(anchor[1])


def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class Guardian(IaquaOps):
    def __init__(self, user, engine, emit):
        self.user, self.engine, self.emit = user, engine, emit
        self.run = None
        self.nodes = {}  # identifiant ou référence → {x, y, r, text, new}
        self.found = {}  # nodes trouvés par search_nodes : identifiant → id de leur dimension
        self.docs = {}  # modes d'emploi réécrits dans les nodes d'outils de l'univers
        self.timings = []  # mesures des appels au modèle (engine.stats[…]['last'])
        self.perception = perception.Perception(user)  # chaque node vu en un objet (texte, liens, auteur, portail…)
        self.seen = set()  # actions déjà exécutées pendant cette demande : un tour suivant ne les refait pas
        self.asked = False  # une question posée à l'humain : on attend sa réponse
        self.scale = 1.0  # part du contexte montrée au modèle (réduite si son contexte déborde)
        self.letters = []  # réponses de l'humain à ses notes (correspondance)
        self.attached_away = []  # nodes joints d'autres dimensions (sélecteur de contexte)
        self.allowed = []  # outils permis (lus avec le prompt système)
        self.source = None  # mode Pensée : le node d'où la pensée pousse
        self.heading = None  # mode Pensée : direction de la pousse, qui ondule d'une pensée à l'autre

    # --- contexte envoyé par la page

    def load(self, context):
        if not isinstance(context, dict):
            raise PlanError('contexte invalide')
        view = context.get('view') or {}
        center = (_number(view.get('x')), _number(view.get('y')))
        nodes = [n for n in context.get('nodes') or [] if isinstance(n, dict) and str(n.get('id', '')).startswith('N-')]
        selection = [str(i) for i in context.get('selection') or []]
        # Nodes joints à cette demande seulement (multisélection envoyée au Gardien) : en tête, en texte complet.
        attached = [str(i) for i in context.get('attached') or []]
        by_id = {n['id']: n for n in nodes}
        self.attached, budget = [], ATTACHED_TOTAL
        # joints depuis d'autres dimensions (sélecteur de contexte) : lus en base, texte complet et dimension
        self.attached_away = [i for i in dict.fromkeys(attached) if i not in by_id and node_id(i)][:MAX_ATTACHED_AWAY]
        for i in dict.fromkeys(attached):
            if i in by_id and budget > 0:
                text = multiline(by_id[i].get('text', ''))[:min(ATTACHED_TEXT, budget)]
                self.attached.append((i, text))
                budget -= len(text)
        selection = [i for i, _ in self.attached] + [i for i in selection if i not in dict(self.attached)]
        selected = [by_id[i] for i in selection if i in by_id]
        others = sorted((n for n in nodes if n['id'] not in selection),
                        key=lambda n: math.dist((_number(n.get('x')), _number(n.get('y'))), center))
        # Les plus proches de la vue, listés dans l'ordre des identifiants : d'une demande à l'autre la liste change
        # peu et llama.cpp réutilise sa lecture (sinon, un léger déplacement réordonne tout et tout est relu).
        self.nearest = (selected + others)[:MAX_CONTEXT_NODES]  # du plus proche au plus loin (raccourci si trop long)
        self.context = sorted(self.nearest, key=lambda n: node_id(n['id']) or 0)
        self.history = [(h['role'], ' '.join(multiline(str(h.get('text') or '')).split())[:HISTORY_TEXT])
                        for h in (context.get('history') or [])[-HISTORY:]
                        if isinstance(h, dict) and h.get('role') in ('user', 'guardian') and h.get('text')]
        for n in nodes:
            self.nodes[n['id']] = {'x': _number(n.get('x')), 'y': _number(n.get('y')), 'r': _number(n.get('r'), RADIUS),
                                   'text': plain(n.get('text', '')), 'color': n.get('color', '')}
        self.occupied = [(n['x'], n['y'], n['r']) for n in self.nodes.values()]
        origin = context.get('origin')  # le node message : les réponses se placent autour de lui
        first = self.nodes.get(origin) or (self.nodes.get(selected[0]['id']) if selected else None)
        self.anchor = (first['x'], first['y']) if first else center
        known = {n['id'] for n in self.context}
        self.links = sorted((a, b) for a, b in (context.get('links') or []) if a in known and b in known)
        self.selection = [n['id'] for n in selected]
        self.origin = origin if origin in self.nodes else None
        self.layer = context.get('layer') or {}
        self.layers = [l for l in context.get('layers') or [] if isinstance(l, dict)]

    def agents(self):
        return {a.name: a for a in Agent.objects.filter(owner=self.user, enabled=True).select_related('model')}

    def prompt(self, request):
        """Message du modèle : la dimension, puis chaque node en un objet (perception.py), la conversation et la demande.
        Le texte est entier pour les nodes joints, sélectionnés, cités ou le node message ; les nodes cités hors de la
        page (autre dimension) sont lus en base : aucun tour de lecture pour eux."""
        cited = list(dict.fromkeys(re.findall(r'N-\d+', request)))[:4]
        limits = dict((i, len(text) or 1) for i, text in self.attached)  # nodes joints : dans le budget de load()
        full = {*limits, *self.selection[:3], *([self.origin] if self.origin else []), *cited}
        shown = self.context if self.scale >= 1 else sorted(self.nearest[:max(6, int(len(self.nearest) * self.scale))],
                                                            key=lambda n: node_id(n['id']) or 0)
        view = self.perception.objects(shown, self.links, full=full, limits=limits, scale=self.scale)
        away = self.perception.outside([ref for ref in cited if ref not in self.nodes])
        joined = [o for o in self.perception.outside(self.attached_away) if not o.get('introuvable')] if self.attached_away else []
        guide = tools.relevant(request, self.allowed, self.docs)
        talk = ['Échanges récents (du plus ancien au plus récent) :',
                *(f"{'Humain' if role == 'user' else 'Toi'} : {text}" for role, text in self.history)] if self.history else []
        return '\n'.join([
            f"Dimension : {self.layer.get('name') or 'sans nom'}",
            'Nodes (un objet par node ; sans "par", écrit par l\'humain ; "par": "moi" = créé par toi ; "plus": caractères non montrés) :',
            *(perception.lines(view) or ['(aucun)']),
            *talk,  # après les nodes, qui changent peu : seule la fin du message est relue
            *(['Correspondance (dimension Échanges) :', *self.letters] if self.letters else []),
            'Sélection : ' + (', '.join(self.selection) or 'aucune'),
            *([self.dimensions()] if self.layers else []),
            *(['Nodes cités hors de cette dimension :', *perception.lines(away)] if away else []),
            *(['Nodes joints d\'autres dimensions (contexte choisi par l\'humain) :', *perception.lines(joined)] if joined else []),
            *(['Outils pour cette demande :', guide] if guide else []),  # aiguillage : ceux que ses mots appellent
            f'Message écrit dans le node {self.origin} : {request}' if self.origin else f'Demande : {request}',
            *([f'Node source : {self.source}'] if self.source else []),
        ])

    def dimensions(self):
        """Les dimensions de l'univers, avec leur nombre de nodes : l'IA sait où elle est et ce qui existe ailleurs."""
        counts = dict(Node.objects.filter(user=self.user, archive=False).values('layer__layer_id')
                      .annotate(n=Count('id')).values_list('layer__layer_id', 'n'))
        here = self.layer.get('id')
        return 'Dimensions de l\'univers : ' + ', '.join(
            f"{l.get('name') or 'sans nom'} ({'ici, ' if l.get('id') == here else ''}{counts.get(l.get('id'), 0)} nodes)"
            for l in self.layers[:30] if l.get('id') is not None)

    # --- validation des actions

    def existing(self, ref):
        if ref not in self.nodes:
            raise PlanError(f'référence inconnue : {ref!r}')
        return ref

    def place(self, ref, near, radius=RADIUS):
        target = self.nodes.get(near) if near else None
        anchor = (target['x'], target['y']) if target else self.anchor
        x, y = free_spot(anchor, self.occupied, radius)
        self.occupied.append((x, y, radius))
        self.nodes[ref] = {'x': x, 'y': y, 'r': radius, 'text': '', 'new': True}
        return x, y

    def agent(self, agents, name):
        agent = agents.get(name) or next((a for n, a in agents.items() if n.lower() == (name or '').lower()), None)
        if agent is None:
            raise PlanError(f'agent inconnu : {name!r}')
        return agent

    def color(self, action):
        value = action.get('color')
        if value and not HEX_COLOR.fullmatch(value):
            raise PlanError(f'couleur invalide : {value!r}')
        return value or None

    def op_create(self, action, agents):
        if action['ref'] in self.nodes:
            raise PlanError(f"{action['ref']} existe déjà (update pour le modifier)")
        x, y = self.place(action['ref'], action.get('near'))
        self.nodes[action['ref']]['text'] = plain(action.get('text', ''))
        return {'op': 'create', 'ref': action['ref'], 'x': x, 'y': y, 'text': text_html(action.get('text', '')),
                'color': self.color(action), 'shape': action.get('shape') if action.get('shape') in SHAPES else None}

    def op_ask(self, action, agents):
        """Question à l'humain, avec des choix cliquables dans le chat : la demande s'arrête là, sa réponse arrive
        comme un nouveau message (avec cet échange dans les échanges récents)."""
        text = ' '.join(str(action.get('text') or '').split())[:300]
        if not text:
            raise PlanError('question vide (text)')
        choices = list(dict.fromkeys(c for c in (' '.join(str(c).split())[:60] for c in action.get('choices') or []) if c))[:4]
        self.asked = True
        self.emit('ask', {'text': text, 'choices': choices})
        return None

    def op_put(self, action, agents):
        """Un node écrit comme il est lu, en un objet : crée (new1) ou modifie (N-12) son texte, son apparence, ses
        liens et ses enfants en une seule action."""
        ref, created = action['ref'], action['ref'] not in self.nodes
        if created:
            if str(ref).startswith('N-'):
                raise PlanError(f'référence inconnue : {ref!r}')
            self.emit('action', self.op_create(action, agents))  # texte, couleur et forme compris
        elif 'text' in action:
            self.emit('action', self.op_update(action, agents))
        styled = ('radius', 'lock') if created else ('color', 'shape', 'radius', 'lock')
        if any(action.get(k) is not None for k in styled):
            self.emit('action', self.op_style(action, agents))
        for target in dict.fromkeys(action.get('links') or []):
            if target != ref:
                self.emit('action', self.op_link({'source': ref, 'target': target}, agents))
        if action.get('children'):
            self.op_mindmap({'ref': ref, 'children': action['children'], 'color': action.get('color')}, agents)
        return None

    def op_note(self, action, agents):
        """Une note pour plus tard (correspondance) : gardée dans son cerveau, posée dans la dimension « Échanges »
        quand l'humain l'ouvre ; ses réponses (nodes reliés à la note) reviennent au Gardien à chaque demande."""
        text = str(action.get('text') or '').strip()[:1500]
        if not text:
            raise PlanError('note vide (text)')
        choices = list(dict.fromkeys(c for c in (' '.join(str(c).split())[:60] for c in action.get('choices') or []) if c))[:4]
        letters = list(self.guardian.brain.get('letters') or [])
        letter = {'id': (max((l['id'] for l in letters), default=0) + 1), 'text': text, 'choices': choices,
                  'at': time.strftime('%d/%m %H:%M'), 'node': None}
        self.guardian.brain = {**self.guardian.brain, 'letters': (letters + [letter])[-LETTERS:]}
        self.guardian.save(update_fields=['brain'])
        self.emit('note', {'id': letter['id'], 'text': text, 'choices': choices})
        return None

    def correspondence(self):
        """Réponses de l'humain aux notes posées dans « Échanges » : les nodes reliés à une note (hors la racine)."""
        letters = [l for l in (self.guardian.brain.get('letters') or []) if l.get('node')] if self.guardian else []
        if not letters:
            return []
        root = (self.guardian.brain.get('universe') or {}).get('exchanges')
        by_note = {l['node']: l for l in letters}
        replies = {}
        for a, b in Link.objects.filter(user=self.user, archive=False).filter(Q(linkA__in=by_note) | Q(linkB__in=by_note)).values_list('linkA', 'linkB'):
            for note, other in ((a, b), (b, a)):
                if note in by_note and other not in by_note and other != root:
                    replies.setdefault(note, set()).add(other)
        texts = dict(Node.objects.filter(user=self.user, archive=False, node_id__in=[node_id(r) for rs in replies.values() for r in rs])
                     .values_list('node_id', 'text_content'))
        lines = []
        for note, refs in replies.items():
            answer = ' / '.join(t for t in (multiline(texts.get(node_id(r)) or '') for r in sorted(refs)) if t)
            if answer:
                lines.append(f"Ta note {note} (« {short(by_note[note]['text'], 80)} ») → l'humain a répondu : {answer[:400]}")
        return lines[-5:]

    def op_update(self, action, agents):
        return {'op': 'update', 'ref': self.existing(action.get('ref')), 'text': text_html(action.get('text', ''))}

    def op_style(self, action, agents):
        radius = action.get('radius')
        return {'op': 'style', 'ref': self.existing(action.get('ref')), 'color': self.color(action),
                'shape': action.get('shape') if action.get('shape') in SHAPES else None,
                'radius': min(max(float(radius), 20.0), 400.0) if isinstance(radius, (int, float)) else None,
                'lock': action['lock'] if isinstance(action.get('lock'), bool) else None}

    def op_set_type(self, action, agents):
        if action.get('content_type') not in TYPES:
            raise PlanError(f"type inconnu : {action.get('content_type')!r}")
        return {'op': 'set_type', 'ref': self.existing(action.get('ref')), 'content_type': action['content_type']}

    def op_link(self, action, agents):
        source, target = self.existing(action.get('source')), self.existing(action.get('target'))
        if source == target:
            raise PlanError('un node ne se relie pas à lui-même')
        return {'op': 'link', 'source': source, 'target': target}

    def op_unlink(self, action, agents):
        return {'op': 'unlink', 'source': self.existing(action.get('source')), 'target': self.existing(action.get('target'))}

    def op_portal(self, action, agents):
        name = (action.get('name') or '').strip()[:60]
        self.layers.append({'id': None, 'name': name})
        # Mode Pensée : la page ouvre le portail puis revient, la pensée reste sous les yeux (gate) ; sinon on y entre.
        return {'op': 'gate' if self.source else 'portal', 'ref': self.existing(action.get('ref')), 'name': name}

    def op_archive(self, action, agents):
        return {'op': 'archive', 'ref': self.existing(action.get('ref'))}

    def op_cleanup(self, action, agents):
        empty = [n['id'] for n in self.context if not self.nodes[n['id']]['text']]
        return {'op': 'cleanup', 'refs': empty} if empty else None

    def op_delegate(self, action, agents):
        agent = self.agent(agents, action.get('agent'))
        if agent.role == Agent.Role.ORCHESTRATOR:
            raise PlanError('le Gardien ne se délègue pas à lui-même')
        if agent.model_id is None:
            raise PlanError(f"{agent.name} n'a pas de modèle : branche-lui un modèle (plug_agent)")
        if (agent.role == Agent.Role.IMAGE) != (agent.model.kind == LocalModel.Kind.IMAGE):
            raise PlanError(f"{agent.name} : son modèle n'est pas du bon type (image ou texte)")
        ref = action['ref']
        self.jobs.append((agent, action.get('task', ''), ref))
        if ref in self.nodes:
            return None
        x, y = self.place(ref, action.get('near'), IMAGE_RADIUS if agent.role == Agent.Role.IMAGE else RADIUS)  # il attend le résultat
        self.nodes[ref]['text'] = f"{agent.name} {'dessine' if agent.role == Agent.Role.IMAGE else 'travaille'}…"
        return {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': text_html(self.nodes[ref]['text']), 'color': None, 'shape': None}

    def op_plug_agent(self, action, agents):
        agent = self.agent(agents, action.get('agent'))
        model = self.ready_model(action.get('model'))
        agent.model = model
        agent.save(update_fields=['model'])
        self.emit('notice', {'text': f'{agent.name} utilise maintenant {model.filename}'})
        return None

    def op_mindmap(self, action, agents):
        ref = action.get('ref') or f'auto{len(self.nodes) + 1}'
        children = [c for c in action.get('children') or [] if str(c).strip()][:12]
        if not children:
            raise PlanError('une carte mentale demande des idées (children)')
        if ref not in self.nodes:
            self.emit('action', self.op_create({**action, 'ref': ref}, agents))
        for i, text in enumerate(children, 1):
            child = f'{ref}.{i}'
            self.emit('action', self.op_create({'ref': child, 'text': text, 'near': ref, 'color': action.get('color')}, agents))
            self.emit('action', {'op': 'link', 'source': ref, 'target': child})
        return None

    # --- gabarits : structures de nodes construites par le Gardien (layouts.py), gardées dans son cerveau

    def free_area(self, points, near):
        """Origine où poser un gabarit (positions relatives `points`) sans chevaucher les nodes existants."""
        target = self.nodes.get(near) if near else None
        ax, ay = (target['x'], target['y']) if target else self.anchor
        gap = 2 * RADIUS + 40
        clear = lambda ox, oy: all(math.dist((ox + x, oy + y), o[:2]) >= gap + (o[2] - RADIUS if len(o) > 2 else 0)
                                   for x, y in points for o in self.occupied)
        for ring in range(0, 30):
            for dx, dy in ((1, 0), (0, -1), (-1, 0), (0, 1)):
                ox, oy = ax + 2 * RADIUS + 120 + dx * ring * layouts.STEP, ay + dy * ring * layouts.STEP
                if clear(ox, oy):
                    return ox, oy
        return ax + 2 * RADIUS + 120, ay - 30 * layouts.STEP

    def templates(self):
        return dict(self.guardian.brain.get('templates') or {})

    def op_build(self, action, agents):
        spec = {}
        if action.get('template'):
            spec = dict(self.templates().get(action['template']) or {})
            if not spec:
                raise PlanError(f"gabarit inconnu : {action['template']!r} (templates pour la liste)")
        spec.update({k: action[k] for k in ('layout', 'title', 'rows', 'cols', 'cells', 'items') if action.get(k)})
        spec = self.repaired(spec, action)
        if spec['layout'] in layouts.SCHEMAS and spec['layout'] not in layouts.LAYOUTS:  # « build swot » : c'est un modèle
            return self.op_schema({'type': spec['layout'], 'title': spec.get('title', ''), 'near': action.get('near')}, agents)
        try:
            nodes, links = layouts.build(spec.get('layout'), spec.get('title'), spec.get('rows'), spec.get('cols'), spec.get('cells'), spec.get('items'))
        except layouts.LayoutError as e:
            raise PlanError(str(e)) from None
        count = sum(1 for key in self.nodes if key.startswith('build') and '.' not in key)
        base = action['ref'] if str(action.get('ref', '')).startswith('new') else f'build{count + 1}'
        ox, oy = self.free_area([(n['x'], n['y']) for n in nodes], action.get('near'))
        accent = self.color(action) or '#6848A6'
        for n in nodes:
            ref = base if n['key'] == 't' else f"{base}.{n['key']}"
            x, y = round(ox + n['x']), round(oy + n['y'])
            self.nodes[ref] = {'x': x, 'y': y, 'r': RADIUS, 'text': plain(n['text']), 'new': True}
            self.occupied.append((x, y, RADIUS))
            self.emit('action', {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': text_html(n['text']),
                                 'color': accent if n['role'] in ('title', 'header') else None,
                                 'shape': 'square' if n['role'] in ('title', 'header') else None})
        for a, b in links:
            ref = lambda key: base if key == 't' else f'{base}.{key}'
            self.emit('action', {'op': 'link', 'source': ref(a), 'target': ref(b)})
        if action.get('save_as'):
            self.op_template_save({**spec, 'name': action['save_as'], 'description': action.get('description', '')}, agents)
        return None

    def repaired(self, spec, action):
        """build tolérant, comme une API interne : un petit modèle se trompe de nom de champ ou en oublie. Nom du
        gabarit en français ou synonyme, listes prises où il les a mises (cols, items, rows, names, steps, titres de
        slides), sinon des valeurs par défaut sensées : on construit plutôt que de refuser."""
        spec = dict(spec)
        layout = str(spec.get('layout') or '').strip().lower()
        spec['layout'] = LAYOUT_ALIASES.get(layout, layout)
        lists = [action.get(k) for k in ('cols', 'items', 'rows', 'names', 'steps')]
        lists.append([s.get('title') for s in action.get('slides') or [] if isinstance(s, dict) and s.get('title')])
        found = next((values for values in lists if isinstance(values, list) and values), [])
        if spec['layout'] == 'kanban' and not spec.get('cols'):
            spec['cols'] = found or ['À faire', 'En cours', 'Fait']
        elif spec['layout'] == 'matrix':
            spec['rows'] = spec.get('rows') or ['Ligne 1', 'Ligne 2']
            spec['cols'] = spec.get('cols') or ['Colonne 1', 'Colonne 2']
        elif spec['layout'] in ('timeline', 'pyramid', 'tree', 'list') and not spec.get('items'):
            spec['items'] = found or [spec.get('title') or 'Étape 1', 'Étape 2', 'Étape 3']
        return spec

    def op_grow(self, action, agents):
        """Un raisonnement qui pousse en étoile (layouts.organic) : le modèle écrit un plan libre dans `text`, une idée
        par ligne, indentée ; chaque branche a sa couleur. Avec `ref` N-12, la structure pousse autour de ce node au
        lieu d'en créer un nouveau (développer une idée existante)."""
        try:
            nodes, links = layouts.organic(action.get('text', ''))
        except layouts.LayoutError as e:
            raise PlanError(str(e)) from None
        grown = str(action.get('ref', '')) in self.nodes and str(action['ref']).startswith('N-')
        count = sum(1 for key in self.nodes if key.startswith('grow') and '.' not in key)
        base = action['ref'] if grown or str(action.get('ref', '')).startswith('new') else f'grow{count + 1}'
        if grown:
            ox, oy = self.nodes[base]['x'], self.nodes[base]['y']
        else:
            ox, oy = self.free_area([(n['x'], n['y']) for n in nodes], action.get('near'))
        accent = self.color(action) or '#6848A6'
        ref = lambda key: base if key == 't' else f'{base}.{key}'
        for n in nodes:
            if n['key'] == 't' and grown:
                continue
            x, y = round(ox + n['x']), round(oy + n['y'])
            self.nodes[ref(n['key'])] = {'x': x, 'y': y, 'r': RADIUS, 'text': plain(n['text']), 'new': True}
            self.occupied.append((x, y, RADIUS))
            color = accent if n['depth'] == 0 else BRANCHES[n['branch'] % len(BRANCHES)]
            self.emit('action', {'op': 'create', 'ref': ref(n['key']), 'x': x, 'y': y, 'text': text_html(n['text']),
                                 'color': color, 'shape': None})
            if n['depth'] < 2:  # le centre et les grandes branches ressortent
                self.emit('action', {'op': 'style', 'ref': ref(n['key']), 'color': None, 'shape': None,
                                     'radius': 110.0 if n['depth'] == 0 else 85.0, 'lock': None})
        for a, b in links:
            self.emit('action', {'op': 'link', 'source': ref(a), 'target': ref(b)})
        return None

    def op_template_save(self, action, agents):
        name = str(action.get('name') or '').strip()[:40]
        if not name:
            raise PlanError('nom de gabarit requis')
        if action.get('layout') not in layouts.LAYOUTS:
            raise PlanError(f"layout requis : {', '.join(layouts.LAYOUTS)}")
        saved = {k: action[k] for k in ('layout', 'title', 'rows', 'cols', 'cells', 'items', 'description') if action.get(k)}
        brain = dict(self.guardian.brain)
        brain['templates'] = {**self.templates(), name: saved}
        self.guardian.brain = brain
        self.guardian.save(update_fields=['brain'])
        self.sync_brain()
        self.emit('notice', {'text': f'Gabarit gardé : {name}'})
        return None

    def op_templates(self, action, agents):
        saved = self.templates()
        lines = [f"{name} : {t.get('layout')}{f' · {t['description']}' if t.get('description') else ''}"
                 f"{f' · colonnes {t['cols']}' if t.get('cols') else ''}{f' · lignes {t['rows']}' if t.get('rows') else ''}"
                 for name, t in saved.items()]
        self.read('Gabarits gardés', '\n'.join(lines) or 'aucun (build avec save_as, ou template_save, pour en garder un)')
        return None

    def op_template_delete(self, action, agents):
        saved = self.templates()
        if saved.pop(str(action.get('name')), None) is None:
            raise PlanError(f"gabarit inconnu : {action.get('name')!r}")
        self.guardian.brain = {**self.guardian.brain, 'templates': saved}
        self.guardian.save(update_fields=['brain'])
        self.sync_brain()
        return None

    def memory_hint(self, guardian):
        """Le modèle ne tient pas dans la RAM libre : il relit le disque à chaque jeton écrit. Ce qu'il faut dire à
        l'humain (tailles en Go), ou None."""
        placement = (getattr(self.engine, 'placement', {}) or {}).get(guardian.model.pk) or {}
        if placement.get('fits', True):
            return None
        return {'model_gb': round(placement['model_mb'] / 1024, 1), 'free_gb': round(placement['ram_free_mb'] / 1024, 1),
                'advice_gb': round(max(0.5, placement['ram_free_mb'] * 0.6 / 1024), 1)}

    def op_schema(self, action, agents):
        if action.get('type') not in layouts.SCHEMAS:
            raise PlanError(f"modèle inconnu : {action.get('type')!r} ({', '.join(layouts.SCHEMAS)})")
        fill = action.get('fill') or {}
        if not isinstance(fill, dict) or len(fill) > 16:
            raise PlanError('schema : fill attend un objet {intitulé: texte ou [idées]} (16 cases au plus)')
        cells = {}
        for label, value in fill.items():
            items = value if isinstance(value, list) else [value]
            if not all(isinstance(v, str) for v in items) or len(items) > 10:
                raise PlanError(f'schema : {label!r} attend un texte ou une liste de 10 idées au plus')
            texts = [text_html(short(v, 300)) for v in items if v.strip()]
            cells[short(str(label), 60)] = texts if isinstance(value, list) else (texts[0] if texts else '')
        target = self.nodes.get(action.get('near'))
        x, y = free_spot((target['x'], target['y']) if target else self.anchor, self.occupied, layouts.SCHEMA_SPAN)
        self.occupied.append((x, y, layouts.SCHEMA_SPAN))
        out = {'op': 'schema', 'type': action['type'], 'x': x, 'y': y}
        if cells:
            out['fill'] = cells
        if str(action.get('title') or '').strip():
            out['title'] = text_html(short(action['title'], 200))
        return out

    def op_tour(self, action, agents):
        return {'op': 'tour', 'ref': self.existing(action.get('ref'))}

    def op_create_agent(self, action, agents):
        name = (action.get('name') or '').strip()[:100]
        if not name or Agent.objects.filter(owner=self.user, name__iexact=name).exists():
            raise PlanError(f'nom d\'agent vide ou déjà pris : {name!r}')
        role = action.get('role') if action.get('role') in ROLES else Agent.Role.TEXT
        model = self.ready_model(action.get('model')) if action.get('model') else None
        agent = Agent.objects.create(owner=self.user, name=name, role=role, model=model,
                                     description=(action.get('description') or '')[:300], system_prompt=action.get('prompt') or '')
        agents[agent.name] = agent
        self.emit('notice', {'text': f"Nouvel agent : {agent.name}{f' ({model.filename})' if model else ' (sans modèle)'}"})
        return None

    def op_update_agent(self, action, agents):
        agent = next((a for a in Agent.objects.filter(owner=self.user) if a.name.lower() == str(action.get('agent', '')).lower()), None)
        if agent is None:
            raise PlanError(f"agent inconnu : {action.get('agent')!r}")
        fields = []
        if action.get('description'):
            agent.description, fields = action['description'][:300], fields + ['description']
        if action.get('prompt'):
            agent.system_prompt, fields = action['prompt'], fields + ['system_prompt']
        if isinstance(action.get('enabled'), bool) and agent.role != Agent.Role.ORCHESTRATOR:
            agent.enabled, fields = action['enabled'], fields + ['enabled']
        if fields:
            agent.save(update_fields=fields)
            self.emit('notice', {'text': f'{agent.name} mis à jour'})
        return None

    def op_remember(self, action, agents):
        fact = ' '.join(str(action.get('text') or '').split())[:200]
        if fact and fact not in self.guardian.memory:
            self.guardian.memory = (self.guardian.memory + [fact])[-MAX_MEMORY:]
            self.guardian.save(update_fields=['memory'])
            self.sync_memory()
        return None

    def sync_memory(self):
        """Réécrit le node « Mémoire » de l'univers ; à l'écran tout de suite s'il est dans la dimension affichée."""
        ref = (self.guardian.brain.get('universe') or {}).get('memory')
        text = 'Mémoire du Gardien\n' + '\n'.join(f'- {fact}' for fact in self.guardian.memory)
        if ref in self.nodes:
            self.emit('action', {'op': 'update', 'ref': ref, 'text': text_html(text)})
        elif ref:
            write_node(self.user, ref, text)

    def sync_brain(self):
        """Réécrit le node « Cerveau » de l'univers (gabarits, champs du cerveau)."""
        ref = (self.guardian.brain.get('universe') or {}).get('brain')
        if ref in self.nodes:
            self.emit('action', {'op': 'update', 'ref': ref, 'text': text_html(brain_text(self.guardian))})
        elif ref:
            write_node(self.user, ref, brain_text(self.guardian))

    def op_forget(self, action, agents):
        needle = str(action.get('text') or '').strip().lower()
        kept = [f for f in self.guardian.memory if not needle or needle not in f.lower()]
        if needle and len(kept) != len(self.guardian.memory):
            self.guardian.memory = kept
            self.guardian.save(update_fields=['memory'])
            self.sync_memory()
        return None

    def op_search_nodes(self, action, agents):
        query = str(action.get('query') or '').strip()
        if not query:
            raise PlanError('recherche vide')
        words = query.split()[:6]
        condition = Q()
        for word in words:
            condition |= Q(text_content__icontains=word) | Q(file_text_content__icontains=word) | Q(file_name__icontains=word)
        nodes = Node.objects.filter(condition, user=self.user, archive=False).select_related('layer')[:40]
        scored = sorted(nodes, key=lambda n: -sum(w.lower() in f'{n.text_content} {n.file_name} {n.file_text_content}'.lower() for w in words))[:10]
        for n in scored:
            self.found[f'N-{n.node_id}'] = n.layer.layer_id
        lines = [f"N-{n.node_id} (dimension {n.layer.layer_name or n.layer.layer_id}) : "
                 f"{plain(n.text_content) or n.file_name or '(vide)'}" for n in scored]
        self.reads.append(f'Nodes trouvés pour « {query} » :\n' + ('\n'.join(lines) or 'aucun'))
        return None

    def op_read_file(self, action, agents):
        if action.get('path'):  # fichier de l'espace de travail (read_file d'iAqua)
            try:
                self.reads.append(f"Fichier {action['path']} :\n{workspace.read_file(self.user, action['path'])}")
            except workspace.WorkspaceError as e:
                raise PlanError(str(e)) from None
            return None
        ref = str(action.get('ref') or '')
        node = Node.objects.filter(user=self.user, node_id=ref.removeprefix('N-')).first() if ref.startswith('N-') else None
        if node is None or not (node.file_text_content or node.text_content):
            raise PlanError(f'{ref} : aucun document lisible')
        self.reads.append(f'Contenu de {ref} ({node.file_name or node.type}) :\n{(node.file_text_content or plain(node.text_content, 4000))[:4000]}')
        return None

    def op_open(self, action, agents):
        """Répertoire d'outils : ouvre une ou plusieurs adresses (outil, dossier, « outils ») ; lu au tour suivant."""
        paths = action.get('paths') or [action.get('path') or action.get('name') or 'outils']
        opened = [(p, tools.open_path(p, self.allowed, self.docs)) for p in paths[:6]]
        missing = [p for p, text in opened if text is None]
        if missing and len(missing) == len(opened):
            raise PlanError(f"adresse inconnue : {', '.join(map(str, missing))} (exemple : outils/nodes/style ; « outils » liste les dossiers)")
        self.reads.append('Ouvert :\n' + '\n'.join(text for _, text in opened if text))
        return None

    def op_tool_help(self, action, agents):
        names = [n for n in action.get('names') or [action.get('name')] if n in tools.BY_OP and n in self.allowed]
        if not names:
            raise PlanError('outils inconnus ou coupés : cite des noms de la liste')
        self.reads.append('Modes d\'emploi :\n' + '\n'.join(f'- {tools.usage(n, self.docs)}' for n in names))
        return None

    def op_web_search(self, action, agents):
        query = str(action.get('query') or '').strip()
        try:
            results = web.search(query)
        except web.WebError as e:
            raise PlanError(str(e)) from None
        self.reads.append(f'Résultats web pour « {query} » :\n' + ('\n'.join(
            f"- {r['title']} ({r['url']}) : {r['snippet']}" for r in results) or 'aucun'))
        return None

    def op_web_fetch(self, action, agents):
        url = str(action.get('url') or '').strip()
        try:
            text = web.fetch(url)
        except web.WebError as e:
            raise PlanError(str(e)) from None
        self.reads.append(f'Page {url} :\n{text}')
        return None

    def op_goto(self, action, agents):
        ref = str(action.get('ref') or '')
        if ref in self.nodes:
            return self.op_focus(action, agents)
        if ref not in self.found:
            raise PlanError(f'{ref} : cherche-le d\'abord (search_nodes)')
        return {'op': 'goto', 'ref': ref, 'layer': self.found[ref], 'text': action.get('text', '')}

    def ready_model(self, query):
        query = (query or '').strip()
        ready = LocalModel.objects.filter(status=LocalModel.Status.READY).exclude(kind=LocalModel.Kind.COMPONENT)
        model = ready.filter(Q(filename__icontains=query) | Q(repo__icontains=query) | Q(label__icontains=query)).first() if query else None
        if model is None:
            raise PlanError(f'aucun modèle prêt ne correspond à {query!r}')
        return model

    def op_focus(self, action, agents):
        zoom = action.get('zoom')
        return {'op': 'focus', 'ref': self.existing(action.get('ref')), 'text': action.get('text', ''),
                'zoom': min(max(float(zoom), 0.1), 8.0) if isinstance(zoom, (int, float)) else None}

    def op_overview(self, action, agents):
        return {'op': 'overview', 'text': action.get('text', '')}

    def op_travel(self, action, agents):
        name = (action.get('name') or '').strip().lower()
        layer = next((l for l in self.layers if str(l.get('name', '')).lower() == name), None)
        if layer is None:
            raise PlanError(f"dimension introuvable : {action.get('name')!r}")
        return {'op': 'travel', 'layer': layer.get('id'), 'name': layer.get('name'), 'text': action.get('text', '')}

    def op_inventory(self, action, agents):
        self.reads.append(self.inventory())
        return None

    def inventory(self):
        agents = Agent.objects.filter(owner=self.user).select_related('model')
        models = LocalModel.objects.filter(status=LocalModel.Status.READY).exclude(kind=LocalModel.Kind.COMPONENT)
        current = self.layer.get('id')
        return '\n'.join([
            'Dimensions : ' + (', '.join(f"{l.get('name')}{' (courante)' if l.get('id') == current else ''}" for l in self.layers) or 'aucune'),
            'Agents : ' + ', '.join(f'{a.name} ({a.role}, {a.model.filename if a.model else "sans modèle"}'
                                    f'{", désactivé" if not a.enabled else ""})' for a in agents),
            'Modèles prêts : ' + (', '.join(f'{m.filename} ({m.kind})' for m in models) or 'aucun'),
        ])

    def read_universe(self, guardian):
        """Le Gardien installé dans l'univers : le node « Prompt système » donne ses consignes, le node d'un
        outil son mode d'emploi ; un node d'outil supprimé coupe l'outil. Renvoie les consignes (ou None)."""
        mapping = guardian.brain.get('universe')
        if not mapping:
            return None
        ids = {mapping.get('prompt'), mapping.get('memory'), *mapping.get('tools', {}).values()}
        texts = {f'N-{n.node_id}': multiline(n.text_content) for n in Node.objects.filter(
            user=self.user, archive=False, node_id__in=[i for i in map(node_id, ids) if i is not None])}
        # Node « Mémoire » : ce que l'utilisateur y écrit ou efface devient la mémoire du Gardien.
        if mapping.get('memory') in texts:
            lines = memory_lines(texts[mapping['memory']])
            if lines != guardian.memory:
                guardian.memory = lines
                guardian.save(update_fields=['memory'])
        for op, node in mapping.get('tools', {}).items():
            if node not in texts:
                self.allowed = [o for o in self.allowed if o != op]
            elif texts[node]:
                self.docs[op] = texts[node]
        return texts.get(mapping.get('prompt')) or None

    def execute(self, actions, agents):
        """Valide et émet les actions dans l'ordre ; une action invalide est signalée et sautée."""
        self.jobs, self.reads, self.done, self.failed, self.repeated = [], [], [], [], []
        for action in actions:
            op = action.get('op')
            key = json.dumps(action, sort_keys=True, ensure_ascii=False)
            if key in self.seen:  # petit modèle qui boucle : même lecture, même création qu'au tour d'avant
                self.repeated.append(op)
                continue
            self.seen.add(key)
            try:
                if op not in OPS:
                    raise PlanError(f'action inconnue : {op!r}')
                if op not in self.allowed:
                    raise PlanError(f"outil désactivé dans Agents & modèles : {op}")
                if op == 'create' and action.get('ref') in self.nodes and str(action.get('ref')).startswith('N-'):
                    # « create N-172 » : un nouveau node près de N-172 (petit modèle qui confond identifiant et référence)
                    action = {**action, 'near': action.get('near') or action['ref'], 'ref': f'auto{len(self.nodes) + 1}'}
                if op in ('create', 'put', 'delegate', 'mindmap') and not str(action.get('ref', '')).startswith(('new', 'N-', 'auto')):
                    action = {**action, 'ref': f'auto{len(self.nodes) + 1}'}  # référence manquante
                if op == 'create' and action.get('children'):
                    op, action = 'mindmap', {**action, 'op': 'mindmap'}  # un node et ses enfants : une carte mentale
                self.emit('intent', {'text': intent(action, self.nodes)})
                reads = len(self.reads)
                event = getattr(self, f'op_{op}')(action, agents)
                if event:
                    self.emit('action', event)
                if len(self.reads) == reads:  # une lecture n'est pas encore un résultat
                    self.done.append(op)
            except (PlanError, KeyError, TypeError, ValueError) as e:
                self.emit('error', {'message': f'{op} : {e}'})
                self.failed.append(f'{json.dumps(action, ensure_ascii=False)} : {e}')
            except Exception as e:  # action inattendue du modèle : elle échoue seule, la demande continue
                logger.exception('Gardien, action %s', op)
                self.emit('error', {'message': f'{op} : erreur interne ({type(e).__name__})'})
                self.failed.append(f'{json.dumps(action, ensure_ascii=False)} : action impossible, écris-la autrement')
        return self.jobs, self.reads

    def answer(self, say):
        """La réponse du Gardien : un node relié au node message, ou une ligne si la demande n'a pas de node."""
        if not self.origin:
            self.emit('text', {'text': say})
            return
        ref = f'reply{sum(1 for key in self.nodes if key.startswith("reply")) + 1}'
        self.emit('action', self.op_create({'ref': ref, 'text': say, 'near': self.origin}, {}))
        self.emit('action', {'op': 'link', 'source': self.origin, 'target': ref})

    def delegate(self, agent, task, ref, extra=None):
        self.emit('agent', {'agent': agent.name, 'ref': ref, 'task': task, 'role': agent.role})
        if agent.role == Agent.Role.IMAGE:
            return self.illustrate(agent, task, ref, extra or {})
        messages = [
            {'role': 'system', 'content': agent.system_prompt or prompts.default(agent.role)},
            {'role': 'user', 'content': task},
        ]
        text = self.engine.chat(
            agent.model, messages, on_text=lambda piece: self.emit('agent_text', {'ref': ref, 'text': piece}),
            priority=priorities.AGENT, owner=f'agent:{agent.name}', **agent.params,
        )
        self.emit('action', {'op': 'update', 'ref': ref, 'text': code_html(text) if agent.role == Agent.Role.CODE else text_html(text)})

    def illustrate(self, agent, prompt, ref, extra):
        """Image par stable-diffusion.cpp, posée dans le node `ref` ; un échec est écrit dans le node."""
        progress = lambda step, total: self.emit('intent', {'text': f'{agent.name} dessine : étape {step}/{total}'})
        try:
            with self.engine.exclusive(priorities.IMAGE, f'agent:{agent.name}'):
                name = imaging.generate(agent.model, prompt, self.user, on_progress=progress, **{**agent.params, **extra})
        except imaging.ImageUnavailable as e:
            self.emit('error', {'message': f'{agent.name} : {e}'})
            self.emit('action', {'op': 'update', 'ref': ref, 'text': text_html(f'{agent.name} : {e}')})
            return
        self.emit('action', {'op': 'image', 'ref': ref, 'url': f'toolbox/images/{name}'})

    # --- boucle

    def system(self, agents):
        """Prompt système : consignes et outils (stables) d'abord, agents et mémoire (qui changent) à la fin, pour que
        le modèle réutilise sa lecture du début d'une demande à l'autre."""
        guardian = self.guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        self.allowed = tools.enabled(guardian, self.user) if guardian else []
        guidelines = self.read_universe(guardian) if guardian else None
        if guardian is None or guardian.model is None:
            raise EngineUnavailable("le Gardien n'a pas de modèle : choisis-en un dans la bibliothèque d'agents")
        roster = '\n'.join(f'- {a.name} ({a.role}) : {a.description}' for a in agents.values()
                           if a.role != Agent.Role.ORCHESTRATOR and a.model_id) or '(aucun agent équipé)'
        memory = 'Tu te souviens :\n' + '\n'.join(f'- {f}' for f in guardian.memory) if guardian.memory else ''
        return (SYSTEM.replace('{tools}', tools.prompt(self.allowed, self.docs)).replace('{agents}', roster).replace('{memory}', memory)
                .replace('{guidelines}', guidelines or guardian.system_prompt or prompts.GUARDIAN))

    def plan_call(self, guardian, messages, round_, request, schema=PLAN_SCHEMA, on_text=None, temperature=0.2):
        """Appel du modèle pour un plan. Un prompt plus long que le contexte du modèle (ValueError de llama-cpp-python)
        est raccourci, moins de nodes et de texte puis les plus anciens tours, avant d'abandonner clairement."""
        while True:
            try:
                # Automatisation : le plan s'écrit en direct dans le chat (réflexion repliable, comme Poséidon).
                return self.engine.chat(guardian.model, messages, json_schema=schema, priority=priorities.CHAT, owner='gardien',
                                        on_text=on_text or (lambda piece: self.emit('thinking', {'round': round_, 'text': piece})),
                                        **{'temperature': temperature, **guardian.params})
            except ValueError as e:
                if 'context window' not in str(e):
                    raise
                if self.scale > 0.2:
                    self.scale /= 2
                    messages[1]['content'] = self.prompt(request)
                elif len(messages) > 3:
                    del messages[2:4]  # le plus ancien tour : réponse du modèle et ce qu'il a lu
                else:
                    raise PlanError(f"demande trop longue pour le contexte de son modèle ({e}) : augmente le contexte "
                                    'dans Agents & modèles, ou prends moins de nodes') from None
                self.emit('intent', {'text': 'Mon contexte est plein : je regarde moins de nodes…'})

    def warm(self, mode='auto'):
        """Préchauffage : le modèle du Gardien lit son prompt système en arrière-plan (sur CPU, plusieurs minutes pour
        un 7B), pour que la première demande ne lise que le message. Faux s'il était déjà lu."""
        system = self.think_system(self.agents()) if mode == 'think' else self.system(self.agents())
        return self.engine.prefill(self.guardian.model, [{'role': 'system', 'content': system}, {'role': 'user', 'content': '.'}],
                                   priority=priorities.BACKGROUND, owner='gardien:préchauffage')

    # --- mode Pensée

    def think_system(self, agents):
        """Prompt système du mode Pensée : format, outils de création et consignes, fixes (lus une fois par llama.cpp),
        puis la mémoire."""
        guardian = self.guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        if guardian is None or guardian.model is None:
            raise EngineUnavailable("le Gardien n'a pas de modèle : choisis-en un dans la bibliothèque d'agents")
        self.allowed = THINK_OPS
        memory = 'Tu te souviens :\n' + '\n'.join(f'- {f}' for f in guardian.memory) if guardian.memory else ''
        return (THINK_SYSTEM.replace('{schemas}', ', '.join(layouts.SCHEMAS)).replace('{guidelines}', prompts.THINKER)
                .replace('{memory}', memory))

    def source_node(self, request):
        """Le node d'où la pensée pousse : le node message, sinon le premier sélectionné ou joint. Sans node en contexte,
        la demande elle-même devient un node, au centre de la vue."""
        ref = self.origin or (self.selection[0] if self.selection else None)
        if ref:
            return ref
        self.emit('action', self.op_create({'ref': 'ask1', 'text': request}, {}))
        return 'ask1'

    def grow_spot(self, previous):
        """Pousse organique : la pensée suivante s'écarte de la précédente dans la direction de la chaîne, qui ondule ;
        une place prise fait tourner la pousse, puis on se rabat sur l'anneau libre le plus proche."""
        base = self.nodes[previous]
        self.heading = (math.pi / 3 if self.heading is None else self.heading) + random.uniform(-0.6, 0.6)
        step = THOUGHT_RADIUS + base['r'] + 40
        for turn in (0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3):
            angle = self.heading + turn
            x, y = base['x'] + step * math.cos(angle), base['y'] + step * math.sin(angle)
            if all(math.dist((x, y), p[:2]) >= THOUGHT_RADIUS + (p[2] if len(p) > 2 else RADIUS) + 20 for p in self.occupied):
                self.heading = angle
                return round(x), round(y)
        return free_spot((base['x'], base['y']), self.occupied, THOUGHT_RADIUS)

    def sprout(self, text, thoughts):
        """Une pensée : un petit node sans cadre, texte clair en italique, relié à la pensée d'avant (ou au source)."""
        text = ' '.join(str(text).replace('*', '').split())[:140]
        if not text or len(thoughts) >= MAX_THOUGHTS:
            return
        ref, previous = f't{len(thoughts) + 1}', thoughts[-1] if thoughts else self.source
        x, y = self.grow_spot(previous)
        self.nodes[ref] = {'x': x, 'y': y, 'r': THOUGHT_RADIUS, 'text': text, 'new': True}
        self.occupied.append((x, y, THOUGHT_RADIUS))
        self.emit('action', {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': text_html(f'[{THOUGHT_INK}]*{text}*[/]'),
                             'color': THOUGHT_COLOR, 'shape': 'none'})
        self.emit('action', {'op': 'link', 'source': previous, 'target': ref})
        thoughts.append(ref)

    def think(self, request, context):
        """Mode Pensée : un seul appel au modèle. Ses pensées poussent en nodes pendant qu'il les écrit, puis ses
        résultats se posent, rattachés aux pensées qui les ont produits. Tout ce qu'il dit est dans l'univers."""
        started = time.monotonic()
        self.request = request
        self.load(context)
        agents = self.agents()
        system = self.think_system(agents)
        guardian = self.guardian
        self.run = AIRun.objects.create(
            owner=self.user, model_id=str(guardian.model), mode=AIRun.Mode.COMMAND, prompt=request,
            context_node_ids=[n['id'] for n in self.context], status=AIRun.Status.RUNNING,
        )
        self.emit('start', {'run': str(self.run.id)})
        try:
            self.source = self.source_node(request)
            thoughts, stream = [], ThoughtStream()

            def heard(piece):
                self.emit('tick', None)  # un arrêt demandé coupe le modèle au fragment suivant, même entre deux pensées
                for text in stream.feed(piece):
                    self.sprout(text, thoughts)

            self.emit('intent', {'text': 'Je réfléchis…'})
            messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': self.prompt(request)}]
            raw = self.plan_call(guardian, messages, 0, request, schema=THINK_SCHEMA, on_text=heard, temperature=0.6)
            last = (getattr(self.engine, 'stats', {}).get(guardian.model.pk) or {}).get('last')
            if last:
                self.timings.append(last)
            try:
                answer = json.loads(raw)
            except json.JSONDecodeError:  # coupé en route : ses pensées sont déjà posées, ses résultats sont perdus
                answer = {}
                self.emit('notice', {'text': 'Mon modèle s\'est emballé : je garde ses pensées, sans ses résultats.'})
            for text in answer.get('thoughts') or []:  # celles que le flux n'a pas vues passer (moteur sans flux)
                if ' '.join(str(text).replace('*', '').split())[:140] not in [self.nodes[t]['text'] for t in thoughts]:
                    self.sprout(text, thoughts)
            # Les portails en dernier : tout le reste est posé dans la dimension du node source avant qu'on les ouvre.
            self.execute(sorted(answer.get('actions') or [], key=lambda a: a.get('op') == 'portal'), agents)
            made = [ref for ref, n in self.nodes.items() if n.get('new')]
            if made:  # la caméra cadre la pensée entière : le node source, ses pensées et ses résultats
                self.emit('action', {'op': 'frame', 'refs': [self.source, *made]})
            if not thoughts and not self.done:
                raise PlanError("mon modèle n'a rien pensé ni créé : reformule, ou prends un modèle plus grand")
            if self.timings:
                self.emit('timing', {'calls': len(self.timings), 'total_s': round(time.monotonic() - started, 1),
                                     'wait_s': round(sum(t['wait_s'] for t in self.timings), 1),
                                     'prompt_tokens': self.timings[0]['prompt_tokens'],
                                     'speed': self.timings[-1]['speed'], 'memory': self.memory_hint(guardian)})
            self.run.status = AIRun.Status.DONE
        except Exception as e:
            self.run.status, self.run.error = AIRun.Status.ERROR, str(e)
            raise
        finally:
            self.run.duration_ms = int((time.monotonic() - started) * 1000)
            self.run.save(update_fields=['status', 'error', 'duration_ms'])

    # --- mode Automatisation

    def handle(self, request, context):
        if isinstance(context, dict) and context.get('mode') == 'think':
            return self.think(request, context)
        started = time.monotonic()
        self.request = request
        self.load(context)
        agents = self.agents()
        system = self.system(agents)
        guardian = self.guardian
        self.letters = self.correspondence()
        self.run = AIRun.objects.create(
            owner=self.user, model_id=str(guardian.model), mode=AIRun.Mode.COMMAND, prompt=request,
            context_node_ids=[n['id'] for n in self.context], status=AIRun.Status.RUNNING,
        )
        self.emit('start', {'run': str(self.run.id)})
        try:
            messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': self.prompt(request)}]
            say, done, steps, read, nudged, cut = '', [], [], False, False, False
            failures = []  # toutes les erreurs de la demande : la raison dite à l'humain si rien n'a abouti
            for round_ in range(MAX_ROUNDS):
                self.emit('intent', {'text': 'Je lis ton message et le plan…' if round_ == 0 else 'Je lis ce que j\'ai trouvé et je continue…'})
                # Le plan s'écrit en direct dans le chat (réflexion repliable, comme Poséidon).
                raw = self.plan_call(guardian, messages, round_, request)
                last = (getattr(self.engine, 'stats', {}).get(guardian.model.pk) or {}).get('last')
                if last:
                    self.timings.append(last)
                cut = False
                try:
                    plan = json.loads(raw)
                except json.JSONDecodeError:
                    # Avec la grammaire JSON, seul un texte coupé est hors format : boucle arrêtée ou longueur maximale.
                    why = 'il tournait en boucle' if last and last.get('stopped') else \
                        f"coupé après {last['tokens']} jetons" if last else 'réponse coupée'
                    plan, cut = salvage(raw), True
                    if plan is None:
                        raise PlanError(f'le Gardien s\'est emballé ({why}) : réessaie, ou prends un modèle plus grand') from None
                    self.emit('notice', {'text': f'Le Gardien s\'est emballé ({why}) : je garde ce qu\'il a dit, sans ses actions.'})
                say = plan.get('say') or say
                steps = [short(step, 80) for step in plan.get('plan') or [] if str(step).strip()][:8]
                if steps:
                    self.emit('plan', {'steps': steps})
                jobs, reads = self.execute(plan.get('actions') or [], agents)
                done += self.done
                failures += self.failed
                read = read or bool(reads)
                for job in jobs:  # (agent, consigne, node) ou, pour une retouche d'image, plus l'image source
                    self.delegate(*job)
                if cut or self.asked:
                    break  # boucle : elle recommencerait ; question : on attend la réponse de l'humain
                # Tour suivant si le modèle a lu, s'est trompé, ou a annoncé un plan sans rien faire.
                feedback = list(reads)
                if self.failed:
                    feedback.append('Ces actions ont échoué ; corrige-les (identifiants existants, champs requis) :\n'
                                    + '\n'.join(f'- {f}' for f in self.failed))
                if self.repeated and not (self.done or reads or self.failed):
                    if nudged or failures:
                        break  # il reboucle, ou refait ce qui a échoué : inutile de relancer (chaque tour coûte)
                    nudged = True
                    feedback.append(f"Tu refais {', '.join(sorted(set(self.repeated)))} à l'identique (déjà fait ou refusé : voir plus haut). "
                                    "N'ajoute plus d'action : réponds maintenant dans say, à partir de ce que tu as lu.")
                elif steps and not self.done and not reads and not self.failed and not read:
                    feedback.append(f"Tu as annoncé « {' ; '.join(steps)} » sans aucune action : rien n'a été fait. "
                                    'Réponds maintenant avec les actions qui le réalisent.')
                if not feedback or round_ == MAX_ROUNDS - 1:
                    break  # dernier tour : sa réponse devient le node-réponse (une seule par message)
                self.emit('intent', {'text': 'Je corrige mon plan…' if self.failed or not reads else 'Je lis ce que j\'ai trouvé…'})
                messages += [
                    {'role': 'assistant', 'content': raw},
                    {'role': 'user', 'content': '\n'.join(feedback) + '\nContinue la demande sans refaire les actions déjà faites.'},
                ]
            if steps and not done and not read:  # jamais de promesse dans le node-réponse quand rien n'a été fait
                reason = "mon modèle s'est emballé en écrivant ses actions" if cut else \
                    failures[-1].rsplit(' : ', 1)[-1] if failures else "mon modèle n'a proposé aucune action"
                say = (f"Je n'ai pas réussi à le faire ({reason}). Reformule ta demande, "
                       'ou donne-moi un modèle plus grand dans Agents & modèles.')
            if say:
                self.answer(say)
            if self.timings:  # ce qui a pris du temps : lecture du prompt, génération, nombre d'appels
                self.emit('timing', {'calls': len(self.timings), 'total_s': round(time.monotonic() - started, 1),
                                     'wait_s': round(sum(t['wait_s'] for t in self.timings), 1),
                                     'prompt_tokens': self.timings[0]['prompt_tokens'],
                                     'speed': self.timings[-1]['speed'], 'memory': self.memory_hint(guardian)})
            self.run.status = AIRun.Status.DONE
        except Exception as e:
            self.run.status, self.run.error = AIRun.Status.ERROR, str(e)
            raise
        finally:
            self.run.duration_ms = int((time.monotonic() - started) * 1000)
            self.run.save(update_fields=['status', 'error', 'duration_ms'])
