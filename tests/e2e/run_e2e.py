"""Test end-to-end in Chromium reale: si carica l'estensione estratta dallo zip del pacchetto (non la cartella sorgente),
sito simulato con la struttura reale, import, scoperta, badge, nuove pagine 1.1, due schede, accessibilità, confronto visivo,
ripresa della scansione dopo la chiusura del browser.
Uso: python3 -I tests/e2e/run_e2e.py   (serve Chrome o Chromium e Playwright per Python; npm install per axe-core)
Variabili: E2E_UPDATE_BASELINE=1 rigenera le immagini di riferimento in tests/e2e/baseline/.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8765
SITE = f"http://127.0.0.1:{PORT}"
OUT = Path(os.environ.get("E2E_OUT", "/tmp/bingemap-e2e"))
CHROME = os.environ.get("CHROME", shutil.which("google-chrome") or shutil.which("chromium") or "")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("OK   " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))


BASELINE = ROOT / "tests/e2e/baseline"
AXE = ROOT / "node_modules/axe-core/axe.min.js"


def prepare_extension():
    """Test 1: si costruisce il pacchetto vero e si carica quello estratto. Un file dimenticato da pacchetto.sh fa fallire i test."""
    import zipfile
    subprocess.run(["bash", str(ROOT / "scripts/pacchetto.sh")], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    version = json.loads((ROOT / "manifest.json").read_text())["version"]
    tmp = Path(tempfile.mkdtemp(prefix="bm-ext-"))
    with zipfile.ZipFile(ROOT / f"BingeMap-{version}.zip") as z:
        names = z.namelist()
        check("pacchetto: tutto dentro la cartella BingeMap/", all(n.startswith("BingeMap/") for n in names), str(names[:3]))
        check("pacchetto: niente test né node_modules", not any(("tests/" in n or "node_modules" in n) for n in names))
        z.extractall(tmp)
    ext = tmp / "BingeMap"
    m = json.loads((ext / "manifest.json").read_text())
    # Solo per i test: il sito simulato è già autorizzato (il prompt dei permessi non è automatizzabile).
    m["host_permissions"].append("http://127.0.0.1/*")
    (ext / "manifest.json").write_text(json.dumps(m))
    return tmp, ext


def launch(p, profile, ext):
    return p.chromium.launch_persistent_context(
        str(profile), executable_path=CHROME or None, headless=False, accept_downloads=True,
        args=["--headless=new", f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--no-first-run", "--window-size=1440,1000"],
        viewport={"width": 1440, "height": 1000})


def db_jobs(page):
    return page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('bingemap'); q.onsuccess = () => r(q.result); });
        return await new Promise(r => { const q = db.transaction('scan_jobs').objectStore('scan_jobs').getAll(); q.onsuccess = () => r(q.result); }); }""")


def db_get(page, store, key):
    return page.evaluate("""async ([s, k]) => { const db = await new Promise(r => { const q = indexedDB.open('bingemap'); q.onsuccess = () => r(q.result); });
        return await new Promise(r => { const q = db.transaction(s).objectStore(s).get(k); q.onsuccess = () => r(q.result || null); }); }""", [store, key])


def visual(page, name, tolerance=0.02):
    """Test 15: confronto con un'immagine di riferimento (differenza media per pixel)."""
    from PIL import Image, ImageChops
    shot = OUT / f"vis-{name}.png"
    page.screenshot(path=str(shot))
    ref = BASELINE / f"{name}.png"
    if os.environ.get("E2E_UPDATE_BASELINE") or not ref.exists():
        BASELINE.mkdir(parents=True, exist_ok=True)
        shutil.copy(shot, ref)
        check(f"immagine di riferimento {name} creata", True)
        return
    a = Image.open(shot).convert("RGB"); b = Image.open(ref).convert("RGB")
    if a.size != b.size:
        check(f"aspetto {name} uguale al riferimento", False, f"dimensioni {a.size} ≠ {b.size}")
        return
    diff = ImageChops.difference(a, b).convert("L")
    hist = diff.histogram()
    changed = sum(hist[24:]) / (a.size[0] * a.size[1])
    if changed > tolerance:
        diff.point(lambda x: 255 if x > 24 else 0).save(OUT / f"vis-{name}-diff.png")
    check(f"aspetto {name} uguale al riferimento", changed <= tolerance, f"{changed:.1%} dei pixel diversi (vedi vis-{name}-diff.png)")


def axe(page, label):
    """Test 15: controllo automatico di accessibilità con axe-core (violazioni gravi e critiche)."""
    if not AXE.exists():
        check(f"accessibilità {label}", False, "manca node_modules/axe-core: esegui npm install")
        return
    page.evaluate(AXE.read_text())
    res = page.evaluate("""async () => { const r = await axe.run(document, { resultTypes: ['violations'] });
        return r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0]?.target?.join(' ') })); }""")
    check(f"accessibilità {label}", not res, "; ".join(f"{v['id']} ({v['impact']}, {v['n']}× es. {v['target']})" for v in res))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen([sys.executable, "-I", str(ROOT / "tests/e2e/site_server.py"), str(PORT)])
    time.sleep(0.8)
    tmp, ext = prepare_extension()
    profile = tmp / "profile"
    errors = []
    try:
        with sync_playwright() as p:
            ctx = launch(p, profile, ext)
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
            ext_id = sw.url.split("/")[2]
            check("service worker avviato", bool(ext_id))
            base = f"chrome-extension://{ext_id}/src/ui/app.html"

            def watch(pg):
                pg.on("pageerror", lambda e: errors.append(f"{pg.url}: {e}"))
                pg.on("console", lambda m: errors.append(f"{pg.url}: {m.text}") if m.type == "error" and "favicon" not in m.text and "ERR_FILE_NOT_FOUND" not in m.text else None)
                return pg

            # La scheda di benvenuto si apre da sola all'installazione.
            time.sleep(1.5)
            app = watch(ctx.new_page())
            app.goto(base + "#/benvenuto")
            app.wait_for_selector("text=Benvenuto in BingeMap", timeout=10000)
            check("benvenuto", True)

            site = watch(ctx.new_page())
            site.goto(SITE + "/it/archive?type=tv")
            check("sito simulato: data-page tolto dopo l'avvio come sul sito reale", site.evaluate("() => !document.querySelector('[data-page]') && !!document.querySelector('#app').__vue_app__"))
            send = lambda msg: app.evaluate("m => chrome.runtime.sendMessage(m)", msg)
            tab_id = app.evaluate("async (u) => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(u)).id", SITE)
            r = send({"type": "site.connect", "tabId": tab_id, "url": site.url})
            check("collegamento del sito dalla scheda", r and r.get("ok"), str(r))
            check("raccolta passiva della pagina", r and r.get("found") == 60, str(r))

            r = send({"type": "scan.start", "kind": "sc-list", "mode": "full"})
            job = None
            for _ in range(200):
                job = send({"type": "scan.active"})
                if not job:
                    break
                time.sleep(0.5)
            last = sorted(db_jobs(app), key=lambda j: j["startedAt"])[-1]
            check("scansione completa", last["status"] == "done" and last["complete"], f"{last['status']} {last.get('error')} trovate={last.get('titlesFound')}")
            check("130 serie, film esclusi", last.get("titlesFound") == 130, str(last.get("titlesFound")))
            check("strategia: elenco JSON paginato con intestazioni XHR", last.get("strategy") == "api", str(last.get("strategy")))

            r = send({"type": "scan.start", "kind": "sc-detail", "mode": "full", "opts": {"cks": ["sc:1", "sc:2", "sc:3"]}})
            for _ in range(60):
                if not send({"type": "scan.active"}):
                    break
                time.sleep(0.5)

            # Import CSV dall'interfaccia
            app.goto(base + "#/import/csv")
            app.wait_for_selector("[data-pick]")
            with app.expect_file_chooser() as fc:
                app.click("[data-pick]")
            fc.value.set_files(str(ROOT / "tests/fixtures/library.csv"))
            app.wait_for_selector("text=Collega le colonne", timeout=10000)
            app.screenshot(path=str(OUT / "01-mappatura.png"), full_page=True)
            app.click("[data-next]")
            app.wait_for_selector("text=Anteprima", timeout=10000)
            app.click("[data-commit]")
            app.wait_for_selector("text=Import completato", timeout=20000)
            txt = app.inner_text("[data-step]")
            check("report di import", "riconosciute" in txt and "da confermare" in txt, txt[:200])
            app.screenshot(path=str(OUT / "02-report.png"), full_page=True)

            # Scopri
            app.goto(base + "#/scopri")
            app.wait_for_selector(".hero", timeout=10000)
            hero = app.inner_text(".hero")
            check("Scopri: serie non completate", "serie nel catalogo che non hai completato" in hero, hero[:120])
            app.screenshot(path=str(OUT / "03-scopri.png"), full_page=True)

            # Catalogo con filtro genere e ricerca
            app.goto(base + "#/catalogo")
            app.wait_for_selector("[data-count]", timeout=10000)
            app.fill("[data-search]", "dark")
            app.wait_for_timeout(900)
            check("ricerca nel catalogo", "Dark" in app.inner_text("[data-grid]"))
            dark_card = app.locator("article.tcard", has_text="Dark").first
            check("Dark completata nel catalogo", "Completata" in dark_card.inner_text())
            app.fill("[data-search]", "")
            app.click("button[data-tab=genre]")
            app.wait_for_timeout(500)
            app.screenshot(path=str(OUT / "04-catalogo.png"), full_page=True)

            # Coda da confermare
            app.goto(base + "#/libreria/coda")
            app.wait_for_selector("text=Shogun", timeout=10000)
            app.click("[data-ok='0']")
            app.wait_for_timeout(1200)
            check("coda: conferma", "Nessuna corrispondenza da confermare" in app.inner_text("main"))

            # Mancanti
            app.goto(base + "#/mancanti")
            app.wait_for_selector("text=Serie Introvabile", timeout=10000)
            check("mancanti", True)
            app.screenshot(path=str(OUT / "05-mancanti.png"), full_page=True)

            # Scheda serie e stato personale
            app.goto(base + "#/serie/sc%3A2")
            app.wait_for_selector("h1:has-text('Silo')", timeout=10000)
            app.click("[data-a=watched]")
            app.wait_for_selector("text=Segna non vista", timeout=10000)
            check("scheda: segna come vista", True)
            app.screenshot(path=str(OUT / "06-scheda.png"), full_page=True)

            # Filtri e ricerca salvata
            app.goto(base + "#/filtri")
            app.wait_for_selector("[data-add=genre]")
            app.click("[data-add=genre]")
            app.wait_for_timeout(500)
            app.screenshot(path=str(OUT / "07-filtri.png"), full_page=True)
            check("costruttore di filtri", "Genere" in app.inner_text("[data-conds]"))

            # Badge sul sito
            site.reload()
            site.wait_for_timeout(2500)
            badges = site.locator(".bm-badge")
            check("badge sulle copertine", badges.count() >= 3, str(badges.count()))
            check("badge fuori dal menu", site.locator("header .bm-badge").count() == 0)
            dark_badge = site.locator("div.card:has(a[href='/it/titles/1-dark']) .bm-badge")
            check("badge Dark completata", dark_badge.count() and "Completata" in dark_badge.first.inner_text(), str(dark_badge.count()))
            site.screenshot(path=str(OUT / "08-sito.png"))

            # Popup
            pop = watch(ctx.new_page())
            pop.set_viewport_size({"width": 380, "height": 600})
            pop.goto(f"chrome-extension://{ext_id}/src/ui/popup.html")
            pop.wait_for_selector("text=Cerca aggiornamento", timeout=10000)
            check("popup", True)
            pop.screenshot(path=str(OUT / "09-popup.png"))

            # Backup
            app.goto(base + "#/attivita")
            app.wait_for_selector("[data-backup='1']", timeout=10000)
            with app.expect_download() as dl:
                app.click("[data-backup='1']")
            path = dl.value.path()
            data = json.loads(Path(path).read_text())
            check("backup scaricato", data.get("app") == "BingeMap" and len(data["stores"]["library_items"]) == 5, str(len(data['stores'].get('library_items', []))))
            app.screenshot(path=str(OUT / "10-attivita.png"), full_page=True)

            for route in ["ricerche", "statistiche", "impostazioni/catalogo", "impostazioni/servizi", "impostazioni/info", "libreria/tag", "libreria/storico", "coppia", "preset/p-weekend"]:
                app.goto(base + "#/" + route)
                app.wait_for_timeout(900)
                body = app.inner_text("main")
                check(f"pagina {route}", "Qualcosa non ha funzionato" not in body and len(body) > 40, body[:120])
            app.goto(base + "#/statistiche"); app.wait_for_timeout(800)
            app.screenshot(path=str(OUT / "11-statistiche.png"), full_page=True)

            # ---------- 1.1.0: nuove funzioni
            # Dettagli letti dalla scheda reale: episodi per stagione, servizi legali.
            app.goto(base + "#/serie/sc%3A1")
            app.wait_for_selector("h1:has-text('Dark')", timeout=10000)
            check("scheda: dove guardarla legalmente (dal sito: Netflix)", "Netflix" in app.inner_text("[data-legal]"))
            check("scheda: parole chiave dalla scheda del sito", "time travel" in app.inner_text("main"))
            app.goto(base + "#/serie/sc%3A3")
            app.wait_for_selector("h1:has-text('Arcane')", timeout=10000)
            app.click("[data-a=ep-next]")
            app.wait_for_selector("text=di 16 episodi", timeout=10000)
            check("progresso per episodio: S1E1 di 16", "S1E1" in app.inner_text("[data-progress]"))
            app.click("[data-a=ep-next]")
            app.wait_for_selector("[data-progress] >> text=S1E2", timeout=10000)
            app.keyboard.press("Control+z")
            app.wait_for_selector("[data-progress] >> text=S1E1", timeout=10000)
            check("annulla globale con Ctrl+Z", True)
            app.screenshot(path=str(OUT / "13-progresso.png"), full_page=True)

            # Import Netflix e lista incollata
            app.goto(base + "#/import/netflix")
            app.wait_for_selector("[data-pick]")
            with app.expect_file_chooser() as fc:
                app.click("[data-pick]")
            fc.value.set_files(str(ROOT / "tests/fixtures/netflix.csv"))
            app.wait_for_selector("[data-commit]", timeout=10000)
            app.click("[data-commit]")
            app.wait_for_selector("text=Import completato", timeout=20000)
            check("import Netflix", "Squid Game" in app.inner_text("main") or "riconosciute" in app.inner_text("main"))
            app.goto(base + "#/import/paste")
            app.wait_for_selector("[data-text]")
            app.fill("[data-text]", "Le serie del mese secondo noi, scelte con grande cura dalla redazione.\n1. Dark (2017)\n2) Severance – thriller aziendale da brividi\n#3 The Expanse su Prime Video\n4. Una serie che non esiste")
            app.click("[data-go]")
            app.wait_for_selector("[data-res] table", timeout=10000)
            res = app.inner_text("[data-res]")
            check("incolla una lista: 4 titoli, Dark già vista", "4 titoli" in res and "1 già visti" in res, res[:160])
            app.click("[data-add]")
            app.wait_for_selector("[data-commit]", timeout=10000)
            app.click("[data-commit]")
            app.wait_for_selector("text=Import completato", timeout=20000)
            app.goto(base + "#/serie/sc%3A6")
            app.wait_for_selector("h1:has-text('Severance')", timeout=10000)
            check("lista incollata: Severance da vedere", "Da vedere" in app.inner_text("main .st"), app.inner_text("main .st"))

            # Mappa
            app.goto(base + "#/mappa")
            app.wait_for_selector("canvas", timeout=20000)
            app.wait_for_selector("[data-side] >> text=Zone da esplorare", timeout=20000)
            painted = app.evaluate("() => { const c = document.querySelector('.mapwrap canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }")
            check("mappa disegnata", painted > 1000, str(painted))
            app.locator("[data-side] [data-z]").first.click()
            app.wait_for_timeout(600)
            app.screenshot(path=str(OUT / "14-mappa.png"))

            # Scorri: freccia a destra = da vedere, Ctrl+Z annulla
            app.goto(base + "#/scorri")
            app.wait_for_selector("[data-card]", timeout=10000)
            name = app.inner_text("[data-card] .info b")
            app.keyboard.press("ArrowRight")
            app.wait_for_timeout(700)
            check("Scorri: → aggiunge a Da vedere", "Da vedere 1" in app.inner_text("[data-count]"), app.inner_text("[data-count]"))
            app.keyboard.press("Control+z")
            app.wait_for_timeout(700)
            check("Scorri: Ctrl+Z riporta la carta con lo stato di prima", name in app.inner_text("[data-card]") and "Da vedere" not in app.inner_text("[data-card] .st"), app.inner_text("[data-card]")[:80])
            app.screenshot(path=str(OUT / "15-scorri.png"))

            for route, needle in [("calendario", "In arrivo"), ("stasera?min=40", "minuti"), ("maratona", "Pianifica la maratona"), ("wrapped", "in serie")]:
                app.goto(base + "#/" + route)
                app.wait_for_timeout(1000)
                body = app.inner_text("main")
                check(f"pagina {route}", needle in body and "Qualcosa non ha funzionato" not in body, body[:120])
            app.goto(base + "#/wrapped")
            app.wait_for_selector("[data-dl]", timeout=10000)
            with app.expect_download() as dl:
                app.click("[data-dl]")
            check("Wrapped: immagine PNG", Path(dl.value.path()).read_bytes()[:4] == b"\x89PNG")
            app.screenshot(path=str(OUT / "16-wrapped.png"), full_page=True)

            # ---------- 1.2.0
            # Metadati TMDB simulati (il sito simulato non ha TMDB): paese, stato, stagioni uscite.
            app.evaluate("""async () => {
              const db = await new Promise(r => { const q = indexedDB.open('bingemap'); q.onsuccess = () => r(q.result); });
              const y = new Date().getFullYear();
              const rows = [
                { tmdbId: 70523, countries: ['DE'], status: 'Ended', seasons: 3, voteCount: 7000, voteAverage: 8.4, creators: ['Baran bo Odar'], seasonEpisodes: [1,2,3].map(n => ({ n, episodes: 8, date: `${y - 7 + n}-01-01` })), statusHistory: [], updatedAt: Date.now() },
                { tmdbId: 125988, countries: ['US'], status: 'Returning Series', seasons: 3, voteCount: 2000, seasonEpisodes: [1,2,3].map(n => ({ n, episodes: 10, date: `${y - 4 + n}-01-01` })), statusHistory: [], updatedAt: Date.now() },
                { tmdbId: 94605, countries: ['US', 'FR'], status: 'Canceled', seasons: 2, voteCount: 4000, seasonEpisodes: [], statusHistory: [], updatedAt: Date.now() },
              ];
              await new Promise(r => { const tx = db.transaction('tmdb_cache', 'readwrite'); rows.forEach(x => tx.objectStore('tmdb_cache').put(x)); tx.oncomplete = r; });
            }""")
            app.goto(base + "#/scopri"); app.reload(); app.wait_for_selector(".hero", timeout=10000)
            app.goto(base + "#/serie/sc%3A3"); app.wait_for_selector("h1:has-text('Arcane')", timeout=10000)
            check("Arcane: avviso «cancellata senza finale»", "Cancellata senza finale" in app.inner_text("main"))
            app.goto(base + "#/serie/sc%3A2"); app.wait_for_selector("h1:has-text('Silo')", timeout=10000)
            check("Silo: stagioni mancanti nel catalogo (2 su 3)", "ne sono uscite" in app.inner_text("main"), app.inner_text("main")[:300])
            # Persone seguite: tocco il nome di un autore.
            app.goto(base + "#/serie/sc%3A1"); app.wait_for_selector("h1:has-text('Dark')", timeout=10000)
            app.click("[data-follow='Baran bo Odar']")
            app.wait_for_selector("[data-follow='Baran bo Odar'][aria-pressed='true']", timeout=10000)
            app.goto(base + "#/persone"); app.wait_for_timeout(1000)
            check("persone seguite", "Baran bo Odar" in app.inner_text("main"))
            # Giro del mondo
            app.goto(base + "#/mondo"); app.wait_for_selector("svg path", timeout=10000)
            visited = app.inner_text("main aside")
            check("giro del mondo: paesi visitati", "paesi visitati" in visited.lower() and app.locator("svg a").count() >= 3, f"{app.locator('svg a').count()} paesi con serie")
            app.screenshot(path=str(OUT / "18-mondo.png"))
            for route, needle in [("esplora", "Esplora"), ("universi", "Universi"), ("classici", "classici"), ("cronologia", "linea del tempo"), ("anime", "AniList"),
                                  ("preset/p-almost", "Quasi finite"), ("preset/p-pilot", "pilota"), ("preset/p-open", "Arcane"), ("preset/p-missing-seasons", "Silo")]:
                app.goto(base + "#/" + route)
                app.wait_for_timeout(1100)
                body = app.inner_text("main")
                check(f"pagina {route}", needle.lower() in body.lower() and "Qualcosa non ha funzionato" not in body, body[:120])
            app.goto(base + "#/classici"); app.wait_for_timeout(900)
            app.screenshot(path=str(OUT / "19-classici.png"), full_page=True)
            # Import MyAnimeList
            app.goto(base + "#/import/mal")
            app.wait_for_selector("[data-pick]")
            with app.expect_file_chooser() as fc:
                app.click("[data-pick]")
            fc.value.set_files(str(ROOT / "tests/fixtures/mal.xml"))
            app.wait_for_selector("[data-commit]", timeout=10000)
            app.click("[data-commit]")
            app.wait_for_selector("text=Import completato", timeout=20000)
            check("import MyAnimeList", True)
            # Esporta verso altre app
            app.goto(base + "#/attivita"); app.wait_for_selector("[data-exports]", timeout=10000)
            got = {}
            for k in ["imdb-ratings", "full", "mal"]:
                with app.expect_download() as dl:
                    app.click(f"[data-exp='{k}']")
                got[k] = Path(dl.value.path()).read_text()
            check("esporta: CSV IMDb con Dark", "tt5753856" in got["imdb-ratings"] and got["imdb-ratings"].startswith("Const,"), got["imdb-ratings"][:200])
            check("esporta: CSV completo", got["full"].lstrip("\ufeff").startswith("title,") and "Dark" in got["full"])
            check("esporta: XML MyAnimeList", "<series_animedb_id>37521</series_animedb_id>" in got["mal"] and "<my_status>Completed</my_status>" in got["mal"], got["mal"][:200])
            # Alto contrasto e testo più grande
            app.goto(base + "#/impostazioni/aspetto"); app.wait_for_selector("[name=contrast]")
            app.check("[name=contrast]"); app.select_option("[name=textScale]", "115")
            app.click("[data-form] button.p")
            app.wait_for_timeout(800)
            look = app.evaluate("() => [document.documentElement.dataset.contrast, document.documentElement.style.zoom]")
            check("alto contrasto e testo al 115%", look == ["high", "1.15"], str(look))
            app.goto(base + "#/serie/sc%3A1"); app.wait_for_selector("h1:has-text('Dark')"); app.wait_for_timeout(900)
            axe(app, "serie in alto contrasto")
            app.screenshot(path=str(OUT / "20-contrasto.png"))
            app.evaluate("() => import('/src/common/settings.js').then(m => m.saveSettings({ contrast: 'normal', textScale: 100 }))")
            app.reload(); app.wait_for_timeout(800)

            # Test 14: due schede della dashboard aperte insieme
            other = watch(ctx.new_page())
            other.goto(base + "#/serie/sc%3A7")
            other.wait_for_selector("h1:has-text('The Expanse')", timeout=10000)
            app.goto(base + "#/serie/sc%3A7")
            app.wait_for_selector("h1:has-text('The Expanse')", timeout=10000)
            app.click("[data-a=watched]")
            try:
                other.wait_for_selector("text=Segna non vista", timeout=8000)
                ok2 = True
            except Exception:
                ok2 = False
            check("due schede: la modifica in una appare nell'altra", ok2)
            other.close()

            # Test 15: tastiera, accessibilità, aspetto
            app.goto(base + "#/catalogo")
            app.wait_for_selector("article.tcard", timeout=10000)
            app.evaluate("() => document.activeElement && document.activeElement.blur()")
            reached = False
            for _ in range(80):
                app.keyboard.press("Tab")
                if app.evaluate("() => !!document.activeElement?.closest('article.tcard')"):
                    reached = True
                    break
            app.keyboard.press("Enter")
            app.wait_for_timeout(800)
            check("solo tastiera: Tab fino a una serie e Invio apre la scheda", reached and "#/serie/" in app.url, app.url)
            for route in ["scopri", "catalogo", "serie/sc%3A1", "mappa", "calendario", "impostazioni/aspetto", "esplora", "mondo", "universi", "classici", "cronologia", "persone"]:
                app.goto(base + "#/" + route)
                app.wait_for_timeout(1200)
                axe(app, route)
            app.add_style_tag(content="*{transition:none!important;animation:none!important}")
            for theme in ["dark", "light"]:
                app.evaluate("(t) => import('/src/common/settings.js').then(m => m.saveSettings({ theme: t }))", theme)
                app.goto(base + "#/serie/sc%3A1"); app.reload(); app.wait_for_selector("h1:has-text('Dark')"); app.wait_for_timeout(900)
                visual(app, f"serie-{theme}")
            mob = watch(ctx.new_page())
            mob.set_viewport_size({"width": 390, "height": 844})
            mob.goto(base + "#/serie/sc%3A1"); mob.wait_for_selector("h1:has-text('Dark')"); mob.wait_for_timeout(900)
            visual(mob, "serie-mobile")
            overflow = mob.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            check("telefono 390 px: niente scorrimento orizzontale", overflow <= 1, f"{overflow}px")
            mob.close()
            app.evaluate("() => import('/src/common/settings.js').then(m => m.saveSettings({ theme: 'dark' }))")

            # Interfaccia in inglese
            app.evaluate("() => import('/src/common/settings.js').then(m => m.saveSettings({ lang: 'en' }))")
            app.goto(base + "#/scopri"); app.reload(); app.wait_for_selector(".hero", timeout=10000)
            nav = app.inner_text("#side")
            check("interfaccia in inglese", "Discover" in nav and "My library" in nav and "Check for updates" in nav, nav[:160])
            app.screenshot(path=str(OUT / "17-english.png"))
            app.evaluate("() => import('/src/common/settings.js').then(m => m.saveSettings({ lang: 'it' }))")

            # App web (stesso codice, senza estensione)
            web_srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", "8766", "--bind", "127.0.0.1", "--directory", str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(0.8)
            try:
                web = watch(ctx.new_page())
                web.goto("http://127.0.0.1:8766/web/index.html#/scopri")
                web.wait_for_selector("text=Il catalogo è vuoto", timeout=15000)
                check("app web: avvio", True)
                web.goto("http://127.0.0.1:8766/web/index.html#/import/manual")
                web.wait_for_selector("[data-text]")
                web.fill("[data-text]", "Dark (2017)\nSilo")
                web.click("[data-go]")
                web.wait_for_selector("[data-commit]", timeout=10000)
                web.click("[data-commit]")
                web.wait_for_selector("text=Import completato", timeout=10000)
                check("app web: import manuale", True)
                web.screenshot(path=str(OUT / "12-web.png"), full_page=True)
            finally:
                web_srv.terminate()

            # Test 4: scansione interrotta chiudendo il browser e ripresa alla riapertura.
            app.evaluate("() => import('/src/common/settings.js').then(m => m.saveSettings({ sc: { delayMs: 2500 } }))")
            send({"type": "scan.start", "kind": "sc-list", "mode": "full"})
            for _ in range(40):
                j = send({"type": "scan.active"})
                if j and (j.get("titlesFound") or 0) >= 60:
                    break
                time.sleep(0.25)
            started = j.get("id") if j else None
            check("scansione avviata prima della chiusura", bool(started) and j.get("status") == "running", str(j))
            ctx.close()
            ctx = launch(p, profile, ext)
            sw2 = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
            pg = ctx.new_page()
            pg.goto(base + "#/attivita")
            pg.wait_for_timeout(1000)
            # La ripresa parte all'avvio del browser; se Chrome non lancia onStartup ci pensa l'allarme «resume».
            pg.evaluate("() => chrome.runtime.sendMessage({ type: 'scan.resume', id: null }).catch(() => null)")
            job2 = None
            for _ in range(120):
                jobs = {x["id"]: x for x in db_jobs(pg)}
                job2 = jobs.get(started)
                if job2 and job2["status"] not in ("running", "interrupted", "paused"):
                    break
                time.sleep(0.5)
            check("ripresa dopo la chiusura del browser: scansione completa", job2 and job2["status"] == "done" and job2["complete"] and job2.get("titlesFound") == 130,
                  f"{job2 and job2['status']} trovate={job2 and job2.get('titlesFound')}")
            ctx.close()
    finally:
        server.terminate()
        shutil.rmtree(tmp, ignore_errors=True)
    real_errors = [e for e in errors if "Failed to load resource" not in e]
    check("nessun errore JavaScript nelle pagine", not real_errors, " | ".join(real_errors[:5]))
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} controlli superati")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
