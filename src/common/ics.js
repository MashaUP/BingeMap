// Esportazione del calendario in formato iCalendar (.ics), eventi di un giorno intero.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Righe più lunghe di 75 ottetti spezzate come vuole la RFC 5545.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = []; let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ch; } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const ymd = (iso) => String(iso).slice(0, 10).replace(/-/g, '');
function nextDay(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function toIcs(items, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BingeMap//Calendario//IT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:BingeMap — In arrivo'];
  for (const it of items) {
    const se = it.s != null ? ` S${String(it.s).padStart(2, '0')}${it.e != null ? `E${String(it.e).padStart(2, '0')}` : ''}` : '';
    const summary = `${it.name}${se}${it.kind === 'premiere' ? ' (nuova stagione)' : ''}`;
    lines.push('BEGIN:VEVENT', `UID:${String(it.ck).replace(/[^\w.-]/g, '-')}-${it.s ?? 0}x${it.e ?? 0}@bingemap`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(it.date)}`, `DTEND;VALUE=DATE:${nextDay(it.date)}`, `SUMMARY:${esc(summary)}`);
    if (it.epName) lines.push(`DESCRIPTION:${esc(it.epName)}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
