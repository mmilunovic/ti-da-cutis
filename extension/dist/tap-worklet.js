// Collects 16 kHz mono samples and posts them to the offscreen document in 2048-sample blocks.
class PmuteTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const chs = input.length;
      const len = input[0].length;
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (let c = 0; c < chs; c++) v += input[c][i];
        this.buf[this.n++] = v / chs;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pmute-tap", PmuteTap);
