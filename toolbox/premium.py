"""Gardien Premium : un abonnement Stripe (Checkout, mode abonnement) qui donne au compte le modèle Premium du serveur
(un modèle marqué premium par l'administrateur, en général par API : la clé reste sur le serveur).

- checkout_url : la page de paiement Stripe du compte ; le compte est retrouvé au retour par client_reference_id.
- billing_url : le portail client Stripe (résilier, changer de carte).
- handle : le webhook signé (STRIPE_WEBHOOK_SECRET) ; checkout.session.completed active le compte,
  customer.subscription.updated / deleted le garde actif ou le désactive selon l'état de l'abonnement.
Activer : premium sur le compte, son Gardien passe sur le modèle Premium, un e-mail de bienvenue part (SMTP, Postfix en
local). Désactiver : premium retiré, ses agents qui utilisaient l'IA du serveur s'endorment (sa clé API ou le Premium les
réveillent), un e-mail le dit. Chaque changement d'état n'a lieu qu'une fois : un webhook rejoué ne renvoie pas d'e-mail.
"""

import logging
import re
from datetime import timedelta

import stripe
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.utils import timezone

from . import i18n
from .models import Agent, LocalModel, Preference

logger = logging.getLogger(__name__)
ACTIVE = ('active', 'trialing')  # états d'abonnement qui gardent le Premium
GUEST = re.compile(r'^guest\d+@nodz\.com$')  # comptes invités : pas d'abonnement (pas de vraie adresse)
REFERRAL_DAYS = 30   # Premium offert au parrain par filleul inscrit
REFERRAL_CAP = 365   # jours offerts devant soi, au plus


class PremiumError(Exception):
    pass


def configured():
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID and settings.STRIPE_WEBHOOK_SECRET)


def model():
    """Le modèle Premium du serveur (le premier prêt), ou None."""
    return LocalModel.objects.filter(premium=True, owner=None, status=LocalModel.Status.READY).first()


def offer(user):
    """Ce que la page montre : l'offre, son prix affiché, et si ce compte l'a."""
    premium = model()
    return {'configured': configured() and premium is not None, 'active': bool(user.premium), 'price': settings.PREMIUM_PRICE_LABEL,
            'model': (premium.label or premium.filename) if premium else None, 'guest': bool(GUEST.match(user.email or ''))}


def _preference(user):
    return Preference.objects.get_or_create(owner=user)[0]


def checkout_url(user, base_url):
    if not configured() or model() is None:
        raise PremiumError("le Premium n'est pas encore ouvert sur ce serveur")
    if GUEST.match(user.email or ''):
        raise PremiumError('crée un compte (avec ton adresse e-mail) pour passer Premium')
    if user.premium:
        raise PremiumError('ton compte est déjà Premium')
    pref = _preference(user)
    session = stripe.checkout.Session.create(
        api_key=settings.STRIPE_SECRET_KEY, mode='subscription', line_items=[{'price': settings.STRIPE_PRICE_ID, 'quantity': 1}],
        client_reference_id=str(user.pk), metadata={'user': str(user.pk)},
        **({'customer': pref.stripe_customer} if pref.stripe_customer else {'customer_email': user.email}),
        success_url=f'{base_url}/universe?premium=ok', cancel_url=f'{base_url}/universe?premium=annule')
    return session.url


def billing_url(user, base_url):
    pref = _preference(user)
    if not configured() or not pref.stripe_customer:
        raise PremiumError('aucun abonnement à gérer')
    return stripe.billing_portal.Session.create(api_key=settings.STRIPE_SECRET_KEY, customer=pref.stripe_customer,
                                                return_url=f'{base_url}/universe').url


def _mail(user, subject, body):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])
    except Exception:  # un serveur de courrier en panne ne bloque pas l'activation
        logger.exception('e-mail Premium')


def activate(user, mail=True):
    if user.premium:
        return False
    user.premium, user.premium_date = True, timezone.now()
    user.save(update_fields=['premium', 'premium_date'])
    premium = model()
    if premium:
        Agent.objects.filter(owner=user, role=Agent.Role.ORCHESTRATOR).update(model=premium)
    if mail:
        name = premium.label or premium.filename if premium else i18n.say(user, 'le modèle Premium', 'the Premium model')
        _mail(user, i18n.say(user, 'Ton Gardien Premium est actif', 'Your Premium Guardian is active'), i18n.say(
            user, "Bonjour,\n\nTon abonnement Nodz Premium est actif : ton Gardien utilise maintenant {name}.\n"
                  "Ouvre ton univers, il t'attend.\n\nPour gérer ou résilier ton abonnement : Agents & modèles, Mon IA.\n\nNodz",
            "Hello,\n\nYour Nodz Premium subscription is active: your Guardian now uses {name}.\n"
            "Open your universe, it's waiting for you.\n\nTo manage or cancel your subscription: Agents & models, My AI.\n\nNodz", name=name))
    return True


def deactivate(user, gifted=False):
    if not user.premium:
        return False
    user.premium = False
    user.save(update_fields=['premium'])
    Agent.objects.filter(owner=user, model__owner=None, model__kind=LocalModel.Kind.TEXT).update(model=None)  # l'IA du serveur
    why = (i18n.say(user, 'Ton Premium offert par parrainage a pris fin', 'Your referral Premium has ended') if gifted
           else i18n.say(user, 'Ton abonnement Premium a pris fin', 'Your Premium subscription has ended'))
    _mail(user, i18n.say(user, 'Ton Nodz Premium est terminé', 'Your Nodz Premium has ended'), i18n.say(
        user, "Bonjour,\n\n{why} : ton Gardien s'endort, l'IA du serveur est réservée au Premium.\n"
              "Pour le réveiller : branche ton IA par API avec ta clé, ou abonne-toi, depuis Agents & modèles, Mon IA.\n"
              "Ton univers, lui, reste entier et gratuit.\n\nNodz",
        "Hello,\n\n{why}: your Guardian falls asleep, the server's AI is reserved for Premium.\n"
        "To wake it up: plug in your AI via API with your key, or subscribe, from Agents & models, My AI.\n"
        "Your universe stays whole and free.\n\nNodz", why=why))
    return True


def _subscribed(user):
    return Preference.objects.filter(owner=user).exclude(stripe_subscription='').exists()


def gift(user, days=REFERRAL_DAYS):
    """Premium offert (parrainage) : `days` jours de plus, jamais plus de REFERRAL_CAP jours devant soi. Un abonné
    Stripe garde son abonnement ; les jours offerts prennent le relais s'il le résilie."""
    now = timezone.now()
    start = max(now, user.premium_until or now)
    user.premium_until = min(start + timedelta(days=days), now + timedelta(days=REFERRAL_CAP))
    user.save(update_fields=['premium_until'])
    until = timezone.localtime(user.premium_until).strftime('%d/%m/%Y')
    if activate(user, mail=False):
        _mail(user, i18n.say(user, 'Un ami t\'offre Nodz Premium', 'A friend gives you Nodz Premium'), i18n.say(
            user, "Bonjour,\n\nUn ami a créé son compte Nodz avec ton lien de parrainage : tu as Nodz Premium jusqu'au {until}.\n"
                  "Chaque nouvel ami inscrit t'offre un mois de plus.\n\nNodz",
            "Hello,\n\nA friend created their Nodz account with your referral link: you have Nodz Premium until {until}.\n"
            "Each new friend who signs up gives you one more month.\n\nNodz", until=until))
    else:
        _mail(user, i18n.say(user, 'Un mois de Nodz Premium en plus', 'One more month of Nodz Premium'), i18n.say(
            user, "Bonjour,\n\nUn ami a créé son compte avec ton lien de parrainage : ton Premium offert court jusqu'au {until}.\n\nNodz",
            "Hello,\n\nA friend created their account with your referral link: your gifted Premium runs until {until}.\n\nNodz",
            until=until))
    return user.premium_until


def expire(user):
    """Fin du Premium offert à son échéance, sauf si un abonnement Stripe prend le relais."""
    if not (user.premium and user.premium_until and user.premium_until < timezone.now()) or _subscribed(user):
        return False
    user.premium_until = None
    user.save(update_fields=['premium_until'])
    return deactivate(user, gifted=True)


def handle(payload, signature):
    """Un événement Stripe signé ; renvoie ce qui a été fait (pour le journal)."""
    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as e:
        raise PremiumError(f'webhook refusé : {e}') from None
    kind, obj = event['type'], event['data']['object']
    users = get_user_model().objects
    if kind == 'checkout.session.completed':
        user = users.filter(pk=obj.get('client_reference_id')).first()
        if user is None:
            return 'compte inconnu'
        Preference.objects.update_or_create(owner=user, defaults={'stripe_customer': obj.get('customer') or '',
                                                                  'stripe_subscription': obj.get('subscription') or ''})
        return 'activé' if activate(user) else 'déjà actif'
    if kind in ('customer.subscription.updated', 'customer.subscription.deleted'):
        pref = Preference.objects.filter(stripe_subscription=obj.get('id')).select_related('owner').first()
        if pref is None:
            return 'abonnement inconnu'
        if kind == 'customer.subscription.updated' and obj.get('status') in ACTIVE:
            return 'activé' if activate(pref.owner) else 'déjà actif'
        if kind == 'customer.subscription.deleted':  # abonnement fini : plus d'abonnement à retrouver ni à respecter
            pref.stripe_subscription = ''
            pref.save(update_fields=['stripe_subscription'])
        until = pref.owner.premium_until
        if until and until > timezone.now():  # des jours offerts par parrainage restent : le Premium continue jusque-là
            return 'abonnement terminé, Premium offert jusqu\'à son échéance'
        return 'désactivé' if deactivate(pref.owner) else 'déjà inactif'
    return 'ignoré'
