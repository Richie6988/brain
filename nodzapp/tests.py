from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from nodzapp.models import Layer, NodzUser, Param


class BootstrapCommandTests(TestCase):
    def run_bootstrap(self, *args):
        call_command('bootstrap', *args, stdout=StringIO())

    def test_existing_account_becomes_admin(self):
        NodzUser.objects.create_user(email='b@nodz.local', password='x')
        self.run_bootstrap('--email', 'b@nodz.local')
        user = NodzUser.objects.get(email='b@nodz.local')
        self.assertTrue(user.is_staff and user.is_superuser)
        self.assertTrue(user.check_password('x'))

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


class Phase1FixesTests(TestCase):
    def setUp(self):
        call_command('bootstrap', '--email', 'a@nodz.local', '--password', 'pw-123456', stdout=StringIO())
        self.user = NodzUser.objects.get(email='a@nodz.local')

    def test_node_created_at_is_not_overwritten_on_save(self):
        from nodzapp.models import Node

        node = Node.objects.create(user=self.user, layer=Layer.objects.get(user=self.user))
        created = node.created_at
        node.text_content = 'edit'
        node.save()
        node.refresh_from_db()
        self.assertEqual(node.created_at, created)

    def test_validation_code_endpoints_require_csrf(self):
        from django.test import Client

        client = Client(enforce_csrf_checks=True)
        for url in ('/send-validation-code/', '/verify-validation-code/'):
            self.assertEqual(client.post(url, {'email': 'x@y.z'}).status_code, 403)

    def test_templates_use_absolute_static_urls(self):
        for url in ('/', '/universe', '/terms', '/privacy'):
            html = self.client.get(url).content.decode()
            self.assertNotRegex(html, r'(src|href)="static\\', url)

    def test_login_redirects_to_universe(self):
        response = self.client.post('/login/', {'username': 'a@nodz.local', 'password': 'pw-123456'})
        self.assertRedirects(response, '/universe', fetch_redirect_response=False)


class DeploymentTests(TestCase):
    def test_healthz(self):
        response = self.client.get('/healthz')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_universe_exposes_url_prefix_and_loads_base_js_first(self):
        html = self.client.get('/universe').content.decode()
        self.assertIn('data-base=""', html)
        self.assertLess(html.index('js/base.js'), html.index('js/STLviewer.js'))

    def test_cookies_do_not_collide_with_paintit(self):
        response = self.client.get('/login/')
        self.assertIn('nodz_csrftoken', response.cookies)
        self.assertNotIn('csrftoken', response.cookies)


class UniverseSessionTests(TestCase):
    def test_opening_universe_keeps_the_session(self):
        user = NodzUser.objects.create_user(email='s@nodz.local', password='x')
        self.client.force_login(user)
        self.assertEqual(self.client.get('/universe').status_code, 200)  # un autre onglet, un rechargement
        self.assertEqual(self.client.get('/api/v1/toolbox/status').status_code, 200)
