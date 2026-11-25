// Smoke test run before every release (and locally).
//   node test/ci-smoke.mjs                  -> runs the source app (Linux needs xvfb-run)
//   APP_EXE="dist/win-unpacked/The Butcher Karaoke.exe" node test/ci-smoke.mjs   -> runs the built app (CI)
// Fails (exit 1) if any song type can't load, key change breaks, text boxes eat spaces,
// the window can be navigated away, any page error happens, or the app won't close cleanly.
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';

const fixtures = path.resolve('test/fixtures');
const exe = process.env.APP_EXE ? path.resolve(process.env.APP_EXE) : (await import('electron')).default;
const args = process.env.APP_EXE ? [] : ['.'];
if (process.platform === 'linux') args.unshift('--no-sandbox');
// fresh profile every run so old settings can't hide a problem
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-smoke-'));
args.push('--user-data-dir=' + profile);

const failures = [];
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failures.push(what); };

const app = await electron.launch({ executablePath: exe, args, timeout: 60000 });
const pg = await app.firstWindow();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(e.message));
await pg.waitForLoadState('domcontentloaded');
await pg.waitForTimeout(2000);
if (await pg.isVisible('#foldersModal')) await pg.click('#btnCloseFolders');

const id = await pg.evaluate(d => window.api.libAdd(d), fixtures);
await pg.evaluate(id => __kp.rescan(id, true), id);
const status = await pg.textContent('#status');
check(/^3 songs/.test(status), `library found the 3 test songs (${status})`);

for (const b of await pg.$$('#results .row button')) await b.click();
const fits = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#playlist').getBoundingClientRect().right <= innerWidth);
check(fits, 'window fits the screen (no sideways scrolling, playlist visible)');
const names = await pg.$$eval('#playlist .row .name div', e => e.map(x => x.textContent));
check(names.length === 3, 'songs added to playlist: ' + names.join(' | '));

for (let i = 0; i < names.length; i++) {
  await pg.click(`#playlist .row:nth-child(${i + 1}) button[title="Sing this song now"]`);
  await pg.waitForFunction(() => document.getElementById('busy').style.display !== 'flex', null, { timeout: 30000 });
  await pg.waitForTimeout(2500);
  const s = await pg.evaluate(() => ({ kind: __kp.song()?.kind, playing: __kp.engine.playing, pos: __kp.engine.position(),
    msg: document.getElementById('msg').style.display === 'block' ? document.getElementById('msg').textContent : '' }));
  check(!!s.kind && s.playing && !/Could not play/.test(s.msg), `plays "${names[i]}" (${s.kind})${s.msg ? ' msg: ' + s.msg : ''}`);
  if (s.pos <= 0.2) console.log(`WARN position did not advance for "${names[i]}" (no sound device on this machine?)`);
  await pg.click('#keyUp'); await pg.waitForTimeout(800);
  const k = await pg.evaluate(() => ({ semis: __kp.engine.semis, playing: __kp.engine.playing }));
  check(k.semis === 1 && k.playing, `key change +1 keeps playing (${names[i]})`);
  await pg.click('#keyDown');
}
await pg.click('#btnStop');

await pg.click('#btnReport'); await pg.click('#reportText'); await pg.keyboard.type('two words');
check(await pg.inputValue('#reportText') === 'two words', 'spaces can be typed in the report box');
await pg.keyboard.press('Escape');
check(!(await pg.isVisible('#reportModal')), 'Escape closes the report box');

await pg.click('#btnGuide');
check(await pg.isVisible('#guideModal'), 'User Guide opens from the bottom bar');
await pg.click('#guideToc a[href="#g-record"]'); await pg.waitForTimeout(600);
check(pg.url().endsWith('index.html') && await pg.isVisible('#g-record'), 'guide contents links jump inside the guide');
await pg.keyboard.press('Escape');
check(!(await pg.isVisible('#guideModal')), 'Escape closes the guide');
await pg.keyboard.press('F1');
check(await pg.isVisible('#guideModal'), 'F1 opens the guide');
await pg.click('#btnGuideClose');

const before = pg.url();
await pg.evaluate(() => { location.href = 'file:///C:/Windows/win.ini'; });
await pg.waitForTimeout(800);
check(pg.url() === before, 'window cannot be navigated away from the app');

const early = await pg.evaluate(() => window.__kpState().recentErrors || []);
check(pageErrors.length === 0 && early.length === 0, 'no page errors' + (pageErrors.length || early.length ? ': ' + [...pageErrors, ...early].join(' / ') : ''));

// closing goes through the "save recordings first" path and must finish
const closed = new Promise(res => app.process().once('exit', () => res(true)));
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('The Butcher Karaoke')).close());
check(await Promise.race([closed, new Promise(r => setTimeout(() => r(false), 15000))]), 'app closes cleanly');
try { await app.close(); } catch {}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
