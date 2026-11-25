// Encodes recorded audio to MP3 while the song plays, so saving at the end is instant.
importScripts('vendor/lame.min.js');
let enc = null, parts = [];
const toInt16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; } return o; };
onmessage = e => {
  try { handle(e.data); } catch (err) { enc = null; parts = []; postMessage({ error: String(err && err.stack || err) }); }
};
function handle(m) {
  if (m.type === 'start') { enc = new lamejs.Mp3Encoder(2, m.sampleRate, 192); parts = []; }
  else if (m.type === 'data' && enc) { const b = enc.encodeBuffer(toInt16(m.l), toInt16(m.r)); if (b.length) parts.push(new Uint8Array(b)); }
  else if (m.type === 'stop') {
    if (!enc) { postMessage({ error: 'encoder was not running' }); return; }
    const b = enc.flush(); if (b.length) parts.push(new Uint8Array(b));
    const len = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(len); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    enc = null; parts = [];
    postMessage(out, [out.buffer]);
  }
}
