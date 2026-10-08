"""Dispatcher des demandes au Gardien : peu à la fois, dans l'ordre, une par utilisateur.

Le broker sérialise chaque appel au modèle ; une demande au Gardien en enchaîne plusieurs (tours,
délégations). Le dispatcher admet des demandes entières : `workers` en cours au plus, `max_waiting`
en file au plus, une seule par utilisateur (en cours ou en file). Au-delà, la demande est refusée
tout de suite plutôt que d'empiler du travail qui saturerait le modèle.
"""

import threading


class Busy(Exception):
    """Demande refusée : file pleine ou demande déjà en cours pour cet utilisateur."""


class Ticket:
    def __init__(self, owner):
        self.owner = owner
        self.cancelled = False


class Dispatcher:
    def __init__(self, workers=1, max_waiting=8):
        self.workers, self.max_waiting = workers, max_waiting
        self._cond = threading.Condition()
        self._running = []
        self._waiting = []

    def admit(self, owner):
        with self._cond:
            if any(t.owner == owner for t in self._running + self._waiting):
                raise Busy('le Gardien traite déjà une de tes demandes : attends sa réponse')
            if len(self._waiting) >= self.max_waiting:
                raise Busy(f'le Gardien est très demandé ({len(self._waiting)} en attente) : réessaie dans un moment')
            ticket = Ticket(owner)
            self._waiting.append(ticket)
            self._cond.notify_all()
            return ticket

    def wait(self, ticket, on_position=lambda position: None):
        """Attend son tour ; `on_position(n)` à chaque changement de place. Faux si la demande est abandonnée."""
        shown = None
        with self._cond:
            while True:
                if ticket.cancelled:
                    self._waiting.remove(ticket)
                    self._cond.notify_all()
                    return False
                position = self._waiting.index(ticket)
                if position == 0 and len(self._running) < self.workers:
                    self._waiting.pop(0)
                    self._running.append(ticket)
                    return True
                if position != shown:
                    shown = position
                    on_position(position + 1)
                self._cond.wait(1.0)

    def cancel(self, ticket):
        with self._cond:
            ticket.cancelled = True
            self._cond.notify_all()

    def stop(self, owner):
        """Arrête les demandes de cet utilisateur (en file ou en cours). Vrai s'il y en avait une."""
        with self._cond:
            tickets = [t for t in self._running + self._waiting if t.owner == owner]
            for ticket in tickets:
                ticket.cancelled = True
            self._cond.notify_all()
        return bool(tickets)

    def done(self, ticket):
        with self._cond:
            if ticket in self._running:
                self._running.remove(ticket)
            elif ticket in self._waiting:
                self._waiting.remove(ticket)
            self._cond.notify_all()

    def tickets(self, with_state=False):
        """Demandes en cours puis en file (avec `running` si with_state), pour la console d'administration."""
        with self._cond:
            items = [(t, True) for t in self._running] + [(t, False) for t in self._waiting]
        return items if with_state else [t for t, _ in items]

    def state(self):
        with self._cond:
            return {'running': len(self._running), 'waiting': len(self._waiting), 'workers': self.workers}
