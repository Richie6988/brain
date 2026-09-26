from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from nodzapp.models import Layer, NodzUser, Param


class BootstrapCommandTests(TestCase):
    def run_bootstrap(self, *args):
        call_command('bootstrap', *args, stdout=StringIO())

    def test_creates_local_user_with_param_and_home_layer(self):
        self.run_bootstrap('--email', 'a@nodz.local', '--password', 'pw-123456')
        user = NodzUser.objects.get(email='a@nodz.local')
        self.assertTrue(user.check_password('pw-123456'))
        self.assertTrue(user.is_superuser)
        self.assertEqual(Param.objects.filter(user=user).count(), 1)
        self.assertEqual(Layer.objects.get(user=user, layer_id=1).layer_name, 'Home')

    def test_is_idempotent(self):
        self.run_bootstrap('--email', 'a@nodz.local', '--password', 'pw-123456')
        self.run_bootstrap('--email', 'a@nodz.local')
        self.assertEqual(NodzUser.objects.count(), 1)
        self.assertEqual(Param.objects.count(), 1)
        self.assertEqual(Layer.objects.count(), 1)
        self.assertTrue(NodzUser.objects.get().check_password('pw-123456'))
