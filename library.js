// Song library: remembers song folders by drive (not drive letter), keeps a saved index
// so the app opens instantly, and rescans in the background.
const { app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const { execFile } = require('child_process');

const MEDIA_EXT = new Set(['zip', 'cdg', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'mp4', 'm4v', 'webm', 'mkv', 'mov']);
const isWin = process.platform === 'win32';
const indexFile = () => path.join(app.getPath('userData'), 'library.json');

let lib = { folders: [], files: {} }; // folders: [{id, name, serial, label, rel, lastPath}]; files: {id: [relpaths]}
let loaded = false;

async function load() {
  if (loaded) return;
  try { lib = JSON.parse(await fs.readFile(indexFile(), 'utf8')); } catch {}
  lib.folders = lib.folders || []; lib.files = lib.files || {};
  loaded = true;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const tmp = indexFile() + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(lib));
      await fs.rename(tmp, indexFile());
    } catch (e) { console.error('save index', e); }
  }, 200);
}

/* ---- drive identity (Windows): "vol E:" prints the label and serial number ---- */
const volCache = new Map();
function volInfo(drive) { // drive like "E:"
  if (!isWin) return Promise.resolve(null);
  const key = drive.toUpperCase();
  if (volCache.has(key)) return volCache.get(key);
  const p = new Promise(res => {
    execFile('cmd.exe', ['/d', '/c', 'vol', key], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err || !out) return res(null);
      const serial = (out.match(/([0-9A-F]{4}-[0-9A-F]{4})/i) || [])[1] || null;
      const label = (out.match(/drive \w is (.+)/i) || [])[1] || '';
      res(serial ? { serial: serial.toUpperCase(), label: label.trim() } : null);
    });
  });
  volCache.set(key, p);
  setTimeout(() => volCache.delete(key), 10000); // drives can be swapped; don't trust this for long
  return p;
}
const driveOf = p => (isWin && /^[a-z]:/i.test(p)) ? p.slice(0, 2).toUpperCase() : null;
const exists = p => fs.stat(p).then(s => s.isDirectory(), () => false);

/** Find where a saved folder lives right now, even if its drive letter changed. */
async function resolve(f) {
  if (!isWin || !f.serial) return (await exists(f.lastPath)) ? f.lastPath : null;
  const d = driveOf(f.lastPath);
  if (d && await exists(f.lastPath)) {
    const v = await volInfo(d);
    if (v && v.serial === f.serial) return f.lastPath;
  }
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = L + ':\\';
    if (!fss.existsSync(root)) continue;
    const v = await volInfo(L + ':');
    if (v && v.serial === f.serial) {
      const p = path.join(root, f.rel);
      if (await exists(p)) { f.lastPath = p; save(); return p; }
    }
  }
  return null;
}

async function walk(dir, rel, out, progress) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$') || e.name === '__MACOSX' || e.name === 'System Volume Information') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out, progress);
    else if (e.isFile() && MEDIA_EXT.has(path.extname(e.name).slice(1).toLowerCase())) {
      out.push(r);
      if (out.length % 1000 === 0) progress(out.length);
    }
  }
}

async function folderStatus() {
  await load();
  const out = [];
  for (const f of lib.folders) {
    const p = await resolve(f);
    out.push({ id: f.id, name: f.name, label: f.label, path: p || f.lastPath, online: !!p, count: (lib.files[f.id] || []).length });
  }
  return out;
}

module.exports = {
  /** Saved index — instant, no disk scan. */
  async get() { await load(); return { folders: await folderStatus(), files: lib.files }; },

  async add(dir) {
    await load();
    dir = path.resolve(dir);
    if (lib.folders.some(f => path.resolve(f.lastPath).toLowerCase() === dir.toLowerCase())) return null;
    const d = driveOf(dir), v = d ? await volInfo(d) : null;
    const f = {
      id: Math.random().toString(36).slice(2, 10),
      name: path.basename(dir) || (v && v.label) || dir,
      serial: v ? v.serial : null, label: v ? v.label : '',
      rel: d ? dir.slice(3) : dir, lastPath: dir,
    };
    lib.folders.push(f); lib.files[f.id] = []; save();
    return f.id;
  },

  async remove(id) {
    await load();
    lib.folders = lib.folders.filter(f => f.id !== id); delete lib.files[id]; save();
  },

  /** Rescan every connected folder (or just one). Returns the number of new songs files found. */
  async scan(onlyId, progress = () => {}) {
    await load();
    let added = 0, removed = 0;
    for (const f of lib.folders) {
      if (onlyId && f.id !== onlyId) continue;
      const p = await resolve(f);
      if (!p) continue; // drive not plugged in: keep the old list
      const out = [];
      await walk(p, '', out, n => progress(f.name, n));
      // Folder removed during the scan, or drive unplugged mid-scan: don't save a partial list
      // (that would make songs "disappear" until the next scan).
      if (!lib.folders.includes(f) || !(await exists(p))) continue;
      const before = new Set(lib.files[f.id] || []), after = new Set(out);
      for (const r of after) if (!before.has(r)) added++;
      for (const r of before) if (!after.has(r)) removed++;
      lib.files[f.id] = out;
    }
    save();
    return { added, removed };
  },

  /** Full path of a song, checked to be inside its folder. */
  async fullPath(key) {
    await load();
    const i = key.indexOf('|'), id = key.slice(0, i), rel = key.slice(i + 1);
    const f = lib.folders.find(x => x.id === id);
    if (!f) throw new Error('That song folder was removed');
    const root = await resolve(f);
    if (!root) throw new Error(`The drive with "${f.name}" isn't plugged in`);
    const base = path.resolve(root), prefix = base.endsWith(path.sep) ? base : base + path.sep;
    const full = path.resolve(base, rel);
    if (!full.startsWith(prefix)) throw new Error('Outside song folder');
    return full;
  },

  status: folderStatus,
};
