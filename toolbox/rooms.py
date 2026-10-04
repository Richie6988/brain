"""Salons multijoueur (room.js) : un relais WebSocket par salon. Le serveur n'écrit rien dans les univers : le
navigateur de l'hôte applique et enregistre les gestes des invités. Il vérifie l'accès (compte connecté, salon ouvert,
pas exclu), signe chaque message de l'identité de son auteur (jamais celle qu'il prétend) et réserve à l'hôte l'état
de l'univers, l'exclusion et la fermeture.
"""

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import Room

RELAYED = {'hello', 'state', 'save', 'delete', 'type', 'cursor', 'view', 'kick', 'close'}
HOST_ONLY = {'state', 'kick', 'close'}


def display_name(user):
    return (user.username or user.email.split('@')[0])[:40]


@database_sync_to_async
def enter(token, user):
    room = Room.objects.filter(token=token, closed=False).select_related('host').first()
    if room is None or (room.host_id != user.pk and user.pk in room.banned):
        return None
    return room


@database_sync_to_async
def ban(room_id, user_id):
    room = Room.objects.get(pk=room_id)
    if user_id not in room.banned:
        room.banned = [*room.banned, user_id]
        room.save(update_fields=['banned'])


@database_sync_to_async
def shut(room_id):
    Room.objects.filter(pk=room_id).update(closed=True)


class RoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        self.group = None
        if not user or not user.is_authenticated:
            return await self.close(code=4401)
        room = await enter(self.scope['url_route']['kwargs']['token'], user)
        if room is None:
            return await self.close(code=4403)
        self.room_id, self.host = room.pk, room.host_id == user.pk
        self.who = {'id': user.pk, 'name': display_name(user), 'host': self.host}
        self.group = f'room_{room.pk}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({'t': 'welcome', 'me': self.who, 'room': {'name': room.name, 'host': display_name(room.host)}})
        await self.share({'t': 'join'})

    async def disconnect(self, code):
        if self.group:
            await self.share({'t': 'leave'})
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        kind = content.get('t') if isinstance(content, dict) else None
        if kind not in RELAYED or (kind in HOST_ONLY and not self.host):
            return
        if kind == 'kick':
            if not isinstance(content.get('user'), int) or content['user'] == self.who['id']:
                return
            await ban(self.room_id, content['user'])
        elif kind == 'close':
            await shut(self.room_id)
        await self.share(content)

    async def share(self, content):
        await self.channel_layer.group_send(self.group, {'type': 'relay', 'sender': self.channel_name,
                                                         'message': {**content, 'from': self.who}})

    async def relay(self, event):
        message = event['message']
        if event['sender'] == self.channel_name or message.get('to') not in (None, self.who['id']):
            return
        await self.send_json(message)
        excluded = message['t'] == 'kick' and message.get('user') == self.who['id']
        if not self.host and (excluded or message['t'] == 'close'):
            await self.close(code=4403)
