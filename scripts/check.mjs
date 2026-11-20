// Controlli del repository (npm run check, anche in npm test, nella CI e nella release).
// Blocca se: versioni diverse o non x.y.z; CHANGELOG senza la sezione della versione; file del manifest mancanti;
// JSON non validi; links.json o version.json fuori dal formato comune (claude/standard-comuni.md, sezioni 1 e 2);
// SHA-256 di version.json diverso dallo zip nella radice, o due zip nella radice; segreti nel repository;
// HTML costruito in modi non sicuri (insertAdjacentHTML, outerHTML, document.write, href con dati non controllati).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const errors = [];
const fail = (m) => errors.push(m);
const SEMVER = /^\d+\.\d+\.\d+$/;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.git', '_site', 'dist', 'tmp'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(root, p));
  }
  return out;
}
const all = walk(root);

// --- JSON validi
const json = {};
for (const f of all.filter((x) => x.endsWith('.json'))) {
  try { json[f] = JSON.parse(read(f)); } catch (e) { fail(`${f}: JSON non valido (${e.message})`); }
}

// --- Versioni (fonte unica: manifest.json)
const manifest = json['manifest.json'] || {};
const v = manifest.version;
if (!SEMVER.test(String(v))) fail(`manifest.json: versione «${v}» non è x.y.z`);
const copies = {
  'package.json': json['package.json']?.version,
  'version.json': json['version.json']?.version,
  'src/common/version.js': (read('src/common/version.js').match(/VERSION = '([^']+)'/) || [])[1],
  'README.md': (read('README.md').match(/Versione:?\s*\**\s*(\d+\.\d+\.\d+)/) || [])[1],
};
for (const [f, x] of Object.entries(copies)) if (x !== v) fail(`${f}: versione ${x} diversa da manifest ${v}`);
if (!new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\]`, 'm').test(read('CHANGELOG.md'))) fail(`CHANGELOG.md: manca la sezione «## [${v}]»`);
const readmeZip = read('README.md').match(/BingeMap-(\d+\.\d+\.\d+)\.zip/);
if (readmeZip && readmeZip[1] !== v) fail(`README.md: cita BingeMap-${readmeZip[1]}.zip invece di BingeMap-${v}.zip`);

// --- File citati dal manifest
const files = new Set();
const add = (p) => p && files.add(p.split(/[?#]/)[0]);
Object.values(manifest.icons || {}).forEach(add);
Object.values(manifest.action?.default_icon || {}).forEach(add);
add(manifest.action?.default_popup);
add(manifest.background?.service_worker);
add(manifest.options_page);
for (const w of manifest.web_accessible_resources || []) w.resources.filter((r) => !r.includes('*')).forEach(add);
for (const f of ['src/content/site.js', 'src/content/bridge.js', 'src/content/badges.css', 'src/ui/app.html', 'src/ui/worker.js']) add(f);
for (const f of files) if (!existsSync(join(root, f))) fail(`manca il file ${f} citato dal manifest`);

// --- version.json (sezione 2)
const vj = json['version.json'] || {};
if (vj.zip !== `BingeMap-${v}.zip`) fail(`version.json: zip deve essere BingeMap-${v}.zip (lo scrive scripts/pacchetto.sh)`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(vj.date))) fail('version.json: date deve essere AAAA-MM-GG');
if (!Array.isArray(vj.notes) || !vj.notes.length || vj.notes.length > 12 || vj.notes.some((n) => typeof n !== 'string' || !n.trim() || n.length > 300)) fail('version.json: notes deve essere un elenco di 1–12 voci da massimo 300 caratteri');
if (!/^[a-f0-9]{64}$/.test(String(vj.sha256))) fail('version.json: sha256 mancante o non valido (lo scrive scripts/pacchetto.sh)');
const rootZips = readdirSync(root).filter((n) => /^BingeMap-.*\.zip$/.test(n));
if (rootZips.length !== 1) fail(`nella radice ci deve essere un solo zip BingeMap-*.zip (trovati: ${rootZips.join(', ') || 'nessuno'})`);
else if (rootZips[0] !== vj.zip) fail(`lo zip nella radice è ${rootZips[0]}, version.json dice ${vj.zip}`);
else {
  const sha = createHash('sha256').update(readFileSync(join(root, rootZips[0]))).digest('hex');
  if (sha !== vj.sha256) fail(`SHA-256 di ${rootZips[0]} (${sha.slice(0, 12)}…) diverso da version.json (${String(vj.sha256).slice(0, 12)}…): rifai npm run package`);
}

// --- links.json (sezione 1)
const lj = json['links.json'] || {};
const HOSTS = ['github.com', 'discord.gg', 'discord.com', 'ko-fi.com', 'mashaup.github.io'];
const OWN = { github: ['github.com'], discord: ['discord.gg', 'discord.com'], kofi: ['ko-fi.com'] };
if (lj.schemaVersion !== 1) fail('links.json: schemaVersion deve essere 1');
if (lj.project !== 'bingemap') fail('links.json: project deve essere «bingemap»');
if (!Number.isInteger(lj.revision) || lj.revision < 1) fail('links.json: revision deve essere un intero ≥ 1');
for (const k of ['github', 'discord', 'kofi', 'documentation', 'changelog', 'bugs', 'ideas']) if (!lj.links?.[k]) fail(`links.json: manca la voce «${k}»`);
for (const [k, l] of Object.entries(lj.links || {})) {
  if (!/^[a-z]{2,32}$/.test(k)) fail(`links.json: chiave «${k}» non valida (solo lettere minuscole)`);
  let u = null; try { u = new URL(l.url); } catch { /* sotto */ }
  if (!u || u.protocol !== 'https:') { fail(`links.json: «${k}» non è un indirizzo https`); continue; }
  if (!HOSTS.includes(u.hostname) || (OWN[k] && !OWN[k].includes(u.hostname))) fail(`links.json: «${k}» punta a un sito non consentito (${u.hostname})`);
  if (typeof l.enabled !== 'boolean' || typeof l.label !== 'string' || !l.label) fail(`links.json: «${k}» deve avere enabled (sì/no) e label`);
}
for (const t of ['bug.yml', 'idea.yml']) if (!existsSync(join(root, '.github/ISSUE_TEMPLATE', t))) fail(`manca .github/ISSUE_TEMPLATE/${t} (citato da links.json)`);

// --- Segreti (i test hanno token finti apposta per provare l'oscuramento della diagnostica)
const SECRET = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}|ya29\.[\w-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bap]-[\w-]{10,})/;
for (const f of all.filter((x) => !x.startsWith('tests/') && /\.(js|mjs|json|md|yml|yaml|html|css|sh|txt|py)$/.test(x))) {
  const m = read(f).match(SECRET);
  if (m) fail(`${f}: possibile segreto nel repository (${m[0].slice(0, 12)}…)`);
}

// --- HTML non sicuro nel codice dell'interfaccia
for (const f of all.filter((x) => /^(src|web)\/.*\.js$/.test(x))) {
  const s = read(f);
  if (/\binsertAdjacentHTML\b|\.outerHTML\s*=|document\.write\s*\(/.test(s)) fail(`${f}: insertAdjacentHTML, outerHTML o document.write non ammessi: usa innerHTML con e() o textContent`);
  // Un href con un valore inserito deve passare da e(), href() o encodeURIComponent; gli indirizzi esterni da httpUrl().
  for (const m of s.matchAll(/href="\$\{(?!e\(|href\(|encodeURIComponent\()/g)) fail(`${f}: href con un valore non controllato (posizione ${m.index})`);
  for (const m of s.matchAll(/href="\$\{e\(([a-z]+)\.(url|trailer|link)\)\}/gi)) fail(`${f}: indirizzo esterno ${m[1]}.${m[2]} senza httpUrl()`);
}

if (errors.length) { console.error('Controllo NON superato:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`Controllo superato: versione ${v}, ${files.size} file del manifest presenti, links.json e version.json conformi, nessun segreto.`);
