"""
URL configuration for nodz project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import path, include

from graph import views as graph_views


def healthz(request):
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('healthz', healthz),
    path('api/v1/', include('graph.urls')),
    path('next', graph_views.next_page, name='next'),
    path('admin/', admin.site.urls),
    path('', include('nodzapp.urls')),
]
