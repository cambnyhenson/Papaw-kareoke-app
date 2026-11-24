# Karaoke Player

A simple Windows karaoke show player built for one person: Grandpa.

- Plays **MP3+G zips**, matching **.mp3 + .cdg** files, and **MP4** karaoke videos
- **Lyrics on the TV**: opens full screen on the second display automatically
- **Key change** (±6 semitones) without changing the speed, remembered per song
- **Playlist** that is saved automatically and survives restarts
- **Sound to:** lets you pick the mixer directly. Audio goes through Windows' shared
  mode, so the track's sample rate (44.1k or 48k) never has to match the mixer

## Using it

1. Run `Karaoke-Player-Setup-x.y.z.exe` (or the portable `.exe`, which needs no install).
   Windows may show "Windows protected your PC" because the app isn't code-signed:
   click **More info → Run anyway**.
2. **Choose Song Folder**: it's remembered and rescanned every time the app opens.
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
