import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from nodzapp import routing  # Import your routing file

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nodz.settings')

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(            
            routing.websocket_urlpatterns  # Define your WebSocket URL patterns here          
        )
    ),
})
