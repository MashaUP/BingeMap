// SIMKL: accesso diretto con OAuth PKCE (pensato per le estensioni, senza client_secret).
// Serve un client_id gratuito creato su simkl.com/settings/developer con il redirect mostrato nelle impostazioni.
import { authFlow, redirectUrl, kv } from '../platform/platform.js';
import { VERSION } from '../common/version.js';
import { fromSimkl } from './sources.js';

const API = 'https://api.simkl.com';
const APP = `app-name=bingemap&app-version=${VERSION}`;

function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export function simklRedirect() { return redirectUrl('simkl'); }

export async function connectSimkl(clientId) {
  if (!clientId) throw new Error('Inserisci il client_id SIMKL nelle impostazioni');
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const u = new URL('https://simkl.com/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', simklRedirect());
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  const back = new URL(await authFlow(u.href));
  if (back.searchParams.get('state') !== state) throw new Error('Risposta SIMKL non valida');
  const code = back.searchParams.get('code');
  if (!code) throw new Error('Accesso SIMKL annullato');
  const r = await fetch(`${API}/oauth/token?client_id=${encodeURIComponent(clientId)}&${APP}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, client_id: clientId, redirect_uri: simklRedirect(), grant_type: 'authorization_code', code_verifier: verifier }),
  });
  if (!r.ok) throw new Error(`SIMKL: scambio del codice non riuscito (${r.status})`);
  const tok = await r.json();
  if (!tok.access_token) throw new Error('SIMKL non ha restituito un token');
  await kv.set('simklToken', tok.access_token);
  return true;
}

export async function simklConnected() { return !!(await kv.get('simklToken')); }
export async function disconnectSimkl() { await kv.remove('simklToken'); }

export async function fetchSimklLibrary(clientId) {
  const token = await kv.get('simklToken');
  if (!token) throw new Error('SIMKL non collegato');
  const headers = { authorization: `Bearer ${token}`, 'simkl-api-key': clientId };
  const get = async (type) => {
    const r = await fetch(`${API}/sync/all-items/${type}/all?extended=full&client_id=${encodeURIComponent(clientId)}&${APP}`, { headers });
    if (r.status === 401) { await kv.remove('simklToken'); throw new Error('Accesso SIMKL scaduto: ricollega l\'account'); }
    if (!r.ok) throw new Error(`SIMKL HTTP ${r.status}`);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  };
  const shows = await get('shows');
  const anime = await get('anime');
  return fromSimkl({ shows: shows?.shows || [], anime: anime?.anime || [] });
}
