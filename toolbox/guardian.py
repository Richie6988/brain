"""Le Gardien : orchestrateur garant de l'intégrité de l'univers.

Il lit une demande et le contexte du plan, répond par un plan d'actions en JSON (contraint par
grammaire), place les nodes sans chevauchement, délègue la production aux agents de la
bibliothèque et publie leurs résultats en brouillon. Toute écriture passe par `apply_changes`
avec un `AIRun` : provenance, révisions et audit sont ceux de l'humain.
"""

import html
import json
import math
import re
import time
import uuid

from django.utils.html import strip_tags

from graph.models import AIRun, Edge, Layer, Node
from graph.services import ChangeError, apply_changes

from . import broker as priorities
from .engine import EngineUnavailable
from .models import Agent

RADIUS = 62.5
MAX_CONTEXT_NODES = 60
OPS = ['create', 'update', 'link', 'archive', 'cleanup', 'delegate']

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
                    'agent': {'type': 'string'},
                    'task': {'type': 'string'},
                },
            },
        },
    },
}

SYSTEM = """Tu es le Gardien de l'univers Nodz : une carte spatiale de nodes (idées) reliés entre eux.
Tu réponds uniquement en JSON : {"say": phrase courte pour l'utilisateur, "actions": [...]}.
Actions possibles :
- {"op":"create","ref":"new1","text":"...","near":"n3"} : nouveau node (ref new1, new2...), placé près de `near`.
- {"op":"update","ref":"n2","text":"..."} : remplace le texte d'un node existant.
- {"op":"link","source":"n1","target":"new1"} : relie deux nodes.
- {"op":"archive","ref":"n4"} : archive un node devenu inutile.
- {"op":"cleanup"} : archive les nodes vides du plan.
- {"op":"delegate","agent":"<nom>","task":"consigne précise","ref":"new1 ou n2","near":"n1"} : confie la
  production à un agent ; son résultat est publié dans le node `ref` (créé s'il est nouveau).
Délègue tout contenu long (rédaction, code, image) ; écris toi-même seulement les titres courts.
N'archive que ce que l'utilisateur demande ou ce qui est manifestement vide ou en double.
Agents disponibles :
{agents}"""

AGENT_SYSTEM = {
    Agent.Role.TEXT: 'Tu écris un contenu clair et concis en français, sans préambule.',
    Agent.Role.CODE: 'Tu écris uniquement du code, dans un seul bloc, avec des commentaires brefs.',
    Agent.Role.TOOLS: 'Tu accomplis la tâche et rends un résultat bref.',
}


def summary(node, length=120):
    text = strip_tags((node.payload.get('text') or {}).get('html', ''))
    if not text and node.payload.get('code'):
        text = node.payload['code'].get('source', '')
    return html.unescape(' '.join(text.split()))[:length]


def text_payload(text):
    return {'html': '<br>'.join(html.escape(line) for line in text.strip().split('\n'))}


def code_payload(text):
    match = re.search(r'```([\w+-]*)\n(.*?)```', text, re.S)
    language, source = (match.group(1), match.group(2)) if match else ('', text)
    return {'language': language, 'source': source.strip('\n')}


def free_spot(anchor, occupied, radius=RADIUS):
    """Premier emplacement libre sur des anneaux autour de `anchor` (aucun chevauchement)."""
    gap = radius * 2.4
    for ring in range(1, 12):
        steps = 6 * ring
        for i in range(steps):
            angle = 2 * math.pi * i / steps - math.pi / 2
            x, y = anchor[0] + ring * gap * math.cos(angle), anchor[1] + ring * gap * math.sin(angle)
            if all(math.dist((x, y), p) >= gap * 0.9 for p in occupied):
                return round(x, 1), round(y, 1)
    return anchor[0] + gap, anchor[1]


class Guardian:
    def __init__(self, user, engine, emit):
        self.user, self.engine, self.emit = user, engine, emit
        self.run = None
        self.refs = {}  # référence courte (n1, new1) -> node (id, x, y)
        self.occupied = []

    # --- contexte

    def load(self, layer_id, selection, view):
        self.layer = Layer.objects.filter(id=layer_id, owner=self.user).exclude(kind=Layer.Kind.ARCHIVE).first()
        if self.layer is None:
            raise ChangeError('plan introuvable')
        nodes = list(self.layer.nodes.exclude(status=Node.Status.ARCHIVED))
        selected = [n for n in nodes if str(n.id) in selection]
        try:
            center = (float(view['x']), float(view['y']))
        except (TypeError, KeyError, ValueError):
            center = (0.0, 0.0)
        others = sorted((n for n in nodes if n not in selected), key=lambda n: math.dist((n.x, n.y), center))
        self.context = (selected + others)[:MAX_CONTEXT_NODES]
        self.occupied = [(n.x, n.y) for n in nodes]
        self.anchor = (selected[0].x, selected[0].y) if selected else center
        for i, n in enumerate(self.context, 1):
            self.refs[f'n{i}'] = {'id': str(n.id), 'x': n.x, 'y': n.y}
        ids = {str(n.id): ref for ref, n in zip(self.refs, self.context)}
        edges = Edge.objects.filter(source_id__in=[n.id for n in self.context], target_id__in=[n.id for n in self.context])
        self.links = [(ids[str(e.source_id)], ids[str(e.target_id)]) for e in edges]
        self.selected_refs = [ids[str(n.id)] for n in selected]

    def agents(self):
        return {a.name: a for a in Agent.objects.filter(owner=self.user, enabled=True).select_related('model')}

    def prompt(self, request):
        lines = [f'{ref} : {summary(n) or "(vide)"}' for ref, n in zip(self.refs, self.context)]
        return '\n'.join([
            f'Plan : {self.layer.name or "sans nom"}',
            'Nodes :', *(lines or ['(aucun)']),
            'Liens : ' + (', '.join(f'{a}-{b}' for a, b in self.links) or 'aucun'),
            'Sélection : ' + (', '.join(self.selected_refs) or 'aucune'),
            f'Demande : {request}',
        ])

    # --- écriture

    def apply(self, nodes=(), edges=(), deleted=()):
        result = apply_changes(self.user, {
            'ai_run': str(self.run.id),
            'nodes': {'upsert': list(nodes), 'delete': list(deleted)},
            'edges': {'upsert': list(edges)},
        })
        self.emit('changes', result)
        return result

    def place(self, ref, near):
        target = self.refs.get(near) if near else None
        anchor = (target['x'], target['y']) if target else self.anchor
        x, y = free_spot(anchor, self.occupied)
        self.occupied.append((x, y))
        self.refs[ref] = {'id': str(uuid.uuid4()), 'x': x, 'y': y, 'new': True}
        return {'id': self.refs[ref]['id'], 'layer': str(self.layer.id), 'x': x, 'y': y}

    def existing(self, ref):
        node = self.refs.get(ref or '')
        if node is None:
            raise ChangeError(f'référence inconnue : {ref!r}')
        return node['id']

    def payload(self, node_id):
        """Payload courant : on remplace un état, on garde les autres."""
        node = Node.objects.filter(id=node_id).only('payload').first()
        return dict(node.payload) if node else {}

    def execute(self, actions, agents):
        nodes, edges, deleted, jobs = {}, [], [], []
        for action in actions:
            op, ref = action.get('op'), action.get('ref', '')
            if op == 'delegate':
                agent = agents.get(action.get('agent', ''))
                if agent is None or agent.role == Agent.Role.ORCHESTRATOR:
                    self.emit('error', {'message': f"agent inconnu : {action.get('agent')!r}"})
                    continue
                if agent.role == Agent.Role.IMAGE:
                    self.emit('error', {'message': f"{agent.name} : la génération d'images n'est pas encore branchée"})
                    continue
                if agent.model_id is None:
                    self.emit('error', {'message': f"{agent.name} n'a pas de modèle : choisis-en un dans la bibliothèque"})
                    continue
            if op in ('create', 'delegate') and ref not in self.refs:
                ref = ref if ref.startswith('new') else f'auto{len(self.refs) + 1}'
                nodes[ref] = self.place(ref, action.get('near'))
            if op in ('create', 'update'):
                node = nodes.setdefault(ref, {'id': self.existing(ref)})
                node.setdefault('payload', self.payload(node['id']))['text'] = text_payload(action.get('text', ''))
            elif op == 'link':
                source, target = self.existing(action.get('source')), self.existing(action.get('target'))
                if source != target:
                    edges.append({'id': str(uuid.uuid4()), 'source': source, 'target': target, 'kind': Edge.Kind.LINK})
            elif op == 'archive':
                deleted.append(self.existing(ref))
            elif op == 'cleanup':
                deleted += [self.refs[r]['id'] for r, n in zip(list(self.refs), self.context) if not summary(n)]
            elif op == 'delegate':
                if ref in nodes and 'payload' not in nodes[ref]:
                    nodes[ref]['payload'] = {'text': text_payload(f'{agent.name} travaille…')}
                jobs.append((agent, action.get('task', ''), ref))
        if nodes or edges or deleted:
            self.apply(nodes.values(), edges, sorted(set(deleted)))
        return jobs

    def delegate(self, agent, task, ref):
        node_id = self.existing(ref)
        self.emit('agent', {'agent': agent.name, 'node': node_id, 'task': task})
        messages = [
            {'role': 'system', 'content': agent.system_prompt or AGENT_SYSTEM.get(agent.role, '')},
            {'role': 'user', 'content': task},
        ]
        text = self.engine.chat(
            agent.model, messages, on_text=lambda piece: self.emit('agent_text', {'node': node_id, 'text': piece}),
            priority=priorities.AGENT, owner=f'agent:{agent.name}', **agent.params,
        )
        payload = self.payload(node_id)
        if self.refs[ref].get('new'):
            payload.pop('text', None)  # le texte d'attente « X travaille… »
        if agent.role == Agent.Role.CODE:
            payload['code'], content_type = code_payload(text), Node.ContentType.CODE
        else:
            payload['text'], content_type = text_payload(text), Node.ContentType.TEXT
        self.apply(nodes=[{'id': node_id, 'payload': payload, 'content_type': content_type}])

    # --- boucle

    def handle(self, request, layer_id, selection=(), view=None):
        started = time.monotonic()
        self.load(layer_id, set(selection), view)
        agents = self.agents()
        guardian = next((a for a in agents.values() if a.role == Agent.Role.ORCHESTRATOR), None)
        if guardian is None or guardian.model is None:
            raise EngineUnavailable("le Gardien n'a pas de modèle : choisis-en un dans la bibliothèque d'agents")
        self.run = AIRun.objects.create(
            owner=self.user, model_id=str(guardian.model), mode=AIRun.Mode.COMMAND, prompt=request,
            context_node_ids=[n['id'] for n in self.refs.values()], status=AIRun.Status.RUNNING,
        )
        self.emit('start', {'run': str(self.run.id)})
        try:
            roster = '\n'.join(f'- {a.name} ({a.role}) : {a.description}' for a in agents.values()
                               if a.role != Agent.Role.ORCHESTRATOR and a.model_id) or '(aucun agent équipé)'
            raw = self.engine.chat(guardian.model, [
                {'role': 'system', 'content': guardian.system_prompt or SYSTEM.replace('{agents}', roster)},
                {'role': 'user', 'content': self.prompt(request)},
            ], json_schema=PLAN_SCHEMA, priority=priorities.CHAT, owner='gardien', temperature=0.2)
            try:
                plan = json.loads(raw)
            except json.JSONDecodeError:
                raise ChangeError('le Gardien a répondu hors format') from None
            if plan.get('say'):
                self.emit('text', {'text': plan['say']})
            for agent, task, ref in self.execute(plan.get('actions') or [], agents):
                self.delegate(agent, task, ref)
            self.run.status = AIRun.Status.DONE
        except Exception as e:
            self.run.status, self.run.error = AIRun.Status.ERROR, str(e)
            raise
        finally:
            self.run.duration_ms = int((time.monotonic() - started) * 1000)
            self.run.save(update_fields=['status', 'error', 'duration_ms'])
