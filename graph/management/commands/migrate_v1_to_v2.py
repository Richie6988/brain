from django.core.management.base import BaseCommand

from nodzapp.models import NodzUser

from graph.legacy import migrate_user


class Command(BaseCommand):
    help = 'Copie les données v1 (nodzapp) dans le graphe v2. Idempotente : relançable sans doublon.'

    def add_arguments(self, parser):
        parser.add_argument('--user', help="email d'un seul utilisateur (défaut : tous)")

    def handle(self, *args, user, **options):
        users = NodzUser.objects.filter(email=user) if user else NodzUser.objects.all()
        total = {'layers': 0, 'nodes': 0, 'edges': 0, 'updated': 0}
        for u in users.iterator():
            for key, value in migrate_user(u).items():
                total[key] += value
        self.stdout.write(
            f"{users.count()} utilisateur(s) : {total['layers']} plans, {total['nodes']} nodes, "
            f"{total['edges']} arêtes créés ; {total['updated']} mis à jour"
        )
