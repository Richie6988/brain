"""Le Gardien : orchestrateur garant de l'intégrité de l'univers.

Il ne touche pas aux données lui-même : la page Nodz (v1, /universe) lui envoie le contexte du plan
(nodes, liens, plans, sélection) ; il réfléchit avec le modèle de son agent (JSON contraint par
grammaire) et renvoie des actions validées que la page exécute avec les fonctions de Nodz
(createNode, createLink, focusNode, dragUniverse, zoom…), donc avec sa sauvegarde et son feel.
Il place les nouveaux nodes sans chevauchement, délègue la production aux agents de la
bibliothèque et publie leur résultat dans le node visé. Chaque demande est tracée par un AIRun.
"""

import copy
import html
import itertools
import json
import logging
import math
import random
import re
import threading
import time

from django.db import connection
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
# Modèle par API (grand contexte, lecture rapide) : il voit l'univers en grand ; les limites ci-dessus sont celles d'un
# petit modèle local sur CPU, où chaque jeton du prompt se paie.
RICH_SCALE, RICH_NODES, RICH_ATTACHED, RICH_HISTORY = 20, 400, (20000, 80000), (20, 2000)
API_TOKENS = 4096  # réponse d'un modèle par API sans longueur réglée (1024 par défaut coupait les plans)
MAX_ROUNDS = 4  # un tour de plus après chaque lecture (inventaire, web, recherche, fichier)
TYPES = ['text', 'image', 'file', 'canvas', 'code']  # types de node de Nodz
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

# Mode Automatisation : partie technique (format et outils), fixe ; ses règles (prompts.AUTOMATION, ou celles écrites
# dans l'univers) s'y ajoutent. Les consignes du Gardien réglées dans Agents & modèles sont son prompt du mode Pensée.
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

# --- Mode Pensée (par défaut dans l'univers) : Nodz est l'API de l'IA. Elle ne répond que par des calls : ses think
# deviennent aussitôt des nodes discrets pendant qu'elle écrit ; ses autres calls forment un plan, exécuté une fois écrit.
# Pas de chat ; l'automatisation lourde (fichiers, agents, missions) reste au mode Automatisation (boucle de handle()).
THINK_OPS = ['think', 'put', 'nodes', 'style', 'link', 'grow', 'build', 'schema', 'explore', 'portal']
# L'agentique minimal du mode Pensée, par le catalogue d'outils (ceux cochés dans Agents & modèles) : modifier,
# supprimer, aller dans les dimensions, lire (l'univers, un document, le web) avant de continuer sa pensée.
THINK_TOOLS = ['update', 'archive', 'unlink', 'travel', 'goto', 'search_nodes', 'inventory', 'read_file',
               'templates', 'template_save', 'web_search', 'web_fetch']
MAX_READS = 2  # tours de lecture d'une pensée : ce qu'elle a lu lui revient, elle continue
# Noms des commandes pour le modèle : les mots qu'on emploie (« delete », « edit »), pas ceux du catalogue.
THINK_NAMES = {'archive': 'delete', 'update': 'edit'}
MAX_THOUGHTS = 12
MAX_CALLS = 150  # calls d'un plan
MAX_BATCH = 40   # nodes d'un call nodes
THINK_TOKENS = 4096  # un plan de 150 calls tient dans la réponse ; la longueur réglée pour le modèle prime
THOUGHT_RADIUS = 60      # place d'une pensée (petit node sans cadre)
SPARK_RADIUS = 45        # place d'une étincelle de la réflexion libre (mode Profond)
# Genres de pensée : la marque qui l'ouvre, la couleur de son lien, l'encre de son texte et sa mise en forme.
KINDS = {
    'idea': ('', '#8B7FC8', '#C9BEF2', '*{}*'),
    'doubt': ('?', '#C9A24A', '#F2D98B', '*? {}*'),
    'dropped': ('✗', '#5A5575', '#8A85A8', '~~{}~~'),
    'decision': ('✓', '#B89AF2', '#EFE9FF', '**✓ {}**'),
}
MARKS = {mark: kind for kind, (mark, *_rest) in KINDS.items() if mark}
SPARK_INK, SPARK_COLOR = '#8FD3E8', '#3E6B7A'      # réflexion libre (mode Profond) : étincelles bleu pâle
MAX_WHISPERS, MAX_SPARKS = 12, 10
# Mot presque dit : le modèle hésitait (son choix sous 75 %) et ce mot avait au moins 12 % de chances.
HESITATION, NEAR_MISS = 0.75, 0.12
MUSE = ('Avant ta réponse, pense librement à voix haute, sans JSON : fragments courts, un par ligne (intuitions, '
        'doutes, associations, pistes que tu écartes). 3 à 8 fragments.')
# Champs des calls du mode Pensée seulement : une grammaire plus petite s'échantillonne plus vite. kind et under avant
# text : le genre et la place d'une pensée sont connus dès son premier mot.
THINK_FIELDS = ('ref', 'near', 'text', 'source', 'target', 'color', 'shape', 'radius', 'content_type', 'children', 'links',
                'layout', 'type', 'fill', 'rows', 'cols', 'items', 'cells', 'title', 'name', 'task', 'template',
                'query', 'url', 'path', 'save_as', 'description')
# L'IA appelle l'IA : une branche confiée à une autre instance, qui la creuse depuis sa place dans l'arbre.
MAX_EXPLORE, MAX_DEPTH, MAX_EXPLORATIONS = 2, 2, 4  # par réponse, profondeur, par demande
LINEAGE = 8  # nodes du chemin dans l'arbre montrés au modèle
# Couleurs par défaut des résultats sans couleur : une par pensée d'attache, pour que les familles se lisent.
RESULT_COLORS = ['#4D96FF', '#33FF99', '#FFD93D', '#FF6B6B', '#C77DFF', '#FF9F45', '#4DD4C6', '#F15BB5']


def think_schema(ops):
    """La réponse du mode Pensée : uniquement des calls (parmi `ops`), un plan de MAX_CALLS au plus."""
    fields = PLAN_SCHEMA['properties']['actions']['items']['properties']
    return {
        'type': 'object',
        'required': ['calls'],
        'properties': {
            'calls': {'type': 'array', 'maxItems': MAX_CALLS, 'items': {'type': 'object', 'required': ['op'], 'properties': {
                'op': {'type': 'string', 'enum': ops},
                'kind': {'type': 'string', 'enum': list(KINDS)},
                'under': {'type': 'string'},
                **{k: fields[k] for k in THINK_FIELDS}}}},
        },
    }



class ThoughtStream:
    """Le flux JSON "calls", caractère par caractère : chaque call dès qu'il est fermé ; le texte d'un call think pendant
    qu'il s'écrit (sa pensée pousse en direct). `inside` : le modèle écrit en ce moment le texte de la pensée `index`."""

    START = re.compile(r'"calls"\s*:\s*\[')
    THINK = re.compile(r'^\{\s*"op"\s*:\s*"think"\s*,(.*)"text"\s*:\s*"$', re.S)  # le texte d'une pensée commence
    META = re.compile(r'"(kind|under)"\s*:\s*"([^"]*)"')

    def __init__(self, base=0):
        self.buffer, self.at, self.closed = '', None, False
        self.index, self.inside, self.chars, self.escape = base - 1, False, [], ''  # base : pensées des tours d'avant
        self.item, self.call, self.depth, self.quoted, self.escaped = -1, [], 0, False, False  # call en cours
        self.meta, self.thinks = {}, {}  # genre et place de la pensée en cours ; rang du call → pensée

    def feed(self, piece):
        """[(('t', index), (texte jusqu'ici, terminée, {kind, under})) ou (('c', rang du call), call)] : dans l'ordre du
        flux, une entrée par pensée qui a avancé dans ce fragment et par call terminé."""
        self.buffer += piece
        if self.closed:
            return []
        if self.at is None:
            start = self.START.search(self.buffer)
            if not start:
                return []
            self.at = start.end()
        moved = {}
        while self.at < len(self.buffer) and not self.closed:
            c = self.buffer[self.at]
            self.at += 1
            if not self.depth:
                if c == '{':
                    self.depth, self.call, self.item = 1, [c], self.item + 1
                elif c == ']':
                    self.closed = True
                continue
            self.call.append(c)
            if self.inside:  # le texte d'une pensée, lettre à lettre
                if self.escape:
                    self.escape += c
                    if self.escape[1] != 'u' or len(self.escape) == 6:
                        try:
                            self.chars.append(json.loads(f'"{self.escape}"'))
                        except json.JSONDecodeError:
                            pass
                        self.escape = ''
                elif c == '\\':
                    self.escape = c
                elif c == '"':
                    self.inside = False
                    moved[('t', self.index)] = (''.join(self.chars), True, self.meta)
                    continue
                else:
                    self.chars.append(c)
                moved[('t', self.index)] = (''.join(self.chars), False, self.meta)
                continue
            if self.escaped:
                self.escaped = False
            elif self.quoted:
                self.escaped, self.quoted = c == '\\', c != '"'
            elif c == '"':
                self.quoted = True
                think = self.depth == 1 and self.item not in self.thinks and self.THINK.match(''.join(self.call))
                if think:
                    self.index += 1
                    self.thinks[self.item] = self.index
                    self.inside, self.chars, self.quoted = True, [], False
                    self.meta = dict(self.META.findall(think.group(1)))
                    moved[('t', self.index)] = ('', False, self.meta)
            elif c in '{}':
                self.depth += 1 if c == '{' else -1
                if not self.depth:
                    try:
                        moved[('c', self.item)] = json.loads(''.join(self.call))
                    except json.JSONDecodeError:
                        pass  # la réponse entière, relue à la fin, le rattrape
        return list(moved.items())


def think_ops(agent):
    """Commandes du mode Pensée pour ce Gardien : celles de création, plus les outils agentiques qu'il a cochés."""
    enabled = tools.enabled(agent, agent.owner)
    return THINK_OPS + [THINK_NAMES.get(op, op) for op in THINK_TOOLS if op in enabled]


def guardian_prompt(agent, ops=None, docs=None, default=False):
    """Le prompt système du Gardien tel qu'il le reçoit (sa mémoire en plus) et tel que l'écran « Consignes » le montre :
    ses consignes si elles sont un prompt complet (des commandes {"calls"}), sinon le prompt par défaut (prompts.GUARDIAN)
    et, à la fin, ces consignes plus anciennes ; la liste des modèles et ses outils cochés y sont écrits en entier."""
    ops = ops or think_ops(agent)
    custom = '' if default else (agent.system_prompt or '').strip()
    template = custom if '"calls"' in custom else prompts.GUARDIAN + (f'\n\nConsignes :\n{custom}' if custom else '')
    return (template.replace('{schemas}', ', '.join(layouts.SCHEMAS))
            .replace('{tools}', '\n'.join(command(tools.usage(op, docs).replace(f'"op":"{op}"', f'"op":"{THINK_NAMES.get(op, op)}"'),
                                                  tools.BY_OP[op].get('read')) for op in THINK_TOOLS if THINK_NAMES.get(op, op) in ops)))


def command(usage, read=False):
    """Une commande du prompt système : son JSON, puis ce qu'elle fait (« {json} → effet »), [L] pour une lecture."""
    example, _, effect = usage.partition('} : ')
    return f"{example}}} → {'[L] ' if read else ''}{effect}" if effect else usage


def thought_shape(raw, kind=None):
    """Genre d'une pensée (celui du call, sinon sa marque « ? », « ✗ », « ✓ » en tête) et son texte nettoyé."""
    body = raw.strip()
    marked = MARKS.get(body[:1])
    text = body[1:] if marked else body
    return (kind if kind in KINDS else marked or 'idea'), ' '.join(text.replace('*', '').replace('~', '').split())[:140]


def near_misses(piece, chances):
    """Mots que le modèle a failli écrire à la place de `piece` : seulement quand il hésitait vraiment."""
    if not chances or chances[0][1] >= HESITATION:
        return []
    chosen = piece.strip().lower()
    return [word for word, p in ((token.strip(), p) for token, p in chances)
            if p >= NEAR_MISS and len(word) >= 3 and word.isalpha() and word.lower() != chosen]


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
    (re.compile(r'~~(.+?)~~'), r'<s>\1</s>'),
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
        'explore': lambda a: f"Je confie {name(a.get('ref'))} à une autre instance de moi : {short(a.get('task'), 60)}",
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
        self.max_nodes, (self.attached_text, self.attached_total) = MAX_CONTEXT_NODES, (ATTACHED_TEXT, ATTACHED_TOTAL)
        self.history_turns, self.history_text = HISTORY, HISTORY_TEXT
        self.direct = False  # demande directe depuis un node : seuls ses nodes dans le prompt (load)
        self.letters = []  # réponses de l'humain à ses notes (correspondance)
        self.attached_away = []  # nodes joints d'autres dimensions (sélecteur de contexte)
        self.allowed = []  # outils permis (lus avec le prompt système)
        self.source = None  # mode Pensée : le node d'où la pensée pousse
        self.heading = None  # mode Pensée : direction de la pousse, qui ondule d'une pensée à l'autre
        self.parents = {}  # mode Pensée : node → son parent dans l'arbre de la pensée (pensées, résultats)
        self.suffix = ''  # mode Pensée : marque les références d'une instance appelée (t1.x1, new1.x1)
        self.explorations = []  # branches confiées par la réponse en cours : (node, consigne)
        self.branches = itertools.count(1)  # instances appelées pendant la demande (partagé par les branches)
        self.lots = itertools.count(1)  # lots de nodes (call nodes) de la demande

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
        self.attached, budget = [], self.attached_total
        # joints depuis d'autres dimensions (sélecteur de contexte) : lus en base, texte complet et dimension
        self.attached_away = [i for i in dict.fromkeys(attached) if i not in by_id and node_id(i)][:MAX_ATTACHED_AWAY]
        for i in dict.fromkeys(attached):
            if i in by_id and budget > 0:
                text = multiline(by_id[i].get('text', ''))[:min(self.attached_text, budget)]
                self.attached.append((i, text))
                budget -= len(text)
        selection = [i for i, _ in self.attached] + [i for i in selection if i not in dict(self.attached)]
        selected = [by_id[i] for i in selection if i in by_id]
        # Demande directe (depuis un node, ou la pastille sur une sélection) : le prompt ne montre que ces nodes, leur
        # contenu entier et leur ID, sans les voisins ni la conversation du chat. Depuis le chat : la page et le chat.
        direct = self.direct = context.get('source') == 'node'
        if direct and context.get('origin') in by_id and context['origin'] not in selection:
            selected.append(by_id[context['origin']])
        others = [] if direct else sorted((n for n in nodes if n['id'] not in selection),
                                          key=lambda n: math.dist((_number(n.get('x')), _number(n.get('y'))), center))
        # Les plus proches de la vue, listés dans l'ordre des identifiants : d'une demande à l'autre la liste change
        # peu et llama.cpp réutilise sa lecture (sinon, un léger déplacement réordonne tout et tout est relu).
        self.nearest = (selected + others)[:self.max_nodes]  # du plus proche au plus loin (raccourci si trop long)
        self.context = sorted(self.nearest, key=lambda n: node_id(n['id']) or 0)
        self.history = [(h['role'], ' '.join(multiline(str(h.get('text') or '')).split())[:self.history_text])
                        for h in ([] if direct else context.get('history') or [])[-self.history_turns:]
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
        agents = {a.name: a for a in Agent.objects.filter(owner=self.user, enabled=True).select_related('model')}
        guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        if guardian and guardian.model and guardian.model.endpoint:  # modèle par API : l'univers en grand (avant load)
            self.scale, self.max_nodes = RICH_SCALE, RICH_NODES
            (self.attached_text, self.attached_total), (self.history_turns, self.history_text) = RICH_ATTACHED, RICH_HISTORY
        return agents

    def prompt(self, request):
        """Message du modèle : la dimension, puis chaque node en un objet (perception.py), la conversation et la demande.
        Le texte est entier pour les nodes joints, sélectionnés, cités ou le node message ; les nodes cités hors de la
        page (autre dimension) sont lus en base : aucun tour de lecture pour eux."""
        cited = list(dict.fromkeys(re.findall(r'N-\d+', request)))[:4]
        limits = dict((i, len(text) or 1) for i, text in self.attached)  # nodes joints : dans le budget de load()
        full = {*limits, *(self.selection if self.direct else self.selection[:3]), *([self.origin] if self.origin else []), *cited}
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
            *([f"Où tu en es dans l'arbre : {' → '.join(path)} (ici)"] if len(path := self.lineage(self.source)) > 1 else []),
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
                'color': self.color(action), 'shape': action.get('shape') if action.get('shape') in SHAPES else None,
                'free': True}  # la physique de la page l'écarte de ses voisins

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
        if created and action.get('content_type') in TYPES and action['content_type'] != 'text':
            self.emit('action', self.op_set_type(action, agents))
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
        items = [text_html(str(t)) for t in action.get('items') or [] if str(t).strip()][:MAX_BATCH]
        # Mode Pensée : la page ouvre le portail puis revient, la pensée reste sous les yeux (gate) ; sinon on y entre.
        # items : le détail, posé dans la nouvelle dimension autour du portail.
        return {'op': 'gate' if self.source else 'portal', 'ref': self.existing(action.get('ref')), 'name': name,
                **({'items': items} if items else {})}

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

    def op_nodes(self, action, agents):
        """Un lot de nodes d'un coup (MAX_BATCH au plus), chacun relié à near : pour les longues listes."""
        near = self.existing(action.get('near'))
        items = [str(t) for t in action.get('items') or [] if str(t).strip()][:MAX_BATCH]
        if not items:
            raise PlanError('nodes : items vide')
        base = f'lot{next(self.lots)}{self.suffix}'
        for i, text in enumerate(items, 1):
            ref = f'{base}.{i}'
            self.emit('action', self.op_create({'ref': ref, 'text': text, 'near': near, 'color': action.get('color'),
                                                'shape': action.get('shape')}, agents))
            self.emit('action', {'op': 'link', 'source': near, 'target': ref})
            self.parents[ref] = near
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
        base = action['ref'] if str(action.get('ref', '')).startswith('new') else f'build{count + 1}{self.suffix}'
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
        if self.nodes.get(action.get('near'), {}).get('new'):  # posé depuis une pensée : il pend à son arbre
            self.parents[base] = action['near']
            self.emit('action', {'op': 'link', 'source': action['near'], 'target': base})
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
                if op not in OPS and op not in THINK_OPS:  # explore n'existe qu'en mode Pensée
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
                .replace('{guidelines}', guidelines or prompts.AUTOMATION))

    def plan_call(self, guardian, messages, round_, request, schema=PLAN_SCHEMA, on_text=None, temperature=0.2, on_token=None,
                  max_tokens=None):
        """Appel du modèle pour un plan. Un prompt plus long que le contexte du modèle (ValueError de llama-cpp-python)
        est raccourci, moins de nodes et de texte puis les plus anciens tours, avant d'abandonner clairement."""
        if not max_tokens and guardian.model.endpoint and not guardian.model.params.get('max_tokens'):
            max_tokens = API_TOKENS
        while True:
            try:
                # Automatisation : le plan s'écrit en direct dans le chat (réflexion repliable, comme Poséidon).
                return self.engine.chat(guardian.model, messages, json_schema=schema, priority=priorities.CHAT, owner='gardien',
                                        on_text=on_text or (lambda piece: self.emit('thinking', {'round': round_, 'text': piece})),
                                        **({'on_token': on_token} if on_token else {}),
                                        **{'temperature': temperature, **({'max_tokens': max_tokens} if max_tokens else {}),
                                           **guardian.params})
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
        system = self.think_system(self.agents()) if mode in ('think', 'deep') else self.system(self.agents())
        return self.engine.prefill(self.guardian.model, [{'role': 'system', 'content': system}, {'role': 'user', 'content': '.'}],
                                   priority=priorities.BACKGROUND, owner='gardien:préchauffage')

    # --- mode Pensée

    def think_system(self, agents):
        """Prompt système du mode Pensée : format, outils de création et consignes, fixes (lus une fois par llama.cpp),
        puis la mémoire."""
        guardian = self.guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        if guardian is None or guardian.model is None:
            raise EngineUnavailable("le Gardien n'a pas de modèle : choisis-en un dans la bibliothèque d'agents")
        self.allowed = think_ops(guardian)
        self.allowed += [op for op, name in THINK_NAMES.items() if name in self.allowed]  # delete s'exécute en archive
        memory = 'Tu te souviens :\n' + '\n'.join(f'- {f}' for f in guardian.memory) if guardian.memory else ''
        saved = self.templates()
        if saved:
            memory = f"{memory}\nTes gabarits gardés : {', '.join(saved)}".strip()
        return '\n'.join(filter(None, [guardian_prompt(guardian, self.allowed, self.docs), memory]))

    def source_node(self, request):
        """Le node d'où la pensée pousse : le node message, sinon le premier sélectionné ou joint. Sans node en contexte,
        la demande elle-même devient un node, au centre de la vue."""
        ref = self.origin or (self.selection[0] if self.selection else None)
        if ref:
            return ref
        self.emit('action', self.op_create({'ref': 'ask1', 'text': request}, {}))
        return 'ask1'

    def grow_spot(self, previous, turn=0.0, radius=THOUGHT_RADIUS, gap=40):
        """Pousse organique : le node suivant s'écarte de `previous` dans la direction de la pousse, qui ondule (une
        branche part de biais : `turn`) ; une place prise fait tourner la pousse, puis on se rabat sur l'anneau libre
        le plus proche. Seule la pensée principale entraîne la direction."""
        base = self.nodes[previous]
        if self.heading is None:
            self.heading = math.pi / 3
        heading = self.heading + turn + random.uniform(-0.6, 0.6)
        step = radius + base['r'] + gap
        for shift in (0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3):
            angle = heading + shift
            x, y = base['x'] + step * math.cos(angle), base['y'] + step * math.sin(angle)
            if all(math.dist((x, y), p[:2]) >= radius + (p[2] if len(p) > 2 else RADIUS) + 20 for p in self.occupied):
                if not turn:
                    self.heading = angle
                return round(x), round(y)
        return free_spot((base['x'], base['y']), self.occupied, radius)

    def speck(self, ref, near, text, ink, color, turn=0.0):
        """Une étincelle de la réflexion libre : tout petit node sans cadre, texte menu, relié à `near`."""
        x, y = self.grow_spot(near, turn=turn, radius=SPARK_RADIUS, gap=10)
        self.nodes[ref] = {'x': x, 'y': y, 'r': SPARK_RADIUS, 'text': text, 'new': True}
        self.occupied.append((x, y, SPARK_RADIUS))
        self.emit('action', {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': text_html(f',,[{ink}]{text}[/],,'),
                             'color': color, 'shape': 'none', 'free': True})
        self.emit('action', {'op': 'link', 'source': near, 'target': ref})

    def thought_html(self, kind, text):
        _mark, _color, ink, form = KINDS[kind]
        return text_html(f'[{ink}]' + form.format(text) + '[/]')

    def form(self, index, raw, done, meta=None):
        """Une pensée (call think) qui s'écrit : posée dès son premier mot (kind et under disent comment et où),
        écrite en direct (brouillon, non sauvegardé), puis figée et sauvegardée ; alors ses échos et ses mots presque
        dits apparaissent. Sans under, elle suit la pensée principale ; avec, elle en est une branche."""
        kind, text = thought_shape(raw, (meta or {}).get('kind'))
        entry = self.formed.get(index)
        if entry is None:
            if not text or len(self.formed) >= MAX_THOUGHTS:
                return
            ref = f't{index + 1}{self.suffix}'
            under = self.remap({'ref': str((meta or {}).get('under') or '')})['ref']
            branch_of = next((e for e in self.formed.values() if e['ref'] == under), None)
            depth = min(branch_of['depth'] + 1, 2) if branch_of else 1 if under in self.nodes else 0
            parent = under if depth else self.levels.get(0, self.source)
            self.parents[ref] = parent
            branch = depth and (0.9 if len([e for e in self.formed.values() if e['depth'] == depth]) % 2 else -0.9)
            x, y = self.grow_spot(parent, turn=branch * depth)
            self.nodes[ref] = {'x': x, 'y': y, 'r': THOUGHT_RADIUS, 'text': text, 'new': True}
            self.occupied.append((x, y, THOUGHT_RADIUS))
            entry = self.formed[index] = {'ref': ref, 'depth': depth, 'kind': kind, 'text': ''}
            self.emit('action', {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': self.thought_html(kind, text),
                                 'color': KINDS[kind][1], 'shape': 'none', 'forming': not done, 'free': True})
            self.emit('action', {'op': 'link', 'source': parent, 'target': ref})
            self.levels = {**{d: r for d, r in self.levels.items() if d < depth}, depth: ref}
        elif text != entry['text'] and not done:
            self.emit('action', {'op': 'draft', 'ref': entry['ref'], 'text': self.thought_html(entry['kind'], text)})
        entry['text'] = self.nodes[entry['ref']]['text'] = text
        if done and not entry.get('done'):
            entry['done'] = True
            self.emit('action', {'op': 'update', 'ref': entry['ref'], 'text': self.thought_html(entry['kind'], text)})
            self.echo(entry['ref'], text)
            words = self.whispers.pop(index, [])[:max(0, MAX_WHISPERS - self.dust)]
            if words:  # éphémères : la page les fait flotter puis s'évaporer, rien n'est sauvegardé
                self.dust += len(words)
                self.emit('action', {'op': 'whisper', 'ref': entry['ref'], 'words': words})

    def echo(self, ref, text):
        """Fils d'écho : la pensée rappelle un node de l'univers (cité N-12, ou dont le titre court apparaît en toutes
        lettres) ; deux au plus."""
        lower = text.lower()
        cited = [r for r in re.findall(r'N-\d+', text) if r in self.nodes and not self.nodes[r].get('new')]
        named = [n['id'] for n in self.context if 4 <= len(self.nodes[n['id']]['text']) <= 40
                 and self.nodes[n['id']]['text'].lower() in lower and n['id'] != self.source]
        for target in list(dict.fromkeys(cited + named))[:2]:
            self.emit('action', {'op': 'link', 'source': ref, 'target': target})

    def overheard(self, stream, piece, chances):
        """Mots presque dits pendant qu'une pensée s'écrit : gardés pour elle, posés quand elle est finie."""
        if stream.inside or piece.endswith('"'):
            words = self.whispers.setdefault(stream.index, [])
            for word in near_misses(piece, chances):
                if word not in words and len(words) < 3:
                    words.append(word)

    def painted(self, action):
        """Résultat sans couleur : une couleur par pensée d'attache (ou par node voisin), pour que les familles de
        résultats se lisent. Les couleurs choisies par le modèle restent."""
        if action.get('op') != 'put' or action.get('color') or not str(action.get('ref', '')).startswith('new'):
            return action
        return {**action, 'color': RESULT_COLORS[self.families.setdefault(action.get('near') or '', len(self.families)) % len(RESULT_COLORS)]}

    def muse(self, guardian, messages):
        """Mode Profond : le modèle pense d'abord librement (sans format) ; chaque fragment devient une étincelle qui
        dérive depuis le node source, de l'autre côté de la pensée. Rend sa réflexion, relue par l'appel suivant."""
        sparks, line = [], []

        def spark(fragment):
            fragment = ' '.join(re.sub(r'</?think>|^[-*•\d.)\s]+', '', fragment).replace('*', '').split())[:120]
            if len(fragment.split()) >= 2 and len(sparks) < MAX_SPARKS:
                ref = f's{len(sparks) + 1}'
                self.speck(ref, sparks[-1] if sparks else self.source, fragment, SPARK_INK, SPARK_COLOR,
                           turn=math.pi + random.uniform(-0.5, 0.5) if not sparks else random.uniform(-0.8, 0.8))
                sparks.append(ref)

        def heard(piece):
            self.emit('tick', None)
            for c in piece:
                line.append(c)
                if c in '\n.!?…':
                    spark(''.join(line))
                    line.clear()

        self.emit('intent', {'text': 'Je pense librement…'})
        free = self.engine.chat(guardian.model, messages, priority=priorities.CHAT, owner='gardien', on_text=heard,
                                **{**guardian.params, 'temperature': 0.9, 'max_tokens': 220})
        spark(''.join(line))
        last = (getattr(self.engine, 'stats', {}).get(guardian.model.pk) or {}).get('last')
        if last:
            self.timings.append(last)
        return free

    def ponder(self, guardian, messages, request, agents, depth):
        """Une pensée : le modèle écrit son plan de calls (ses think poussent en direct), puis le plan s'exécute ; s'il a
        lu quelque chose (lectures [L]), ce qu'il a lu lui revient et il continue (MAX_READS tours au plus). Portails et
        voyages à la fin ; puis les branches confiées à d'autres instances de lui-même (explore) poussent à leur tour."""
        self.formed, self.levels, self.whispers, self.explorations, self.gates = {}, {}, {}, [], []
        self.families = {}
        for round_ in range(MAX_READS + 1):
            raw = self.write(guardian, messages, request, depth)
            self.carry_out(agents)
            if not self.gathered or round_ == MAX_READS:
                break
            messages = [*messages, {'role': 'assistant', 'content': raw}, {'role': 'user', 'content': self.resume()}]
        self.execute(self.gates, agents)
        if depth < MAX_DEPTH:
            self.branch_out(guardian, request, agents, depth)

    def write(self, guardian, messages, request, depth):
        """Un appel au modèle : ses think deviennent des nodes au fil de l'écriture, ses autres calls vont au plan.
        Rend sa réponse brute."""
        self.planned, self.seen_calls = [], set()
        stream = ThoughtStream(len(self.formed))

        def heard(piece, chances=None):
            self.emit('tick', None)  # un arrêt demandé coupe le modèle au fragment suivant, même entre deux pensées
            moved = stream.feed(piece)
            self.overheard(stream, piece, chances)
            for (kind, index), value in moved:
                if kind == 't':
                    self.form(index, *value)
                else:
                    self.plan(index, value, stream.thinks)

        self.emit('intent', {'text': 'Je réfléchis…' if not depth else f"Une autre instance de moi creuse « {short(self.nodes[self.source]['text'], 30)} »…"})
        raw = self.plan_call(guardian, messages, 0, request, schema=think_schema([op for op in self.allowed if op not in THINK_NAMES]), on_text=heard, on_token=heard,
                             temperature=0.6, max_tokens=None if guardian.model.params.get('max_tokens') else THINK_TOKENS)
        last = (getattr(self.engine, 'stats', {}).get(guardian.model.pk) or {}).get('last')
        if last:
            self.timings.append(last)
        try:
            calls = json.loads(raw).get('calls') or []
        except (json.JSONDecodeError, AttributeError):  # coupé en route : ses pensées et les calls finis restent
            calls = []
            self.emit('notice', {'text': 'Mon modèle s\'est emballé : je garde ce qu\'il a fini d\'écrire.'})
        for item, call in enumerate(calls):  # ce que le flux n'a pas vu finir
            if item not in self.seen_calls:
                self.plan(item, call, {})
        return raw

    def plan(self, item, call, thinks):
        """Un call terminé : une pensée pas encore posée l'est (sans texte en flux) ; les autres vont au plan, avec leur
        place dans l'arbre et leur couleur de famille."""
        self.seen_calls.add(item)
        if not isinstance(call, dict):
            return
        if call.get('op') == 'think':
            if item not in thinks:
                self.form(len(self.formed), str(call.get('text') or ''), True, call)
            return
        internal = {name: op for op, name in THINK_NAMES.items()}
        call = self.remap(self.painted({**call, 'op': internal.get(call.get('op'), call.get('op'))}))
        if call.get('op') == 'put' and str(call.get('ref', '')).startswith('new') and call.get('near'):
            self.parents.setdefault(call['ref'], call['near'])
        (self.gates if call.get('op') in ('portal', 'travel', 'goto') else self.planned).append(call)
        if len(self.planned) == 1 or not len(self.planned) % 10:  # la file qui grossit, sans noyer le suivi
            self.emit('intent', {'text': f'Plan : {len(self.planned)} call{"s" if len(self.planned) > 1 else ""} en file'})

    def carry_out(self, agents):
        """Le plan écrit s'exécute, call après call, dans l'ordre ; l'avancement s'affiche par dizaines."""
        self.gathered, total = [], len(self.planned)
        if total:
            self.emit('intent', {'text': f"J'exécute mon plan : {total} call{'s' if total > 1 else ''}"})
        for done, call in enumerate(self.planned, 1):
            self.execute([call], agents)
            self.gathered += self.reads
            if total >= 10 and not done % 10:
                self.emit('intent', {'text': f'Plan : {done} / {total}'})

    def resume(self):
        """Le tour suivant d'une pensée qui a lu : ce qu'elle a lu, et où reprendre sa numérotation."""
        mine = re.compile(rf'new(\d+){re.escape(self.suffix)}')
        taken = [int(m.group(1)) for ref in self.nodes if (m := mine.fullmatch(ref))]
        return '\n'.join(['Ce que tu as lu :', *self.gathered,
                          f'Continue ton plan de calls : tes think suivants sont t{len(self.formed) + 1}…, tes nouveaux nodes '
                          f'new{max(taken, default=0) + 1}… ; ne refais pas ce qui est déjà posé.'])

    def branch_out(self, guardian, request, agents, depth):
        """Les branches confiées (explore) poussent ensemble quand le modèle le permet (par API, plusieurs générations
        à la fois) ; un modèle local n'en fait qu'une à la fois : l'une après l'autre. Chaque branche a son propre
        état de pensée (copie), l'univers (nodes, places, arbre) reste commun."""
        picked = []
        for ref, task in self.explorations[:MAX_EXPLORE]:
            number = next(self.branches)
            if number > MAX_EXPLORATIONS:
                break
            picked.append((copy.copy(self), number, ref, task))
        if not guardian.model.endpoint or len(picked) < 2:
            for branch, number, ref, task in picked:
                branch.ponder(guardian, branch.explore(number, ref, task, agents), request, agents, depth + 1)
            return
        # Les prompts se préparent ici (ils lisent la base) ; seules les générations partent dans leurs fils.
        ready = [(branch, branch.explore(number, ref, task, agents)) for branch, number, ref, task in picked]
        failures = []

        def run(branch, messages):
            try:
                branch.ponder(guardian, messages, request, agents, depth + 1)
            except Exception as e:  # l'arrêt demandé compris : relancé par la demande
                failures.append(e)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=pair, daemon=True) for pair in ready]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        if failures:
            raise failures[0]

    def explore(self, number, ref, task, agents):
        """L'IA appelle l'IA : prépare une autre instance (sur une copie : l'état de pensée de l'appelante ne bouge
        pas), avec le même prompt système (relu du cache), la branche `ref`, le chemin de la racine jusqu'à elle et la
        consigne ; sa pensée poussera depuis ce node, sans croiser celle qui l'a appelée (références suffixées)."""
        path = self.lineage(ref)
        parent, node = self.nodes.get(self.parents.get(ref) or ''), self.nodes[ref]
        # La branche part dans le prolongement de sa place dans l'arbre, vers l'extérieur.
        self.heading = math.atan2(node['y'] - parent['y'], node['x'] - parent['x']) if parent else None
        self.source, self.suffix = ref, f'.x{number}'
        prompt = self.prompt(f"{task} (branche « {short(node['text'], 40)} » ; le fil : {' → '.join(path)})")
        return [{'role': 'system', 'content': self.think_system(agents)}, {'role': 'user', 'content': prompt}]

    def op_explore(self, action, agents):
        ref, task = self.existing(action.get('ref')), ' '.join(str(action.get('task') or '').split())[:200]
        if not task:
            raise PlanError('consigne vide (task)')
        self.explorations.append((ref, task))
        return None

    def lineage(self, ref):
        """Le chemin de la racine jusqu'à `ref` dans l'arbre : parents de la pensée en cours, puis liens de la page
        (Nodz garde le sens parent → enfant d'un lien)."""
        path, seen = [], set()
        while ref and ref not in seen and len(path) < LINEAGE:
            seen.add(ref)
            path.append(short(self.nodes.get(ref, {}).get('text') or ref, 40))
            ref = self.parents.get(ref) or next((a for a, b in self.links if b == ref), None)
        return path[::-1]

    def remap(self, action):
        """Références d'une instance appelée : ses t2 et new1 deviennent t2.x1 et new1.x1 (celles de l'appelante
        restent à elle)."""
        if not self.suffix:
            return action
        own = lambda v: f'{v}{self.suffix}' if isinstance(v, str) and re.fullmatch(r't\d+|new\d+', v) else v
        return {k: [own(x) for x in v] if k == 'links' else own(v) if k in ('ref', 'near', 'source', 'target', 'under') else v
                for k, v in action.items()}

    def think(self, request, context, deep=False):
        """Mode Pensée : ses pensées poussent en nodes pendant qu'il les écrit (brouillon mot à mot, genre, branches,
        échos, mots presque dits), puis ses résultats se posent, rattachés aux pensées qui les ont produits. Mode
        Profond : d'abord sa réflexion libre, en étincelles. Tout ce qu'il dit est dans l'univers."""
        started = time.monotonic()
        self.request = request
        agents = self.agents()
        self.load(context)
        system = self.think_system(agents)
        guardian = self.guardian
        self.run = AIRun.objects.create(
            owner=self.user, model_id=str(guardian.model), mode=AIRun.Mode.COMMAND, prompt=request,
            context_node_ids=[n['id'] for n in self.context], status=AIRun.Status.RUNNING,
        )
        self.emit('start', {'run': str(self.run.id)})
        try:
            self.source = self.source_node(request)
            self.dust = 0
            messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': self.prompt(request)}]
            if deep:
                muse = [*messages[:1], {'role': 'user', 'content': f'{messages[1]["content"]}\n{MUSE}'}]
                free = self.muse(guardian, muse)
                messages = [*muse, {'role': 'assistant', 'content': free},
                            {'role': 'user', 'content': 'Maintenant ta pensée et tes résultats, en JSON.'}]
            self.ponder(guardian, messages, request, agents, depth=0)
            made = [ref for ref, n in self.nodes.items() if n.get('new')]
            left = any(g.get('op') in ('travel', 'goto') for g in self.gates)  # parti ailleurs : la caméra y reste
            if made and not left:  # la caméra cadre la pensée entière : le node source, ses pensées, ses résultats et ses branches
                self.emit('action', {'op': 'frame', 'refs': [self.source, *made]})
            if not made:
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
        if isinstance(context, dict) and context.get('mode') in ('think', 'deep'):
            return self.think(request, context, deep=context['mode'] == 'deep')
        started = time.monotonic()
        self.request = request
        agents = self.agents()
        self.load(context)
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
