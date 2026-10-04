import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nodz.settings')
django_asgi = get_asgi_application()  # initialise Django avant d'importer les consumers (et leurs modèles)

from nodzapp import routing  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi,
    "websocket": AuthMiddlewareStack(
        URLRouter(            
            routing.websocket_urlpatterns  # Define your WebSocket URL patterns here          
        )
    ),
})
