// Recordings and CD projects, all as real files in Documents\Karaoke Recordings:
//   Karaoke Recordings\Song - 2026-11-25 7.42pm.mp3          (not in a project yet)
//   Karaoke Recordings\Gospel CD\01 - How Great Thou Art.mp3 (project = folder, number = CD order)
//   Karaoke Recordings\Gospel CD\Gospel CD.m3u8              (track list, kept in order for burning)
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const AUDIO = /\.(mp3|wav|webm|m4a)$/i;
const BYTES_PER_SEC = 24000; // our recordings are 192 kbps MP3
const root = () => path.join(app.getPath('documents'), 'Karaoke Recordings');

/** Clean a name typed by the user into something safe for a Windows file/folder name. */
function clean(name, fallback) {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 100);
  return s && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s : fallback;
}
function projDir(project) {
  if (!project) return root();
  // any folder inside Karaoke Recordings is a project (even one made in File Explorer)
  const p = String(project);
  if (!p.trim() || /[\\/]/.test(p) || p === '.' || p === '..') throw new Error('Bad project name');
  return path.join(root(), p);
}
function filePath(project, file) {
  const dir = projDir(project), full = path.join(dir, path.basename(String(file)));
  if (path.dirname(full) !== dir) throw new Error('Bad file name');
  return full;
}
const exists = p => fsp.stat(p).then(() => true, () => false);
const NUM = /^(\d{1,3}) - /;
const titleOf = (file, inProject) => { let t = file.replace(AUDIO, ''); if (inProject) t = t.replace(NUM, ''); return t; };

async function freeName(dir, base, ext) {
  let name = base + ext, n = 2;
  while (await exists(path.join(dir, name))) name = `${base} (${n++})${ext}`;
  return name;
}

async function list(project) {
  const dir = projDir(project);
  let names = [];
  try { names = (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && AUDIO.test(e.name)).map(e => e.name); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const st = await fsp.stat(path.join(dir, name));
      out.push({ name, title: titleOf(name, !!project), size: st.size, time: st.mtimeMs, secs: Math.round(st.size / BYTES_PER_SEC) });
    } catch {}
  }
  if (project) out.sort((a, b) => (parseInt(a.name) || 999) - (parseInt(b.name) || 999) || a.name.localeCompare(b.name));
  else out.sort((a, b) => b.time - a.time);
  return out;
}

/** Rewrite the project's track numbers to 01, 02, ... in the given order, and its .m3u8 track list. */
async function renumber(project, order) {
  const dir = projDir(project);
  const files = order || (await list(project)).map(t => t.name);
  const temp = [];
  for (const [i, f] of files.entries()) { const t = `~renumber-${i}-${Date.now()}.tmp`; await fsp.rename(path.join(dir, f), path.join(dir, t)); temp.push([t, f]); }
  const final = [];
  for (const [i, [t, f]] of temp.entries()) {
    const ext = path.extname(f), title = titleOf(f, true);
    const name = `${String(i + 1).padStart(2, '0')} - ${title}${ext}`;
    await fsp.rename(path.join(dir, t), path.join(dir, name)); final.push(name);
  }
  await fsp.writeFile(path.join(dir, project + '.m3u8'), '\ufeff#EXTM3U\r\n' + final.map(n => n).join('\r\n') + '\r\n', 'utf8');
  return final;
}

async function projects() {
  await fsp.mkdir(root(), { recursive: true });
  const out = [];
  for (const e of await fsp.readdir(root(), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const tracks = await list(e.name);
    out.push({ name: e.name, tracks: tracks.length, secs: tracks.reduce((s, t) => s + t.secs, 0) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

function stamp(d = new Date()) {
  const h = d.getHours() % 12 || 12, ap = d.getHours() < 12 ? 'am' : 'pm', p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${h}.${p(d.getMinutes())}${ap}`;
}

module.exports = {
  root, list, projects,

  /** Save a new recording, either loose (song + date) or as the next track of a project. */
  async save(title, bytes, project) {
    let dir = root();
    if (project) { dir = projDir(project); if (!(await exists(dir))) project = null, dir = root(); }
    await fsp.mkdir(dir, { recursive: true });
    const song = clean(title, 'Recording');
    let name;
    if (project) {
      const n = (await list(project)).length + 1;
      name = await freeName(dir, `${String(n).padStart(2, '0')} - ${song}`, '.mp3');
    } else name = await freeName(dir, `${song} - ${stamp()}`, '.mp3');
    await fsp.writeFile(path.join(dir, name), Buffer.from(bytes));
    if (project) await renumber(project);
    return { name, project: project || null };
  },

  async rename(project, file, newTitle) {
    const from = filePath(project, file), ext = path.extname(file);
    const title = clean(newTitle, null); if (!title) throw new Error('Please type a name');
    const prefix = project && NUM.test(file) ? file.match(NUM)[0] : '';
    const name = (prefix + title + ext) === file ? file : await freeName(path.dirname(from), prefix + title, ext);
    if (name !== file) await fsp.rename(from, path.join(path.dirname(from), name));
    if (project) await renumber(project);
    return name;
  },

  /** Move a recording into a project (as its last track) or back out (project = null). */
  async move(project, file, toProject) {
    const from = filePath(project, file), ext = path.extname(file);
    let title = titleOf(file, !!project);
    if (toProject) title = title.replace(/ - \d{4}-\d{2}-\d{2} \d{1,2}\.\d{2}[ap]m( \(\d+\))?$/, '') || title; // no date on CD tracks
    const destDir = projDir(toProject); await fsp.mkdir(destDir, { recursive: true });
    const base = toProject ? `${String((await list(toProject)).length + 1).padStart(2, '0')} - ${title}` : title;
    const name = await freeName(destDir, base, ext);
    await fsp.rename(from, path.join(destDir, name));
    if (project) await renumber(project);
    if (toProject) await renumber(toProject);
    return name;
  },

  async reorder(project, order) { if (!project) throw new Error('Only project tracks have an order'); return renumber(project, order); },

  async projectCreate(name) {
    const p = clean(name, null); if (!p) throw new Error('Please type a name');
    const dir = path.join(root(), p);
    if (await exists(dir)) throw new Error('There is already a project called "' + p + '"');
    await fsp.mkdir(dir, { recursive: true });
    return p;
  },
  async projectRename(oldName, newName) {
    const from = projDir(oldName), p = clean(newName, null); if (!p) throw new Error('Please type a name');
    if (p === oldName) return p;
    const to = path.join(root(), p);
    if (await exists(to)) throw new Error('There is already a project called "' + p + '"');
    await fsp.rename(from, to);
    try { await fsp.unlink(path.join(to, oldName + '.m3u8')); } catch {}
    await renumber(p);
    return p;
  },
  async projectDelete(name) { await shell.trashItem(projDir(name)); return true; }, // Recycle Bin

  read: (project, file) => fsp.readFile(filePath(project, file)),
  remove: async (project, file) => { await shell.trashItem(filePath(project, file)); if (project) await renumber(project); return true; },
  show: (project, file) => shell.showItemInFolder(filePath(project, file)),
  async openFolder(project) { const d = projDir(project); await fsp.mkdir(d, { recursive: true }); return shell.openPath(d); },
};
