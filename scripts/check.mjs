// Controllo prima del pacchetto: versione coerente ovunque e file del manifest esistenti.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const errors = [];

const manifest = JSON.parse(read('manifest.json'));
const v = manifest.version;
const checks = {
  'package.json': JSON.parse(read('package.json')).version,
  'version.json': JSON.parse(read('version.json')).version,
  'src/common/version.js': (read('src/common/version.js').match(/VERSION = '([^']+)'/) || [])[1],
  'CHANGELOG.md': (read('CHANGELOG.md').match(/^## \[?(\d+\.\d+\.\d+)/m) || [])[1],
  'README.md': (read('README.md').match(/Versione:?\s*\**\s*(\d+\.\d+\.\d+)/) || [])[1],
};
for (const [f, x] of Object.entries(checks)) if (x !== v) errors.push(`${f}: versione ${x} diversa da manifest ${v}`);
const vj = JSON.parse(read('version.json'));
if (vj.zip !== `BingeMap-${v}.zip`) errors.push(`version.json: zip deve essere BingeMap-${v}.zip`);

// Ogni file citato dal manifest deve esistere.
const files = new Set();
const add = (p) => p && files.add(p.split('#')[0]);
Object.values(manifest.icons || {}).forEach(add);
Object.values(manifest.action?.default_icon || {}).forEach(add);
add(manifest.action?.default_popup);
add(manifest.background?.service_worker);
add(manifest.options_page);
for (const w of manifest.web_accessible_resources || []) w.resources.forEach(add);
for (const f of ['src/content/site.js', 'src/content/badges.css', 'src/ui/app.html', 'src/ui/worker.js']) add(f);
for (const f of files) if (!existsSync(join(root, f))) errors.push(`manca il file ${f} citato dal manifest`);

if (errors.length) { console.error('Controllo NON superato:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`Controllo superato: versione ${v}, ${files.size} file del manifest presenti.`);
