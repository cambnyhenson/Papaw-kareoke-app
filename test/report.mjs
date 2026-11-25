// node test/report.mjs  — checks logging, error capture and the report path (with a fake key: GitHub rejects it, so it's saved for later)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
fs.writeFileSync('report.json', JSON.stringify({owner:'cambnyhenson',repo:'Papaw-kareoke-app',token:'github_pat_FAKE'}));
const app = await electron.launch({ executablePath: (await import('electron')).default, args: ['--no-sandbox','.'] });
const ud = await app.evaluate(({app})=>app.getPath('userData'));
const pg = await app.firstWindow(); await pg.waitForLoadState('domcontentloaded'); await pg.waitForTimeout(1500);
if (await pg.isVisible('#foldersModal')) await pg.click('#btnCloseFolders');
await pg.evaluate(()=>setTimeout(()=>{ null.boom; },0));       // a page error
await pg.waitForTimeout(500);
console.log('button:', await pg.textContent('#btnReport'), await pg.$eval('#btnReport', b=>b.className));
await pg.click('#btnReport'); await pg.fill('#reportText','Test: song skipped to the next one');
await pg.click('#btnReportSend'); await pg.waitForTimeout(4000);
console.log('status:', await pg.textContent('#reportStatus'));
await pg.screenshot({path:'test/report.png'});
await app.close(); fs.unlinkSync('report.json');
const pend = fs.readdirSync(ud+'/pending-reports'); const rep = JSON.parse(fs.readFileSync(ud+'/pending-reports/'+pend.at(-1),'utf8'));
console.log('pending:', pend.length, '| title:', rep.title, '| labels:', rep.labels, '| body chars:', rep.body.length);
console.log(rep.body.split('<details>')[0]);
console.log('log tail:\n'+fs.readFileSync(ud+'/logs/app.log','utf8').trim().split('\n').slice(-8).join('\n'));
