from django.core.management.base import BaseCommand

from toolbox.iaqua import fire_due_schedules
from toolbox.runtime import engine


class Command(BaseCommand):
    help = "Déclenche les tâches planifiées arrivées à échéance (cron chaque minute, pages fermées comprises)."

    def handle(self, *args, **options):
        for task in fire_due_schedules(engine, background=False):
            self.stdout.write(f'{task.key} : {task.title}')
