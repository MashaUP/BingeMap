"""Sito simulato del catalogo per i test end-to-end, con la struttura verificata sul sito reale (docs/SITE_NOTES.md):
HTML con data-page che Vue toglie dopo l'avvio, elenco JSON paginato in stile Laravel con intestazioni XHR, schede con slider «related».
Come il sito reale (20/11/2026): al massimo PAGE_LIMIT pagine per elenco (oltre: 503 «Page limit reached (N)»), filtro year
(anni singoli dal 2000, decenni prima, valori fuori elenco → 422), schede come dati Inertia (X-Inertia, versione, dati parziali; 409 se la versione è vecchia).
Il limite qui è 2 pagine (sul sito reale 20) perché il catalogo simulato è piccolo: così si prova davvero la lettura a fette."""
import html
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

KNOWN = [
    (1, "Dark", 2017, 70523, "tt5753856", ["Fantascienza", "Thriller"], 3),
    (2, "Silo", 2023, 125988, None, ["Fantascienza", "Drama"], 2),
    (3, "Arcane", 2021, 94605, None, ["Animazione", "Azione"], 2),
    (4, "Shōgun", 2024, None, None, ["Drama", "Storico"], 1),
    (5, "Shōgun", 1980, None, None, ["Drama"], 1),
    (6, "Severance", 2022, None, None, ["Thriller", "Fantascienza"], 2),
    (7, "The Expanse", 2015, None, None, ["Fantascienza"], 6),
]
GENRES = ["Commedia", "Drama", "Crime", "Fantasy", "Mystery", "Animazione"]
TITLES = []
for (i, name, year, tmdb, imdb, genres, seasons) in KNOWN:
    TITLES.append({"id": i, "slug": re.sub(r"\W+", "-", name.lower()).strip("-"), "name": name, "type": "tv", "score": "8.5",
                   "sub_ita": 1 if i == 6 else 0, "seasons_count": seasons, "last_air_date": f"{year}-06-01", "release_date": f"{year}-01-01",
                   "_detail": {"tmdb_id": tmdb, "imdb_id": imdb, "genres": [{"name": g} for g in genres], "plot": f"Trama di {name}.",
                               "seasons": [{"number": s + 1, "episodes_count": 8} for s in range(seasons)], "keywords": [{"name": "time travel"}, {"name": "dystopia"}] if i in (1, 2, 6) else [{"name": "family"}],
                               "main_actors": [{"name": f"Attore {i}"}], "netflix_id": 80100172 if i == 1 else None, "dub_ita": 1},
                   "images": [{"type": "poster", "url": f"/img/{i}.svg"}]})
for n in range(8, 131):
    TITLES.append({"id": n, "slug": f"serie-{n}", "name": f"Serie di prova {n}", "type": "tv", "score": str(5 + (n % 5)), "sub_ita": 0,
                   "seasons_count": 1 + n % 4, "last_air_date": f"{2000 + n % 25}-01-01", "release_date": f"{2000 + n % 25}-01-01",
                   "_detail": {"genres": [{"name": GENRES[n % len(GENRES)]}], "plot": "Trama."}, "images": []})
PAGE_LIMIT = 2
VERSION = "x"
REQUESTS = []
TITLES.append({"id": 999, "slug": "un-film", "name": "Un film", "type": "movie", "score": "7", "_detail": {}, "images": []})


def public(t, detail=False):
    d = {k: v for k, v in t.items() if not k.startswith("_")}
    if detail:
        d.update(t["_detail"])
    return d


# Come sul sito reale: dopo l'avvio l'app sposta i dati in __vue_app__ e toglie l'attributo data-page.
MOUNT = "<script>(function(){var a=document.getElementById('app');var d=JSON.parse(a.getAttribute('data-page'));a.__vue_app__={config:{globalProperties:{$page:d}}};a.removeAttribute('data-page');})();</script>"


def year_of(t):
    return int(str(t.get("release_date") or t.get("last_air_date") or "0")[:4] or 0)


def year_ok(y):
    return (2000 <= y <= 2026) or (1910 <= y < 2000 and y % 10 == 0)


def page(component, props, cards=""):
    data = html.escape(json.dumps({"component": component, "props": props, "url": "/", "version": VERSION}), quote=True)
    return f'<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Catalogo</title></head><body><header><a href="/it/titles/1-dark">Menu Dark</a></header><div id="app" data-page="{data}"><main>{cards}</main></div>{MOUNT}</body></html>'


def cards(ts):
    return "".join(f'<div class="card" style="width:160px;height:240px;display:inline-block;margin:6px"><a href="/it/titles/{t["id"]}-{t["slug"]}"><img src="/img/{t["id"]}.svg" width="160" height="220" alt=""></a><span>{html.escape(t["name"])}</span></div>' for t in ts)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="text/html; charset=utf-8"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        REQUESTS.append(self.path)
        if u.path == "/__requests":
            return self.send(200, json.dumps(REQUESTS), "application/json")
        if u.path.startswith("/api/"):
            return self.send(404, "not found", "text/plain")
        if u.path in ("/it/archive", "/it/archivio"):
            pool = [t for t in TITLES if q.get("type", [""])[0] in ("", t["type"])]
            if self.headers.get("X-Requested-With") == "XMLHttpRequest":
                n = max(1, int(q.get("page", ["1"])[0]))
                if "year" in q:
                    y = int(q["year"][0] or 0)
                    if not year_ok(y):
                        return self.send(422, json.dumps({"message": "The selected year is invalid."}), "application/json")
                    pool = [t for t in pool if (year_of(t) == y if y >= 2000 else y <= year_of(t) < y + 10)]
                if n > PAGE_LIMIT:
                    return self.send(503, json.dumps(f"Page limit reached ({PAGE_LIMIT})"), "application/json")
                chunk = pool[(n - 1) * 60:n * 60]
                last = (len(pool) + 59) // 60
                body = {"current_page": n, "data": [public(t) for t in chunk], "last_page": last, "per_page": 60,
                        "from": (n - 1) * 60 + 1 if chunk else None, "to": (n - 1) * 60 + len(chunk) if chunk else None, "total": len(pool)}
                return self.send(200, json.dumps(body), "application/json")
            chunk = pool[:60]  # l'HTML mostra sempre la prima pagina (offset e page ignorati)
            return self.send(200, page("Titles/Browse", {"titles": [public(t) for t in chunk], "totalCount": len(pool), "browseMoreApiRoute": "/it/archive"}, cards(chunk)))
        m = re.match(r"^/it/titles/(\d+)", u.path)
        if m:
            t = next((x for x in TITLES if x["id"] == int(m.group(1))), None)
            if not t:
                return self.send(404, "no")
            related = [public(x) for x in TITLES if x["id"] in (2, 6, 7) and x["id"] != t["id"]]
            props = {"title": public(t, True), "sliders": [{"name": "related", "titles": related}, {"name": "genre", "titles": []}]}
            if self.headers.get("X-Inertia") == "true":
                if self.headers.get("X-Inertia-Version") != VERSION:
                    self.send_response(409)
                    self.send_header("x-inertia-location", self.path)
                    self.send_header("content-length", "0")
                    self.end_headers()
                    return
                want = [x for x in (self.headers.get("X-Inertia-Partial-Data") or "").split(",") if x]
                if want:
                    props = {k: v for k, v in props.items() if k in want}
                return self.send(200, json.dumps({"component": "Titles/Title", "props": props, "url": self.path, "version": VERSION}), "application/json")
            return self.send(200, page("Titles/Title", props))
        m = re.match(r"^/img/(\d+)\.svg$", u.path)
        if m:
            return self.send(200, f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#2B2A55"/><text x="10" y="120" fill="#fff">{m.group(1)}</text></svg>', "image/svg+xml")
        if u.path == "/":
            return self.send(200, page("Home", {"sliders": [{"titles": [public(t) for t in TITLES[:10]]}]}, cards(TITLES[:10])))
        self.send(404, "no")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
