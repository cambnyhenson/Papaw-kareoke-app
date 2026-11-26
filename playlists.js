// Saved playlists (custom lists like "Elvis", "E Gospel"), plus importing Show Presenter Pro's data.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const file = () => path.join(app.getPath('userData'), 'playlists.json');
const namesFile = () => path.join(app.getPath('userData'), 'spp-names.json');
const SPP_DB = process.env.KP_SPP_DB || 'C:\\ProgramData\\Digital Entertainer Limited\\Show Presenter Pro\\songlist.mdb';

async function writeAtomic(f, data) { const tmp = f + '.tmp'; await fsp.writeFile(tmp, data); await fsp.rename(tmp, f); }

module.exports = {
  async get() { try { return JSON.parse(await fsp.readFile(file(), 'utf8')); } catch { return { lists: [] }; } },
  async save(data) { await writeAtomic(file(), JSON.stringify(data)); return true; },

  /** Show Presenter's artist/title for every song path it knew (lower-case full path -> [artist, title, disc]). */
  async names() { try { return JSON.parse(await fsp.readFile(namesFile(), 'utf8')); } catch { return null; } },

  sppFound() { return fs.existsSync(SPP_DB); },

  /** Read Show Presenter Pro's database. Its "singer" names are used as playlist names. */
  async importSpp(dbPath = SPP_DB) {
    const MDBReader = require('mdb-reader').default || require('mdb-reader');
    const db = new MDBReader(await fsp.readFile(dbPath));
    const tables = new Set(db.getTableNames());
    const rows = t => tables.has(t) ? db.getTable(t).getData() : [];
    const item = (p, artist, title, disc, key) => ({ full: String(p || ''), artist: artist || '', title: title || '', disc: disc || '', key: Number(key) || 0 });

    const lists = new Map(); // name -> {items, seen}
    const add = (name, it) => {
      name = String(name || '').trim() || 'No name';
      if (!lists.has(name)) lists.set(name, { items: [], seen: new Set() });
      const l = lists.get(name), k = it.full.toLowerCase();
      if (!it.full || l.seen.has(k)) return;
      l.seen.add(k); l.items.push(it);
    };
    // Saved Show Presenter playlists, if any
    const pl = new Map(rows('tblPlayLists').map(r => [r.PlayListID, r.PlayListName]));
    for (const r of rows('tblPlayListsSongs').sort((a, b) => a.SongPosition - b.SongPosition))
      add(pl.get(r.PlayListID) || 'Show Presenter playlist', item(r.SongPath, r.Artist, r.Title, r.DiscId, r.SongKey));
    // The queue, then the history, grouped by the name typed as "singer"
    for (const r of rows('tblQueue').sort((a, b) => a.QueuePos - b.QueuePos))
      add(r.PerformerName, item(r.TrackPath, r.ArtistName, r.TrackName, r.DiscName, r.SongKey));
    for (const r of rows('tblKaraokeTrackHistory').sort((a, b) => a.KaraokeTrackHistoryID - b.KaraokeTrackHistoryID))
      add(r.SingerName, item(r.TrackPath, r.Artist, r.Title, r.DiscName, r.SongKey));

    // Show Presenter's song names, to show artist/title correctly in the library
    const names = {};
    for (const r of rows('tblKaraokeTracks')) if (r.TrackPath) names[String(r.TrackPath).toLowerCase()] = [r.ArtistName || '', r.TrackName || '', r.DiscName || ''];
    await writeAtomic(namesFile(), JSON.stringify(names));

    return { playlists: [...lists].map(([name, l]) => ({ name, items: l.items })), names: Object.keys(names).length };
  },
};
