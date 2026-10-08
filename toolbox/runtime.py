"""Instances partagées par le processus : un broker, un moteur, un dispatcher de demandes."""

from django.conf import settings

from .broker import Broker
from .dispatcher import Dispatcher
from .engine import Engine

broker = Broker()
engine = Engine(broker)
dispatcher = Dispatcher(settings.GUARDIAN_WORKERS, settings.GUARDIAN_QUEUE)
