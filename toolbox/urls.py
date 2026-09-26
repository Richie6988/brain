from django.urls import path

from . import api

urlpatterns = [
    path('status', api.status),
    path('hub/search', api.hub_search),
    path('hub/files', api.hub_files),
    path('recommendations', api.recommendations),
    path('models', api.models),
    path('models/<uuid:model_id>', api.model_detail),
    path('models/<uuid:model_id>/<str:action>', api.model_action),
    path('files', api.local_files),
    path('agents', api.agents),
    path('agents/<uuid:agent_id>', api.agent_detail),
    path('command', api.command),
]
