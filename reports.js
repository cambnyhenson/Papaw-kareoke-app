// Logging and "Report a Problem": keeps a log file, and sends problem reports (with the end of
// the log) to the GitHub repo as issues so they can be read and fixed.
const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const logDir = () => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'app.log');
const pendingDir = () => path.join(app.getPath('userData'), 'pending-reports');
const MAX_LOG = 1024 * 1024;

// Hide the Windows user name in anything sent (issues on a public repo are public).
const scrub = s => String(s).split(os.homedir()).join('%USERPROFILE%');
const fmt = p => p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p);

function log(level, ...parts) {
  const line = `${new Date().toISOString()} [${level}] ${parts.map(fmt).join(' ')}\n`;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_LOG) fs.renameSync(f, f + '.1');
    fs.appendFileSync(f, line);
  } catch {}
}

function logTail(maxChars) {
  let text = '';
  for (const f of [logFile() + '.1', logFile()]) { try { text += fs.readFileSync(f, 'utf8'); } catch {} }
  return scrub(text.slice(-maxChars));
}

// The token is written into report.json by the GitHub build (from the REPORT_TOKEN secret).
// It must be a fine-grained token limited to this one repo with only "Issues: read and write".
function config() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'report.json'), 'utf8')); } catch { return null; }
}

function buildReport({ description = '', state = {}, kind = 'report', error = '' }) {
  const first = (description || error || 'Problem report').split('\n')[0].trim();
  const title = (kind === 'crash' ? 'Crash: ' : 'Problem: ') + first.slice(0, 80);
  const info = [
    ['App version', app.getVersion()], ['Windows', `${os.release()} (${os.arch()})`],
    ['Electron', process.versions.electron], ['Memory', Math.round(os.totalmem() / 1073741824) + ' GB'],
    ['Time', new Date().toString()],
  ];
  const body = [
    '### What happened', description ? scrub(description) : '_(no description)_', '',
    error ? '### Error\n```\n' + scrub(error).slice(0, 4000) + '\n```\n' : '',
    '### Computer', '| | |', '|---|---|', ...info.map(([k, v]) => `| ${k} | ${v} |`), '',
    '### App state', '```json', scrub(JSON.stringify(state, null, 2)).slice(0, 4000), '```', '',
    '<details><summary>Log (most recent at the bottom)</summary>', '', '```', logTail(45000), '```', '</details>',
  ].join('\n');
  return { title, body, labels: [kind === 'crash' ? 'crash' : 'problem-report'] };
}

async function post(report) {
  const c = config();
  if (!c || !c.token) throw new Error('Reporting is not set up in this build');
  // Node's fetch, not Electron's net.fetch: net.fetch was seen dropping the Authorization header.
  const send = labels => fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
      'User-Agent': 'KaraokePlayer', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ title: report.title, body: report.body, ...(labels ? { labels: report.labels } : {}) }),
  });
  let res = await send(true);
  if (res.status === 422 || res.status === 403) res = await send(false); // labels not allowed: send without
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return (await res.json()).html_url;
}

/** Send a report now; if that fails (offline etc.), keep it and retry later. */
async function send(opts) {
  const report = buildReport(opts);
  log('info', 'sending problem report:', report.title);
  try {
    const url = await post(report);
    log('info', 'report sent:', url);
    return { ok: true, url };
  } catch (e) {
    log('warn', 'report not sent, saved for later:', e.message);
    try {
      fs.mkdirSync(pendingDir(), { recursive: true });
      const old = fs.readdirSync(pendingDir()).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 19))) fs.unlinkSync(path.join(pendingDir(), f)); // keep at most 20
      fs.writeFileSync(path.join(pendingDir(), Date.now() + '.json'), JSON.stringify(report));
    } catch {}
    return { ok: false, reason: e.message };
  }
}

/** Retry reports that couldn't be sent earlier (e.g. no internet at the show). */
async function sendPending() {
  let files = [];
  try { files = fs.readdirSync(pendingDir()).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const p = path.join(pendingDir(), f);
    try { const url = await post(JSON.parse(fs.readFileSync(p, 'utf8'))); fs.unlinkSync(p); log('info', 'saved report sent:', url); }
    catch (e) { log('warn', 'saved report still not sent:', e.message); return; }
  }
}

module.exports = { log, send, sendPending, logDir, configured: () => !!(config() && config().token) };
