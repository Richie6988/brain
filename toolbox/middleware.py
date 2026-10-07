"""Fin du Premium offert par parrainage, vérifiée à la requête : rien à planifier, et aucune requête en base tant
qu'un compte n'a pas de date de fin (premium_until)."""

from . import premium


class PremiumExpiry:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and getattr(user, 'premium_until', None):
            premium.expire(user)
        return self.get_response(request)
