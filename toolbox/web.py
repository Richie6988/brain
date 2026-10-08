"""Recherche et lecture web du Gardien, comme web_search / web_fetch d'iAqua.

Recherche en cascade, le premier moteur qui trouve répond : Brave Search (BRAVE_API_KEY), SearXNG (SEARXNG_URL,
une instance de l'administrateur, éventuellement locale), puis DuckDuckGo sans clé (HTML, puis Lite : la page HTML
refuse souvent les serveurs). Lecture d'une page publique seulement : chaque adresse (redirections comprises) est
résolue et refusée si elle vise le réseau interne du serveur.
"""

import html
import ipaddress
import json
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


def _get(url, data=None, headers=None, trusted=False):
    """Une page ; `trusted` : adresse choisie par l'administrateur (SEARXNG_URL), qui peut être interne."""
    if not settings.GUARDIAN_WEB:
        raise WebError('le web est désactivé sur ce serveur (GUARDIAN_WEB=0)')
    opener = urllib.request.build_opener() if trusted else urllib.request.build_opener(_Redirects)
    request = urllib.request.Request(url if trusted else _public(url), data=data, headers={'User-Agent': UA, **(headers or {})})
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


def _brave(query, limit):
    _, body = _get('https://api.search.brave.com/res/v1/web/search?' + urllib.parse.urlencode({'q': query, 'count': limit}),
                   headers={'Accept': 'application/json', 'X-Subscription-Token': settings.BRAVE_API_KEY})
    items = (json.loads(body).get('web') or {}).get('results') or []
    return [{'title': to_text(i.get('title', '')), 'url': i.get('url', ''), 'snippet': to_text(i.get('description', ''))} for i in items]


def _searxng(query, limit):
    _, body = _get(f'{settings.SEARXNG_URL}/search?' + urllib.parse.urlencode({'q': query, 'format': 'json'}), trusted=True)
    items = json.loads(body).get('results') or []
    return [{'title': to_text(i.get('title', '')), 'url': i.get('url', ''), 'snippet': to_text(i.get('content', ''))} for i in items]


def _unwrap(url):
    url = html.unescape(url)
    if 'uddg=' in url:  # lien de redirection de DuckDuckGo
        url = urllib.parse.unquote(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['uddg'][0])
    return 'https:' + url if url.startswith('//') else url


def _duckduckgo(query, limit):
    _, page = _get('https://html.duckduckgo.com/html/', urllib.parse.urlencode({'q': query}).encode())
    results = []
    for block in re.findall(r'(?s)<div class="result.*?</div>\s*</div>', page):
        link = re.search(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if link:
            snippet = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.S)
            results.append({'title': to_text(link.group(2)), 'url': _unwrap(link.group(1)), 'snippet': to_text(snippet.group(1)) if snippet else ''})
    return results


def _duckduckgo_lite(query, limit):
    _, page = _get('https://lite.duckduckgo.com/lite/', urllib.parse.urlencode({'q': query}).encode())
    links = re.findall(r"""<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>(.*?)</a>""", page, re.S)
    snippets = re.findall(r"""class=["']result-snippet["'][^>]*>(.*?)</td>""", page, re.S)
    return [{'title': to_text(title), 'url': _unwrap(url), 'snippet': to_text(snippets[i]) if i < len(snippets) else ''}
            for i, (url, title) in enumerate(links)]


ENGINES = [('Brave', _brave, lambda: bool(settings.BRAVE_API_KEY)), ('SearXNG', _searxng, lambda: bool(settings.SEARXNG_URL)),
           ('DuckDuckGo', _duckduckgo, lambda: True), ('DuckDuckGo Lite', _duckduckgo_lite, lambda: True)]


def search(query, limit=5):
    """[{title, url, snippet}] des premiers résultats, du premier moteur qui en trouve ; aucun résultat si tous ont
    répondu sans rien trouver, une erreur (moteur par moteur) si aucun n'a répondu."""
    failures, answered = [], False
    for name, engine, on in ENGINES:
        if not on():
            continue
        try:
            found = [r for r in engine(query, limit) if r['url'].startswith(('http://', 'https://'))]
        except (WebError, ValueError, KeyError) as e:  # ValueError : réponse illisible (JSON)
            failures.append(f'{name} : {e}')
            continue
        answered = True
        if found:
            return found[:limit]
    if not answered:
        raise WebError('recherche impossible (' + ' ; '.join(failures) + ')')
    return []


def fetch(url):
    """Texte lisible d'une page publique, tronqué."""
    kind, body = _get(url)
    text = to_text(body) if 'html' in kind else body
    return text[:MAX_CHARS]
