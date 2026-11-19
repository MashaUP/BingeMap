// Lettore CSV (RFC 4180) con rilevamento del separatore e del BOM.

// Da byte a testo: UTF-8 (con o senza BOM), UTF-16 LE/BE con BOM (Excel «Testo Unicode»), altrimenti Windows-1252
// (Excel italiano «CSV (delimitato dal separatore di elenco)»).
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // UTF-16 senza BOM: molti zeri nelle posizioni dispari o pari.
  if (b.length >= 4) {
    let odd = 0; let even = 0; const n = Math.min(b.length, 400);
    for (let i = 0; i < n; i++) if (b[i] === 0) { if (i % 2) odd++; else even++; }
    if (odd > n / 4) return new TextDecoder('utf-16le').decode(b);
    if (even > n / 4) return new TextDecoder('utf-16be').decode(b);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
}

export async function decodeFile(f) {
  if (typeof f.arrayBuffer === 'function') return decodeBytes(new Uint8Array(await f.arrayBuffer()));
  if (typeof f.bytes === 'function') return decodeBytes(await f.bytes());
  return f.text();
}

export function detectDelimiter(text) {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const cands = [',', ';', '\t', '|'];
  let best = ','; let bestN = -1;
  for (const d of cands) {
    let n = 0; let inQ = false;
    for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch === d) n++; }
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

export function parseCsv(text, delimiter = null) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  // Righe di commento in stile modello Refract ("#").
  const clean = rows.filter((r) => !(r.length && String(r[0]).trim().startsWith('#')));
  if (!clean.length) return { headers: [], records: [] };
  const headers = clean[0].map((h) => h.trim());
  const records = clean.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records, delimiter: d };
}

export function toCsv(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}
