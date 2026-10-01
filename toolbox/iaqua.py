"""Outils portés d'iAqua (Poseidon) pour le Gardien : tâches et planifications, projets et missions,
compétences, cerveau et journal, espace de travail (fichiers, git, documents), e-mail, images, agents,
et, pour l'administrateur, shell, Python, outils forgés et serveurs MCP.

Mixin de Guardian : chaque op_<nom> valide son action, agit, puis soit émet un événement pour la page,
soit ajoute une lecture (self.reads) que le modèle reçoit au tour suivant.
"""

import base64
import json
import re
import tempfile
import threading
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import connection
from django.utils import timezone

from nodzapp.models import Layer, Link, Node

from . import broker as priorities
from . import imaging, workspace
from .engine import acting_for
from .errors import PlanError
from .models import Agent, ForgedTool, GuardianLog, LocalModel, Mission, Project, Schedule, Skill, Task
from .prompts import default

MEMORY_KINDS = ['achievement', 'decision', 'blocker', 'resolve_blocker', 'next_steps', 'agent_sync']
DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']


def cut(text, length=160):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= length else text[:length - 1] + '…'


def log(user, kind, detail=''):
    GuardianLog.objects.create(owner=user, kind=kind, detail=cut(detail, 500))


def dot_set(data, path, value):
    keys = [k for k in path.split('.') if k]
    if not keys:
        raise PlanError('chemin de champ vide')
    node = data
    for key in keys[:-1]:
        if not isinstance(node.get(key), dict):
            node[key] = {}
        node = node[key]
    node[keys[-1]] = value


def dot_get(data, path):
    for key in [k for k in path.split('.') if k]:
        if not isinstance(data, dict) or key not in data:
            return None
        data = data[key]
    return data


def parse_value(value):
    try:
        return json.loads(value) if isinstance(value, str) else value
    except json.JSONDecodeError:
        return value


# --- planifications (schedule_task) : déclenchées par la tour de contrôle ou `manage.py run_schedules`

def parse_expr(expr):
    """('daily', h, m) / ('weekly', jour, h, m) / ('hourly',) / ('every', minutes) ; ValueError sinon."""
    expr = (expr or '').strip().lower()
    if m := re.fullmatch(r'daily@(\d{1,2}):(\d{2})', expr):
        return ('daily', int(m[1]), int(m[2]))
    if m := re.fullmatch(r'weekly:(mon|tue|wed|thu|fri|sat|sun)@(\d{1,2}):(\d{2})', expr):
        return ('weekly', DAYS.index(m[1]), int(m[2]), int(m[3]))
    if expr == 'hourly':
        return ('hourly',)
    if m := re.fullmatch(r'every:(\d{1,4})m', expr):
        return ('every', max(5, int(m[1])))
    raise ValueError(f'expression inconnue : {expr!r} (daily@HH:MM, weekly:mon@HH:MM, hourly, every:Nm)')


def is_due(schedule, now):
    rule = parse_expr(schedule.expr)
    last = schedule.last_fired_at
    local = timezone.localtime(now)
    if rule[0] == 'every':
        return last is None or now - last >= timedelta(minutes=rule[1])
    if rule[0] == 'hourly':
        return last is None or now - last >= timedelta(hours=1)
    hour, minute = rule[-2], rule[-1]
    if rule[0] == 'weekly' and local.weekday() != rule[1]:
        return False
    slot = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return local >= slot and (last is None or timezone.localtime(last) < slot)


def fire_due_schedules(engine=None, now=None, background=True):
    """Crée les tâches des planifications arrivées à échéance ; un agent équipé les exécute (en fond ou tout de suite)."""
    now = now or timezone.now()
    fired = []
    for schedule in Schedule.objects.filter(enabled=True).select_related('agent__model'):
        try:
            due = is_due(schedule, now)
        except ValueError:
            continue
        if not due:
            continue
        schedule.last_fired_at = now
        schedule.save(update_fields=['last_fired_at'])
        task = Task.objects.create(owner=schedule.owner, number=Task.next_number(schedule.owner), title=schedule.title,
                                   description=schedule.description, project=schedule.project, agent=schedule.agent)
        log(schedule.owner, 'schedule_fired', f'{schedule.key} → {task.key}')
        fired.append(task)
        if engine and task.agent and task.agent.model_id:
            if background:
                threading.Thread(target=run_task, args=(task.pk, engine), daemon=True).start()
            else:
                run_task(task.pk, engine)
    return fired


def run_task(task_id, engine):
    """Exécute une tâche par son agent (en fond) : résultat et statut dans le registre."""
    try:
        task = Task.objects.select_related('agent__model').get(pk=task_id)
        agent = task.agent
        task.status = Task.Status.IN_PROGRESS
        task.save(update_fields=['status', 'updated_at'])
        prompt = f'{task.title}\n{task.description}' + (f'\nCritères de réussite : {task.acceptance}' if task.acceptance else '')
        with acting_for(task.owner_id):  # le bouton stop de son propriétaire la coupe
            text = engine.chat(agent.model, [{'role': 'system', 'content': agent.system_prompt or default(agent.role)},
                                             {'role': 'user', 'content': prompt}],
                               priority=priorities.BACKGROUND, owner=f'task:{task.key}', **agent.params)
        task.result, task.status = text[:20000], Task.Status.COMPLETED
        task.progress = task.progress + [f'{timezone.now():%d/%m %H:%M} terminé par {agent.name}']
        task.save(update_fields=['result', 'status', 'progress', 'updated_at'])
        log(task.owner, 'task_completed', task.key)
    except Exception as e:  # le registre garde la trace de l'échec
        Task.objects.filter(pk=task_id).update(status=Task.Status.FAILED, result=f'Échec : {e}'[:2000])
    finally:
        connection.close()


# --- missions autonomes (launch_mission)

MISSION_SCHEMA = {
    'type': 'object', 'required': ['done', 'summary', 'tasks'],
    'properties': {
        'done': {'type': 'boolean'},
        'summary': {'type': 'string'},
        'tasks': {'type': 'array', 'items': {'type': 'object', 'required': ['title', 'agent', 'task'], 'properties': {
            'title': {'type': 'string'}, 'agent': {'type': 'string'}, 'task': {'type': 'string'}}}},
    },
}
MISSION_SYSTEM = """Tu pilotes une mission autonome. À chaque tour : lis le but, ce qui a été produit, et décide.
Réponds en JSON {"done": vrai si le but est atteint, "summary": bilan court, "tasks": tâches du prochain tour}.
Chaque tâche est confiée à un agent de la liste, avec une consigne autonome et précise. Trois tâches au plus par tour.
Agents : {agents}"""


def run_mission(mission_id, engine):
    """Mission en fond, au nom de son propriétaire : son bouton stop coupe l'appel au modèle en cours."""
    with acting_for(Mission.objects.values_list('owner_id', flat=True).get(pk=mission_id)):
        _run_mission(mission_id, engine)


def _run_mission(mission_id, engine):
    mission = Mission.objects.select_related('project').get(pk=mission_id)
    try:
        agents = {a.name.lower(): a for a in Agent.objects.filter(owner=mission.owner, enabled=True).select_related('model')
                  if a.model_id and a.role != Agent.Role.IMAGE}
        guardian = Agent.objects.filter(owner=mission.owner, role=Agent.Role.ORCHESTRATOR).select_related('model').first()
        if guardian is None or guardian.model is None:
            raise PlanError("le Gardien n'a pas de modèle")
        roster = ', '.join(f'{a.name} ({a.role})' for a in agents.values() if a.role != Agent.Role.ORCHESTRATOR)
        memory = json.dumps(mission.project.memory, ensure_ascii=False)[:2000] if mission.project else ''
        history = []
        while mission.iterations < mission.budget:
            mission.refresh_from_db(fields=['status'])
            if mission.status != Mission.Status.RUNNING:
                return
            messages = [{'role': 'system', 'content': MISSION_SYSTEM.replace('{agents}', roster or 'aucun')},
                        {'role': 'user', 'content': f'But : {mission.goal}\nMémoire du projet : {memory or "vide"}\n'
                                                    f'Déjà fait :\n' + ('\n'.join(history) or 'rien')}]
            plan = json.loads(engine.chat(guardian.model, messages, json_schema=MISSION_SCHEMA, priority=priorities.BACKGROUND,
                                          owner=f'mission:{mission.key}', temperature=0.2))
            mission.iterations += 1
            mission.timeline = mission.timeline + [{'at': timezone.now().isoformat(), 'summary': cut(plan.get('summary'), 400)}]
            mission.save(update_fields=['iterations', 'timeline'])
            if plan.get('done'):
                break
            for item in (plan.get('tasks') or [])[:3]:
                agent = agents.get(str(item.get('agent', '')).lower())
                if agent is None or agent.role == Agent.Role.ORCHESTRATOR:
                    continue
                task = Task.objects.create(owner=mission.owner, number=Task.next_number(mission.owner), title=cut(item['title'], 200),
                                           description=item.get('task', ''), project=mission.project, agent=agent)
                run_task(task.pk, engine)
                task.refresh_from_db()
                history.append(f'- {task.key} {task.title} ({task.status}) : {cut(task.result, 300)}')
        mission.status = Mission.Status.DONE
        if mission.project:
            memory = mission.project.memory
            memory['achievements'] = memory.get('achievements', []) + [f'Mission {mission.key} : {cut(mission.goal, 120)}']
            mission.project.save(update_fields=['memory'])
    except Exception as e:
        mission.status = Mission.Status.FAILED
        mission.timeline = mission.timeline + [{'at': timezone.now().isoformat(), 'summary': f'Échec : {cut(e, 300)}'}]
    finally:
        mission.finished_at = timezone.now()
        mission.save(update_fields=['status', 'timeline', 'finished_at'])
        log(mission.owner, 'mission_finished', f'{mission.key} : {mission.status}')
        connection.close()


class IaquaOps:
    """Opérations des outils d'iAqua, mélangées au Gardien (self.user, self.emit, self.reads…)."""

    # --- utilitaires

    def read(self, title, lines):
        self.reads.append(f'{title} :\n' + ('\n'.join(lines) if isinstance(lines, list) else str(lines)) if lines else f'{title} : rien')

    def project(self, name, create=False):
        name = str(name or '').strip().upper()[:80]
        if not name:
            return None
        project = Project.objects.filter(owner=self.user, name=name).first()
        if project is None and not create:
            raise PlanError(f'projet inconnu : {name} (create_project)')
        return project

    def named_project(self, action):
        """Le projet que l'action vise (project_name ou project) ; sans nom, une erreur que le modèle peut corriger."""
        project = self.project(action.get('project_name') or action.get('project'))
        if project is None:
            raise PlanError('nom du projet requis (project_name) : list_projects les donne')
        return project

    def task(self, key):
        match = re.fullmatch(r'task_(\d+)', str(key or ''))
        task = Task.objects.filter(owner=self.user, number=int(match[1])).first() if match else None
        if task is None:
            raise PlanError(f'tâche inconnue : {key!r}')
        return task

    def agent_named(self, name, required=True):
        agent = next((a for a in Agent.objects.filter(owner=self.user) if a.name.lower() == str(name or '').lower()), None)
        if agent is None and required:
            raise PlanError(f'agent inconnu : {name!r}')
        return agent

    def workspace_call(self, fn, *args):
        try:
            return fn(self.user, *args)
        except workspace.WorkspaceError as e:
            raise PlanError(str(e)) from None

    def link_to(self, path):
        return f'{settings.FORCE_SCRIPT_NAME or ""}/api/v1/toolbox/workspace/{path}'

    # --- tâches

    def op_create_task(self, action, agents):
        title = cut(action.get('title') or action.get('text'), 200)
        if not title:
            raise PlanError('titre de tâche requis')
        priority = action.get('priority') if action.get('priority') in Task.Priority.values else Task.Priority.MEDIUM
        task = Task.objects.create(owner=self.user, number=Task.next_number(self.user), title=title,
                                   description=action.get('description', ''), acceptance=action.get('acceptance_criteria', ''),
                                   project=self.project(action.get('project')), priority=priority,
                                   agent=self.agent_named(action['agent']) if action.get('agent') else None)
        log(self.user, 'task_created', f'{task.key} {title}')
        self.emit('notice', {'text': f'Tâche {task.key} créée : {title}'})
        if action.get('run') and task.agent and task.agent.model_id:
            threading.Thread(target=run_task, args=(task.pk, self.engine), daemon=True).start()
        return None

    def op_list_tasks(self, action, agents):
        tasks = Task.objects.filter(owner=self.user).select_related('project', 'agent')
        if action.get('status'):
            tasks = tasks.filter(status=action['status'])
        if action.get('project'):
            tasks = tasks.filter(project__name=str(action['project']).upper())
        self.read('Tâches', [f"- {t.key} [{t.status}, {t.priority}] {t.title}"
                            f"{f' · {t.project.name}' if t.project else ''}{f' · {t.agent.name}' if t.agent else ''}"
                            f"{f' · résultat : {cut(t.result, 120)}' if t.result else ''}" for t in tasks[:50]])
        return None

    def op_update_task(self, action, agents):
        task = self.task(action.get('task_id'))
        field, value = action.get('field'), action.get('value', '')
        if field in ('title', 'description', 'result'):
            setattr(task, field, str(value)[:20000])
        elif field == 'status' and value in Task.Status.values:
            task.status = value
        elif field == 'priority' and value in Task.Priority.values:
            task.priority = value
        elif field in ('assigned_agent_id', 'agent'):
            task.agent = self.agent_named(value)
        elif field == 'progress':
            task.progress = task.progress + [f'{timezone.now():%d/%m %H:%M} {cut(value, 300)}']
        else:
            raise PlanError(f'champ ou valeur invalide : {field}={value!r}')
        task.save()
        log(self.user, 'task_updated', f'{task.key} {field}')
        return None

    def op_delete_task(self, action, agents):
        task = self.task(action.get('task_id'))
        log(self.user, 'task_deleted', f'{task.key} {task.title}')
        task.delete()
        return None

    def op_schedule_task(self, action, agents):
        kind = action.get('action') or 'list'
        if kind == 'list':
            self.read('Planifications', [f"- {s.key} {s.expr} {'actif' if s.enabled else 'en pause'} : {s.title}"
                                         for s in Schedule.objects.filter(owner=self.user)])
            return None
        if kind == 'create':
            try:
                parse_expr(action.get('expr'))
            except ValueError as e:
                raise PlanError(str(e)) from None
            schedule = Schedule.objects.create(owner=self.user, number=Schedule.next_number(self.user), expr=action['expr'].lower(),
                                               title=cut(action.get('title'), 200) or 'Tâche planifiée', description=action.get('description', ''),
                                               project=self.project(action.get('project')),
                                               agent=self.agent_named(action['agent']) if action.get('agent') else None)
            self.emit('notice', {'text': f'Planification {schedule.key} : {schedule.expr}'})
            return None
        match = re.fullmatch(r'sched_(\d+)', str(action.get('schedule_id') or ''))
        schedule = Schedule.objects.filter(owner=self.user, number=int(match[1])).first() if match else None
        if schedule is None:
            raise PlanError(f"planification inconnue : {action.get('schedule_id')!r}")
        if kind == 'delete':
            schedule.delete()
        elif kind in ('enable', 'disable'):
            schedule.enabled = kind == 'enable'
            schedule.save(update_fields=['enabled'])
        else:
            raise PlanError(f'action inconnue : {kind}')
        return None

    # --- projets (une dimension de Nodz) et mémoire vivante

    def op_create_project(self, action, agents):
        name = str(action.get('name') or '').strip().upper()[:80]
        if not name:
            raise PlanError('nom de projet requis')
        project, created = Project.objects.get_or_create(owner=self.user, name=name, defaults={'vision': action.get('vision', '')})
        if not created:
            raise PlanError(f'le projet {name} existe déjà')
        log(self.user, 'project_created', name)
        self.layers.append({'id': None, 'name': name})
        return {'op': 'dimension', 'name': name}  # la page crée la dimension du même nom

    def op_list_projects(self, action, agents):
        lines = []
        for p in Project.objects.filter(owner=self.user):
            total = p.tasks.count()
            done = p.tasks.filter(status=Task.Status.COMPLETED).count()
            lines.append(f"- {p.name} [{p.status}] {done}/{total} tâches ({round(100 * done / total) if total else 0} %) : {cut(p.vision, 100)}")
        self.read('Projets', lines)
        return None

    def op_plan_project(self, action, agents):
        project = self.project(action.get('project'))
        open_tasks = Task.objects.filter(owner=self.user, project=project).exclude(status=Task.Status.COMPLETED)
        self.read(f"Contexte de planification pour « {cut(action.get('goal'), 200)} »", [
            f'Projet : {project.name} ; vision : {project.vision or "à définir"}' if project else 'Projet : aucun',
            f'Mémoire : {json.dumps(project.memory, ensure_ascii=False)[:1500]}' if project else '',
            'Agents : ' + ', '.join(f'{a.name} ({a.role}{", sans modèle" if not a.model_id else ""})' for a in Agent.objects.filter(owner=self.user)),
            'Tâches ouvertes : ' + (', '.join(f'{t.key} {t.title}' for t in open_tasks[:20]) or 'aucune'),
            'Compétences : ' + (', '.join(s.key for s in Skill.objects.filter(owner=self.user)) or 'aucune'),
            'Découpe le but en tâches (create_task, avec agent et critères) ou lance une mission (launch_mission).',
        ])
        return None

    def op_update_project(self, action, agents):
        project = self.named_project(action)
        field, value = action.get('field'), str(action.get('new_value') or action.get('value') or '')
        if field == 'name':
            project.name = value.upper()[:80]
        elif field == 'vision':
            project.vision = value
        elif field == 'status':
            if value not in Project.Status.values:
                raise PlanError('statut : active ou archived (la suppression est laissée à l\'utilisateur)')
            project.status = value
        elif field in ('assign_agent', 'unassign_agent'):
            names = set(project.memory.get('agents', []))
            names = names | {self.agent_named(value).name} if field == 'assign_agent' else names - {value}
            project.memory['agents'] = sorted(names)
        else:
            raise PlanError(f'champ inconnu : {field}')
        project.save()
        return None

    def op_update_project_memory(self, action, agents):
        project = self.named_project(action)
        kind, content = action.get('kind'), action.get('content') or action.get('text') or ''
        if kind not in MEMORY_KINDS:
            raise PlanError(f"type de mémoire : {', '.join(MEMORY_KINDS)}")
        memory = project.memory
        if kind == 'resolve_blocker':
            memory['blockers'] = [b for b in memory.get('blockers', []) if str(content).lower() not in b.lower()]
        elif kind == 'next_steps':
            memory['next_steps'] = content if isinstance(content, list) else [s for s in str(content).split('\n') if s.strip()]
        else:
            key = {'achievement': 'achievements', 'decision': 'decisions', 'blocker': 'blockers', 'agent_sync': 'agent_sync'}[kind]
            memory[key] = memory.get(key, [])[-49:] + [f'{timezone.now():%d/%m} {cut(content, 300)}']
        project.save(update_fields=['memory'])
        return None

    def op_read_project_memory(self, action, agents):
        project = self.named_project(action)
        self.read(f'Mémoire du projet {project.name}', [f'Vision : {project.vision or "à définir"}',
                                                          json.dumps(project.memory, ensure_ascii=False, indent=1)[:4000]])
        return None

    def op_audit_project(self, action, agents):
        project = self.named_project(action)
        tasks = list(project.tasks.all())
        by_status = {s: sum(t.status == s for t in tasks) for s in Task.Status.values}
        layer = Layer.objects.filter(user=self.user, layer_name__iexact=project.name).first()
        nodes = Node.objects.filter(user=self.user, layer=layer, archive=False) if layer else Node.objects.none()
        linked = set()
        for a, b in Link.objects.filter(user=self.user, layer=layer, archive=False).values_list('linkA', 'linkB') if layer else []:
            linked |= {a, b}
        empty = sum(1 for n in nodes if not (n.text_content or n.image_content or n.file_name or n.canvas_content))
        orphans = sum(1 for n in nodes if f'N-{n.node_id}' not in linked)
        self.read(f'Audit du projet {project.name}', [
            f'Tâches : {len(tasks)} ({", ".join(f"{k} {v}" for k, v in by_status.items())})',
            f"Dimension : {nodes.count()} nodes, {empty} vides, {orphans} sans lien" if layer else 'Dimension : introuvable',
            f"Bloquants : {'; '.join(project.memory.get('blockers', [])) or 'aucun'}",
            f"Prochaines étapes : {'; '.join(project.memory.get('next_steps', [])) or 'à définir'}",
            'Recommande les prochaines tâches (create_task) et corrige les nodes vides ou isolés.',
        ])
        return None

    # --- missions

    def op_launch_mission(self, action, agents):
        goal = str(action.get('goal') or '').strip()
        if not goal:
            raise PlanError('but de mission requis')
        budget = min(max(int(action.get('budget') or 3), 1), 8)
        mission = Mission.objects.create(owner=self.user, number=Mission.next_number(self.user), goal=goal,
                                         project=self.project(action.get('project')), budget=budget)
        threading.Thread(target=run_mission, args=(mission.pk, self.engine), daemon=True).start()
        log(self.user, 'mission_launched', f'{mission.key} {cut(goal, 200)}')
        self.emit('notice', {'text': f'Mission {mission.key} lancée ({budget} tours au plus) : suivi avec mission_status'})
        return None

    def op_mission_status(self, action, agents):
        match = re.fullmatch(r'mission_(\d+)', str(action.get('mission_id') or ''))
        if match:
            mission = Mission.objects.filter(owner=self.user, number=int(match[1])).first()
            if mission is None:
                raise PlanError(f"mission inconnue : {action.get('mission_id')}")
            if action.get('abort') and mission.status == Mission.Status.RUNNING:
                mission.status = Mission.Status.ABORTED
                mission.save(update_fields=['status'])
            self.read(f'Mission {mission.key}', [f'But : {mission.goal}', f'Statut : {mission.status}, tours {mission.iterations}/{mission.budget}',
                                                 *[f"- {t['at'][:16]} {t['summary']}" for t in mission.timeline]])
            return None
        self.read('Missions', [f'- {m.key} [{m.status}] {m.iterations}/{m.budget} : {cut(m.goal, 100)}'
                               for m in Mission.objects.filter(owner=self.user)[:10]])
        return None

    # --- compétences

    def op_write_skill(self, action, agents):
        key = re.sub(r'[^a-z0-9_]', '_', str(action.get('skill_id') or action.get('name') or '').lower())[:40].strip('_')
        if not key:
            raise PlanError('identifiant de compétence requis')
        skill, created = Skill.objects.get_or_create(owner=self.user, key=key, defaults={'name': action.get('name') or key})
        skill.name = cut(action.get('name') or skill.name, 100)
        skill.summary = cut(action.get('summary') or skill.summary, 300)
        steps = action.get('steps')
        skill.steps = '\n'.join(steps) if isinstance(steps, list) else str(steps or skill.steps)
        skill.triggers = cut(action.get('triggers') or skill.triggers, 300)
        skill.version = skill.version if created else skill.version + 1
        skill.save()
        return None

    def op_list_skills(self, action, agents):
        lines = []
        for s in Skill.objects.filter(owner=self.user):
            o = s.outcomes
            lines.append(f"- {s.key} v{s.version} : {s.summary} (déclencheurs : {s.triggers or '-'} ; "
                         f"réussites {o.get('success', 0)}, partielles {o.get('partial', 0)}, échecs {o.get('fail', 0)})\n  {cut(s.steps, 600)}")
        self.read('Compétences', lines)
        return None

    def op_delete_skill(self, action, agents):
        if not Skill.objects.filter(owner=self.user, key=action.get('skill_id')).delete()[0]:
            raise PlanError(f"compétence inconnue : {action.get('skill_id')!r}")
        return None

    def op_record_skill_outcome(self, action, agents):
        skill = Skill.objects.filter(owner=self.user, key=action.get('skill_id')).first()
        if skill is None or action.get('outcome') not in ('success', 'partial', 'fail'):
            raise PlanError('compétence ou résultat inconnu (success, partial, fail)')
        skill.outcomes[action['outcome']] = skill.outcomes.get(action['outcome'], 0) + 1
        skill.save(update_fields=['outcomes'])
        return None

    # --- cerveau et journal

    def op_read_my_brain(self, action, agents):
        path = str(action.get('section_path') or '').strip()
        from . import tools
        from .guardian import guardian_prompt  # guardian importe ce module
        sections = {
            'guidelines': guardian_prompt(self.guardian),
            'memory': self.guardian.memory,
            'tools_catalog': [f"{t['op']} : {t['label']}" for t in tools.TOOLS if t['op'] in self.allowed],
            'skills': {s.key: s.steps for s in Skill.objects.filter(owner=self.user)},
            'current_state': {
                'tasks_open': Task.objects.filter(owner=self.user).exclude(status=Task.Status.COMPLETED).count(),
                'missions_running': Mission.objects.filter(owner=self.user, status=Mission.Status.RUNNING).count(),
                'projects': list(Project.objects.filter(owner=self.user).values_list('name', flat=True)),
                'models_ready': list(LocalModel.visible_to(self.user).filter(status=LocalModel.Status.READY).values_list('filename', flat=True)),
            },
            **self.guardian.brain,
        }
        head, _, rest = path.partition('.')
        value = sections.get(head) if head else {k: '…' for k in sections}
        value = dot_get(value, rest) if rest and isinstance(value, dict) else value
        self.read(f'Cerveau : {path or "sections"}', json.dumps(value, ensure_ascii=False, indent=1)[:4000] if value is not None else 'section inconnue')
        return None

    def op_update_brain_field(self, action, agents):
        path = str(action.get('field_path') or '').strip()
        value = parse_value(action.get('value') if 'value' in action else action.get('new_value'))
        if path in ('guidelines', 'fine_tuning'):
            self.guardian.system_prompt = str(value)
            self.guardian.save(update_fields=['system_prompt'])
        elif path == 'memory':
            return self.op_remember({'text': str(value)}, agents)
        else:
            brain = dict(self.guardian.brain)
            dot_set(brain, path, value)
            self.guardian.brain = brain
            self.guardian.save(update_fields=['brain'])
            self.sync_brain()
        log(self.user, 'brain_updated', path)
        return None

    def op_update_user_context(self, action, agents):
        return self.op_remember({'text': action.get('text') or action.get('value')}, agents)

    def op_get_logs(self, action, agents):
        entries = GuardianLog.objects.filter(owner=self.user)
        if action.get('event_type'):
            entries = entries.filter(kind=action['event_type'])
        limit = min(int(action.get('limit') or 20), 50)
        self.read('Journal', [f'- {e.at:%d/%m %H:%M} {e.kind} : {e.detail}' for e in entries[:limit]])
        return None

    # --- espace de travail : fichiers et git

    def op_write_file(self, action, agents):
        path = self.workspace_call(workspace.write_file, action.get('path'), action.get('content', ''))
        log(self.user, 'file_written', path)
        return None

    def op_list_files(self, action, agents):
        entries = self.workspace_call(workspace.list_files, action.get('path') or '.')
        self.read(f"Fichiers de {action.get('path') or '.'}", [f"- {e['name']}" + (f" ({e['size']} o)" if e['size'] is not None else '') for e in entries])
        return None

    def op_edit_file(self, action, agents):
        self.workspace_call(workspace.edit_file, action.get('path'), action.get('search_text'), action.get('replace_text'))
        return None

    def op_git(self, action, agents):
        result = self.workspace_call(workspace.git, action.get('action') or 'status', action.get('message', ''),
                                     action.get('files'), action.get('path', ''))
        self.read(f"git {action.get('action') or 'status'} (code {result['code']})", (result['stdout'] + result['stderr']).strip() or 'rien')
        return None

    # --- documents et e-mail

    def op_generate_pptx(self, action, agents):
        path = self.workspace_call(workspace.pptx, action.get('filename'), action.get('title', ''), action.get('slides') or [])
        self.files.append((path, self.link_to(path)))
        self.read('Présentation créée', f'{path} : {self.link_to(path)} (donne ce lien à l\'utilisateur)')
        return None

    def op_generate_docx(self, action, agents):
        path = self.workspace_call(workspace.docx, action.get('filename'), action.get('title', ''), action.get('markdown') or action.get('content', ''))
        self.files.append((path, self.link_to(path)))
        self.read('Document créé', f'{path} : {self.link_to(path)} (donne ce lien à l\'utilisateur)')
        return None

    def op_send_email(self, action, agents):
        recipients = [r.strip() for r in str(action.get('to') or self.user.email).split(',') if r.strip()]
        if not self.user.is_staff and recipients != [self.user.email]:
            raise PlanError("sans droits d'administrateur, le Gardien n'écrit qu'à ton adresse")
        if not settings.EMAIL_HOST:
            raise PlanError("aucun serveur d'e-mail configuré (EMAIL_HOST dans .env)")
        send_mail(cut(action.get('subject'), 200) or 'Nodz', str(action.get('body') or ''), settings.DEFAULT_FROM_EMAIL, recipients)
        log(self.user, 'email_sent', ', '.join(recipients))
        return None

    # --- images

    def op_generate_image(self, action, agents):
        painter = next((a for a in agents.values() if a.role == Agent.Role.IMAGE), None)
        if painter is None:
            raise PlanError("aucun agent d'image actif")
        return self.op_delegate({'agent': painter.name, 'task': action.get('prompt') or action.get('text', ''), 'mode': action.get('mode'),
                                 'ref': action.get('ref') or f'img{len(self.nodes) + 1}', 'near': action.get('near')}, agents)

    def op_edit_image(self, action, agents):
        painter = next((a for a in agents.values() if a.role == Agent.Role.IMAGE and a.model_id), None)
        if painter is None:
            raise PlanError("aucun agent d'image équipé")
        ref = self.existing(action.get('ref'))
        node = Node.objects.filter(user=self.user, node_id=ref.removeprefix('N-')).first()
        data = re.match(r'data:image/\w+;base64,(.*)', (node.image_content or '') if node else '', re.S)
        if not data:
            raise PlanError(f"{ref} n'est pas un node image enregistré")
        source = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        source.write(base64.b64decode(data[1]))
        source.close()
        strength = min(max(float(action.get('strength') or 0.6), 0.05), 1.0)
        self.jobs.append((painter, action.get('prompt', ''), ref, {'init_image': source.name, 'strength': strength}))
        return None

    # --- agents

    def op_list_agents(self, action, agents):
        self.read('Agents', [f"- {a.name} ({a.role}, {a.model.filename if a.model else 'sans modèle'}"
                             f"{', désactivé' if not a.enabled else ''}) : {a.description}"
                             for a in Agent.objects.filter(owner=self.user).select_related('model')])
        return None

    def op_list_models(self, action, agents):
        self.read('Modèles', [f'- {m.label or m.filename} ({m.kind}, {m.status})'
                              for m in LocalModel.visible_to(self.user).exclude(kind=LocalModel.Kind.COMPONENT)])
        return None

    def op_dispatch_to_agent(self, action, agents):
        return self.op_delegate(action, agents)

    def op_update_agent_field(self, action, agents):
        field = str(action.get('field_path') or action.get('field') or '')
        value = action.get('new_value') if 'new_value' in action else action.get('value')
        mapping = {'description': 'description', 'prompt': 'prompt', 'system_prompt': 'prompt', 'enabled': 'enabled'}
        if field == 'model':
            return self.op_plug_agent({'agent': action.get('agent'), 'model': value}, agents)
        if field not in mapping:
            raise PlanError(f'champ modifiable : {", ".join(mapping)}, model')
        return self.op_update_agent({'agent': action.get('agent'), mapping[field]: parse_value(value) if field == 'enabled' else value}, agents)

    def op_delete_agent(self, action, agents):
        agent = self.agent_named(action.get('agent'))
        from .api import DEFAULT_AGENTS
        if agent.name in {name for name, _, _ in DEFAULT_AGENTS}:
            raise PlanError(f"{agent.name} est un agent de départ : désactive-le plutôt (update_agent)")
        if agent.name.lower() not in self.request.lower() or not re.search(r'supprim|efface|delete|retire', self.request, re.I):
            raise PlanError(f"suppression irréversible : l'utilisateur doit demander de supprimer {agent.name} en le nommant")
        log(self.user, 'agent_deleted', agent.name)
        agent.delete()
        self.emit('notice', {'text': f'Agent {agent.name} supprimé'})
        return None

    # --- administrateur : shell, Python, outils forgés, MCP

    def op_execute_bash(self, action, agents):
        result = self.workspace_call(workspace.shell, action.get('command', ''), action.get('cwd') or '.', action.get('timeout') or 30)
        log(self.user, 'bash', cut(action.get('command'), 300))
        self.read(f"$ {cut(action.get('command'), 200)} (code {result['code']})", (result['stdout'] + result['stderr']).strip() or '(aucune sortie)')
        return None

    def op_pyenv(self, action, agents):
        try:
            result = workspace.pyenv(action.get('action') or 'list', action.get('packages'))
        except workspace.WorkspaceError as e:
            raise PlanError(str(e)) from None
        self.read(f"pyenv {action.get('action') or 'list'} (code {result['code']})", (result['stdout'] + result['stderr']).strip()[-3000:])
        return None

    def op_forge_tool(self, action, agents):
        kind = action.get('action') or 'create'
        if kind == 'list':
            self.read('Outils forgés', [f"- {t.name} {'actif' if t.enabled else 'désactivé'} : {t.description}"
                                        for t in ForgedTool.objects.filter(owner=self.user)])
            return None
        name = str(action.get('name') or '')
        path = self.workspace_call(workspace.tool_path, name)
        if kind == 'create':
            code = str(action.get('code') or '')
            if 'json' not in code or 'stdin' not in code:
                raise PlanError('un outil forgé lit son entrée JSON sur sys.stdin et écrit son résultat sur stdout')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(code)
            test = self.workspace_call(workspace.run_tool, name, parse_value(action.get('test_input') or '{}'))
            if test['code'] != 0:
                path.unlink()
                raise PlanError(f"le test de l'outil a échoué : {cut(test['stderr'], 400)}")
            ForgedTool.objects.update_or_create(owner=self.user, name=name, defaults={'description': cut(action.get('description'), 300), 'enabled': True})
            self.read(f'Outil {name} forgé et testé', cut(test['stdout'], 1000))
            return None
        tool = ForgedTool.objects.filter(owner=self.user, name=name).first()
        if tool is None:
            raise PlanError(f'outil forgé inconnu : {name}')
        if kind == 'delete':
            path.unlink(missing_ok=True)
            tool.delete()
        elif kind in ('enable', 'disable'):
            tool.enabled = kind == 'enable'
            tool.save(update_fields=['enabled'])
        else:
            raise PlanError(f'action inconnue : {kind}')
        return None

    def op_run_tool(self, action, agents):
        name = str(action.get('name') or '')
        if not ForgedTool.objects.filter(owner=self.user, name=name, enabled=True).exists():
            raise PlanError(f'outil forgé inconnu ou désactivé : {name}')
        result = self.workspace_call(workspace.run_tool, name, parse_value(action.get('input') or '{}'))
        self.read(f'Outil {name} (code {result["code"]})', (result['stdout'] + result['stderr']).strip() or '(aucune sortie)')
        return None

    def op_list_mcp_servers(self, action, agents):
        try:
            servers = workspace.mcp_servers()
        except workspace.WorkspaceError as e:
            raise PlanError(str(e)) from None
        self.read('Serveurs MCP', [f"- {name} : {config.get('description', config.get('url', ''))}" for name, config in servers.items()])
        return None

    def op_call_mcp_tool(self, action, agents):
        try:
            result = workspace.mcp_call(action.get('server'), action.get('name'), parse_value(action.get('arguments') or {}))
        except workspace.WorkspaceError as e:
            raise PlanError(str(e)) from None
        self.read(f"MCP {action.get('server')} · {action.get('name')}", result if isinstance(result, str) else
                  [f"- {t['name']} : {t['description']}" for t in result])
        return None
