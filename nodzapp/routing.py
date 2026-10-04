
from django.urls import path, re_path
from toolbox.rooms import RoomConsumer

from . import consumers  

websocket_urlpatterns = [
    path('ws/', consumers.MyConsumer.as_asgi()), 
    # Salons multijoueur (toolbox/rooms.py) ; avec ou sans le préfixe du site (nginx le retire, le serveur de test non).
    re_path(r'^(?:[\w-]+/)?ws/room/(?P<token>[\w-]+)/$', RoomConsumer.as_asgi()),
]
