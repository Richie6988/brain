import os
import secrets

from django.core.management.base import BaseCommand

from nodzapp.models import Layer, NodzUser, Param


class Command(BaseCommand):
    help = "Crée (ou complète) l'utilisateur local avec son Param et son layer Home."

    def add_arguments(self, parser):
        parser.add_argument('--email', default=os.environ.get('NODZ_LOCAL_EMAIL') or 'local@nodz.local')
        parser.add_argument('--password', default=os.environ.get('NODZ_LOCAL_PASSWORD') or None)

    def handle(self, *args, email, password, **options):
        user = NodzUser.objects.filter(email=email).first()
        if user is None:
            password = password or secrets.token_urlsafe(12)
            user = NodzUser.objects.create_superuser(email=email, password=password, username='local')
            self.stdout.write(f'Utilisateur créé : {email} / {password}')
        elif password:
            user.set_password(password)
            user.save()
            self.stdout.write(f'Mot de passe mis à jour pour {email}')
        else:
            self.stdout.write(f'Utilisateur existant : {email}')

        Param.objects.get_or_create(user=user)
        Layer.objects.get_or_create(user=user, layer_id=1, defaults={'layer_name': 'Home'})
