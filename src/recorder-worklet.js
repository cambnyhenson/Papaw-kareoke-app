// Copies incoming audio (the mixer's USB input) out to the page in small blocks.
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = e => { this.on = e.data === 'start'; }; }
  process(inputs) {
    const inp = inputs[0];
    if (this.on && inp && inp.length) {
      const l = inp[0].slice(0), r = (inp[1] || inp[0]).slice(0);
      this.port.postMessage([l, r], [l.buffer, r.buffer]);
    }
    return true;
  }
}
registerProcessor('capture', Capture);
