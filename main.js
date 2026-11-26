// The Butcher Karaoke — Electron main process
const { app, BrowserWindow, ipcMain, dialog, screen, session, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { autoUpdater } = require('electron-updater');
const reports = require('./reports');
const { log } = reports;

// Keep saved data (song library index, playlist, settings, logs) in the folder the app used when it
// was called "Karaoke Player", so renaming it doesn't make it forget anything.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Karaoke Player'));

let win = null;
let tvWin = null;          // the TV (lyrics) window, when open
let closeReady = false;   // set once the page has saved any recording in progress

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
    width: 1280, height: 820, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: '#FFFFFF', title: 'The Butcher Karaoke', autoHideMenuBar: true,
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
        title: 'The Butcher Karaoke – TV Screen', icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: { backgroundThrottling: false },
      },
    };
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Start maximized so the controls at the bottom are never off the bottom of a laptop screen.
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-create-window', child => {
    tvWin = child;
    child.on('closed', () => { if (tvWin === child) tvWin = null; });
  });
  // Closing the app: let the page finish saving a recording first (max 10 s).
  win.on('close', e => {
    if (burner.isBurning()) {
      const r = dialog.showMessageBoxSync(win, { type: 'warning', title: 'The Butcher Karaoke', noLink: true, defaultId: 0, cancelId: 0,
        message: 'A CD is being burned right now.', detail: 'Closing the app now will ruin the CD. Wait for it to finish?',
        buttons: ['Keep burning', 'Close anyway'] });
      if (r === 0) { e.preventDefault(); return; }
    }
    if (closeReady) return;
    e.preventDefault();
    win.webContents.send('app-closing');
    setTimeout(() => { closeReady = true; if (win) win.close(); }, 10000);
  });

  // Log the page's own errors, and recover from crashes with an offer to send a report.
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const lv = e && e.level !== undefined ? e.level : level, msg = e && e.message !== undefined ? e.message : message;
    if (lv === 'error' || lv === 3 || lv === 'warning' || lv === 2) log(lv === 'error' || lv === 3 ? 'page-error' : 'page-warn', msg);
  });
  win.webContents.on('render-process-gone', async (_e, details) => {
    log('crash', 'screen process gone:', details);
    if (details.reason === 'clean-exit') return;
    const r = await dialog.showMessageBox(win, { type: 'error', title: 'The Butcher Karaoke',
      message: 'The Butcher Karaoke had a problem and needs to reload.',
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
const playlists = require('./playlists');
ipcMain.handle('pl-get', () => playlists.get());
ipcMain.handle('pl-save', (_e, data) => playlists.save(data));
ipcMain.handle('spp-found', () => playlists.sppFound());
ipcMain.handle('spp-import', async () => { const r = await playlists.importSpp(); log('info', 'imported Show Presenter:', r.playlists.length, 'playlists,', r.names, 'song names'); return r; });
ipcMain.handle('spp-names', () => playlists.names());
ipcMain.handle('read', async (_e, key) => {
  const full = await library.fullPath(key);
  const st = await fs.stat(full);
  if (st.size > 1.5 * 1024 ** 3) throw new Error('This file is too big to play (' + (st.size / 1024 ** 3).toFixed(1) + ' GB)');
  return fs.readFile(full);
});

/* ---------- logging & problem reports ---------- */
ipcMain.handle('log', (_e, level, msg) => log(level, msg));
ipcMain.handle('report-send', (_e, opts) => reports.send(opts));
ipcMain.handle('report-configured', () => reports.configured());
ipcMain.handle('open-logs', () => shell.openPath(reports.logDir()));

let crashing = false;
process.on('uncaughtException', async err => {
  log('crash', 'main process:', err);
  if (crashing || !app.isReady()) return; crashing = true;
  const r = await dialog.showMessageBox(win || undefined, { type: 'error', title: 'The Butcher Karaoke',
    message: 'The Butcher Karaoke hit a problem.', detail: 'Send a report so it can be fixed?',
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

/* ---------- recordings and CD projects (Documents\Karaoke Recordings) ---------- */
const recs = require('./recordings');
const recLog = (what, p) => p.then(r => { log('info', 'recordings:', what); return r; });
ipcMain.handle('rec-save', (_e, title, bytes, project) => recLog('saved ' + title, recs.save(title, bytes, project)));
ipcMain.handle('rec-list', (_e, project) => recs.list(project || null));
ipcMain.handle('rec-projects', () => recs.projects());
ipcMain.handle('rec-read', (_e, project, name) => recs.read(project || null, name));
ipcMain.handle('rec-delete', (_e, project, name) => recLog('deleted ' + name, recs.remove(project || null, name)));
ipcMain.handle('rec-show', (_e, project, name) => recs.show(project || null, name));
ipcMain.handle('rec-folder', (_e, project) => recs.openFolder(project || null));
ipcMain.handle('rec-rename', (_e, project, name, title) => recLog(`renamed ${name} -> ${title}`, recs.rename(project || null, name, title)));
ipcMain.handle('rec-move', (_e, project, name, to) => recLog(`moved ${name} -> ${to || '(no project)'}`, recs.move(project || null, name, to || null)));
ipcMain.handle('rec-reorder', (_e, project, order) => recs.reorder(project, order));
ipcMain.handle('proj-create', (_e, name) => recLog('project created ' + name, recs.projectCreate(name)));
ipcMain.handle('proj-rename', (_e, from, to) => recLog(`project renamed ${from} -> ${to}`, recs.projectRename(from, to)));
ipcMain.handle('proj-delete', (_e, name) => recLog('project deleted ' + name, recs.projectDelete(name)));
const burner = require('./burner');
ipcMain.handle('burn-check', () => burner.check());
ipcMain.handle('burn-prepare', () => burner.prepare());
ipcMain.handle('burn-write', (_e, dir, i, bytes) => burner.writeTrack(dir, i, bytes));
ipcMain.handle('burn-cleanup', (_e, dir) => burner.cleanup(dir));
ipcMain.handle('burn-start', async (e, dir, project) => {
  log('info', 'burning CD:', project);
  const r = await burner.burn(dir, ev => { log('info', 'burn:', JSON.stringify(ev)); if (!e.sender.isDestroyed()) e.sender.send('burn-event', ev); });
  log(r.type === 'done' ? 'info' : 'error', 'burn finished:', JSON.stringify(r));
  return r;
});

ipcMain.handle('has-tv', () => tvDisplay().external);
ipcMain.handle('close-ready', () => { closeReady = true; if (win) win.close(); });
ipcMain.handle('tv-fullscreen', () => { if (tvWin) tvWin.setFullScreen(!tvWin.isFullScreen()); });

// Keep the screens awake while a song is playing or the TV screen is up (no screensaver mid-song).
let awakeId = null;
ipcMain.handle('keep-awake', (_e, on) => {
  if (on && awakeId === null) { awakeId = powerSaveBlocker.start('prevent-display-sleep'); log('info', 'keeping display awake'); }
  if (!on && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null; log('info', 'display may sleep again'); }
});
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

// Nothing in the app should ever navigate away (e.g. a file dragged onto the window) or open other windows.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e, url) => { e.preventDefault(); log('warn', 'blocked navigation to', url); });
});

function buildMenu() {
  // Simple menu (press Alt to see it): zoom for bigger text, no reload/dev tools to hit by accident.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'View', submenu: [
      { role: 'zoomIn', label: 'Bigger Text', accelerator: 'CmdOrCtrl+=' },
      { role: 'zoomOut', label: 'Smaller Text' },
      { role: 'resetZoom', label: 'Normal Text Size' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { label: 'Help', submenu: [
      { label: 'User Guide', accelerator: 'F1', click: () => { if (win) win.webContents.send('open-guide'); } },
      { type: 'separator' },
      { label: 'Open Log Folder', click: () => shell.openPath(reports.logDir()) },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ] },
  ]));
}

// TV plugged in or unplugged while the app is open.
function watchDisplays() {
  screen.on('display-added', () => { log('info', 'display added'); if (win) win.webContents.send('tv-changed', true); });
  screen.on('display-removed', () => {
    log('info', 'display removed');
    // Don't let a full-screen lyrics window land on top of the laptop's controls.
    if (tvWin && !tvWin.isDestroyed()) tvWin.close();
    if (win) win.webContents.send('tv-changed', false);
  });
}

app.whenReady().then(() => {
  buildMenu();
  watchDisplays();
  // Allow the page to list sound outputs by name and send audio to a chosen one (the mixer).
  const allowed = new Set(['media', 'speaker-selection', 'fullscreen']);
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  log('info', `--- The Butcher Karaoke ${app.getVersion()} starting (Windows ${require('os').release()}, ${screen.getAllDisplays().length} display(s))`);
  createWindow();
  setupUpdates();
  setTimeout(() => reports.sendPending(), 20000); // reports saved while offline
});

app.on('window-all-closed', () => app.quit());
