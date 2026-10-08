from django.urls import path

from . import api

urlpatterns = [
    path('layers', api.layers),
    path('layers/<uuid:layer_id>/graph', api.layer_graph),
    path('changes', api.changes),
    path('nodes/<uuid:node_id>/revisions', api.node_revisions),
    path('runs', api.runs),
    path('runs/<uuid:run_id>', api.run_detail),
    path('files', api.files),
    path('files/<uuid:file_id>', api.file_detail),
]
