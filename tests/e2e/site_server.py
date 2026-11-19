"""Sito simulato del catalogo per i test end-to-end (struttura come descritta in docs/SITE_NOTES.md)."""
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
                   "_detail": {"tmdb_id": tmdb, "imdb_id": imdb, "genres": [{"name": g} for g in genres], "plot": f"Trama di {name}."},
                   "images": [{"type": "poster", "url": f"/img/{i}.svg"}]})
for n in range(8, 131):
    TITLES.append({"id": n, "slug": f"serie-{n}", "name": f"Serie di prova {n}", "type": "tv", "score": str(5 + (n % 5)), "sub_ita": 0,
                   "seasons_count": 1 + n % 4, "last_air_date": f"{2000 + n % 25}-01-01", "release_date": f"{2000 + n % 25}-01-01",
                   "_detail": {"genres": [{"name": GENRES[n % len(GENRES)]}], "plot": "Trama."}, "images": []})
TITLES.append({"id": 999, "slug": "un-film", "name": "Un film", "type": "movie", "score": "7", "_detail": {}, "images": []})


def public(t, detail=False):
    d = {k: v for k, v in t.items() if not k.startswith("_")}
    if detail:
        d.update(t["_detail"])
    return d


def page(component, props, cards=""):
    data = html.escape(json.dumps({"component": component, "props": props, "url": "/", "version": "x"}), quote=True)
    return f'<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Catalogo</title></head><body><header><a href="/it/titles/1-dark">Menu Dark</a></header><div id="app" data-page="{data}"><main>{cards}</main></div></body></html>'


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
        if u.path.startswith("/api/"):
            return self.send(404, "not found", "text/plain")
        if u.path in ("/it/archive", "/it/archivio"):
            off = int(q.get("offset", ["0"])[0])
            chunk = TITLES[off:off + 60]
            return self.send(200, page("Archive", {"titles": [public(t) for t in chunk], "total": len(TITLES)}, cards(chunk)))
        m = re.match(r"^/it/titles/(\d+)", u.path)
        if m:
            t = next((x for x in TITLES if x["id"] == int(m.group(1))), None)
            if not t:
                return self.send(404, "no")
            return self.send(200, page("Titles/Title", {"title": public(t, True)}))
        m = re.match(r"^/img/(\d+)\.svg$", u.path)
        if m:
            return self.send(200, f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#2B2A55"/><text x="10" y="120" fill="#fff">{m.group(1)}</text></svg>', "image/svg+xml")
        if u.path == "/":
            return self.send(200, page("Home", {"sliders": [{"titles": [public(t) for t in TITLES[:10]]}]}, cards(TITLES[:10])))
        self.send(404, "no")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
