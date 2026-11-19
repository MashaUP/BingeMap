# Note sul sito del catalogo

Streaming Community non ha un'API pubblica e cambia dominio spesso. L'adattatore (`src/catalog/sc/adapter.js`) è scritto per essere corretto da **Impostazioni › Avanzate** senza nuovo codice.

## Cosa si sa (verificato da fonti esterne, novembre 2026)

- I dati dei titoli includono `id`, `slug`, `name`, `type`, `score`, `sub_ita`, `last_air_date`, `seasons_count`, `images`; nella scheda anche `tmdb_id`, `imdb_id`, `tags`/`genres`, `plot`, `runtime`, `recommendations`, `trailers` (libreria non ufficiale `streamingcommunity-unofficialapi`).

## Cosa è un'ipotesi da verificare sul sito reale

- Le pagine passano i dati come JSON nell'attributo `data-page` (stile Inertia). L'adattatore accetta anche `__NEXT_DATA__` e risposte JSON pure.
- Elenco dell'archivio: `/{lang}/archive?type=tv&offset=N` (pagina) oppure `/api/archive?lang=it&type=tv&offset=N` (JSON). Modo «auto» prova prima il JSON.
- Schede: `/{lang}/titles/{id}-{slug}`. Immagini: `https://cdn.<dominio>/images/<filename>`.

## Come verificare (prima scansione)

1. Apri l'archivio delle serie, strumenti per sviluppatori › Elementi: cerca `data-page`.
2. Scheda Rete: scorri l'archivio e guarda quali richieste caricano nuovi titoli (percorso, parametro di pagina, quanti per pagina).
3. Riporta percorso, parametro e dimensione in Impostazioni › Avanzate; se serve, aggiorna i valori predefiniti in `src/common/settings.js` e le fixture in `tests/fixtures/site/`.

## Regole che non cambiano

Sola lettura, una richiesta alla volta, pausa minima 800 ms, stop su 403/429/CAPTCHA, nessun aggiramento di blocchi.
