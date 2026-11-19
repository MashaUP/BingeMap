"""Test end-to-end in Chromium reale: estensione caricata, sito simulato, import, scoperta, badge, backup.
Uso: python3 -I tests/e2e/run_e2e.py   (serve Chrome o Chromium e Playwright per Python)
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


def prepare_extension():
    tmp = Path(tempfile.mkdtemp(prefix="bm-ext-"))
    ext = tmp / "BingeMap"
    ext.mkdir()
    shutil.copy(ROOT / "manifest.json", ext)
    shutil.copytree(ROOT / "src", ext / "src")
    shutil.copytree(ROOT / "assets", ext / "assets")
    m = json.loads((ext / "manifest.json").read_text())
    # Solo per i test: il sito simulato è già autorizzato (il prompt dei permessi non è automatizzabile).
    m["host_permissions"].append("http://127.0.0.1/*")
    (ext / "manifest.json").write_text(json.dumps(m))
    return tmp, ext


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen([sys.executable, "-I", str(ROOT / "tests/e2e/site_server.py"), str(PORT)])
    time.sleep(0.8)
    tmp, ext = prepare_extension()
    profile = tmp / "profile"
    errors = []
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(profile), executable_path=CHROME or None, headless=False, accept_downloads=True,
                args=["--headless=new", f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--no-first-run", "--window-size=1440,1000"],
                viewport={"width": 1440, "height": 1000})
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
            site.goto(SITE + "/it/archive?type=tv&offset=0")
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
            jobs = app.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('bingemap'); q.onsuccess = () => r(q.result); });
                return await new Promise(r => { const q = db.transaction('scan_jobs').objectStore('scan_jobs').getAll(); q.onsuccess = () => r(q.result); }); }""")
            last = sorted(jobs, key=lambda j: j["startedAt"])[-1]
            check("scansione completa", last["status"] == "done" and last["complete"], f"{last['status']} {last.get('error')} trovate={last.get('titlesFound')}")
            check("130 serie, film esclusi", last.get("titlesFound") == 130, str(last.get("titlesFound")))
            check("strategia pagina dopo il 404 dell'elenco JSON", last.get("strategy") == "page", str(last.get("strategy")))

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
