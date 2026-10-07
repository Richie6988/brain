"""Fin du Premium offert par parrainage, vérifiée à la requête : rien à planifier, et aucune requête en base tant
qu'un compte n'a pas de date de fin (premium_until). Erreurs JSON traduites pour un compte en anglais."""

import json

from . import i18n, premium


class PremiumExpiry:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and getattr(user, 'premium_until', None):
            premium.expire(user)
        return self.get_response(request)


class TranslateErrors:
    """Une réponse JSON d'erreur ({"error": "..."}) part dans la langue du compte (i18n.ERRORS) ; le reste passe tel quel."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        user = getattr(request, 'user', None)
        if (response.status_code < 400 or getattr(response, 'streaming', False) or not i18n.english(user)
                or not response.get('Content-Type', '').startswith('application/json')):
            return response
        try:
            data = json.loads(response.content)
        except ValueError:
            return response
        if isinstance(data, dict) and isinstance(data.get('error'), str):
            data['error'] = i18n.error(user, data['error'])
            response.content = json.dumps(data)
        return response
