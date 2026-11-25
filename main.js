// Karaoke Player — Electron main process
const { app, BrowserWindow, ipcMain, dialog, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { autoUpdater } = require('electron-updater');
const reports = require('./reports');
const { log } = reports;

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

/** Pick the screen the TV window should use: any display that isn't the laptop's main one. */
function tvDisplay() {
  const primary = screen.getPrimaryDisplay();
  const ext = screen.getAllDisplays().find(d => d.id !== primary.id);
  return { display: ext || primary, external: !!ext };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#111418', title: 'Karaoke Player', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, backgroundThrottling: false,
    },
  });

  // The TV screen is opened by the page with window.open('', 'karaoke_tv').
  // Put it full screen on the TV automatically when a second display is connected.
  win.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName !== 'karaoke_tv') return { action: 'deny' };
    const { display, external } = tvDisplay();
    const b = display.bounds;
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        x: external ? b.x : b.x + 80, y: external ? b.y : b.y + 80,
        width: external ? b.width : 960, height: external ? b.height : 540,
        fullscreen: external, backgroundColor: '#000000', autoHideMenuBar: true,
        title: 'Karaoke – TV Screen', icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: { backgroundThrottling: false },
      },
    };
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Log the page's own errors, and recover from crashes with an offer to send a report.
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const lv = e && e.level !== undefined ? e.level : level, msg = e && e.message !== undefined ? e.message : message;
    if (lv === 'error' || lv === 3 || lv === 'warning' || lv === 2) log(lv === 'error' || lv === 3 ? 'page-error' : 'page-warn', msg);
  });
  win.webContents.on('render-process-gone', async (_e, details) => {
    log('crash', 'screen process gone:', details);
    if (details.reason === 'clean-exit') return;
    const r = await dialog.showMessageBox(win, { type: 'error', title: 'Karaoke Player',
      message: 'Karaoke Player had a problem and needs to reload.',
      detail: 'Send a report so it can be fixed? (Takes a second; the playlist is kept.)',
      buttons: ['Send report and reload', 'Just reload'], defaultId: 0, noLink: true });
    if (r.response === 0) await reports.send({ kind: 'crash', error: 'Screen process ' + details.reason + ' (exit code ' + details.exitCode + ')' });
    if (win) win.reload();
  });
  win.on('unresponsive', () => log('warn', 'window not responding'));
  win.on('responsive', () => log('info', 'window responding again'));
  win.on('closed', () => { win = null; app.quit(); });
}

/* ---------- song library ---------- */
const library = require('./library');

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Choose a folder (or drive) with karaoke songs', properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('lib-get', () => library.get());
ipcMain.handle('lib-status', () => library.status());
ipcMain.handle('lib-add', (_e, dir) => library.add(dir));
ipcMain.handle('lib-remove', (_e, id) => library.remove(id));
let scanning = null;
ipcMain.handle('lib-scan', (e, id) => {
  if (!scanning) {
    scanning = library.scan(id, (name, n) => { if (!e.sender.isDestroyed()) e.sender.send('scan-progress', name, n); })
      .finally(() => { scanning = null; });
  }
  return scanning;
});
ipcMain.handle('read', async (_e, key) => fs.readFile(await library.fullPath(key)));

/* ---------- logging & problem reports ---------- */
ipcMain.handle('log', (_e, level, msg) => log(level, msg));
ipcMain.handle('report-send', (_e, opts) => reports.send(opts));
ipcMain.handle('report-configured', () => reports.configured());
ipcMain.handle('open-logs', () => shell.openPath(reports.logDir()));

let crashing = false;
process.on('uncaughtException', async err => {
  log('crash', 'main process:', err);
  if (crashing || !app.isReady()) return; crashing = true;
  const r = await dialog.showMessageBox(win || undefined, { type: 'error', title: 'Karaoke Player',
    message: 'Karaoke Player hit a problem.', detail: 'Send a report so it can be fixed?',
    buttons: ['Send report', 'Close'], defaultId: 0, noLink: true });
  if (r.response === 0) {
    let state = {};
    try { state = await win.webContents.executeJavaScript('window.__kpState ? window.__kpState() : {}'); } catch {}
    await reports.send({ kind: 'crash', error: err.stack || String(err), state });
  }
  crashing = false;
});
process.on('unhandledRejection', err => log('error', 'main process (promise):', err));
app.on('child-process-gone', (_e, d) => log('warn', 'helper process gone:', d));

/* ---------- recordings (Documents\Karaoke Recordings) ---------- */
const recDir = () => path.join(app.getPath('documents'), 'Karaoke Recordings');
const recPath = name => {
  const full = path.resolve(recDir(), path.basename(name));
  if (path.dirname(full) !== path.resolve(recDir())) throw new Error('Bad file name');
  return full;
};
function stamp(d = new Date()) {
  const h = d.getHours() % 12 || 12, ap = d.getHours() < 12 ? 'am' : 'pm';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${h}.${p(d.getMinutes())}${ap}`;
}
ipcMain.handle('rec-save', async (_e, title, bytes) => {
  await fs.mkdir(recDir(), { recursive: true });
  const clean = String(title).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Recording';
  let name = `${clean} - ${stamp()}.mp3`, n = 2;
  while (await fs.stat(path.join(recDir(), name)).then(() => true, () => false)) name = `${clean} - ${stamp()} (${n++}).mp3`;
  await fs.writeFile(path.join(recDir(), name), Buffer.from(bytes));
  return name;
});
ipcMain.handle('rec-list', async () => {
  let names = [];
  try { names = (await fs.readdir(recDir())).filter(n => /\.(mp3|wav|webm)$/i.test(n)); } catch { return []; }
  const out = [];
  for (const name of names) { try { const st = await fs.stat(path.join(recDir(), name)); out.push({ name, size: st.size, time: st.mtimeMs }); } catch {} }
  return out.sort((a, b) => b.time - a.time);
});
ipcMain.handle('rec-read', async (_e, name) => fs.readFile(recPath(name)));
ipcMain.handle('rec-delete', async (_e, name) => { await shell.trashItem(recPath(name)); return true; }); // goes to the Recycle Bin
ipcMain.handle('rec-show', (_e, name) => shell.showItemInFolder(recPath(name)));
ipcMain.handle('rec-folder', async () => { await fs.mkdir(recDir(), { recursive: true }); return shell.openPath(recDir()); });

ipcMain.handle('has-tv', () => tvDisplay().external);
ipcMain.handle('version', () => app.getVersion());

/* ---------- automatic updates from GitHub Releases ---------- */
function setupUpdates() {
  if (!app.isPackaged) return;            // only the installed app updates itself
  autoUpdater.autoDownload = true;        // download quietly in the background
  autoUpdater.autoInstallOnAppQuit = true; // install when the app is closed, never mid-song
  autoUpdater.on('update-downloaded', info => { log('info', 'update downloaded:', info.version); if (win) win.webContents.send('update-ready', info.version); });
  autoUpdater.on('error', e => log('warn', 'update check failed:', e && e.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {}); // offline is fine
  setTimeout(check, 5000);
  setInterval(check, 2 * 60 * 60 * 1000);
}
ipcMain.handle('update-install', () => autoUpdater.quitAndInstall(true, true));

app.whenReady().then(() => {
  // Allow the page to list sound outputs by name and send audio to a chosen one (the mixer).
  const allowed = new Set(['media', 'speaker-selection', 'fullscreen']);
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  log('info', `--- Karaoke Player ${app.getVersion()} starting (Windows ${require('os').release()}, ${screen.getAllDisplays().length} display(s))`);
  createWindow();
  setupUpdates();
  setTimeout(() => reports.sendPending(), 20000); // reports saved while offline
});

app.on('window-all-closed', () => app.quit());
