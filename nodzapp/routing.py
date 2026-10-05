from django.urls import re_path
from toolbox.rooms import RoomConsumer

websocket_urlpatterns = [
    # Salons multijoueur (toolbox/rooms.py) ; avec ou sans le préfixe du site (nginx le retire, le serveur de test non).
    re_path(r'^(?:[\w-]+/)?ws/room/(?P<token>[\w-]+)/$', RoomConsumer.as_asgi()),
]
