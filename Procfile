web: daphne -b 0.0.0.0 -p $PORT --proxy-headers nodz.asgi:application
release: python manage.py migrate --noinput && python manage.py collectstatic --noinput
