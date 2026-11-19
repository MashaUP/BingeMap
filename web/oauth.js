// Rimanda all'app l'indirizzo di ritorno dell'accesso (token o codice) e chiude la finestra.
if (window.opener) {
  window.opener.postMessage({ type: 'bm-oauth', url: location.href }, location.origin);
  setTimeout(() => window.close(), 300);
}
