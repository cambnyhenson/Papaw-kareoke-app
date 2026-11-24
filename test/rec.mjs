import { _electron as electron } from 'playwright-core';
const LIB = process.argv[2];  // folder with songs, e.g. node test/rec.mjs ~/songs
const app = await electron.launch({ executablePath: (await import('electron')).default, args: ['--no-sandbox','--use-fake-device-for-media-stream','.'] });
const pg = await app.firstWindow(); await pg.waitForLoadState('domcontentloaded');
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
for (const f of await pg.evaluate(()=>window.api.libGet().then(r=>r.folders.map(f=>f.id)))) await pg.evaluate(id=>window.api.libRemove(id), f);
await pg.evaluate(()=>localStorage.clear()); await pg.reload(); await pg.waitForLoadState('domcontentloaded'); await pg.waitForTimeout(800);
await pg.setViewportSize({width:1280,height:800});
await pg.click('#btnCloseFolders');
const fid = await pg.evaluate(l=>window.api.libAdd(l), LIB); await pg.evaluate(id=>__kp.rescan(id,true), fid);
const ins = await pg.$$eval('#inDev option', o=>o.map(x=>[x.value.slice(0,8),x.textContent]));
console.log('inputs', ins);
await pg.selectOption('#inDev', {index:1}); await pg.waitForTimeout(1500);
console.log('meter', await pg.$eval('#meterFill', e=>e.style.width));
await pg.click('#btnRec');
for (const t of ['Crazy','Sweet Caroline']) { await pg.fill('#q',t); await pg.waitForTimeout(200); await pg.click('#results .row button'); }
await pg.click('#playlist .row:nth-child(1) button[title="Sing this song now"]');
await pg.waitForTimeout(6000);
console.log('recinfo', await pg.textContent('#recInfo'));
await pg.screenshot({path:'test/rec_0.png'});
await pg.click('#playlist .row:nth-child(2) button[title="Sing this song now"]'); // switching songs saves the first take
await pg.waitForTimeout(5000);
await pg.click('#btnStop'); await pg.waitForTimeout(2000);
await pg.click('#tabRec'); await pg.waitForTimeout(800);
console.log('recordings', await pg.$$eval('#recList .row .name div:first-child', e=>e.map(x=>x.textContent)));
await pg.click('#recList .row:nth-child(1) button[title="Listen"]'); await pg.waitForTimeout(1500);
console.log('playback', await pg.evaluate(()=>{ const a=document.querySelectorAll('audio'); return 'ok'; }));
await pg.screenshot({path:'test/rec_1.png'});
console.log('errors', errs);
await app.close();
