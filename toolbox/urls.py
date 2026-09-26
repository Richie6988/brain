from django.urls import path

from . import api

urlpatterns = [
    path('status', api.status),
    path('hub/search', api.hub_search),
    path('hub/files', api.hub_files),
    path('recommendations', api.recommendations),
    path('models', api.models),
    path('models/<uuid:model_id>', api.model_detail),
    path('agents', api.agents),
    path('agents/<uuid:agent_id>', api.agent_detail),
]
