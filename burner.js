// Audio CD burning inside the app, using Windows' own CD burning engine (IMAPI2, the same one
// Windows Media Player uses) through a small PowerShell script. Tracks arrive from the page as
// CD audio (44.1 kHz, 16-bit stereo PCM, padded to whole 2352-byte sectors), one file per track.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');

const PS = String.raw`
param([string]$Mode, [string]$Dir)
$ErrorActionPreference = 'Stop'
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  if ($Mode -eq 'burn') {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class KaraokeStream {
  [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = false)]
  static extern void SHCreateStreamOnFileEx(string file, uint mode, uint attributes, bool create, IStream template, out IStream stream);
  public static IStream Open(string file) { IStream s; SHCreateStreamOnFileEx(file, 0x20, 0, false, null, out s); return s; }
}
'@
  }
  $master = New-Object -ComObject IMAPI2.MsftDiscMaster2
  if ($master.Count -eq 0) { Say @{ type = 'status'; burner = $null; reason = 'no-burner' }; exit 0 }
  $tao = New-Object -ComObject IMAPI2.MsftDiscFormat2TrackAtOnce
  $rec = $null; $name = $null
  foreach ($id in $master) {
    $r = New-Object -ComObject IMAPI2.MsftDiscRecorder2
    $r.InitializeDiscRecorder($id)
    $n = (($r.VendorId + ' ' + $r.ProductId) -replace '\s+', ' ').Trim()
    if (-not $name) { $name = $n }
    if ($tao.IsRecorderSupported($r)) { $rec = $r; $name = $n; break }
  }
  if (-not $rec) { Say @{ type = 'status'; burner = $name; reason = 'cannot-burn-cds' }; exit 0 }
  $ok = $false; try { $ok = $tao.IsCurrentMediaSupported($rec) } catch {}
  if (-not $ok) { Say @{ type = 'status'; burner = $name; reason = 'no-blank-cd' }; exit 0 }
  $tao.Recorder = $rec
  $tao.ClientName = 'The Butcher Karaoke'
  if ($Mode -eq 'check') {
    $free = 0; try { $tao.PrepareMedia(); $free = $tao.FreeSectorsOnMedia; $tao.ReleaseMedia() } catch { Say @{ type = 'status'; burner = $name; reason = 'no-blank-cd' }; exit 0 }
    Say @{ type = 'status'; burner = $name; reason = 'ready'; freeSectors = $free }; exit 0
  }
  $files = @(Get-ChildItem -LiteralPath $Dir -Filter '*.pcm' | Sort-Object Name)
  $tao.PrepareMedia()
  $i = 0
  foreach ($f in $files) {
    $i++; Say @{ type = 'track'; n = $i; of = $files.Count }
    $s = [KaraokeStream]::Open($f.FullName)
    $tao.AddAudioTrack($s)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($s)
  }
  Say @{ type = 'closing' }
  $tao.ReleaseMedia()
  try { $rec.EjectMedia() } catch {}
  Say @{ type = 'done' }
} catch {
  Say @{ type = 'error'; message = $_.Exception.Message }
  exit 1
}
`;

let running = null; // the PowerShell burn process, while a CD is being written

async function script() {
  const f = path.join(app.getPath('temp'), 'butcher-karaoke-burn.ps1');
  await fsp.writeFile(f, '﻿' + PS, 'utf8');
  return f;
}

function run(mode, dir, onEvent) {
  return new Promise(async (resolve) => {
    if (process.platform !== 'win32') { resolve({ type: 'status', burner: null, reason: 'not-windows' }); return; }
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', await script(), '-Mode', mode, '-Dir', dir || ''], { windowsHide: true });
    if (mode === 'burn') running = p;
    let last = null, buf = '', err = '';
    p.stdout.on('data', d => {
      buf += d.toString();
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { last = JSON.parse(line); onEvent && onEvent(last); } catch {}
      }
    });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => {
      if (mode === 'burn') running = null;
      resolve(last || { type: 'error', message: (err.trim() || 'The burner did not answer (code ' + code + ')').slice(0, 500) });
    });
    p.on('error', e => { if (mode === 'burn') running = null; resolve({ type: 'error', message: e.message }); });
  });
}

module.exports = {
  isBurning: () => !!running,
  /** Is there a burner, and a blank CD in it? */
  check: () => run('check'),
  /** Make an empty folder for this burn's tracks. */
  async prepare() {
    const dir = path.join(app.getPath('temp'), 'butcher-karaoke-cd-' + Date.now());
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  },
  async writeTrack(dir, index, bytes) {
    if (!path.basename(dir).startsWith('butcher-karaoke-cd-')) throw new Error('Bad folder');
    await fsp.writeFile(path.join(dir, String(index).padStart(2, '0') + '.pcm'), Buffer.from(bytes));
  },
  async burn(dir, onEvent) {
    if (running) throw new Error('A CD is already being burned');
    try { return await run('burn', dir, onEvent); }
    finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  },
  async cleanup(dir) { if (dir && path.basename(dir).startsWith('butcher-karaoke-cd-')) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); },
};
