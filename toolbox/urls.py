from django.urls import path

from . import admin, api

urlpatterns = [
    path('status', api.status),
    path('system', api.system),
    path('hub/search', api.hub_search),
    path('hub/files', api.hub_files),
    path('recommendations', api.recommendations),
    path('models', api.models),
    path('models/<uuid:model_id>', api.model_detail),
    path('models/<uuid:model_id>/<str:action>', api.model_action),
    path('files', api.local_files),
    path('agents', api.agents),
    path('agents/<uuid:agent_id>', api.agent_detail),
    path('packs/<str:key>', api.pack),
    path('cuda', api.cuda_build),
    path('images/<str:name>', api.image),
    path('workspace/<path:path>', api.workspace_file),
    path('brain-map', api.brain_map),
    path('marks', api.marks),
    path('tools', api.tool_list),
    path('command', api.command),
    path('admin/overview', admin.overview),
    path('admin/log', admin.log),
    path('admin/users', admin.users),
    path('admin/users/<int:user_id>', admin.user_detail),
    path('admin/planned', admin.planned),
    path('admin/schedules/<int:schedule_id>', admin.schedule_detail),
    path('admin/missions/<int:mission_id>/stop', admin.mission_stop),
]
