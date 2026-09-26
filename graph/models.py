"""Modèle de données v2 : un graphe gouverné (UUID, provenance, révisions, audit).

Un node garde tous ses états possibles dans `payload` (un sous-objet par type de contenu) ;
seul `content_type` indique celui qui est affiché. Les liens et les portails sont des `Edge` :
un portail est une arête dont les deux extrémités sont sur des plans différents.
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Origin(models.TextChoices):
    HUMAN = 'human'
    AI = 'ai'
    IMPORT = 'import'


class Layer(models.Model):
    class Kind(models.TextChoices):
        USER = 'user'
        AI_DRAFT = 'ai_draft'
        ARCHIVE = 'archive'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='graph_layers')
    name = models.CharField(max_length=200, blank=True)
    index = models.IntegerField(default=0)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.USER)
    legacy_ref = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['index']
        constraints = [models.UniqueConstraint(fields=['owner', 'index'], name='unique_layer_index_per_owner')]

    def __str__(self):
        return f'{self.name or "Layer"} [{self.index}]'


class StoredFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='graph_files')
    file = models.FileField(upload_to='graph/%Y/%m/')
    name = models.CharField(max_length=255)
    mime = models.CharField(max_length=100, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    extracted_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AIRun(models.Model):
    class Mode(models.TextChoices):
        FOCUS = 'focus'
        EXPLORE = 'explore'
        AUTONOMOUS = 'autonomous'
        COMMAND = 'command'

    class Status(models.TextChoices):
        PENDING = 'pending'
        RUNNING = 'running'
        DONE = 'done'
        ERROR = 'error'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ai_runs')
    model_id = models.CharField(max_length=200)
    mode = models.CharField(max_length=12, choices=Mode.choices)
    prompt = models.TextField(blank=True)
    prompt_node = models.ForeignKey('Node', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    context_node_ids = models.JSONField(default=list, blank=True)
    params = models.JSONField(default=dict, blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Node(models.Model):
    class ContentType(models.TextChoices):
        TEXT = 'text'
        IMAGE = 'image'
        FILE = 'file'
        VIDEO = 'video'
        AUDIO = 'audio'
        MODEL3D = 'model3d'
        CODE = 'code'
        PROMPT = 'prompt'

    class Shape(models.TextChoices):
        CIRCLE = 'circle'
        SQUARE = 'square'
        NONE = 'none'

    class Status(models.TextChoices):
        DRAFT = 'draft'
        ACCEPTED = 'accepted'
        ARCHIVED = 'archived'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name='nodes')
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    radius = models.FloatField(default=62.5)
    shape = models.CharField(max_length=6, choices=Shape.choices, default=Shape.CIRCLE)
    color = models.CharField(max_length=20, default='#33FF99')
    lock = models.BooleanField(default=False)
    content_type = models.CharField(max_length=8, choices=ContentType.choices, default=ContentType.TEXT)
    payload = models.JSONField(default=dict, blank=True)
    file = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name='nodes')
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACCEPTED)
    version = models.PositiveIntegerField(default=1)
    origin = models.CharField(max_length=6, choices=Origin.choices, default=Origin.HUMAN)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    ai_run = models.ForeignKey(AIRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='nodes')
    legacy_ref = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['layer', 'status'])]

    def __str__(self):
        return f'{self.content_type} {self.id}'


class Edge(models.Model):
    class Kind(models.TextChoices):
        LINK = 'link'
        PORTAL = 'portal'
        DERIVATION = 'derivation'
        REFERENCE = 'reference'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='out_edges')
    target = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='in_edges')
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.LINK)
    origin = models.CharField(max_length=6, choices=Origin.choices, default=Origin.HUMAN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['source', 'target', 'kind'], name='unique_edge'),
            models.CheckConstraint(check=~Q(source=F('target')), name='edge_not_self'),
        ]


class NodeRevision(models.Model):
    """Historique append-only : un instantané complet du node à chaque version."""

    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name='revisions')
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    ai_run = models.ForeignKey(AIRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    reason = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['node', 'version']
        constraints = [models.UniqueConstraint(fields=['node', 'version'], name='unique_node_version')]


class AuditLog(models.Model):
    """Journal append-only de toutes les écritures (humain ou IA)."""

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    ai_run = models.ForeignKey(AIRun, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=20)
    entity = models.CharField(max_length=10)
    entity_id = models.CharField(max_length=36)
    diff = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['entity', 'entity_id'])]
