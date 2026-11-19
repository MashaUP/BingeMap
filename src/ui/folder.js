// Backup automatico in una cartella scelta dall'utente (idea 28), con la File System Access API.
import { get, put } from '../db/db.js';
import { exportAll, downloadName } from '../backup/backup.js';

export async function pickBackupFolder() {
  if (!window.showDirectoryPicker) throw new Error('Il browser non permette di scegliere una cartella');
  const handle = await window.showDirectoryPicker({ id: 'bingemap-backup', mode: 'readwrite' });
  await put('handles', { key: 'backupFolder', handle, name: handle.name, at: Date.now() });
  return handle.name;
}

export async function folderStatus() {
  try { const r = await get('handles', 'backupFolder'); return r ? { name: r.name } : {}; } catch { return {}; }
}

// interactive=false: scrive solo se il permesso è già concesso (dopo un import), senza chiedere nulla.
export async function writeFolderBackup(interactive = false) {
  const r = await get('handles', 'backupFolder');
  if (!r) return null;
  const h = r.handle;
  let perm = await h.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && interactive) perm = await h.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return null;
  const name = downloadName('bingemap-backup', 'json');
  const fh = await h.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(await exportAll({ includeCatalog: true })));
  await w.close();
  return name;
}
