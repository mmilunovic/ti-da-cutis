// selftest.html: loads the models inside the real extension (same CSP as the offscreen document),
// embeds a few seconds of synthetic audio and reports timings. Open it from chrome://extensions.
import * as ort from "onnxruntime-web/wasm";
import { Embedder, WINDOW_SAMPLES } from "./audio/embed";
import { SileroVAD, VAD_CHUNK } from "./audio/vad";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = 1;

const out = document.getElementById("out")!;
const log = (s: string) => { out.textContent += s + "\n"; console.log(s); };

(async () => {
  try {
    const get = async (p: string) => new Uint8Array(await (await fetch(chrome.runtime.getURL(p))).arrayBuffer());
    let t = performance.now();
    const vad = await SileroVAD.create(ort, await get("models/silero_vad.onnx"));
    const emb = await Embedder.create(ort, await get("models/wespeaker_resnet34_lm.onnx"));
    log(`models loaded in ${(performance.now() - t).toFixed(0)} ms`);
    const vp = await (await fetch(chrome.runtime.getURL("voiceprints.json"))).json();
    log(`voiceprints: ${vp.speakers.map((s: { id: string }) => s.id).join(", ")}`);
    // synthetic voiced signal: harmonics with vibrato + noise
    const x = new Float32Array(WINDOW_SAMPLES);
    for (let i = 0; i < x.length; i++) {
      const f0 = 120 + 10 * Math.sin((2 * Math.PI * 3 * i) / 16000);
      let v = 0;
      for (let h = 1; h < 12; h++) v += Math.sin((2 * Math.PI * f0 * h * i) / 16000) / h;
      x[i] = 0.1 * v + 0.01 * (Math.random() - 0.5);
    }
    t = performance.now();
    for (let k = 0; k < 46; k++) await vad.prob(x.subarray(k * VAD_CHUNK, (k + 1) * VAD_CHUNK));
    log(`VAD 46 chunks (1.5 s of audio): ${(performance.now() - t).toFixed(0)} ms`);
    t = performance.now();
    const e = await emb.embed(x);
    const first = performance.now() - t;
    t = performance.now();
    await emb.embed(x);
    log(`embedding: first ${first.toFixed(0)} ms, then ${(performance.now() - t).toFixed(0)} ms (budget: 500 ms per hop)`);
    log(`embedding dim ${e.length}, norm ${Math.hypot(...e).toFixed(3)}`);
    log("SELFTEST OK");
  } catch (err) {
    log("SELFTEST FAILED: " + String(err));
  }
})();
