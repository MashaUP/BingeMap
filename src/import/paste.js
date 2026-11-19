// «Incolla una lista» (funzione 10): da un articolo o da un elenco incollato ai titoli delle serie.
// Toglie numerazioni, punti elenco, anni, piattaforme e descrizioni dopo un trattino o i due punti.
import { parseTitle } from '../match/normalize.js';

const NOISE = /^(?:leggi anche|read more|pubblicit|advertisement|condividi|share|iscriviti|subscribe|foto|photo|credit|fonte|source|guarda il trailer|trailer)\b/i;
const PLATFORM = /\s*[([]?\s*(?:su|on|disponibile su|available on)\s+(?:netflix|prime video|amazon prime video|disney\+|disney plus|now|sky|apple tv\+?|paramount\+|hbo max|max|raiplay|mediaset infinity|timvision)\s*[)\]]?\s*$/i;

export function extractTitles(text) {
  const out = []; const seen = new Set();
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/ /g, ' ').trim();
    if (!line || line.length > 160 || NOISE.test(line)) continue;
    // Numerazioni e punti elenco: «1.», «#1», «1)», «10 -», «•», «-», «*».
    line = line.replace(/^(?:#?\d{1,3}\s*[.)\]:–—-]?\s+|[•·*▪►◆–—-]\s+)/, '').trim();
    // Descrizione dopo un trattino lungo o dopo i due punti seguiti da testo lungo.
    const dash = line.match(/^(.{2,80}?)\s+[–—]\s+.{10,}$/); if (dash) line = dash[1];
    const colon = line.match(/^(.{2,80}?):\s+.{25,}$/); if (colon) line = colon[1];
    line = line.replace(PLATFORM, '').replace(/^["“«']+|["”»']+$/g, '').replace(/\s*\*+\s*$/, '').trim();
    if (line.length < 2 || /^\d+$/.test(line)) continue;
    // Frasi lunghe senza maiuscole iniziali: probabilmente testo dell'articolo, non un titolo.
    const words = line.split(/\s+/);
    if (words.length > 9) continue;
    if (/[.!?]$/.test(line) && words.length > 4) continue;
    const pt = parseTitle(line);
    const title = line.replace(/\s*[([]\s*(?:18|19|20|21)\d{2}\s*[)\]]\s*$/, '').trim();
    const key = `${pt.norm}|${pt.year || ''}`;
    if (!pt.norm || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, year: pt.year, norm: pt.norm });
  }
  return out;
}
