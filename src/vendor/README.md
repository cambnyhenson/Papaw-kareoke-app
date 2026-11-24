`soundtouch.js` is SoundTouch JS v0.3.0 (https://github.com/cutterbl/SoundTouchJS),
licensed LGPL-2.1. It is unmodified except that the ES-module `export` line was
replaced with `window.PitchShifter = PitchShifter` so it loads as a plain script.
It does the key change (pitch shift without changing speed).

`lame.min.js` is lamejs v1.2.1 (https://github.com/zhuker/lamejs), licensed LGPL-3.0,
unmodified. It encodes the recordings to MP3.
