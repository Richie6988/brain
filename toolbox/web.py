"""Recherche et lecture web du Gardien, comme web_search / web_fetch d'iAqua.

Recherche par l'API HTML de DuckDuckGo (sans clé). Lecture d'une page publique seulement : chaque
adresse (redirections comprises) est résolue et refusée si elle vise le réseau interne du serveur.
"""

import html
import ipaddress
import re
import socket
import urllib.parse
import urllib.request

from django.conf import settings

UA = 'Mozilla/5.0 (X11; Linux x86_64) Nodz-Gardien/1.0'
TIMEOUT = 10
MAX_BYTES = 2 * 1024 * 1024
MAX_CHARS = 4000


class WebError(Exception):
    """Recherche ou lecture impossible : le message est rendu au Gardien."""


def _public(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise WebError(f'adresse refusée : {url!r}')
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80))
    except socket.gaierror:
        raise WebError(f'hôte introuvable : {parts.hostname}') from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise WebError(f'adresse interne refusée : {parts.hostname}')
    return url


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _public(newurl)  # une redirection ne mène pas au réseau interne
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _get(url, data=None):
    if not settings.GUARDIAN_WEB:
        raise WebError('le web est désactivé sur ce serveur (GUARDIAN_WEB=0)')
    opener = urllib.request.build_opener(_Redirects)
    request = urllib.request.Request(_public(url), data=data, headers={'User-Agent': UA})
    try:
        with opener.open(request, timeout=TIMEOUT) as response:
            kind = response.headers.get_content_type()
            body = response.read(MAX_BYTES)
            charset = response.headers.get_content_charset() or 'utf-8'
    except OSError as e:
        raise WebError(f'lecture impossible : {e}') from None
    return kind, body.decode(charset, 'replace')


def to_text(markup):
    markup = re.sub(r'(?is)<(script|style|noscript|svg|head)\b.*?</\1>', ' ', markup)
    markup = re.sub(r'(?i)<(br|p|div|li|h[1-6]|tr)\b[^>]*>', '\n', markup)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', markup))
    return '\n'.join(' '.join(line.split()) for line in text.splitlines() if line.strip())


def search(query, limit=5):
    """[{title, url, snippet}] des premiers résultats."""
    _, page = _get('https://html.duckduckgo.com/html/', urllib.parse.urlencode({'q': query}).encode())
    results = []
    for block in re.findall(r'(?s)<div class="result.*?</div>\s*</div>', page):
        link = re.search(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not link:
            continue
        url = html.unescape(link.group(1))
        if 'uddg=' in url:  # lien de redirection de DuckDuckGo
            url = urllib.parse.unquote(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['uddg'][0])
        snippet = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.S)
        results.append({'title': to_text(link.group(2)), 'url': url, 'snippet': to_text(snippet.group(1)) if snippet else ''})
        if len(results) >= limit:
            break
    return results


def fetch(url):
    """Texte lisible d'une page publique, tronqué."""
    kind, body = _get(url)
    text = to_text(body) if 'html' in kind else body
    return text[:MAX_CHARS]
