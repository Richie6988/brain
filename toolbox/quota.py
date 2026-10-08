"""Compte gratuit (sans Premium) : 5 dimensions et 100 nodes ; Premium et administrateur : illimité. La dimension du
Gardien (posée d'office, home.py) est hors quota : ni elle ni ses nodes ne comptent. Au-delà, rien n'est retiré ; seule la
création s'arrête : le navigateur propose Premium (quota.js) ; le serveur refuse en dernier recours un node de trop
(nodzapp.views.save_node). Une dimension de trop n'est arrêtée que dans le navigateur : vide, elle ne coûte rien, et la
dimension Gardien d'un compte déjà au-delà doit toujours pouvoir se poser.
"""

from nodzapp.models import Layer, Node

from . import home
from .models import Agent, hosted

NODES = 100
DIMENSIONS = 5


def home_layer(user):
    """Numéro de la dimension Gardien du compte, ou None."""
    placed = home.mapping(Agent.objects.filter(owner=user, role=Agent.Role.ORCHESTRATOR).first())
    return placed and placed.get('layer')


def usage(user):
    layer = home_layer(user)
    nodes = Node.objects.filter(user=user, archive=False)
    layers = Layer.objects.filter(user=user)
    if layer is not None:
        nodes, layers = nodes.exclude(layer__layer_id=layer), layers.exclude(layer_id=layer)
    return {'limited': not hosted(user), 'nodes': nodes.count(), 'dimensions': layers.count(),
            'max_nodes': NODES, 'max_dimensions': DIMENSIONS, 'home': layer}


def room_for_nodes(user, layer_id, new):
    """Combien des `new` nouveaux nodes de la dimension `layer_id` ce compte peut encore créer."""
    if not new or hosted(user):
        return new
    if layer_id is not None and str(layer_id) == str(home_layer(user)):
        return new
    return max(0, min(new, NODES - usage(user)['nodes']))
