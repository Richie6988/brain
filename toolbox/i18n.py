"""Langue d'un compte côté serveur : celle choisie dans Nodz (NodzUser.language), le français sinon. say() rend le
texte de la langue du compte ; english() pour les branches plus longues (e-mails, maison du Gardien) ; error() traduit un message d'erreur."""

import re


def lang(user):
    return 'en' if getattr(user, 'language', '') == 'en' else 'fr'


def english(user):
    return lang(user) == 'en'


def say(user, fr, en, **values):
    return (en if english(user) else fr).format(**values)


# Messages d'erreur du serveur rendus à la page (réponses JSON « error », flux du Gardien) : le français reste le texte
# des exceptions, un compte en anglais reçoit sa traduction. Motif (le message entier) → gabarit anglais.
ERRORS = [(re.compile(f'^{fr}$', re.S), en) for fr, en in [
    (r"réservé aux administrateurs : les modèles sont partagés par tout le serveur", 'reserved for administrators: models are shared by the whole server'),
    (r"Hugging Face : (?P<e>.+)", 'Hugging Face: {e}'),
    (r"Stripe : (?P<e>.+)", 'Stripe: {e}'),
    (r"(?P<n>.+?) : nombre attendu", '{n}: number expected'),
    (r"exécution sur le serveur réservée à l'administrateur \(GUARDIAN_SHELL=1\) : exécute dans le navigateur",
     'running on the server is reserved for the administrator (GUARDIAN_SHELL=1): run it in the browser'),
    (r"langage (?P<l>.+?) non exécutable sur le serveur \((?P<r>.+)\)", 'language {l} cannot run on the server ({r})'),
    (r"code vide ou trop long \(100 000 caractères au plus\)", 'empty or too long code (100,000 characters at most)'),
    (r"pinned : liste de numéros de dimension", 'pinned: list of dimension numbers'),
    (r"nom du modèle requis", 'template name required'),
    (r"de 1 à (?P<n>\d+) nodes", 'from 1 to {n} nodes'),
    (r"node : x et y requis", 'node: x and y required'),
    (r"(?P<n>\d+) modèles au plus : retires-en un", '{n} templates at most: remove one'),
    (r"fichier attendu \(champ file\)", 'file expected (file field)'),
    (r"modèle : 20 Mo au plus", 'template: 20 MB at most'),
    (r"une compilation est déjà en cours", 'a build is already running'),
    (r"le serveur ne peut pas se redémarrer seul : (?P<c>.+)", "the server can't restart itself: {c}"),
    (r"action : build ou restart", 'action: build or restart'),
    (r"origine inconnue", 'unknown origin'),
    (r"pas de Gardien", 'no Guardian'),
    (r"classeur requis \(10 Mo au plus\)", 'workbook required (10 MB at most)'),
    (r"classeur illisible : (?P<e>.+)", 'unreadable workbook: {e}'),
    (r"fichier XMind requis \(20 Mo au plus\)", 'XMind file required (20 MB at most)'),
    (r"fichier XMind illisible : (?P<e>.+)", 'unreadable XMind file: {e}'),
    (r"les salons collaboratifs sont réservés au Premium", 'collaborative rooms are reserved for Premium'),
    (r"salon fermé ou introuvable", 'room closed or not found'),
    (r"fichier introuvable", 'file not found'),
    (r"image introuvable", 'image not found'),
    (r"repo attendu sous la forme organisation/dépôt", 'repo expected as organization/repository'),
    (r"repo \(organisation/dépôt\) et filename \(\.gguf\) requis", 'repo (organization/repository) and filename (.gguf) required'),
    (r"type (?P<k>.+?) inconnu", 'unknown type {k}'),
    (r"URL de base \(http:// ou https://\) et nom du modèle requis", 'base URL (http:// or https://) and model name required'),
    (r"connexion impossible : (?P<e>.+)", 'cannot connect: {e}'),
    (r"ce modèle de cette API est déjà dans la bibliothèque", 'this model of this API is already in the library'),
    (r"modèle introuvable", 'model not found'),
    (r"le Premium se donne à un modèle partagé, pas à un connecteur personnel", 'Premium goes to a shared model, not to a personal connector'),
    (r"type inconnu", 'unknown type'),
    (r"action inconnue : (?P<a>.+)", 'unknown action: {a}'),
    (r"fichier \.gguf introuvable dans le dossier des modèles", '.gguf file not found in the models folder'),
    (r"méthode non autorisée", 'method not allowed'),
    (r"name et role valides requis", 'valid name and role required'),
    (r"agent introuvable", 'agent not found'),
    (r"outil inconnu : (?P<t>.+)", 'unknown tool: {t}'),
    (r"un agent ne règle que l'échantillonnage", 'an agent only sets sampling'),
    (r"rôle inconnu", 'unknown role'),
    (r"JSON invalide", 'invalid JSON'),
    (r"contexte de la page requis", 'page context required'),
    (r"prompt requis", 'prompt required'),
    (r"pack inconnu : (?P<k>.+)", 'unknown pack: {k}'),
    (r"(?P<r>\S+) : aucun fichier ne correspond à (?P<p>.+)", '{r}: no file matches {p}'),
    (r"le Premium n'est pas encore ouvert sur ce serveur", "Premium isn't open on this server yet"),
    (r"crée un compte \(avec ton adresse e-mail\) pour passer Premium", 'create an account (with your e-mail address) to go Premium'),
    (r"ton compte est déjà Premium", 'your account is already Premium'),
    (r"aucun abonnement à gérer", 'no subscription to manage'),
    (r"(?P<u>\S+) ne répond pas à temps : le service est surchargé ou très lent, réessaie",
     "{u} doesn't answer in time: the service is overloaded or very slow, try again"),
    (r"(?P<u>\S+) injoignable \((?P<e>\w+)\) : vérifie l'adresse dans Agents & modèles, et que le service tourne",
     "{u} unreachable ({e}): check the address in Agents & models, and that the service is running"),
    (r"(?P<u>\S+) a refusé \(401\) : .+", '{u} refused (401): key refused (invalid or expired): change it in Agents & models, Via API'),
    (r"(?P<u>\S+) a refusé \(403\) : .+", "{u} refused (403): key without access to this model"),
    (r"(?P<u>\S+) a refusé \(404\) : .+", '{u} refused (404): address or model name unknown to the service: check the URL (often …/v1) and the exact model name'),
    (r"(?P<u>\S+) a refusé \(429\) : .+", '{u} refused (429): limit reached (quota or rate): try again in a moment, or check your credit'),
    (r"(?P<u>\S+) ne répond pas comme une API compatible OpenAI", "{u} doesn't answer like an OpenAI-compatible API"),
    (r"date illisible : (?P<d>.+?) \(attendu AAAA-MM-JJ HH:MM\)", 'unreadable date: {d} (expected YYYY-MM-DD HH:MM)'),
    (r"node inconnu : (?P<r>.+)", 'unknown node: {r}'),
    (r"node introuvable : (?P<r>.+)", 'node not found: {r}'),
    (r"chemin hors de l'espace de travail : (?P<p>.+)", 'path outside the workspace: {p}'),
    (r"fichier introuvable : (?P<p>.+)", 'file not found: {p}'),
    (r"fichier trop gros \(1 Mo au plus\)", 'file too big (1 MB at most)'),
    (r"chemin de fichier requis", 'file path required'),
    (r"dossier introuvable : (?P<p>.+)", 'folder not found: {p}'),
    (r"le texte cherché apparaît (?P<n>\d+) fois \(il doit apparaître une fois\)", 'the searched text appears {n} times (it must appear once)'),
    (r"délai dépassé \((?P<s>\d+) s\)", 'timed out ({s} s)'),
    (r"message de commit requis", 'commit message required'),
    (r"action git inconnue : (?P<a>\S+) \(status, diff, log, commit\)", 'unknown git action: {a} (status, diff, log, commit)'),
    (r"paquets requis", 'packages required'),
    (r"action inconnue : (?P<a>\S+) \(install, list, remove\)", 'unknown action: {a} (install, list, remove)'),
    (r"nom d'outil en snake_case, 3 à 31 caractères", 'tool name in snake_case, 3 to 31 characters'),
    (r"outil inconnu : (?P<t>.+)", 'unknown tool: {t}'),
    (r"modèle : un fichier \.pptx, \.docx, \.xlsx ou \.pdf, avec un nom", 'template: a .pptx, .docx, .xlsx or .pdf file, with a name'),
    (r"modèle de document introuvable : (?P<n>.+)", 'document template not found: {n}'),
    (r"MCP_SERVERS n'est pas un JSON valide", "MCP_SERVERS isn't valid JSON"),
    (r"serveur MCP injoignable : (?P<e>.+)", 'MCP server unreachable: {e}'),
    (r"serveur MCP inconnu : (?P<s>.+)", 'unknown MCP server: {s}'),
    (r"stable-diffusion\.cpp \(sd\) n'est pas installé sur le serveur : voir DEPLOY\.md", "stable-diffusion.cpp (sd) isn't installed on the server: see DEPLOY.md"),
    (r"(?P<f>.+) n'est pas téléchargé", "{f} isn't downloaded"),
    (r"FLUX a besoin de ses fichiers compagnons \((?P<m>.+)\) : installe le pack FLUX depuis Agents & modèles",
     'FLUX needs its companion files ({m}): install the FLUX pack from Agents & models'),
    (r"génération trop longue : interrompue", 'generation too long: interrupted'),
    (r"stable-diffusion\.cpp a échoué : (?P<e>.+)", 'stable-diffusion.cpp failed: {e}'),
    (r"llama-cpp-python n'est pas installé \(pip install -r requirements-ai\.txt\)", "llama-cpp-python isn't installed (pip install -r requirements-ai.txt)"),
    (r"(?P<m>.+) ne se charge pas \((?P<e>.+)\) : réduis le contexte dans ses réglages", "{m} doesn't load ({e}): reduce the context in its settings"),
    (r"demande trop longue pour le contexte du modèle \((?P<p>\d+) jetons sur (?P<n>\d+)\) : .+",
     "request too long for the model's context ({p} tokens out of {n}): increase the context in the model's settings, or shorten the conversation"),
    (r"arrêté", 'stopped'),
    (r"réglage inconnu : (?P<k>.+)", 'unknown setting: {k}'),
    (r"(?P<l>.+?) : oui ou non", '{l}: yes or no'),
    (r"(?P<l>.+?) : choix inconnu", '{l}: unknown choice'),
    (r"(?P<l>.+?) : nombres séparés par des virgules", '{l}: comma-separated numbers'),
    (r"(?P<l>.+?) : parts positives", '{l}: positive shares'),
    (r"(?P<l>.+?) : entre (?P<a>\S+) et (?P<b>\S+)", '{l}: between {a} and {b}'),
    (r"Cache V quantifié : active la flash attention", 'Quantized V cache: enable flash attention'),
    (r"le Gardien traite déjà une de tes demandes : attends sa réponse", 'the Guardian is already handling one of your requests: wait for its answer'),
    (r"le Gardien est très demandé \((?P<n>\d+) en attente\) : réessaie dans un moment", 'the Guardian is in high demand ({n} waiting): try again in a moment'),
    (r"erreur interne du Gardien \((?P<d>.+)\)", 'internal Guardian error ({d})'),
    (r"Parrainage refusé", 'Referral refused'),
]]


def error(user, message):
    """Le message d'erreur dans la langue du compte (tel quel s'il n'est pas dans la table)."""
    if not english(user) or not isinstance(message, str):
        return message
    for pattern, en in ERRORS:
        match = pattern.match(message)
        if match:
            return en.format(**match.groupdict())
    return message
