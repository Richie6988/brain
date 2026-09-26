"""Boîte à outils IA intégrée (portée de SquidMind) : modèles locaux et agents."""

import uuid

from django.conf import settings
from django.db import models


class LocalModel(models.Model):
    """Un fichier de poids (GGUF) téléchargé depuis Hugging Face, partagé par tout le serveur."""

    class Kind(models.TextChoices):
        TEXT = 'text'
        IMAGE = 'image'
        EMBED = 'embed'
        AUDIO = 'audio'

    class Status(models.TextChoices):
        DOWNLOADING = 'downloading'
        READY = 'ready'
        ERROR = 'error'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repo = models.CharField(max_length=200)
    filename = models.CharField(max_length=300)
    path = models.CharField(max_length=500, blank=True)
    kind = models.CharField(max_length=6, choices=Kind.choices, default=Kind.TEXT)
    capabilities = models.JSONField(default=list, blank=True)  # chat, tools, code, vision, image, reason…
    quant = models.CharField(max_length=20, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DOWNLOADING)
    progress = models.FloatField(default=0)
    error = models.TextField(blank=True)
    params = models.JSONField(default=dict, blank=True)  # n_ctx, temperature, max_tokens…
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['repo', 'filename']
        constraints = [models.UniqueConstraint(fields=['repo', 'filename'], name='unique_model_file')]

    def __str__(self):
        return f'{self.repo}/{self.filename}'


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
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['role', 'name']
        constraints = [models.UniqueConstraint(fields=['owner', 'name'], name='unique_agent_name_per_owner')]

    def __str__(self):
        return self.name
