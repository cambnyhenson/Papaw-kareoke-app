# Karaoke Player

A simple Windows karaoke show player built for one person: Grandpa.

- **Big libraries**: add one or more song folders or whole drives. Songs are read in place
  (nothing copied). The index is saved, so it opens instantly and picks up new songs in the
  background. Drives are matched by volume serial number, so a changed drive letter doesn't matter.
  Disc codes like `SC8123-05` are split out and songs are listed by Artist / Title.
- Plays **MP3+G zips**, matching **.mp3 + .cdg** files, and **MP4** karaoke videos
- **Lyrics on the TV**: opens full screen on the second display automatically
- **Key change** (±6 semitones) without changing the speed, remembered per song
- **Playlist** that is saved automatically and survives restarts
- **Recording**: pick the mixer under "Record from", turn on ● REC, and every song played is
  saved as an MP3 (the mixer's full mix: voice plus track) in `Documents\Karaoke Recordings`.
  The Recordings tab plays them back, shows them in Explorer, or moves them to the Recycle Bin
- **Sound to:** lets you pick the mixer directly. Audio goes through Windows' shared
  mode, so the track's sample rate (44.1k or 48k) never has to match the mixer

## Using it

1. Download `Karaoke-Player-Setup-x.y.z.exe` from the **Releases** page and run it.
   After that the app **updates itself**: it checks GitHub every couple of hours, downloads new
   versions quietly, and installs them when the app is closed (never mid-song).
   Windows may show "Windows protected your PC" because the app isn't code-signed:
   click **More info → Run anyway**.
2. **📁 Song Folders → + Add Folder**: pick the karaoke drive. The first read of a big drive
   takes a few minutes; after that it's instant.
3. **Sound to:** pick the mixer.
4. Plug in the TV before starting. The TV screen opens on it full screen.
   **📺 TV Screen** reopens it; double-click it to switch full screen on or off.
5. Search, **Add**, then **▶** on the playlist. Space bar = play/pause.

## Building

Pushing to `main` builds the Windows installer and portable exe on GitHub Actions
(download them from the run's **Artifacts**). Pushing a tag like `v1.0.1` also
attaches them to a GitHub Release.

Locally:

```bash
npm install
npm start          # run it
npm run dist       # build installers into dist/ (run on Windows)
```

Smoke test (Linux needs `xvfb-run`): `node test/smoke.mjs <folder with songs>`
