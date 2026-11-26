`soundtouch.js` is SoundTouch JS v0.3.0 (https://github.com/cutterbl/SoundTouchJS),
licensed LGPL-2.1. It is unmodified except that the ES-module `export` line was
replaced with `window.PitchShifter = PitchShifter` so it loads as a plain script.
It does the key change (pitch shift without changing speed).

`lame.min.js` is lamejs v1.2.1 (https://github.com/zhuker/lamejs), licensed LGPL-3.0,
unmodified. It encodes the recordings to MP3.

`inflate.js` is tiny-inflate 1.0.3 (https://github.com/foliojs/tiny-inflate, MIT), extended
to also decode Deflate64 (zip compression method 9). Many older karaoke zips (Music Maestro,
Sound Choice) were packed with it, and browsers can't open it.
