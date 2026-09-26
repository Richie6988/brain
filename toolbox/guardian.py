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
import math
import re
import time

from django.db.models import Q

from graph.models import AIRun

from . import broker as priorities
from .engine import EngineUnavailable
from .models import Agent, LocalModel

RADIUS = 85  # rayon d'un node texte de Nodz une fois dimensionné (nodeSizing 120 × 120)
MAX_CONTEXT_NODES = 60
MAX_ROUNDS = 3  # un tour de plus après chaque lecture (inventaire)
TYPES = ['text', 'image', 'file', 'canvas']  # types de node de Nodz
SHAPES = ['circle', 'square', 'none']
OPS = ['create', 'update', 'style', 'set_type', 'link', 'unlink', 'portal', 'archive', 'cleanup',
       'delegate', 'plug_agent', 'inventory', 'focus', 'overview', 'travel']
HEX_COLOR = re.compile(r'#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}')


class PlanError(Exception):
    """Action ou contexte invalide : signalé à l'utilisateur, le reste continue."""


PLAN_SCHEMA = {
    'type': 'object',
    'required': ['say', 'actions'],
    'properties': {
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
                },
            },
        },
    },
}

SYSTEM = """Tu es le Gardien de l'univers Nodz : une carte spatiale de nodes (idées) reliés entre eux,
répartis sur des dimensions (plans) reliées par des portails. Tu pilotes le vaisseau de l'utilisateur :
tes travellings de caméra le guident (tutoriels, visites, montrer ce que tu viens de faire).
L'utilisateur t'écrit dans un node (le node message) ; tu réponds uniquement en JSON :
{"say": ta réponse, courte, écrite dans un node relié au node message, "actions": [...]}.
Les nodes existants ont un identifiant (N-12) ; les nouveaux, une référence new1, new2...
Actions possibles :
- {"op":"create","ref":"new1","text":"...","near":"N-3","color":"#4D96FF","shape":"circle"} : nouveau node
  placé près de `near` ; couleur et forme facultatives.
- {"op":"update","ref":"N-2","text":"..."} : remplace le texte d'un node.
- {"op":"style","ref":"N-2","color":"#FF6B6B","shape":"square","radius":90,"lock":true} : apparence
  (formes : circle, square, none ; taille 20 à 400 ; lock empêche de le déplacer).
- {"op":"set_type","ref":"N-2","content_type":"canvas"} : type du node (text, image, file, canvas = dessin).
- {"op":"link","source":"N-1","target":"new1"} / {"op":"unlink","source":"N-1","target":"N-2"} : crée ou retire un lien.
- {"op":"portal","ref":"N-2","name":"Recherche"} : téléporte N-2 dans une nouvelle dimension `name`, reliée par un portail.
- {"op":"archive","ref":"N-4"} : supprime un node (annulable avec Ctrl+Z).
- {"op":"cleanup"} : supprime les nodes vides du plan.
- {"op":"delegate","agent":"<nom>","task":"consigne précise","ref":"new1 ou N-2","near":"N-1"} : confie la
  production à un agent ; son résultat est publié dans le node `ref` (créé s'il est nouveau).
- {"op":"plug_agent","agent":"<nom>","model":"<partie du nom du modèle>"} : branche un modèle sur un agent.
- {"op":"focus","ref":"N-2","zoom":1.5,"text":"légende"} : travelling vers un node puis légende.
  Enchaîne plusieurs focus pour une visite guidée ou un tutoriel.
- {"op":"overview","text":"..."} : prend du recul pour montrer tout le plan.
- {"op":"travel","name":"<dimension>","text":"..."} : voyage vers une autre dimension.
- {"op":"inventory"} : liste les dimensions, les agents et les modèles ; tu recevras la réponse et pourras continuer.
Délègue tout contenu long (rédaction, code) ; écris toi-même seulement les titres courts.
Ne supprime que ce que l'utilisateur demande ou ce qui est manifestement vide ou en double.
Agents équipés :
{agents}"""

AGENT_SYSTEM = {
    Agent.Role.TEXT: 'Tu écris un contenu clair et concis en français, sans préambule.',
    Agent.Role.CODE: 'Tu écris uniquement du code, dans un seul bloc, avec des commentaires brefs.',
    Agent.Role.TOOLS: 'Tu accomplis la tâche et rends un résultat bref.',
}


def plain(markup, length=120):
    """Texte lisible d'un contenu HTML de node (pour le prompt)."""
    return html.unescape(' '.join(re.sub(r'<[^>]+>', ' ', markup or '').split()))[:length]


def text_html(text):
    return '<br>'.join(html.escape(line) for line in text.strip().split('\n'))


def code_html(text):
    match = re.search(r'```[\w+-]*\n(.*?)```', text, re.S)
    return f'<pre>{html.escape((match.group(1) if match else text).strip(chr(10)))}</pre>'


def free_spot(anchor, occupied, radius=RADIUS):
    """Premier emplacement libre sur des anneaux autour de `anchor` (aucun chevauchement)."""
    gap = max(radius, RADIUS) * 2 + 70
    for ring in range(1, 12):
        steps = 6 * ring
        for i in range(steps):
            # Jamais pile sur un axe : le dégradé d'un lien de Nodz ne s'affiche pas s'il est vertical ou horizontal.
            angle = 2 * math.pi * i / steps + math.pi / 2 + 0.35
            x, y = anchor[0] + ring * gap * math.cos(angle), anchor[1] + ring * gap * math.sin(angle)
            if all(math.dist((x, y), p) >= gap * 0.9 for p in occupied):
                return round(x), round(y)
    return round(anchor[0] + gap), round(anchor[1])


def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class Guardian:
    def __init__(self, user, engine, emit):
        self.user, self.engine, self.emit = user, engine, emit
        self.run = None
        self.nodes = {}  # identifiant ou référence → {x, y, r, text, new}

    # --- contexte envoyé par la page

    def load(self, context):
        if not isinstance(context, dict):
            raise PlanError('contexte invalide')
        view = context.get('view') or {}
        center = (_number(view.get('x')), _number(view.get('y')))
        nodes = [n for n in context.get('nodes') or [] if isinstance(n, dict) and str(n.get('id', '')).startswith('N-')]
        selection = [str(i) for i in context.get('selection') or []]
        selected = [n for n in nodes if n['id'] in selection]
        others = sorted((n for n in nodes if n['id'] not in selection),
                        key=lambda n: math.dist((_number(n.get('x')), _number(n.get('y'))), center))
        self.context = (selected + others)[:MAX_CONTEXT_NODES]
        for n in nodes:
            self.nodes[n['id']] = {'x': _number(n.get('x')), 'y': _number(n.get('y')), 'r': _number(n.get('r'), RADIUS),
                                   'text': plain(n.get('text', '')), 'color': n.get('color', '')}
        self.occupied = [(n['x'], n['y']) for n in self.nodes.values()]
        origin = context.get('origin')  # le node message : les réponses se placent autour de lui
        first = self.nodes.get(origin) or (self.nodes.get(selected[0]['id']) if selected else None)
        self.anchor = (first['x'], first['y']) if first else center
        known = {n['id'] for n in self.context}
        self.links = [(a, b) for a, b in (context.get('links') or []) if a in known and b in known]
        self.selection = [n['id'] for n in selected]
        self.origin = origin if origin in self.nodes else None
        self.layer = context.get('layer') or {}
        self.layers = [l for l in context.get('layers') or [] if isinstance(l, dict)]

    def agents(self):
        return {a.name: a for a in Agent.objects.filter(owner=self.user, enabled=True).select_related('model')}

    def prompt(self, request):
        lines = [f"{n['id']} : {self.nodes[n['id']]['text'] or '(vide)'}" for n in self.context]
        return '\n'.join([
            f"Dimension : {self.layer.get('name') or 'sans nom'}",
            'Nodes :', *(lines or ['(aucun)']),
            'Liens : ' + (', '.join(f'{a}-{b}' for a, b in self.links) or 'aucun'),
            'Sélection : ' + (', '.join(self.selection) or 'aucune'),
            f'Message écrit dans le node {self.origin} : {request}' if self.origin else f'Demande : {request}',
        ])

    # --- validation des actions

    def existing(self, ref):
        if ref not in self.nodes:
            raise PlanError(f'référence inconnue : {ref!r}')
        return ref

    def place(self, ref, near):
        target = self.nodes.get(near) if near else None
        anchor = (target['x'], target['y']) if target else self.anchor
        x, y = free_spot(anchor, self.occupied)
        self.occupied.append((x, y))
        self.nodes[ref] = {'x': x, 'y': y, 'r': RADIUS, 'text': '', 'new': True}
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
        return {'op': 'portal', 'ref': self.existing(action.get('ref')), 'name': name}

    def op_archive(self, action, agents):
        return {'op': 'archive', 'ref': self.existing(action.get('ref'))}

    def op_cleanup(self, action, agents):
        empty = [n['id'] for n in self.context if not self.nodes[n['id']]['text']]
        return {'op': 'cleanup', 'refs': empty} if empty else None

    def op_delegate(self, action, agents):
        agent = self.agent(agents, action.get('agent'))
        if agent.role == Agent.Role.ORCHESTRATOR:
            raise PlanError('le Gardien ne se délègue pas à lui-même')
        if agent.role == Agent.Role.IMAGE:
            raise PlanError(f"{agent.name} : la génération d'images n'est pas encore branchée")
        if agent.model_id is None:
            raise PlanError(f"{agent.name} n'a pas de modèle : branche-lui un modèle (plug_agent)")
        ref = action['ref']
        self.jobs.append((agent, action.get('task', ''), ref))
        if ref in self.nodes:
            return None
        x, y = self.place(ref, action.get('near'))  # nouveau node : il attend le résultat de l'agent
        self.nodes[ref]['text'] = f'{agent.name} travaille…'
        return {'op': 'create', 'ref': ref, 'x': x, 'y': y, 'text': text_html(self.nodes[ref]['text']), 'color': None, 'shape': None}

    def op_plug_agent(self, action, agents):
        agent = self.agent(agents, action.get('agent'))
        query = (action.get('model') or '').strip()
        ready = LocalModel.objects.filter(status=LocalModel.Status.READY)
        model = ready.filter(Q(filename__icontains=query) | Q(repo__icontains=query)).first() if query else None
        if model is None:
            raise PlanError(f'aucun modèle prêt ne correspond à {query!r}')
        agent.model = model
        agent.save(update_fields=['model'])
        self.emit('notice', {'text': f'{agent.name} utilise maintenant {model.filename}'})
        return None

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
        models = LocalModel.objects.filter(status=LocalModel.Status.READY)
        current = self.layer.get('id')
        return '\n'.join([
            'Dimensions : ' + (', '.join(f"{l.get('name')}{' (courante)' if l.get('id') == current else ''}" for l in self.layers) or 'aucune'),
            'Agents : ' + ', '.join(f'{a.name} ({a.role}, {a.model.filename if a.model else "sans modèle"}'
                                    f'{", désactivé" if not a.enabled else ""})' for a in agents),
            'Modèles prêts : ' + (', '.join(f'{m.filename} ({m.kind})' for m in models) or 'aucun'),
        ])

    def execute(self, actions, agents):
        """Valide et émet les actions dans l'ordre ; une action invalide est signalée et sautée."""
        self.jobs, self.reads = [], []
        for action in actions:
            op = action.get('op')
            try:
                if op not in OPS:
                    raise PlanError(f'action inconnue : {op!r}')
                if op in ('create', 'delegate') and not str(action.get('ref', '')).startswith(('new', 'N-')):
                    action = {**action, 'ref': f'auto{len(self.nodes) + 1}'}  # référence manquante
                event = getattr(self, f'op_{op}')(action, agents)
                if event:
                    self.emit('action', event)
            except (PlanError, KeyError, TypeError, ValueError) as e:
                self.emit('error', {'message': f'{op} : {e}'})
        return self.jobs, self.reads

    def answer(self, say):
        """La réponse du Gardien : un node relié au node message, ou une ligne si la demande n'a pas de node."""
        if not self.origin:
            self.emit('text', {'text': say})
            return
        ref = f'reply{sum(1 for key in self.nodes if key.startswith("reply")) + 1}'
        self.emit('action', self.op_create({'ref': ref, 'text': say, 'near': self.origin}, {}))
        self.emit('action', {'op': 'link', 'source': self.origin, 'target': ref})

    def delegate(self, agent, task, ref):
        self.emit('agent', {'agent': agent.name, 'ref': ref, 'task': task})
        messages = [
            {'role': 'system', 'content': agent.system_prompt or AGENT_SYSTEM.get(agent.role, '')},
            {'role': 'user', 'content': task},
        ]
        text = self.engine.chat(
            agent.model, messages, on_text=lambda piece: self.emit('agent_text', {'ref': ref, 'text': piece}),
            priority=priorities.AGENT, owner=f'agent:{agent.name}', **agent.params,
        )
        self.emit('action', {'op': 'update', 'ref': ref, 'text': code_html(text) if agent.role == Agent.Role.CODE else text_html(text)})

    # --- boucle

    def handle(self, request, context):
        started = time.monotonic()
        self.load(context)
        agents = self.agents()
        guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        if guardian is None or guardian.model is None:
            raise EngineUnavailable("le Gardien n'a pas de modèle : choisis-en un dans la bibliothèque d'agents")
        self.run = AIRun.objects.create(
            owner=self.user, model_id=str(guardian.model), mode=AIRun.Mode.COMMAND, prompt=request,
            context_node_ids=[n['id'] for n in self.context], status=AIRun.Status.RUNNING,
        )
        self.emit('start', {'run': str(self.run.id)})
        try:
            roster = '\n'.join(f'- {a.name} ({a.role}) : {a.description}' for a in agents.values()
                               if a.role != Agent.Role.ORCHESTRATOR and a.model_id) or '(aucun agent équipé)'
            messages = [
                {'role': 'system', 'content': guardian.system_prompt or SYSTEM.replace('{agents}', roster)},
                {'role': 'user', 'content': self.prompt(request)},
            ]
            say = ''
            for _ in range(MAX_ROUNDS):
                raw = self.engine.chat(guardian.model, messages, json_schema=PLAN_SCHEMA, priority=priorities.CHAT,
                                       owner='gardien', temperature=0.2)
                try:
                    plan = json.loads(raw)
                except json.JSONDecodeError:
                    raise PlanError('le Gardien a répondu hors format') from None
                say = plan.get('say') or say
                jobs, reads = self.execute(plan.get('actions') or [], agents)
                for agent, task, ref in jobs:
                    self.delegate(agent, task, ref)
                if not reads:
                    break  # dernier tour : sa réponse devient le node-réponse (une seule par message)
                messages += [
                    {'role': 'assistant', 'content': raw},
                    {'role': 'user', 'content': '\n'.join(reads) + '\nContinue la demande sans refaire les actions déjà faites.'},
                ]
            if say:
                self.answer(say)
            self.run.status = AIRun.Status.DONE
        except Exception as e:
            self.run.status, self.run.error = AIRun.Status.ERROR, str(e)
            raise
        finally:
            self.run.duration_ms = int((time.monotonic() - started) * 1000)
            self.run.save(update_fields=['status', 'error', 'duration_ms'])
