// Smoke test: node test/smoke.mjs <song folder>   (Linux needs xvfb-run)
import { _electron as electron } from 'playwright-core';
const lib = process.argv[2];
const app = await electron.launch({ executablePath: (await import('electron')).default, args: ['--no-sandbox', '.'] });
const pg = await app.firstWindow();
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await pg.waitForLoadState('domcontentloaded');
await pg.evaluate(()=>localStorage.clear());
await pg.evaluate(l=>__kp.loadFolder(l), lib);
console.log('status:', await pg.textContent('#status'));
for (const b of await pg.$$('#results .row button')) await b.click();
const names = await pg.$$eval('#playlist .row .name div', e=>e.map(x=>x.textContent));
console.log('playlist:', names);
console.log('outputs:', await pg.$$eval('#outDev option', o=>o.map(x=>x.textContent)));
const tvP = app.waitForEvent('window'); await pg.click('#btnTV'); const tv = await tvP;
for (let i=0;i<names.length;i++){
  await pg.click(`#playlist .row:nth-child(${i+1}) button[title="Sing this song now"]`);
  await pg.waitForTimeout(2500);
  const s = await pg.evaluate(()=>({pos:+__kp.engine.position().toFixed(2), playing:__kp.engine.playing, kind:__kp.song()?.kind, va:__kp.song()?.videoAudio, cdg:__kp.cdg.pos}));
  await pg.click('#keyUp'); await pg.waitForTimeout(1200);
  const k = await pg.evaluate(()=>({pos:+__kp.engine.position().toFixed(2), playing:__kp.engine.playing, semis:__kp.engine.semis}));
  console.log(names[i], JSON.stringify(s), 'key+1 ->', JSON.stringify(k));
  await pg.screenshot({path:`test/main_${i}.png`}); await tv.screenshot({path:`test/tv_${i}.png`});
}
// let the last song end with auto-advance off
await pg.evaluate(()=>__kp.engine.seek(__kp.engine.duration-1)); await pg.waitForTimeout(2500);
console.log('after end:', await pg.textContent('#np'));
console.log('errors:', errs);
await app.close();
