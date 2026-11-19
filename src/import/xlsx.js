// Lettura del primo foglio di un file Excel (.xlsx) senza dipendenze: ZIP + XML.
import { readZip } from './zip.js';

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function parseXlsx(buffer) {
  const files = await readZip(buffer);
  const byName = new Map(files.map((f) => [f.name, f]));
  const shared = [];
  if (byName.has('xl/sharedStrings.xml')) {
    const xml = await byName.get('xl/sharedStrings.xml').text();
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]));
      shared.push(parts.join(''));
    }
  }
  const sheetName = [...byName.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('Nessun foglio trovato nel file Excel');
  const xml = await byName.get(sheetName).text();
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      let val = '';
      if (type === 'inlineStr') val = unesc((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v != null) val = type === 's' ? shared[Number(v)] ?? '' : unesc(v);
      }
      const idx = ref ? colIndex(ref) : row.length;
      row[idx] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const records = rows.slice(1).filter((r) => r.some((x) => String(x).trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
  return { headers, records };
}
