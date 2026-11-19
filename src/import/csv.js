// Lettore CSV (RFC 4180) con rilevamento del separatore e del BOM.

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
