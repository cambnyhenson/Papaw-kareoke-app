// Karaoke Player — Electron main process
const { app, BrowserWindow, ipcMain, dialog, screen, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const MEDIA_EXT = new Set(['zip', 'cdg', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'mp4', 'm4v', 'webm', 'mkv', 'mov']);
let win = null;
let root = null; // the song folder currently loaded

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
  win.on('closed', () => { win = null; app.quit(); });
}

/* ---------- file access for the page ---------- */
async function walk(dir, rel, out) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; } // skip unreadable folders
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) {
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (MEDIA_EXT.has(ext)) out.push(r);
    }
  }
}

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Choose the karaoke song folder', properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('scan', async (_e, dir) => {
  const st = await fs.stat(dir); // throws if the drive/folder is missing
  if (!st.isDirectory()) throw new Error('Not a folder');
  root = path.resolve(dir);
  const out = [];
  await walk(root, '', out);
  return out;
});

ipcMain.handle('read', async (_e, rel) => {
  if (!root) throw new Error('No song folder loaded');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Outside song folder');
  return await fs.readFile(full);
});

ipcMain.handle('has-tv', () => tvDisplay().external);
ipcMain.handle('version', () => app.getVersion());

app.whenReady().then(() => {
  // Allow the page to list sound outputs by name and send audio to a chosen one (the mixer).
  const allowed = new Set(['media', 'speaker-selection', 'fullscreen']);
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
