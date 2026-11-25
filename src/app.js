

const $ = id => document.getElementById(id);
const fmt = s => { s = Math.max(0, s|0); return (s/60|0) + ':' + String(s%60).padStart(2,'0'); };
let msgTimer;
function toast(t, ms=4000){ try{ window.api.log('ui', t); }catch(e){} const m=$('msg'); m.textContent=t; m.style.display='block'; clearTimeout(msgTimer); msgTimer=setTimeout(()=>m.style.display='none', ms); }
function busy(on, text='Loading…'){ $('busy').textContent=text; $('busy').style.display=on?'flex':'none'; }

/* ================= AUDIO ENGINE =================
   Plays through the normal Windows sound path (shared mode). Windows converts
   to whatever sample rate the mixer runs at, so 44.1k vs 48k never matters. */
class Engine {
  constructor(){ this.ctx=null; this.gain=null; this.buffer=null; this.semis=0; this.playing=false;
    this.offset=0; this.node=null; this.shifter=null; this.gen=0; this.onended=null; this.volume=1; }
  ensure(){
    if(!this.ctx){
      this.ctx = new AudioContext({latencyHint:'playback'});
      this.gain = this.ctx.createGain(); this.gain.gain.value=this.volume; this.gain.connect(this.ctx.destination);
      applyOutput();
    }
    if(this.ctx.state==='suspended') this.ctx.resume();
    return this.ctx;
  }
  setVolume(v){ this.volume=v; if(this.gain) this.gain.gain.value=v; }
  load(buffer){ this.stopNodes(); this.buffer=buffer; this.offset=0; this.playing=false; }
  unload(){ this.stopNodes(); this.buffer=null; this.offset=0; this.playing=false; }
  get duration(){ return this.buffer ? this.buffer.duration : 0; }
  position(){
    if(!this.buffer) return 0;
    if(!this.playing) return this.offset;
    const now=this.ctx.currentTime;
    if(this.node) return Math.min(this.duration, this.offset + (now - this.startedAt));
    if(this.shifter){ const s=this.sh; return Math.max(0, Math.min(this.duration, s.pos + (now - s.at) - s.lat)); }
    return this.offset;
  }
  play(){ if(!this.buffer||this.playing) return; this.ensure(); if(this.offset>=this.duration-0.05) this.offset=0;
    this.startNodes(this.offset); this.playing=true; }
  pause(){ if(!this.playing) return; this.offset=this.position(); this.stopNodes(); this.playing=false; }
  seek(t){ t=Math.max(0,Math.min(this.duration-0.05,t)); const was=this.playing; if(was) this.stopNodes();
    this.offset=t; if(was) this.startNodes(t); }
  setKey(s){ const pos=this.position(); this.semis=s; if(this.playing){ this.stopNodes(); this.offset=pos; this.startNodes(pos); } }
  finish(gen){ if(gen!==this.gen || !this.playing) return; this.stopNodes(); this.playing=false; this.offset=this.duration; this.onended && this.onended(); }
  startNodes(off){
    const ctx=this.ctx, gen=++this.gen;
    if(this.semis===0){
      // untouched original audio when no key change
      const n=ctx.createBufferSource(); n.buffer=this.buffer; n.connect(this.gain);
      n.onended=()=>this.finish(gen);
      this.startedAt=ctx.currentTime; n.start(0, off); this.node=n;
    } else {
      let done=false;
      const sh=new PitchShifter(ctx, this.buffer, 4096, ()=>{ if(done) return; done=true; setTimeout(()=>this.finish(gen),0); });
      sh.pitchSemitones=this.semis;
      sh.percentagePlayed = off/this.duration;
      const lat = 4096/ctx.sampleRate;
      this.sh={pos:off, at:ctx.currentTime+lat, lat:0};
      sh.on('play', d=>{ if(gen===this.gen) this.sh={pos:d.timePlayed, at:ctx.currentTime, lat}; });
      sh.connect(this.gain); this.shifter=sh;
    }
  }
  stopNodes(){
    this.gen++;
    if(this.node){ this.node.onended=null; try{this.node.stop();}catch(e){} this.node.disconnect(); this.node=null; }
    if(this.shifter){ try{ this.shifter.node.onaudioprocess=null; this.shifter.disconnect(); }catch(e){} this.shifter=null; }
  }
}
const engine = new Engine();
document.addEventListener('pointerdown', ()=>engine.ensure(), {capture:true});

/* ================= CDG (CD+G lyrics) DECODER ================= */
class CDG {
  constructor(){ this.canvas=document.createElement('canvas'); this.canvas.width=300; this.canvas.height=216;
    this.c2=this.canvas.getContext('2d'); this.img=this.c2.createImageData(300,216); this.load(null); }
  load(bytes){ this.data=bytes; this.reset(); }
  reset(){ this.pix=new Uint8Array(300*216); this.pal=new Array(16).fill(0).map(()=>[0,0,0]);
    this.pos=0; this.hOff=0; this.vOff=0; this.dirty=true; }
  update(t){
    if(!this.data) return;
    const total=(this.data.length/24)|0, target=Math.max(0,Math.min(total, Math.floor(t*300)));
    if(target<this.pos) this.reset();
    while(this.pos<target){ this.packet(this.pos*24); this.pos++; }
    if(this.dirty) this.render();
  }
  packet(o){
    const d=this.data; if((d[o]&0x3F)!==9) return;
    const ins=d[o+1]&0x3F, p=o+4;
    switch(ins){
      case 1: this.pix.fill(d[p]&15); this.dirty=true; break;                       // memory preset
      case 2: { const c=d[p]&15; for(let y=0;y<216;y++) for(let x=0;x<300;x++)       // border preset
                  if(x<6||x>=294||y<12||y>=204) this.pix[y*300+x]=c; this.dirty=true; break; }
      case 6: this.tile(p,false); break;
      case 38: this.tile(p,true); break;
      case 20: this.scroll(p,false); break;
      case 24: this.scroll(p,true); break;
      case 30: case 31: { const base=ins===30?0:8;                                   // colour table
        for(let i=0;i<8;i++){ const hi=d[p+2*i], lo=d[p+2*i+1];
          this.pal[base+i]=[((hi&0x3C)>>2)*17, (((hi&3)<<2)|((lo&0x30)>>4))*17, (lo&15)*17]; }
        this.dirty=true; break; }
    }
  }
  tile(p,xor){
    const d=this.data, c0=d[p]&15, c1=d[p+1]&15, row=d[p+2]&0x1F, col=d[p+3]&0x3F;
    const x0=col*6, y0=row*12; if(x0+6>300||y0+12>216) return;
    for(let i=0;i<12;i++){ const bits=d[p+4+i]&0x3F;
      for(let j=0;j<6;j++){ const c=(bits>>(5-j))&1 ? c1 : c0, k=(y0+i)*300+x0+j;
        this.pix[k] = xor ? (this.pix[k]^c) : c; } }
    this.dirty=true;
  }
  scroll(p,copy){
    const d=this.data, color=d[p]&15, hs=d[p+1]&0x3F, vs=d[p+2]&0x3F;
    const hc=(hs&0x30)>>4, vc=(vs&0x30)>>4;
    this.hOff=Math.min(hs&7,5); this.vOff=Math.min(vs&15,11);
    const dx = hc===1?6 : hc===2?-6 : 0, dy = vc===1?12 : vc===2?-12 : 0;
    if(dx||dy){ const o=this.pix, n=new Uint8Array(300*216);
      for(let y=0;y<216;y++) for(let x=0;x<300;x++){
        let sx=x-dx, sy=y-dy;
        if(copy){ sx=(sx+300)%300; sy=(sy+216)%216; n[y*300+x]=o[sy*300+sx]; }
        else n[y*300+x] = (sx<0||sx>=300||sy<0||sy>=216) ? color : o[sy*300+sx]; }
      this.pix=n; }
    this.dirty=true;
  }
  render(){
    const a=this.img.data, pal=this.pal, pix=this.pix, ho=this.hOff, vo=this.vOff;
    for(let y=0;y<216;y++) for(let x=0;x<300;x++){
      let k;
      if(x<6||x>=294||y<12||y>=204) k=pix[y*300+x];
      else k=pix[Math.min(215,y+vo)*300+Math.min(299,x+ho)];
      const c=pal[k], i=(y*300+x)*4; a[i]=c[0]; a[i+1]=c[1]; a[i+2]=c[2]; a[i+3]=255; }
    this.c2.putImageData(this.img,0,0); this.dirty=false;
  }
}
const cdg = new CDG();

/* ================= ZIP READER (MP3+G zips) ================= */
async function readZip(bytes){
  const dv=new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n=bytes.byteLength;
  let eocd=-1; for(let i=n-22;i>=Math.max(0,n-65557);i--) if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
  if(eocd<0) throw new Error('Not a valid zip file');
  const cdOff=dv.getUint32(eocd+16,true), cdEnd=cdOff+dv.getUint32(eocd+12,true);
  const entries=[]; let p=cdOff;
  while(p+46<=cdEnd && dv.getUint32(p,true)===0x02014b50){
    const method=dv.getUint16(p+10,true), comp=dv.getUint32(p+20,true),
      nl=dv.getUint16(p+28,true), el=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), lo=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(bytes.subarray(p+46, p+46+nl));
    entries.push({name, method, comp, lo}); p+=46+nl+el+cl;
  }
  async function extract(e){
    const start=e.lo+30+dv.getUint16(e.lo+26,true)+dv.getUint16(e.lo+28,true);
    const raw=bytes.slice(start, start+e.comp);
    if(e.method===0) return raw;
    if(e.method===8) return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    throw new Error('Unsupported zip compression');
  }
  const find = ext => entries.find(e=>e.name.toLowerCase().endsWith(ext) && !e.name.includes('__MACOSX'));
  return { find, extract };
}

/* ================= LIBRARY =================
   The app keeps a saved index of every song folder (in the main process), so it opens
   instantly, then rescans connected folders in the background. Songs stay where they are. */
const AUDIO=['mp3','m4a','wav','ogg','flac'], VIDEO=['mp4','m4v','webm','mkv','mov'];
let library=new Map();   // key ("folderId|relative/path") -> song
let libList=[];
let folders=[];          // [{id,name,label,path,online,count}]
let rawFiles={};         // folderId -> [relative paths]
const ext = n => { const i=n.lastIndexOf('.'); return i<0?'':n.slice(i+1).toLowerCase(); };
const stripExt = n => { const i=n.lastIndexOf('.'); return i<0?n:n.slice(0,i); };
const readFile = key => window.api.read(key);
let nameOrder = localStorage.getItem('kp.nameOrder') || 'at';   // 'at' = Artist - Title, 'ta' = Title - Artist
let sortBy = localStorage.getItem('kp.sort') || 'artist';

/* "SC8123-05 - Patsy Cline - Crazy" -> {code:'SC8123-05', artist:'Patsy Cline', title:'Crazy'} */
const CODE_RE=/^[\[(]?([a-z]{1,8}[- ]?\d{2,}[a-z0-9]*(?:[-_. ]\d{1,3}[a-z]?)?)[\])]?\s*(?:[-_.]\s*)?/i;
function parseName(base){
  let s=base.replace(/_/g,' ').replace(/\s+/g,' ').trim(), code='';
  const m=s.match(CODE_RE);
  // only treat the start as a disc code if "Artist - Title" is still left after it (so "Matchbox 20 - Push" stays intact)
  if(m){ const rest=s.slice(m[0].length).trim(); if(rest.includes(' - ')){ code=m[1]; s=rest; } }
  const parts=s.split(/\s+-\s+/).map(x=>x.trim()).filter(Boolean);
  if(parts.length<2) return {code, artist:'', title:s};
  return nameOrder==='ta' ? {code, title:parts[0], artist:parts.slice(1).join(' - ')}
                          : {code, artist:parts[0], title:parts.slice(1).join(' - ')};
}
const displayName = s => s.artist ? s.artist+' - '+s.title : s.title;

function buildLibrary(){
  library=new Map();
  for(const f of folders){
    const groups=new Map();
    for(const rel of rawFiles[f.id]||[]){
      const e=ext(rel), base=stripExt(rel).toLowerCase(), key=f.id+'|'+rel;
      let g=groups.get(base); if(!g){ g={}; groups.set(base,g); }
      if(e==='zip') g.zip=key; else if(e==='cdg') g.cdg=key; else if(AUDIO.includes(e)) g.audio=key; else if(VIDEO.includes(e)) g.video=key;
    }
    const add=(key,type,parts)=>{
      const rel=key.slice(key.indexOf('|')+1), file=stripExt(rel.split('/').pop());
      const p=parseName(file), folder=f.name+(rel.includes('/')?' › '+rel.split('/').slice(0,-1).join(' › '):'');
      library.set(key,{path:key,type,...parts,...p,name:displayName(p),folder,online:f.online,
        search:(p.artist+' '+p.title+' '+p.code+' '+rel).toLowerCase()});
    };
    for(const g of groups.values()){
      if(g.zip) add(g.zip,'zip',{zip:g.zip});
      if(g.audio && g.cdg) add(g.audio,'mp3g',{audio:g.audio,cdg:g.cdg});
      else if(g.audio && !g.zip) add(g.audio,'audio',{audio:g.audio});
      if(g.video) add(g.video,'video',{video:g.video});
    }
  }
  sortLibrary();
  updateLibStatus(); doSearch(); renderPlaylist();
}
function sortLibrary(){
  const c=(a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});
  libList=[...library.values()].sort(sortBy==='title'
    ? (a,b)=>c(a.title,b.title)||c(a.artist,b.artist)
    : (a,b)=>c(a.artist||'￿',b.artist||'￿')||c(a.title,b.title));
  $('sortArtist').classList.toggle('active',sortBy==='artist'); $('sortTitle').classList.toggle('active',sortBy==='title');
}
$('sortArtist').onclick=()=>{ sortBy='artist'; localStorage.setItem('kp.sort',sortBy); sortLibrary(); doSearch(); };
$('sortTitle').onclick=()=>{ sortBy='title'; localStorage.setItem('kp.sort',sortBy); sortLibrary(); doSearch(); };

let scanNote='';
function updateLibStatus(){
  const off=folders.filter(f=>!f.online);
  let t=libList.length.toLocaleString()+' songs';
  if(scanNote) t+=' · '+scanNote;
  $('status').textContent=t;
  $('offline').style.display=off.length?'':'none';
  $('offline').textContent=off.length ? '⚠ Not plugged in: '+off.map(f=>f.label||f.name).join(', ') : '';
}
window.api.onScanProgress((name,n)=>{ scanNote='checking '+name+'… '+n.toLocaleString()+' files'; updateLibStatus(); });

async function loadIndex(){
  const r=await window.api.libGet(); folders=r.folders; rawFiles=r.files; buildLibrary(); renderFolders();
}
async function rescan(id, quietIfNoChange){
  scanNote='checking for new songs…'; updateLibStatus();
  try{
    const before=libList.length, {added,removed}=await window.api.libScan(id);
    await loadIndex();
    window.api.log('info','scan done: '+libList.length+' songs, +'+added+'/-'+removed+' files, folders: '+folders.map(f=>f.name+(f.online?'':' (offline)')).join(', '));
    const diff=libList.length-before;
    if(added||removed) toast(diff>0 ? 'Library updated: '+diff.toLocaleString()+' new songs' : diff<0 ? 'Library updated: '+(-diff).toLocaleString()+' songs no longer found' : 'Library updated',5000);
    else if(!quietIfNoChange) toast('Library is up to date',2500);
  }catch(e){ toast('Scan problem: '+e.message,6000); }
  scanNote=''; updateLibStatus();
}
// when a song drive gets plugged in later, notice it and bring its songs back
setInterval(async()=>{
  if(!folders.some(f=>!f.online)) return;
  const st=await window.api.libStatus();
  const back=st.filter(f=>f.online && !folders.find(x=>x.id===f.id&&x.online));
  if(back.length){ folders=st; toast('Song drive connected: '+back.map(f=>f.label||f.name).join(', '),4000); buildLibrary(); renderFolders(); rescan(null,true); }
}, 15000);

/* Song Folders window */
function renderFolders(){
  const box=$('folderList'); box.innerHTML='';
  if(!folders.length){ box.innerHTML='<div class="empty">No song folders yet. Click “+ Add Folder” and pick the karaoke drive (or a folder on it).</div>'; return; }
  for(const f of folders){
    const r=document.createElement('div'); r.className='row';
    r.innerHTML=`<span title="${f.online?'Connected':'Not plugged in'}">${f.online?'🟢':'⚪'}</span><div class="name"><div></div><div class="meta"></div></div><button>Remove</button>`;
    r.querySelector('.name div').textContent=f.name+(f.label&&f.label!==f.name?'  ('+f.label+')':'');
    r.querySelector('.meta').textContent=(f.online?f.path:'Not plugged in — last seen at '+f.path)+' · '+f.count.toLocaleString()+' files';
    r.querySelector('button').onclick=async()=>{ if(!confirm('Remove "'+f.name+'" from the library? (The song files are not deleted.)')) return;
      await window.api.libRemove(f.id); await loadIndex(); };
    box.appendChild(r);
  }
}
$('btnFolder').onclick=()=>{ renderFolders(); $('nameOrder').value=nameOrder; $('foldersModal').style.display='flex'; };
$('btnCloseFolders').onclick=()=>{ $('foldersModal').style.display='none'; };
$('btnAddFolder').onclick=async()=>{
  const dir=await window.api.pickFolder(); if(!dir) return;
  const id=await window.api.libAdd(dir);
  if(!id){ toast('That folder is already in the library.'); return; }
  await loadIndex(); busy(true,'Reading songs… this can take a few minutes the first time on a big drive');
  await rescan(id,true); busy(false);
};
$('btnRescan').onclick=()=>rescan(null,false);
$('nameOrder').onchange=e=>{ nameOrder=e.target.value; localStorage.setItem('kp.nameOrder',nameOrder); buildLibrary(); };

/* ================= SEARCH ================= */
const typeLabel={zip:'MP3+G',mp3g:'MP3+G',video:'Video',audio:'Audio only'};
function doSearch(){
  const words=$('q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const res=[]; let n=0;
  for(const s of libList){ if(words.every(w=>s.search.includes(w))){ n++; if(res.length<300) res.push(s); } }
  $('count').textContent = libList.length ? (n.toLocaleString()+' match'+(n===1?'':'es')+(n>300?' — showing first 300, type more to narrow it down':'')) : '';
  if(!libList.length) return;
  const box=$('results'); box.innerHTML='';
  if(!res.length){ box.innerHTML='<div class="empty">No songs match that search</div>'; return; }
  for(const s of res){
    const r=document.createElement('div'); r.className='row'+(s.online?'':' missing');
    r.innerHTML=`<div class="name"><div class="t"></div><div class="folder"></div></div>${s.code?'<span class="tag code"></span>':''}<span class="tag">${typeLabel[s.type]}</span><button>Add</button>`;
    r.querySelector('.t').textContent=s.title;
    r.querySelector('.folder').textContent=(s.artist||'')+(s.artist?'  ·  ':'')+s.folder;
    if(s.code) r.querySelector('.code').textContent=s.code;
    r.querySelector('button').onclick=()=>addToPlaylist(s);
    r.ondblclick=()=>addToPlaylist(s);
    box.appendChild(r);
  }
}
let st; $('q').oninput=()=>{ clearTimeout(st); st=setTimeout(doSearch,150); };

/* ================= PLAYLIST (saved automatically) ================= */
let playlist=[]; try{ playlist=JSON.parse(localStorage.getItem('kp.playlist')||'[]'); }catch(e){}
let currentId=null;
const save=()=>{ try{ localStorage.setItem('kp.playlist', JSON.stringify(playlist)); }catch(e){} };
const uid=()=>Math.random().toString(36).slice(2,10);
function addToPlaylist(s){ playlist.push({id:uid(), path:s.path, name:s.name, key:0, played:false}); save(); renderPlaylist(); toast('Added: '+s.name,1500); }
const keyText = k => k===0 ? 'Original key' : (k>0?'+':'')+k;
function renderPlaylist(){
  const box=$('playlist'); box.innerHTML='';
  if(!playlist.length){ box.innerHTML='<div class="empty">Playlist is empty.<br>Search for a song on the left and click Add.</div>'; return; }
  playlist.forEach((it,i)=>{
    const s = library.get(it.path), miss = libList.length && (!s || !s.online);
    const r=document.createElement('div');
    r.className='row'+(it.id===currentId?' current':'')+(it.played?' played':'')+(miss?' missing':'');
    r.innerHTML=`<span class="num">${it.played?'✓':i+1}</span><button title="Sing this song now">▶</button>
      <div class="name"><div></div></div>${it.key?`<span class="keytag">Key ${keyText(it.key)}</span>`:''}
      <button title="Move up">▲</button><button title="Move down">▼</button><button title="Remove">✕</button>`;
    r.querySelector('.name div').textContent=it.name+(miss?(s?'  (drive not plugged in)':'  (file not found)'):'');
    const b=r.querySelectorAll('button');
    b[0].onclick=()=>playItem(it);
    b[1].onclick=()=>{ if(i>0){ [playlist[i-1],playlist[i]]=[playlist[i],playlist[i-1]]; save(); renderPlaylist(); } };
    b[2].onclick=()=>{ if(i<playlist.length-1){ [playlist[i+1],playlist[i]]=[playlist[i],playlist[i+1]]; save(); renderPlaylist(); } };
    b[3].onclick=()=>{ if(it.id===currentId) stopSong(); playlist.splice(i,1); save(); renderPlaylist(); };
    box.appendChild(r);
  });
}
$('btnClearPlayed').onclick=()=>{ playlist=playlist.filter(i=>!i.played||i.id===currentId); save(); renderPlaylist(); };
$('btnClearAll').onclick=()=>{ if(confirm('Remove every song from the playlist?')){ stopSong(); playlist=[]; save(); renderPlaylist(); } };

/* ================= PLAYBACK ================= */
const video=$('video'), pCanvas=$('previewCanvas');
let song=null;          // {item, kind:'cdg'|'video'|'audio', videoAudio:'engine'|'element'}
let videoUrl=null;

function current(){ return playlist.find(i=>i.id===currentId); }
function nextItem(){ const i=playlist.findIndex(x=>x.id===currentId);
  return playlist.slice(i+1).find(x=>!x.played) || playlist.find(x=>!x.played && x.id!==currentId); }

async function decode(bytes){ const ctx=engine.ensure(); return await ctx.decodeAudioData(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength) : bytes); }

async function playItem(it){
  const s=library.get(it.path); if(!s){ toast('That song file was not found in the library.'); return; }
  if(!s.online){ toast('That song is on a drive that isn’t plugged in.'); return; }
  stopSong(true);
  busy(true,'Loading '+s.name+'…');
  window.api.log('info', 'play: '+s.name+' ['+s.type+'] key '+it.key+' — '+s.path);
  try{
    let buf=null, cdgBytes=null, kind='cdg', videoAudio='engine';
    if(s.type==='zip'){
      const z=await readZip(await readFile(s.zip));
      const a=z.find('.mp3')||z.find('.m4a')||z.find('.wav')||z.find('.ogg'), c=z.find('.cdg');
      if(!a) throw new Error('No audio file inside this zip');
      buf=await decode(await z.extract(a)); if(c) cdgBytes=await z.extract(c); else kind='audio';
    } else if(s.type==='mp3g'){
      const [a,c]=await Promise.all([readFile(s.audio), readFile(s.cdg)]);
      buf=await decode(a); cdgBytes=c;
    } else if(s.type==='audio'){
      buf=await decode(await readFile(s.audio)); kind='audio';
    } else {
      kind='video'; const bytes=await readFile(s.video);
      videoUrl=URL.createObjectURL(new Blob([bytes])); video.src=videoUrl;
      try{ buf=await decode(bytes); video.muted=true; }
      catch(e){ videoAudio='element'; video.muted=false; }
      if(video.readyState<1) await new Promise((res,rej)=>{ video.onloadedmetadata=res; video.onerror=()=>rej(new Error('This video format can’t be played')); });
    }
    cdg.load(cdgBytes);
    if(buf) engine.load(buf); else engine.unload();
    song={item:it, kind, videoAudio};
    currentId=it.id; engine.semis = videoAudio==='element' ? 0 : it.key;
    video.style.display = kind==='video' ? 'block':'none'; pCanvas.style.display = kind==='video' ? 'none':'block';
    $('np').textContent=it.name;
    $('btnPlay').disabled=false; $('btnStop').disabled=false;
    updateKeyUI(); renderPlaylist();
    busy(false);
    play();
  }catch(e){
    busy(false); song=null; currentId=null; renderPlaylist();
    window.api.log('error', 'could not play '+s.path+': '+(e&&e.stack||e));
    toast('Could not play "'+s.name+'": '+e.message, 6000);
  }
}
function usesElement(){ return song && song.kind==='video' && song.videoAudio==='element'; }
function isPlaying(){ return usesElement() ? !video.paused : engine.playing; }
function pos(){ return usesElement() ? video.currentTime : engine.position(); }
function dur(){ return usesElement() ? (video.duration||0) : engine.duration; }
function play(){ if(!song) return; engine.ensure();
  if(usesElement()) video.play(); else { engine.play(); if(song.kind==='video'){ video.currentTime=engine.position(); video.play().catch(()=>{}); } }
  const it=current(); if(it && !it.played){ it.played=true; save(); renderPlaylist(); }
  if(rec.armed && !rec.active) startRecording(song.item.name);
  recAudioStop();
  $('btnPlay').textContent='❚❚'; }
function pause(){ if(usesElement()) video.pause(); else { engine.pause(); if(song&&song.kind==='video') video.pause(); } $('btnPlay').textContent='▶'; }
function stopSong(silent){
  stopRecording();
  engine.unload(); video.pause(); video.removeAttribute('src'); video.load();
  if(videoUrl){ URL.revokeObjectURL(videoUrl); videoUrl=null; }
  cdg.load(null); song=null; currentId=null;
  video.style.display='none'; pCanvas.style.display='block';
  $('np').textContent='Nothing playing'; $('btnPlay').textContent='▶'; $('btnPlay').disabled=true; $('btnStop').disabled=true;
  updateKeyUI(); if(!silent) renderPlaylist();
}
function seek(t){ if(!song) return; if(usesElement()) video.currentTime=t; else { engine.seek(t); if(song.kind==='video') video.currentTime=engine.position(); } }
function songEnded(){
  const n=nextItem(); stopSong();
  if($('auto').checked && n) playItem(n);
}
engine.onended=songEnded;
video.onended=()=>{ if(usesElement()) songEnded(); };

$('btnPlay').onclick=()=>{ isPlaying()?pause():play(); };
$('btnStop').onclick=()=>stopSong();
$('btnNext').onclick=()=>{ const n=nextItem(); if(n) playItem(n); else toast('No more songs on the playlist'); };
$('bar').onclick=e=>{ if(!song) return; const r=e.currentTarget.getBoundingClientRect(); seek((e.clientX-r.left)/r.width*dur()); };
$('vol').oninput=e=>{ const v=e.target.value/100; engine.setVolume(v); video.volume=v; recAudio.volume=v; localStorage.setItem('kp.vol',e.target.value); };
$('vol').value=localStorage.getItem('kp.vol')||100; engine.setVolume($('vol').value/100); video.volume=$('vol').value/100;
$('auto').checked=localStorage.getItem('kp.auto')==='1'; $('auto').onchange=e=>localStorage.setItem('kp.auto',e.target.checked?'1':'0');

/* key change */
function updateKeyUI(){
  const it=current(); const k=it?it.key:0; const disabled=!song||usesElement();
  $('keyVal').textContent = k===0?'0':(k>0?'+':'')+k;
  $('keyUp').disabled=disabled||k>=6; $('keyDown').disabled=disabled||k<=-6;
  $('keyUp').title=$('keyDown').title = usesElement() ? 'Key change isn’t available for this video file' : '';
}
function changeKey(d){ const it=current(); if(!it||usesElement()) return; it.key=Math.max(-6,Math.min(6,it.key+d)); save();
  engine.setKey(it.key); updateKeyUI(); renderPlaylist(); }
$('keyUp').onclick=()=>changeKey(1); $('keyDown').onclick=()=>changeKey(-1);

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT' && e.target.type==='text') return;
  if(e.code==='Space'){ e.preventDefault(); if(song) $('btnPlay').click(); }
});

/* ================= OUTPUT DEVICE (the mixer) ================= */
async function listOutputs(){
  const sel=$('outDev'), saved=localStorage.getItem('kp.outLabel')||'';
  let devs=[]; try{ devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput' && d.deviceId!=='default' && d.deviceId!=='communications'); }catch(e){}
  sel.innerHTML='<option value="">Windows default</option>';
  for(const d of devs){ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||'Sound device'; sel.appendChild(o); }
  const match=devs.find(d=>d.label===saved);
  sel.value = match ? match.deviceId : '';
  if(saved && !match) $('outDev').title='The saved device ('+saved+') is not plugged in — using Windows default';
  applyOutput();
}
async function applyOutput(){
  const id=$('outDev').value;
  try{ if(engine.ctx && engine.ctx.setSinkId) await engine.ctx.setSinkId(id); }catch(e){ toast('Could not switch sound output: '+e.message); }
  try{ if(video.setSinkId) await video.setSinkId(id); }catch(e){}
  try{ if(recAudio.setSinkId) await recAudio.setSinkId(id); }catch(e){}
}
$('outDev').onchange=()=>{ const o=$('outDev').selectedOptions[0]; window.api.log('info','sound to: '+o.textContent); localStorage.setItem('kp.outLabel', o.value? o.textContent : ''); $('outDev').title='Pick the mixer here'; applyOutput(); };
if(navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', ()=>{ listOutputs(); listInputs(); });

/* ================= RECORDING =================
   Records the mixer's USB input (its main mix: the mic with the mixer's effects plus the
   karaoke track) and saves an MP3 to Documents\Karaoke Recordings. */
const rec = { stream:null, src:null, node:null, mute:null, analyser:null, worker:null, active:false, started:0,
  title:'', armed: localStorage.getItem('kp.rec')==='1', pending:[], workletReady:false, level:0 };
const recAudio = new Audio();
let recPlaying=null;

async function listInputs(){
  const sel=$('inDev'), saved=localStorage.getItem('kp.inLabel')||'', before=sel.value;
  let devs=[]; try{ devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput' && d.deviceId!=='default' && d.deviceId!=='communications'); }catch(e){}
  sel.innerHTML='<option value="">— none —</option>';
  for(const d of devs){ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||'Recording device'; sel.appendChild(o); }
  const match=devs.find(d=>d.label===saved);
  sel.value = match ? match.deviceId : '';
  if(sel.value!==before || !rec.stream) openInput();
}
$('inDev').onchange=()=>{ const o=$('inDev').selectedOptions[0]; window.api.log('info','record from: '+o.textContent); localStorage.setItem('kp.inLabel', o.value? o.textContent : ''); openInput(); };

async function openInput(){
  closeInput();
  const id=$('inDev').value; if(!id) return;
  const ctx=engine.ensure();
  try{
    rec.stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:id}, echoCancellation:false,
      noiseSuppression:false, autoGainControl:false, channelCount:{ideal:2}}});
    if(!rec.workletReady){ await ctx.audioWorklet.addModule('recorder-worklet.js'); rec.workletReady=true; }
  }catch(e){ rec.stream=null; toast('Could not open the recording input: '+e.message, 6000); return; }
  rec.src=ctx.createMediaStreamSource(rec.stream);
  rec.analyser=ctx.createAnalyser(); rec.analyser.fftSize=1024; rec.src.connect(rec.analyser);
  rec.node=new AudioWorkletNode(ctx,'capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit'});
  rec.src.connect(rec.node);
  rec.mute=ctx.createGain(); rec.mute.gain.value=0; rec.node.connect(rec.mute); rec.mute.connect(ctx.destination); // keeps it running, silent
  rec.node.port.onmessage=e=>{ if(rec.active) rec.worker.postMessage({type:'data', l:e.data[0], r:e.data[1]}, [e.data[0].buffer, e.data[1].buffer]); };
  rec.stream.getAudioTracks()[0].onended=()=>{ toast('The recording input was disconnected.', 6000); closeInput(); };
}
function closeInput(){
  stopRecording();
  try{ rec.src&&rec.src.disconnect(); rec.node&&rec.node.disconnect(); rec.mute&&rec.mute.disconnect(); }catch(e){}
  if(rec.stream) rec.stream.getTracks().forEach(t=>t.stop());
  rec.stream=rec.src=rec.node=rec.analyser=rec.mute=null;
}

function startRecording(title){
  if(!rec.node){ toast('Recording is on, but no input is picked. Choose the mixer under "Record from".', 7000); return false; }
  if(!rec.worker){ rec.worker=new Worker('mp3-worker.js'); rec.worker.onmessage=e=>finishSave(e.data); }
  rec.worker.postMessage({type:'start', sampleRate:engine.ctx.sampleRate});
  rec.node.port.postMessage('start');
  rec.active=true; rec.started=performance.now(); rec.title=title;
  updateRecUI(); return true;
}
function stopRecording(){
  if(!rec.active) return;
  rec.active=false; if(rec.node) rec.node.port.postMessage('stop');
  const secs=(performance.now()-rec.started)/1000;
  rec.pending.push({title:rec.title, keep:secs>=3});   // throw away accidental 1–2 second takes
  rec.worker.postMessage({type:'stop'});
  updateRecUI();
}
async function finishSave(bytes){
  const job=rec.pending.shift(); if(!job || !job.keep) return;
  try{ const name=await window.api.recSave(job.title, bytes); toast('Recording saved: '+name, 5000);
    if($('recView').style.display!=='none') showRecordings(); }
  catch(e){ noteError('could not save recording: '+(e.stack||e)); toast('Could not save the recording: '+e.message, 8000); }
}
function updateRecUI(){
  $('btnRec').classList.toggle('on', rec.armed);
  $('btnRec').textContent = rec.armed ? '● REC ON' : '● REC';
  if(!rec.active) $('recInfo').textContent='';
}
$('btnRec').onclick=()=>{
  rec.armed=!rec.armed; localStorage.setItem('kp.rec', rec.armed?'1':'0');
  if(rec.armed && song && isPlaying() && !rec.active) startRecording(song.item.name);
  if(!rec.armed) stopRecording();
  updateRecUI();
};
const meterBuf=new Float32Array(1024);
function recTick(){
  if(rec.active) $('recInfo').textContent='● REC '+fmt((performance.now()-rec.started)/1000);
  let peak=0;
  if(rec.analyser){ rec.analyser.getFloatTimeDomainData(meterBuf); for(let i=0;i<meterBuf.length;i++){ const v=Math.abs(meterBuf[i]); if(v>peak) peak=v; } }
  rec.level=Math.max(peak, rec.level*0.9);
  $('meterFill').style.width=Math.min(100, rec.level*100)+'%';
}

/* Recordings tab */
function showTab(which){
  const recs=which==='rec';
  $('libView').style.display=recs?'none':''; $('recView').style.display=recs?'':'none';
  $('tabLib').classList.toggle('active',!recs); $('tabRec').classList.toggle('active',recs);
  $('btnRecFolder').style.display=recs?'':'none';
  if(recs) showRecordings();
}
$('tabLib').onclick=()=>showTab('lib'); $('tabRec').onclick=()=>showTab('rec');
$('btnRecFolder').onclick=()=>window.api.recFolder();
function recAudioStop(){ recAudio.pause(); if(recAudio.src){ URL.revokeObjectURL(recAudio.src); recAudio.removeAttribute('src'); } recPlaying=null; }
recAudio.onended=()=>{ recAudioStop(); showRecordings(); };
async function showRecordings(){
  const box=$('recList'); const list=await window.api.recList();
  box.innerHTML='';
  if(!list.length){ box.innerHTML='<div class="empty">No recordings yet.<br>Pick the mixer under "Record from", turn on ● REC, and sing a song.</div>'; return; }
  for(const r of list){
    const row=document.createElement('div'); row.className='row';
    const playing=recPlaying===r.name;
    row.innerHTML=`<button title="${playing?'Stop':'Listen'}">${playing?'■':'▶'}</button><div class="name"><div></div><div class="meta"></div></div>
      <button title="Show in folder">📂</button><button title="Delete (moves it to the Recycle Bin)">🗑</button>`;
    row.querySelector('.name div').textContent=r.name.replace(/\.(mp3|wav|webm)$/i,'');
    row.querySelector('.meta').textContent=new Date(r.time).toLocaleString()+' · '+(r.size/1048576).toFixed(1)+' MB';
    const b=row.querySelectorAll('button');
    b[0].onclick=async()=>{
      if(playing){ recAudioStop(); return showRecordings(); }
      if(song && isPlaying()) pause();
      recAudioStop();
      const bytes=await window.api.recRead(r.name);
      recAudio.src=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'})); recPlaying=r.name;
      recAudio.volume=$('vol').value/100; recAudio.play(); showRecordings();
    };
    b[1].onclick=()=>window.api.recShow(r.name);
    b[2].onclick=async()=>{ if(!confirm('Move "'+r.name+'" to the Recycle Bin?')) return;
      if(recPlaying===r.name) recAudioStop(); await window.api.recDelete(r.name); showRecordings(); };
    box.appendChild(row);
  }
}

/* ================= TV SCREEN ================= */
let tv=null, tvCanvas=null;
function openTV(){
  if(tv && !tv.closed){ tv.focus(); return; }
  tv=window.open('','karaoke_tv');
  if(!tv){ toast('Could not open the TV screen.'); return; }
  tv.document.open();
  tv.document.write(`<!DOCTYPE html><title>Karaoke – TV Screen</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
    canvas{width:100%;height:100%;display:block}</style><canvas id="c"></canvas>
    <div id="h" style="position:fixed;left:0;right:0;bottom:20px;text-align:center;color:#888;font:18px Segoe UI,sans-serif">Double-click to go full screen</div>`);
  tv.document.close();
  tvCanvas=tv.document.getElementById('c');
  const hint=tv.document.getElementById('h');
  const syncHint=()=>{ const fs=!!tv.document.fullscreenElement || (tv.innerHeight>=tv.screen.height-2 && tv.innerWidth>=tv.screen.width-2);
    hint.style.display=fs?'none':''; tv.document.body.style.cursor=fs?'none':''; };
  tv.document.addEventListener('dblclick',()=>{ const d=tv.document; if(d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen().catch(()=>{}); });
  tv.addEventListener('resize',syncHint); setTimeout(syncHint,300);
  const loop=()=>{ if(tv && !tv.closed){ tick(); tv.requestAnimationFrame(loop); } }; tv.requestAnimationFrame(loop);
}
$('btnTV').onclick=openTV;

function fit(ctx, W, H, src, sw, sh, smooth){
  const s=Math.min(W/sw, H/sh), w=sw*s, h=sh*s;
  ctx.imageSmoothingEnabled=smooth; ctx.drawImage(src,(W-w)/2,(H-h)/2,w,h);
}
function drawScreen(canvas){
  const W=canvas.width, H=canvas.height, c=canvas.getContext('2d');
  c.fillStyle='#000'; c.fillRect(0,0,W,H);
  if(song && song.kind==='video' && video.videoWidth){ fit(c,W,H,video,video.videoWidth,video.videoHeight,true); return; }
  if(song && song.kind==='cdg'){ fit(c,W,H,cdg.canvas,300,216,false); return; }
  c.textAlign='center'; c.fillStyle='#fff';
  if(song){ c.font=`600 ${H/12|0}px Segoe UI,sans-serif`; wrapText(c, song.item.name, W/2, H/2, W*0.9, H/10); return; }
  const n=nextItem();
  c.fillStyle='#f2b134'; c.font=`600 ${H/10|0}px Segoe UI,sans-serif`; c.fillText('🎤 Karaoke', W/2, H*0.38);
  if(n){ c.fillStyle='#fff'; c.font=`${H/18|0}px Segoe UI,sans-serif`; c.fillText('Up next', W/2, H*0.55);
    c.fillStyle='#fff'; c.font=`600 ${H/14|0}px Segoe UI,sans-serif`; wrapText(c, n.name, W/2, H*0.66, W*0.9, H/12); }
}
function wrapText(c, t, x, y, maxW, lh){
  const words=t.split(' '), lines=[]; let l='';
  for(const w of words){ const tl=l?l+' '+w:w; if(c.measureText(tl).width>maxW && l){ lines.push(l); l=w; } else l=tl; }
  lines.push(l); lines.slice(0,3).forEach((ln,i)=>c.fillText(ln,x,y+i*lh));
}

/* ================= MAIN LOOP ================= */
let lastTick=0;
function tick(){
  const now=performance.now(); if(now-lastTick<12) return; lastTick=now;
  const p=pos(), d=dur();
  if(song){
    if(song.kind==='cdg') cdg.update(p);
    if(song.kind==='video' && !usesElement()){
      if(engine.playing){ if(video.paused) video.play().catch(()=>{}); if(Math.abs(video.currentTime-p)>0.3) video.currentTime=p; }
      else if(!video.paused) video.pause();
    }
  }
  $('fill').style.width = d? (p/d*100)+'%' : '0';
  recTick();
  $('tCur').textContent=fmt(p); $('tDur').textContent=fmt(d);
  if(song) $('btnPlay').textContent = isPlaying()?'❚❚':'▶';
  if(pCanvas.style.display!=='none') drawScreen(pCanvas);
  if(tv && !tv.closed && tvCanvas){
    const dpr=tv.devicePixelRatio||1, W=Math.round(tv.innerWidth*dpr), H=Math.round(tv.innerHeight*dpr);
    if(tvCanvas.width!==W||tvCanvas.height!==H){ tvCanvas.width=W; tvCanvas.height=H; }
    drawScreen(tvCanvas);
  }
}
(function loop(){ tick(); requestAnimationFrame(loop); })();
setInterval(tick, 250); // keeps going even if this window is minimized
window.addEventListener('beforeunload', ()=>{ if(tv && !tv.closed) tv.close(); });

renderPlaylist(); updateKeyUI(); listOutputs(); listInputs(); updateRecUI();
(async()=>{
  await loadIndex();
  if(!folders.length){ $('btnFolder').click(); } else rescan(null,true);   // opens instantly, then checks for new songs
  if(await window.api.hasTV()) openTV();   // TV plugged in: put lyrics screen on it right away
  document.title='Karaoke Player '+(await window.api.version());
})();
/* ================= UPDATES =================
   New versions download in the background from GitHub. They install when the app is closed,
   so an update never interrupts a song. "Restart and update now" installs right away. */
window.api.onUpdateReady(v=>{
  $('updateText').textContent='A new version ('+v+') is ready. It installs automatically next time the app is closed.';
  $('update').style.display='flex';
});
$('btnUpdate').onclick=()=>{
  if(song && isPlaying() && !confirm('A song is playing. Stop it and restart to update now?')) return;
  stopSong(); window.api.installUpdate();
};

/* ================= PROBLEM REPORTS ================= */
let errorCount=0;
function noteError(msg){
  errorCount++; window.api.log('error', msg);
  $('btnReport').classList.add('alert'); $('btnReport').textContent='⚠ Report a Problem ('+errorCount+')';
}
window.addEventListener('error', e=>noteError('page error: '+(e.error&&e.error.stack||e.message)+' @ '+e.filename+':'+e.lineno));
window.addEventListener('unhandledrejection', e=>noteError('page error (promise): '+(e.reason&&e.reason.stack||e.reason)));
window.__kpState=()=>({
  songs: libList.length,
  folders: folders.map(f=>({name:f.name, online:f.online, files:f.count})),
  playing: song ? {name:song.item.name, kind:song.kind, key:song.item.key, at:Math.round(pos())+'s of '+Math.round(dur())+'s'} : null,
  playlist: playlist.length, soundTo: $('outDev').selectedOptions[0]?.textContent, recordFrom: $('inDev').selectedOptions[0]?.textContent,
  recording: rec.active, recordArmed: rec.armed, outputRate: engine.ctx ? engine.ctx.sampleRate : null,
  tvOpen: !!(tv && !tv.closed), errorsThisSession: errorCount,
});
$('btnReport').onclick=()=>{ $('reportText').value=''; $('reportStatus').textContent=''; $('btnReportSend').disabled=false; $('reportModal').style.display='flex'; $('reportText').focus(); };
$('btnReportCancel').onclick=()=>{ $('reportModal').style.display='none'; };
$('btnLogs').onclick=()=>window.api.openLogs();
$('btnReportSend').onclick=async()=>{
  $('btnReportSend').disabled=true; $('reportStatus').textContent='Sending…';
  const r=await window.api.sendReport({ description:$('reportText').value.trim(), state:window.__kpState(), kind:'report' });
  if(r.ok){ $('reportStatus').textContent='✓ Sent. Thank you!'; errorCount=0; $('btnReport').classList.remove('alert'); $('btnReport').textContent='⚠ Report a Problem';
    setTimeout(()=>{ $('reportModal').style.display='none'; },1500); }
  else { $('reportStatus').textContent = /not set up/.test(r.reason||'')
      ? 'Saved on this computer. (Sending isn’t set up in this version yet; it will go out after the next update.)'
      : 'Saved. It will send automatically next time there is internet.';
    $('btnReportSend').disabled=false; }
};

window.__kp={engine,cdg,library:()=>library,playItem,playlist:()=>playlist,loadIndex,rescan,parseName,song:()=>song,tv:()=>tv,rec};
