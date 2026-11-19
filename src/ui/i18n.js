// Interfaccia in inglese (funzione 15). L'app è scritta in italiano: in inglese si traducono i testi
// visibili (nodi di testo e attributi placeholder, aria-label, title) con un dizionario e alcune frasi con numeri.
// Le pagine aggiunte dopo (finestre, notifiche, liste che si ricaricano) si traducono da sole con un osservatore.

let lang = 'it';
export function getLang() { return lang; }

const EN = {
  // Menu e guscio
  'Scopri': 'Discover', 'Catalogo': 'Catalog', 'Mappa': 'Map', 'In arrivo': 'Coming up', 'La mia libreria': 'My library', 'Mancanti': 'Missing',
  'Ricerche salvate': 'Saved searches', 'Statistiche': 'Statistics', 'Attività': 'Activity', 'Impostazioni': 'Settings', 'Comandi': 'Commands',
  'Cerca aggiornamento': 'Check for updates', 'Menu principale': 'Main menu', 'Cerca una serie o un comando': 'Search a series or a command',
  'Nessun risultato': 'No results', 'comando': 'command', 'serie': 'series', 'Annulla': 'Cancel', 'Annullato': 'Undone', 'Niente da annullare': 'Nothing to undo',
  'Chiudi': 'Close', 'OK': 'OK', 'Salva': 'Save', 'Conferma': 'Confirm', 'Continua': 'Continue', 'Elimina': 'Delete', 'Modifica': 'Edit', 'Rimuovi': 'Remove',
  'Applica': 'Apply', 'Azzera': 'Reset', 'Apri': 'Open', 'Più tardi': 'Later', 'Sì': 'Yes', 'No': 'No', 'Fatto': 'Done', 'Prova': 'Test', 'Usa': 'Use',
  'Qualcosa non ha funzionato.': 'Something went wrong.', 'BingeMap non si è avviato.': 'BingeMap did not start.', 'Sei aggiornato': 'You are up to date',
  'Controllo in corso…': 'Checking…', 'Calcolo…': 'Calculating…', 'Indietro': 'Back', '← Indietro': '← Back', 'Togli': 'Remove', 'Ripristina': 'Restore',
  // Stati
  'Completata': 'Completed', 'In corso': 'Watching', 'In pausa': 'On hold', 'Abbandonata': 'Dropped', 'Da vedere': 'Plan to watch', 'Non nelle liste': 'Not in lists',
  'Incerto': 'Uncertain', 'Incerta': 'Uncertain', 'Completate': 'Completed', 'Abbandonate': 'Dropped', 'Incerte': 'Uncertain',
  // Scopri
  'Ciao': 'Hi', 'Cosa iniziamo stasera?': 'What shall we start tonight?', 'Disponibili e non completate': 'Available and not completed',
  'Sorprendimi': 'Surprise me', 'Esplora il catalogo': 'Explore the catalog', 'Consigliate per te': 'Recommended for you', 'Umore': 'Mood',
  'Le tue collezioni': 'Your collections', 'Collezioni consigliate': 'Suggested collections', 'Tutte le ricerche': 'All searches',
  'Nuove nel catalogo per i tuoi gusti': 'New in the catalog for your taste', 'Ultimi 14 giorni': 'Last 14 days', 'Rivela': 'Reveal', "Un'altra": 'Another one',
  'Regole trasparenti: generi, tag, voti, somiglianze': 'Transparent rules: genres, tags, ratings, similarity', 'La tua coda corta: aggiungi con il segnalibro': 'Your short queue: add with the bookmark',
  'Il titolo resta nascosto finché non decidi di scoprirlo.': 'The title stays hidden until you decide to reveal it.', 'Apri la scheda': 'Open details',
  'Serata in due': 'Night for two', 'Concluse': 'Ended', 'Weekend (≤ 10 ore)': 'Weekend (≤ 10 hours)', 'Stasera ho 2 ore': 'I have 2 hours tonight', 'Nuove': 'New',
  'Complete nel catalogo': 'Complete in the catalog', 'Leggera': 'Light', 'Da pensare': 'Thought-provoking', 'Adrenalina': 'Adrenaline', 'Cupa': 'Dark', 'Epica': 'Epic',
  'Il catalogo è vuoto': 'The catalog is empty', 'Inizia': 'Start', 'Importa liste': 'Import lists', 'Benvenuto': 'Welcome', 'Benvenuto in BingeMap': 'Welcome to BingeMap',
  'Ho': 'I have', 'minuti': 'minutes', 'Altre idee': 'More ideas', 'Ti consiglio': 'My pick', 'Altro': 'Other',
  // Catalogo e filtri
  'Cerca nel catalogo': 'Search the catalog', 'Cerca per titolo, originale o alternativo': 'Search by title, original or alternative title', 'Ordina': 'Sort',
  'Filtri': 'Filters', 'Filtri attivi': 'Active filters', 'Nessun filtro attivo': 'No active filters', 'Costruttore di filtri': 'Filter builder', 'Applica testo': 'Apply text',
  'Salva come ricerca': 'Save as search', 'Aggiungi un gruppo O': 'Add an OR group', 'Risultato': 'Result', 'Tutte le serie': 'All series', 'Mostra altre': 'Show more',
  'Più adatte a te': 'Best for you', 'Voto': 'Rating', 'Voto personale': 'Personal rating', 'Aggiunte di recente': 'Recently added', 'Anno (recenti)': 'Year (newest)',
  'Anno (vecchie)': 'Year (oldest)', 'Titolo A–Z': 'Title A–Z', 'Meno stagioni': 'Fewest seasons', 'Più brevi': 'Shortest', 'Popolarità TMDB': 'TMDB popularity',
  'Stato di visione': 'Watch status', 'Tag': 'Tags', 'Tag importati': 'Imported tags', 'Tag personali': 'Personal tags', 'Liste': 'Lists', 'Le prossime 5': 'Next 5',
  'Genere': 'Genre', 'Generi': 'Genres', 'Anno': 'Year', 'Voto del sito': 'Site rating', 'Stagioni': 'Seasons', 'Aggiunta al catalogo': 'Added to catalog',
  'Fornitore': 'Provider', 'Nuova stagione': 'New season', 'Completa nel catalogo': 'Complete in catalog', 'Stato serie': 'Series status', 'Paese': 'Country',
  'Lingua originale': 'Original language', 'Episodi': 'Episodes', 'Durata episodio (min)': 'Episode length (min)', 'Ore totali': 'Total hours', 'Appena conclusa': 'Just ended',
  'Attori e creatori': 'Cast and creators', 'Parole chiave': 'Keywords', 'Progresso (%)': 'Progress (%)', 'Dove guardarla legalmente': 'Where to watch legally',
  'Disponibile legalmente': 'Legally available', 'Rinnovata, conclusa o cancellata da poco': 'Recently renewed, ended or cancelled', 'Episodio in arrivo': 'Episode coming up',
  'Confidenza match': 'Match confidence', 'Stati in conflitto': 'Conflicting statuses', 'Dati parziali': 'Partial data', 'Ferme da tempo': 'Stalled',
  'Non mi interessa': 'Not interested', 'Rimandate': 'Snoozed', 'Iniziale': 'Initial', 'Testo': 'Text', 'Personali': 'Personal', 'Sistema': 'System',
  'almeno uno': 'any', 'tutti': 'all', 'Escludi (NON)': 'Exclude (NOT)', 'Aggiungi valore': 'Add value', 'Per anno': 'By year', 'Sub-ITA': 'Italian subs',
  'Perché non la vedo?': "Why don't I see it?", 'Nessuna serie trovata con questi filtri.': 'No series found with these filters.',
  // Scheda
  'Apri sul sito': 'Open on site', 'Dove guardarla': 'Where to watch', 'Segna come vista': 'Mark as watched', 'Segna non vista': 'Mark as not watched',
  'Aggiungi alle prossime 5': 'Add to next 5', 'Togli dalle prossime 5': 'Remove from next 5', 'Rimanda 30 giorni': 'Snooze 30 days', 'Mi interessa di nuovo': 'Interested again',
  'Trailer': 'Trailer', 'Nella tua libreria': 'In your library', 'Stato in BingeMap': 'Status in BingeMap', 'Automatico (dalle liste)': 'Automatic (from lists)',
  'Note': 'Notes', 'Note personali': 'Personal notes', 'Monitora questo titolo': 'Watch this title for changes', 'Perché è questa serie': 'Why this series',
  'Cronologia nel catalogo': 'Catalog history', 'Ultima volta vista nel catalogo': 'Last seen in catalog', 'Simili': 'Similar', 'Non è questa serie': 'Not this series',
  'Nessun cambiamento registrato.': 'No changes recorded.', 'Non è in nessuna lista importata.': 'Not in any imported list.',
  'Nessuna riga delle tue liste è collegata a questa serie.': 'No row from your lists is linked to this series.', 'Episodi visti': 'Episodes watched',
  'Dove sei arrivato': 'Where you are', 'Stagione': 'Season', 'Episodio': 'Episode', 'Un episodio in più': 'One more episode', 'Mostra la trama': 'Show plot',
  "Segna l'ultimo episodio visto: BingeMap calcola quanto manca.": 'Mark the last episode you watched: BingeMap works out what is left.',
  'In abbonamento': 'Subscription', 'Gratis': 'Free', 'Noleggio': 'Rent', 'Acquisto': 'Buy', 'Nel tuo abbonamento': 'In your subscription', 'Apri su TMDB': 'Open on TMDB',
  'Nessun servizio in Italia secondo JustWatch.': 'No service in Italy according to JustWatch.', 'Il catalogo indica che esiste anche su:': 'The catalog says it is also on:',
  'Cataloghi': 'Catalogs', 'Fornitori': 'Providers', 'Creatori': 'Creators', 'Interpreti': 'Cast', 'Audio': 'Audio', 'Nel catalogo dal': 'In catalog since',
  'Doppiata': 'Dubbed', 'Sottotitolata (Sub-ITA)': 'Subtitled (Italian)', 'dagli import': 'from imports', 'serie completata': 'series completed',
  // Libreria, import, mancanti
  'Da confermare': 'To confirm', 'Conflitti': 'Conflicts', 'Storico': 'History', 'Storico import': 'Import history', 'Fonti': 'Sources', '← Fonti': '← Sources',
  'Incolla una lista': 'Paste a list', 'Lista manuale': 'Manual list', 'CSV, JSON o Excel': 'CSV, JSON or Excel', 'Scegli i file': 'Choose files', 'Scegli il file CSV': 'Choose the CSV file',
  'Collega le colonne': 'Map the columns', 'Anteprima': 'Preview', 'Righe': 'Rows', 'Cambiate': 'Changed', 'Uguali': 'Same', 'Importa': 'Import', 'Import completato': 'Import complete',
  'Conferma i dubbi': 'Confirm doubtful ones', 'Vedi le mancanti': 'See missing', 'Titolo': 'Title', 'Titolo *': 'Title *', 'Titolo originale': 'Original title', 'Tipo': 'Type',
  'Stato': 'Status', 'Data': 'Date', 'Lista': 'List', 'Nome della lista': 'List name', 'Trova i titoli': 'Find titles', 'Titolo nel testo': 'Title in text', 'Nel catalogo': 'In catalog',
  'non trovato': 'not found', '(probabile)': '(likely)', 'Nessun titolo riconosciuto nel testo.': 'No title recognised in the text.', 'Profilo': 'Profile',
  'Se lo stato manca': 'If status is missing', 'Scegli almeno la colonna del titolo.': 'Choose at least the title column.', 'Stato di tutte queste serie': 'Status of all these series',
  'Nessuna corrispondenza da confermare.': 'No matches to confirm.', 'Nessuna serie mancante con questi filtri.': 'No missing series with these filters.', 'Non nel catalogo': 'Not in catalog',
  'Le righe originali restano conservate così come sono. Reimportare lo stesso file non crea doppioni.': 'Original rows are kept as they are. Re-importing the same file creates no duplicates.',
  // Nuove pagine 1.1
  'La mappa delle serie': 'The series map', 'Tutte': 'All', 'Non viste': 'Not watched', 'Le mie': 'Mine', 'Zone da esplorare': 'Zones to explore', 'Tutte le zone': 'All zones',
  'Mostra tutta la mappa': 'Show the whole map', 'Disegno la mappa…': 'Drawing the map…', 'Le mie serie': 'My series', 'Tutto il catalogo': 'Whole catalog',
  'Esporta nel calendario (.ics)': 'Export to calendar (.ics)', 'Rinnovi, conclusioni e cancellazioni': 'Renewals, endings and cancellations', 'Oggi': 'Today', 'Domani': 'Tomorrow', 'Ieri': 'Yesterday',
  'nuova stagione': 'new season', 'Pianifica la maratona': 'Plan your marathon', 'Ore a settimana': 'Hours per week', 'Giorni in cui guardi': 'Days you watch', 'Cosa': 'What',
  'Scorri': 'Swipe', 'Salta': 'Skip', 'Già vista': 'Already watched', 'Mazzo finito. Bel lavoro!': 'Deck finished. Nice work!', 'Tutte le non completate': 'All not completed',
  "Scarica l'immagine": 'Download image', 'Serie completate': 'Series completed', 'Iniziate': 'Started', 'Ore': 'Hours', 'Giorni di fila': 'Days in a row', 'Mese più intenso': 'Busiest month',
  'Progresso': 'Progress', 'Progresso azzerato': 'Progress reset', 'Netflix': 'Netflix',
  // Impostazioni e attività
  'Aspetto': 'Appearance', 'Scuro': 'Dark', 'Chiaro': 'Light', 'Lingua': 'Language', 'Notifiche': 'Notifications', 'Servizi': 'Services', 'Profili': 'Profiles',
  'Avanzate': 'Advanced', 'Informazioni': 'About', 'Sincronizzazione': 'Sync', 'Backup': 'Backup', 'Backup e ripristino': 'Backup and restore', 'Diagnostica': 'Diagnostics',
  'Scansioni': 'Scans', 'Catalogo legale': 'Legal catalog', 'Catalogo attivo': 'Active catalog', 'Tutti i cataloghi': 'All catalogs', 'Solo Streaming Community': 'Streaming Community only',
  'Solo fornitori legali': 'Legal providers only', 'Ripristina backup': 'Restore backup', 'Esci': 'Sign out', 'Connesso a Google': 'Connected to Google', 'Disconnesso': 'Disconnected',
  'Ogni giorno': 'Daily', 'Ogni settimana': 'Weekly', 'Pesi dei consigli': 'Recommendation weights', 'Scoperta': 'Discovery', 'Novità': 'New', 'Scansione programmata': 'Scheduled scan',
  'Controlla gli aggiornamenti ogni 12 ore': 'Check for updates every 12 hours', 'Badge sulle copertine del sito': 'Badges on site covers',
  'Attenua sul sito le serie già completate': 'Dim completed series on the site', 'Notifiche e automatismi': 'Notifications and automations',
  'serie nel catalogo che non hai completato': 'series in the catalog you have not completed', 'Cosa guardo': 'What to watch',
  'Scrivi cosa cerchi: «fantasy concluse dopo il 2018 non viste»': 'Type what you want: «ended fantasy after 2018 not watched»',
  'Concluse da recuperare': 'Ended to catch up', 'Corte per il weekend': 'Short for the weekend', 'Must Watch disponibili': 'Must Watch available', 'Mai viste in nessuna lista': 'Never in any list',
  'Simili a quelle che hai amato': 'Like the ones you loved', 'Nei tuoi abbonamenti': 'In your subscriptions', 'Episodi in arrivo': 'Episodes coming up', 'Rinnovate o cancellate da poco': 'Recently renewed or cancelled',
  'La mappa': 'The map', 'Maratona': 'Marathon', 'Le zone che non hai ancora esplorato': "Zones you haven't explored yet", 'Smista in fretta le serie mai viste': 'Quickly sort series you never watched',
  'Episodi e stagioni delle tue serie': 'Episodes and seasons of your series', 'Quando finisci le prossime 5': 'When you finish your next 5', 'Nuove nel catalogo per mese': 'New in the catalog by month',
  'Il tuo anno in serie': 'Your year in series', 'Numeri che servono a scegliere, non a fare classifiche.': 'Numbers to help you choose, not to rank.',
  'Esplora': 'Explore', 'Universi e spin-off': 'Universes and spin-offs', 'I grandi classici che ti mancano': 'The great classics you are missing', 'I grandi classici': 'The great classics',
  'La tua linea del tempo': 'Your timeline', 'Persone che segui': 'People you follow', 'Il giro del mondo in serie': 'Around the world in series', 'Il giro del mondo': 'Around the world',
  'Anime della stagione': "This season's anime", 'Quasi finite': 'Almost finished', 'Prova il pilota': 'Try the pilot', 'Cancellate senza finale': 'Cancelled without an ending',
  'Stagioni mancanti': 'Missing seasons', 'Stagioni mancanti nel catalogo': 'Seasons missing from the catalog', 'Chiuse bene': 'Properly ended', 'Doppiate in italiano': 'Dubbed in Italian',
  'Con persone che segui': 'With people you follow', 'Paesi visitati': 'Countries visited', 'Mai provati': 'Never tried', 'I tuoi paesi': 'Your countries', 'Da recuperare': 'To catch up',
  'Esporta verso altre app': 'Export to other apps', 'Leggibilità': 'Readability', 'Dimensione del testo': 'Text size', 'Normale (100%)': 'Normal (100%)', 'Grande (115%)': 'Large (115%)', 'Molto grande (130%)': 'Very large (130%)',
  'Non seguire più': 'Unfollow', 'Tutti gli universi': 'All universes', 'Finita': 'Finished', 'Iniziata': 'Started', 'Non nel catalogo': 'Not in catalog', 'AniList': 'AniList', 'MyAnimeList': 'MyAnimeList',
  'Senza spoiler': 'Spoiler-free', 'I tuoi abbonamenti': 'Your subscriptions', 'Interfaccia': 'Interface', 'Italiano': 'Italian', 'Inglese': 'English',
};

// Frasi con numeri o parti variabili.
const PATTERNS = [
  [/^(\d[\d.]*) serie$/, '$1 series'], [/^(\d[\d.]*) possibili corrispondenze da confermare$/, '$1 possible matches to confirm'],
  [/^Ultima scansione completa: (.+) · (\d[\d.]*) serie$/, 'Last complete scan: $1 · $2 series'], [/^(\d[\d.]*) serie nel catalogo che non hai completato$/, '$1 series in the catalog you have not completed'],
  [/^Importa da (.+)$/, 'Import from $1'], [/^Sei a S(\d+)E(\d+)$/, 'You are at S$1E$2'], [/^Ho visto S(\d+)E(\d+)$/, 'I watched S$1E$2'],
  [/^(\d+) min$/, '$1 min'], [/^Le prossime (\d+)$/, 'Next $1'], [/^Il tuo (\d{4}) in serie$/, 'Your $1 in series'], [/^(\d+) di (\d+) episodi$/, '$1 of $2 episodes'],
  [/^Nuova versione (.+)$/, 'New version $1'], [/^Finisci tutto il (.+)$/, 'You finish everything on $1'], [/^Rimandata di 30 giorni$/, 'Snoozed for 30 days'],
  [/^Segnata come vista$/, 'Marked as watched'], [/^Segnata come non vista$/, 'Marked as not watched'], [/^Stato aggiornato$/, 'Status updated'],
  [/^Aggiunta alle prossime 5$/, 'Added to next 5'], [/^Tolta dalle prossime 5$/, 'Removed from next 5'], [/^Annullato: (.+)$/, 'Undone: $1'],
];

export function t(s) {
  if (lang !== 'en' || s == null) return s;
  const k = String(s).trim();
  if (EN[k]) return String(s).replace(k, EN[k]);
  for (const [re, rep] of PATTERNS) if (re.test(k)) return String(s).replace(k, k.replace(re, rep));
  return s;
}

const ATTRS = ['placeholder', 'aria-label', 'title'];
export function translateTree(el) {
  if (lang !== 'en' || !el) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!n.nodeValue.trim() || n.parentElement?.closest('script,style,textarea,[data-notr]')) continue;
    const tr = t(n.nodeValue);
    if (tr !== n.nodeValue) n.nodeValue = tr;
  }
  const els = el.querySelectorAll ? [el, ...el.querySelectorAll('[placeholder],[aria-label],[title]')] : [];
  for (const x of els) for (const a of ATTRS) { const v = x.getAttribute?.(a); if (v) { const tr = t(v); if (tr !== v) x.setAttribute(a, tr); } }
}

let observer = null;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'it';
  document.documentElement.lang = lang;
  if (lang === 'en' && !observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) { if (n.nodeType === 1) translateTree(n); else if (n.nodeType === 3 && n.parentElement) translateTree(n.parentElement); } });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export const DICT_SIZE = Object.keys(EN).length;
