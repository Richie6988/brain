from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie


@ensure_csrf_cookie
def next_page(request):
    """Nouvelle interface (Phase 3), en parallèle de /universe jusqu'à la bascule."""
    return render(request, 'graph/next.html')
