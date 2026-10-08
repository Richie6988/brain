"""Modèle par API : un serveur compatible OpenAI (/v1/chat/completions en flux) à la place d'un fichier GGUF local.

Ollama, LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI, Groq, Mistral… L'entrée de la bibliothèque garde l'URL
de base, le nom du modèle et la clé (jamais renvoyée au navigateur). Le JSON du Gardien est demandé par schéma
(response_format json_schema) ; un serveur qui ne le connaît pas reçoit json_object, et le schéma est rappelé dans les
consignes. L'administrateur en ajoute pour tout le serveur ; chaque compte peut brancher les siens (sa clé, pour lui
seul), vers une adresse publique uniquement : le serveur ne sert pas de relais vers son propre réseau.
"""

import json
import math

import requests

from .web import WebError, _public

TIMEOUT = (10, 300)  # connexion, puis silence maximal entre deux fragments


class RemoteError(Exception):
    pass


def _post(model, payload, stream):
    headers = {'Content-Type': 'application/json'}
    if model.api_key:
        headers['Authorization'] = f'Bearer {model.api_key}'
    url = f"{model.endpoint.rstrip('/')}/chat/completions"
    guarded = model.owner_id is not None and not model.owner.is_staff  # connecteur d'un compte non administrateur
    try:
        if guarded:
            _public(url)  # à chaque appel : une adresse qui change de cible ne mène pas au réseau interne
        response = requests.post(url, json=payload, headers=headers, stream=stream, timeout=TIMEOUT, allow_redirects=not guarded)
    except WebError as e:
        raise RemoteError(str(e)) from None
    except requests.Timeout:
        raise RemoteError(f'{model.endpoint} ne répond pas à temps : le service est surchargé ou très lent, réessaie') from None
    except requests.RequestException as e:
        raise RemoteError(f'{model.endpoint} injoignable ({type(e).__name__}) : vérifie l\'adresse dans Agents & modèles, '
                          'et que le service tourne') from None
    if response.status_code >= 400:
        detail = response.text[:300].replace('\n', ' ')
        response.close()
        raise RemoteError(f'{model.endpoint} a refusé ({response.status_code}) : {REFUSED.get(response.status_code, detail)}')
    return response


# Refus courants des services compatibles OpenAI, dits à l'humain (le détail technique, pour les autres codes).
REFUSED = {401: 'clé refusée (invalide ou expirée) : change-la dans Agents & modèles, Par API',
           403: 'clé sans accès à ce modèle',
           404: 'adresse ou nom de modèle inconnu du service : vérifie l\'URL (souvent …/v1) et le nom exact du modèle',
           429: 'limite atteinte (quota ou débit) : réessaie dans un moment, ou vérifie ton crédit'}


def chances_of(choice):
    """Jetons envisagés d'un fragment (top_logprobs du format OpenAI), du plus probable au moins probable ; None sinon."""
    content = (choice.get('logprobs') or {}).get('content') or []
    top = content[0].get('top_logprobs') if content else None
    return [(t.get('token', ''), math.exp(t['logprob'])) for t in top if 'logprob' in t] if top else None


class Stream:
    """Fragments de texte d'une réponse en flux ; `usage` (jetons du prompt) arrive à la fin si le serveur le donne."""

    def __init__(self, model, messages, options, json_schema=None, chances=False):
        payload = {'model': model.filename, 'messages': messages, 'stream': True,
                   'stream_options': {'include_usage': True}, **options}
        self.chances = chances  # jetons envisagés (top_logprobs), si le serveur les donne
        if chances:
            payload.update(logprobs=True, top_logprobs=5)
        if json_schema:
            payload['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'reponse', 'schema': json_schema}}
        try:
            self.response = _post(model, payload, True)
        except RemoteError as e:
            if chances and 'logprobs' in str(e):  # serveur sans probabilités : le flux vient sans elles
                payload.pop('logprobs'), payload.pop('top_logprobs')
                self.response = _post(model, payload, True)
            elif not json_schema or 'response_format' not in str(e) and 'json_schema' not in str(e):
                raise
            else:
                payload['response_format'] = {'type': 'json_object'}  # serveur sans schéma : JSON libre, le prompt le décrit
                self.response = _post(model, payload, True)
        self.usage = None

    def __iter__(self):
        for line in self.response.iter_lines(decode_unicode=True):
            if not line or not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            if chunk.get('usage'):
                self.usage = chunk['usage']
            for choice in chunk.get('choices') or []:
                piece = (choice.get('delta') or {}).get('content')
                if piece:
                    yield (piece, chances_of(choice)) if self.chances else piece

    def close(self):
        self.response.close()


def check(model):
    """Petit appel pour vérifier l'URL, la clé et le nom du modèle avant d'ajouter l'entrée."""
    response = _post(model, {'model': model.filename, 'messages': [{'role': 'user', 'content': 'ok'}], 'max_tokens': 1}, False)
    try:
        response.json()
    except ValueError:
        raise RemoteError(f'{model.endpoint} ne répond pas comme une API compatible OpenAI') from None
