"""Consoles d'administration de Nodz (boutons « Data » et « Users » du compte staff).

Console IA : file du Gardien en direct, modèle en mémoire, demandes par jour, journal du Gardien de tous
les comptes, travail planifié (planifications, missions, tâches en cours). Utilisateurs : comptes, nodes,
usage de l'IA, droit administrateur et Gardien actif par compte.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone

from graph.api import api
from graph.services import ChangeError
from nodzapp.models import Node

from .models import Agent, GuardianLog, LocalModel, Mission, Schedule, Task
from .runtime import broker, dispatcher, engine

DAYS = 14


class Forbidden(ChangeError):
    status = 403


class NotFound(ChangeError):
    status = 404


def staff(request):
    if not request.user.is_staff:
        raise Forbidden('réservé aux administrateurs')


def who(user):
    return user.email or user.username or f'#{user.pk}'


@api('GET')
def overview(request, body):
    staff(request)
    now = timezone.now()
    since = now - timedelta(days=DAYS - 1)
    requests = GuardianLog.objects.filter(kind='demande')
    per_day = dict(requests.filter(at__date__gte=since.date()).annotate(day=TruncDate('at')).values_list('day').annotate(n=Count('id')))
    week = requests.filter(at__gte=now - timedelta(days=7))
    users = {u.pk: u for u in get_user_model().objects.filter(pk__in=[t.owner for t in dispatcher.tickets()])}
    loaded = LocalModel.objects.filter(pk=engine.loaded).first() if engine.loaded else None
    return JsonResponse({
        'queue': [{'user': who(users[t.owner]) if t.owner in users else f'#{t.owner}', 'running': running}
                  for t, running in dispatcher.tickets(with_state=True)],
        'dispatcher': dispatcher.state(), 'broker': broker.state(),
        'loaded': {'label': loaded.label or loaded.filename, 'stats': engine.stats.get(loaded.pk), 'placement': engine.placement.get(loaded.pk)}
        if loaded else None,
        'days': [{'day': (since + timedelta(days=i)).date().isoformat(), 'requests': per_day.get((since + timedelta(days=i)).date(), 0)}
                 for i in range(DAYS)],
        'totals': {'users': get_user_model().objects.count(), 'active_week': week.values('owner').distinct().count(),
                   'requests_today': requests.filter(at__date=now.date()).count(), 'requests_week': week.count(),
                   'errors_week': week.filter(detail__contains='échec').count()},
        'top': [{'user': row['owner__email'] or f"#{row['owner']}", 'requests': row['n']}
                for row in week.values('owner', 'owner__email').annotate(n=Count('id')).order_by('-n')[:8]],
    })


@api('GET')
def log(request, body):
    staff(request)
    entries = GuardianLog.objects.select_related('owner').order_by('-at')
    if request.GET.get('user'):
        entries = entries.filter(owner_id=request.GET['user'])
    if request.GET.get('q'):
        entries = entries.filter(Q(detail__icontains=request.GET['q']) | Q(kind__icontains=request.GET['q']))
    return JsonResponse({'entries': [{'user': who(e.owner), 'user_id': e.owner_id, 'kind': e.kind, 'detail': e.detail, 'at': e.at.isoformat()}
                                     for e in entries[:200]]})


def user_to_dict(u, requests, nodes, guardians):
    g = guardians.get(u.pk)
    return {'id': u.pk, 'email': u.email, 'username': u.username, 'country': u.country or '', 'premium': bool(getattr(u, 'premium', False)),
            'joined': u.date_joined.date().isoformat(), 'last_login': u.last_login.isoformat() if u.last_login else None,
            'staff': u.is_staff, 'nodes': nodes.get(u.pk, 0), 'requests_week': requests.get(u.pk, 0),
            'guardian': {'enabled': g.enabled, 'model': g.model.label or g.model.filename if g.model else None} if g else None}


def user_rows(ids=None):
    users = get_user_model().objects.order_by('-date_joined')
    if ids is not None:
        users = users.filter(pk__in=ids)
    week = timezone.now() - timedelta(days=7)
    requests = dict(GuardianLog.objects.filter(kind='demande', at__gte=week).values_list('owner').annotate(n=Count('id')))
    nodes = dict(Node.objects.filter(archive=False).values_list('user').annotate(n=Count('id')))
    guardians = {a.owner_id: a for a in Agent.objects.filter(role=Agent.Role.ORCHESTRATOR).select_related('model')}
    return [user_to_dict(u, requests, nodes, guardians) for u in users]


@api('GET')
def users(request, body):
    staff(request)
    return JsonResponse({'users': user_rows(), 'me': request.user.pk})


@api('PATCH')
def user_detail(request, body, user_id):
    """Droit administrateur (jamais le sien) et Gardien actif d'un compte."""
    staff(request)
    user = get_user_model().objects.filter(pk=user_id).first()
    if user is None:
        raise NotFound('compte introuvable')
    if 'staff' in body:
        if user.pk == request.user.pk:
            raise ChangeError('tu ne peux pas changer ton propre droit administrateur')
        user.is_staff = bool(body['staff'])
        user.save(update_fields=['is_staff'])
    if 'guardian' in body:
        updated = Agent.objects.filter(owner=user, role=Agent.Role.ORCHESTRATOR).update(enabled=bool(body['guardian']))
        if not updated:
            raise ChangeError("ce compte n'a pas encore de Gardien (il en reçoit un en ouvrant Agents & modèles)")
    return JsonResponse({'user': user_rows([user.pk])[0]})


@api('GET')
def planned(request, body):
    staff(request)
    return JsonResponse({
        'schedules': [{'id': s.pk, 'ref': s.key, 'user': who(s.owner), 'expr': s.expr, 'title': s.title, 'enabled': s.enabled,
                       'last': s.last_fired_at.isoformat() if s.last_fired_at else None}
                      for s in Schedule.objects.select_related('owner').order_by('owner_id', 'number')],
        'missions': [{'id': m.pk, 'ref': m.key, 'user': who(m.owner), 'goal': m.goal, 'status': m.status, 'iterations': m.iterations, 'budget': m.budget}
                     for m in Mission.objects.select_related('owner').order_by('-created_at')[:30]],
        'tasks': [{'id': t.pk, 'ref': t.key, 'user': who(t.owner), 'title': t.title, 'status': t.status, 'priority': t.priority}
                  for t in Task.objects.select_related('owner').exclude(status__in=[Task.Status.COMPLETED, Task.Status.FAILED]).order_by('-updated_at')[:50]],
    })


@api('PATCH')
def schedule_detail(request, body, schedule_id):
    staff(request)
    if not Schedule.objects.filter(pk=schedule_id).update(enabled=bool(body.get('enabled'))):
        raise NotFound('planification introuvable')
    return JsonResponse({'ok': True})


@api('POST')
def mission_stop(request, body, mission_id):
    staff(request)
    if not Mission.objects.filter(pk=mission_id, status=Mission.Status.RUNNING).update(status=Mission.Status.ABORTED, finished_at=timezone.now()):
        raise NotFound('mission introuvable ou déjà terminée')
    return JsonResponse({'ok': True})
