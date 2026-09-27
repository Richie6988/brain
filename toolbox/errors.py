"""Erreurs communes au Gardien et à ses outils."""


class PlanError(Exception):
    """Action ou contexte invalide : signalé à l'utilisateur (et au modèle), le reste continue."""
