"""Un seul modèle en mémoire, un seul consommateur à la fois, par ordre de priorité.

Porté du ModelBroker de SquidMind : les demandes interactives passent devant les agents,
les agents devant les tâches de fond ; un jeton tenu trop longtemps expire (plantage).
"""

import heapq
import itertools
import threading
import time
from contextlib import contextmanager

CHAT, IMAGE, AGENT, BACKGROUND = 0, 1, 2, 3


class BrokerTimeout(Exception):
    pass


class Broker:
    def __init__(self, max_hold=600):
        self.max_hold = max_hold
        self._cond = threading.Condition()
        self._queue = []  # (priorité, ordre d'arrivée, propriétaire)
        self._seq = itertools.count()
        self._holder = None  # (propriétaire, priorité, acquis à)

    def _expire(self):
        if self._holder and time.monotonic() - self._holder[2] > self.max_hold:
            self._holder = None

    @contextmanager
    def slot(self, priority, owner, timeout=900):
        entry = (priority, next(self._seq), owner)
        deadline = time.monotonic() + timeout
        with self._cond:
            heapq.heappush(self._queue, entry)
            while True:
                self._expire()
                if self._holder is None and self._queue[0] is entry:
                    heapq.heappop(self._queue)
                    self._holder = (owner, priority, time.monotonic())
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._queue.remove(entry)
                    heapq.heapify(self._queue)
                    self._cond.notify_all()
                    raise BrokerTimeout(f'{owner} : file d\'attente trop longue')
                self._cond.wait(min(remaining, 1.0))
        try:
            yield
        finally:
            with self._cond:
                if self._holder and self._holder[0] == owner:
                    self._holder = None
                self._cond.notify_all()

    def state(self):
        with self._cond:
            return {'busy': self._holder is not None, 'holder': self._holder[0] if self._holder else None,
                    'queued': [owner for _, _, owner in sorted(self._queue)]}
