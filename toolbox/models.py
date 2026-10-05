"""Boîte à outils IA intégrée (portée de SquidMind) : modèles locaux et agents."""

import secrets
import uuid

from django.conf import settings
from django.db import models


class LocalModel(models.Model):
    """Un fichier de poids (GGUF) téléchargé depuis Hugging Face, partagé par tout le serveur ; ou un modèle par API,
    partagé (ajouté par l'administrateur) ou personnel (`owner` : le connecteur et la clé d'un utilisateur, à lui seul)."""

    class Kind(models.TextChoices):
        TEXT = 'text'
        IMAGE = 'image'
        EMBED = 'embed'
        AUDIO = 'audio'
        COMPONENT = 'component'  # fichier compagnon d'un modèle d'image (VAE, encodeurs CLIP et T5)

    class Status(models.TextChoices):
        DOWNLOADING = 'downloading'
        READY = 'ready'
        ERROR = 'error'
        CANCELLED = 'cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repo = models.CharField(max_length=200)  # 'local' pour un fichier importé depuis le serveur
    filename = models.CharField(max_length=300)
    label = models.CharField(max_length=120, blank=True)  # nom affiché, choisi par l'utilisateur
    path = models.CharField(max_length=500, blank=True)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.TEXT)
    capabilities = models.JSONField(default=list, blank=True)  # chat, tools, code, vision, image, reason…
    quant = models.CharField(max_length=20, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    downloaded = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DOWNLOADING)
    error = models.TextField(blank=True)
    params = models.JSONField(default=dict, blank=True)  # n_ctx, n_gpu_layers, n_threads, n_batch, ttl, temperature, max_tokens
    # Modèle par API (remote.py) : URL de base compatible OpenAI ; filename porte alors le nom du modèle distant.
    endpoint = models.URLField(max_length=300, blank=True)
    api_key = models.CharField(max_length=300, blank=True)  # jamais renvoyée au navigateur
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='api_models')
    premium = models.BooleanField(default=False)  # le Gardien Premium : réservé aux comptes abonnés (premium.py)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['repo', 'filename']
        constraints = [models.UniqueConstraint(fields=['owner', 'repo', 'filename'], name='unique_model_file')]

    def __str__(self):
        return f'{self.repo}/{self.filename}'

    @classmethod
    def visible_to(cls, user):
        """Les modèles partagés du serveur et les connecteurs personnels de cet utilisateur (jamais ceux des autres) ; un
        modèle Premium seulement pour un compte abonné ou l'administrateur."""
        shown = cls.objects.filter(models.Q(owner=None) | models.Q(owner=user))
        return shown if getattr(user, 'is_staff', False) or getattr(user, 'premium', False) else shown.exclude(premium=True)


class Agent(models.Model):
    """Un spécialiste de la bibliothèque : un rôle, un modèle, un prompt, des outils."""

    class Role(models.TextChoices):
        TEXT = 'text'
        CODE = 'code'
        IMAGE = 'image'
        TOOLS = 'tools'
        ORCHESTRATOR = 'orchestrator'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agents')
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.TEXT)
    description = models.CharField(max_length=300, blank=True)
    model = models.ForeignKey(LocalModel, null=True, blank=True, on_delete=models.SET_NULL, related_name='agents')
    system_prompt = models.TextField(blank=True)
    tools_allowed = models.JSONField(default=list, blank=True)
    params = models.JSONField(default=dict, blank=True)
    memory = models.JSONField(default=list, blank=True)  # faits retenus (remember), relus à chaque demande
    brain = models.JSONField(default=dict, blank=True)  # champs libres du « cerveau » (read_my_brain / update_brain_field)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['role', 'name']
        constraints = [models.UniqueConstraint(fields=['owner', 'name'], name='unique_agent_name_per_owner')]

    def __str__(self):
        return self.name


class NodeMark(models.Model):
    """Origine d'un node de Nodz (v1) : message envoyé au Gardien, ou créé par l'IA. Sans marque : écrit à la main."""

    class Origin(models.TextChoices):
        MESSAGE = 'message'
        AI = 'ai'

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='node_marks')
    node_id = models.PositiveIntegerField()
    origin = models.CharField(max_length=8, choices=Origin.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'node_id'], name='unique_mark_per_node')]


# --- Outils portés d'iAqua : projets, tâches, planifications, missions, compétences, journal, outils forgés

class Numbered(models.Model):
    """Numéro par utilisateur (task_0001, sched_0001…), comme les registres d'iAqua."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    PREFIX = ''

    class Meta:
        abstract = True

    @property
    def key(self):
        return f'{self.PREFIX}_{self.number:04d}'

    @classmethod
    def next_number(cls, owner):
        last = cls.objects.filter(owner=owner).aggregate(models.Max('number'))['number__max']
        return (last or 0) + 1


class Project(models.Model):
    """Projet d'iAqua : dans Nodz, une dimension du même nom, avec sa mémoire vivante."""

    class Status(models.TextChoices):
        ACTIVE = 'active'
        ARCHIVED = 'archived'

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='projects')
    name = models.CharField(max_length=80)
    vision = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    memory = models.JSONField(default=dict, blank=True)  # achievements, decisions, blockers, next_steps, agent_sync
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'name'], name='unique_project_per_owner')]


class Task(Numbered):
    PREFIX = 'task'

    class Status(models.TextChoices):
        PLANNED = 'planned'
        IN_PROGRESS = 'in_progress'
        COMPLETED = 'completed'
        FAILED = 'failed'

    class Priority(models.TextChoices):
        LOW = 'low'
        MEDIUM = 'medium'
        HIGH = 'high'
        CRITICAL = 'critical'

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    acceptance = models.TextField(blank=True)  # critères de réussite
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name='tasks')
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.SET_NULL, related_name='tasks')
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    progress = models.JSONField(default=list, blank=True)  # étapes notées au fil du travail
    result = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['number']
        constraints = [models.UniqueConstraint(fields=['owner', 'number'], name='unique_task_number')]


class Schedule(Numbered):
    """Tâche récurrente : daily@HH:MM, weekly:mon@HH:MM, hourly, every:Nm (minutes)."""

    PREFIX = 'sched'
    expr = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL)
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.SET_NULL)
    enabled = models.BooleanField(default=True)
    last_fired_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['number']
        constraints = [models.UniqueConstraint(fields=['owner', 'number'], name='unique_schedule_number')]


class Mission(Numbered):
    """Mission autonome : planifier, exécuter, auditer, re-planifier, dans un budget de tours."""

    PREFIX = 'mission'

    class Status(models.TextChoices):
        RUNNING = 'running'
        DONE = 'done'
        ABORTED = 'aborted'
        FAILED = 'failed'

    goal = models.TextField()
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL)
    budget = models.PositiveIntegerField(default=3)
    iterations = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.RUNNING)
    timeline = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-number']
        constraints = [models.UniqueConstraint(fields=['owner', 'number'], name='unique_mission_number')]


class Skill(models.Model):
    """Compétence : une recette réutilisable, avec son taux de réussite."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='skills')
    key = models.SlugField(max_length=40)
    name = models.CharField(max_length=100)
    summary = models.CharField(max_length=300, blank=True)
    steps = models.TextField(blank=True)
    triggers = models.CharField(max_length=300, blank=True)
    version = models.PositiveIntegerField(default=1)
    outcomes = models.JSONField(default=dict, blank=True)  # success, partial, fail
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'key'], name='unique_skill_per_owner')]


class GuardianLog(models.Model):
    """Journal des actions du Gardien (get_logs)."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='guardian_logs')
    kind = models.CharField(max_length=40)
    detail = models.TextField(blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-at']


class ForgedTool(models.Model):
    """Outil forgé par le Gardien (forge_tool) : un script Python dans l'espace de travail."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='forged_tools')
    name = models.SlugField(max_length=31)
    description = models.CharField(max_length=300, blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'name'], name='unique_forged_tool')]


class Preference(models.Model):
    """Réglages d'interface d'un compte, gardés sur le serveur : dimensions épinglées, modèles personnels de la galerie."""

    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='nodz_preference')
    pinned_layers = models.JSONField(default=list, blank=True)  # numéros de dimension (layer_id), dans l'ordre d'épinglage
    gallery = models.JSONField(default=list, blank=True)  # [{id, name, nodes: [{x, y, text, color, shape, radius}], links: [[i, j]]}]
    stripe_customer = models.CharField(max_length=100, blank=True)  # abonnement Premium (premium.py)
    stripe_subscription = models.CharField(max_length=100, blank=True)


def room_token():
    return secrets.token_urlsafe(16)


class Room(models.Model):
    """Salon multijoueur : l'univers de l'hôte ouvert en direct à d'autres comptes, par un lien. Le navigateur de
    l'hôte fait autorité (il enregistre les gestes des invités dans son univers) ; le serveur relaie (rooms.py)."""

    token = models.CharField(max_length=40, unique=True, default=room_token)
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='rooms')
    name = models.CharField(max_length=120, blank=True)
    closed = models.BooleanField(default=False)
    banned = models.JSONField(default=list, blank=True)  # comptes exclus par l'hôte
    created_at = models.DateTimeField(auto_now_add=True)
