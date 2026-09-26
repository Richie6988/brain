from django.conf import settings


def nodz_base(request):
    return {'NODZ_BASE': settings.FORCE_SCRIPT_NAME or ''}
