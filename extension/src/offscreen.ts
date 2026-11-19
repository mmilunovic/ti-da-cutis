// Offscreen document: owns the captured tab audio, the models and the mute decisions.
//
//   tab stream ──► playCtx: source ─► delay (0 or 3 s) ─► gain ─► speakers
//              └─► anaCtx (16 kHz): source ─► tap worklet ─► Analyzer ─► MuteEngine
//
// Offscreen documents only get chrome.runtime, so settings arrive in messages.
import * as ort from "onnxruntime-web/wasm";
import { Analyzer, Voiceprint } from "./audio/analyzer";
import { Embedder } from "./audio/embed";
import { SileroVAD } from "./audio/vad";
import { DEFAULT_PARAMS, Decision, MuteEngine } from "./engine/decide";
import type { Msg, Status } from "./shared/messages";
import { DELAY_S, FADE_S, Settings } from "./shared/settings";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = 1;

interface Session {
  stream: MediaStream;
  playCtx: AudioContext;
  anaCtx: AudioContext;
  delay: DelayNode;
  gain: GainNode;
  engine: MuteEngine;
  analyzer: Analyzer;
  settings: Settings;
  busy: boolean;
  queue: Float32Array[];
  last: Decision | null;
}

let session: Session | null = null;
let models: { vad: SileroVAD; emb: Embedder; vps: Voiceprint[] } | null = null;

const send = (m: Msg) => chrome.runtime.sendMessage(m).catch(() => {});

function status(extra: Partial<Status> = {}): Status {
  const d = session?.last;
  return {
    running: !!session, muted: d?.muted ?? false, target: d?.target ?? null, best: d?.best ?? null,
    bestScore: d?.bestScore ?? 0, reason: d?.reason ?? "starting", embedMs: session?.analyzer.lastEmbedMs ?? 0,
    t: d?.t ?? 0, ...extra,
  };
}

async function loadModels() {
  if (models) return models;
  const get = async (p: string) => new Uint8Array(await (await fetch(chrome.runtime.getURL(p))).arrayBuffer());
  const [vadBytes, embBytes, vpDoc] = await Promise.all([
    get("models/silero_vad.onnx"),
    get("models/wespeaker_resnet34_lm.onnx"),
    fetch(chrome.runtime.getURL("voiceprints.json")).then((r) => r.json()),
  ]);
  const vad = await SileroVAD.create(ort, vadBytes);
  const emb = await Embedder.create(ort, embBytes);
  const vps: Voiceprint[] = vpDoc.speakers.map((s: { id: string; voiceprint: number[] }) => ({
    id: s.id, vec: Float32Array.from(s.voiceprint),
  }));
  return (models = { vad, emb, vps });
}

function engineFor(s: Settings): MuteEngine {
  return new MuteEngine({ ...DEFAULT_PARAMS, defaultThreshold: s.threshold }, new Set(s.muted));
}

function applyGain(muted: boolean) {
  if (!session) return;
  const { playCtx, gain, settings } = session;
  const now = playCtx.currentTime;
  // With the delay on, audio reaching the speakers is DELAY_S behind what we analyse.
  // Muting now covers the turn from its first word; unmuting is pushed back so we don't
  // un-mute while the muted MP's last words are still in the delay line.
  const at = settings.delay && !muted ? now + Math.max(0, DELAY_S - 2.0) : now;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.setValueAtTime(gain.gain.value, at);
  gain.gain.linearRampToValueAtTime(muted ? 0 : 1, at + FADE_S);
  const musicDelayMs = (at - now) * 1000;
  setTimeout(() => send({ type: "music", play: muted }), musicDelayMs);
}

async function pump() {
  const s = session;
  if (!s || s.busy) return;
  s.busy = true;
  try {
    while (s.queue.length && session === s) {
      // if analysis falls behind, drop the oldest audio rather than lag further
      if (s.queue.length > 32) s.queue.splice(0, s.queue.length - 8);
      const block = s.queue.shift()!;
      for (const o of await s.analyzer.feed(block)) {
        const d = s.engine.step(o);
        s.last = d;
        if (d.changed) applyGain(d.muted);
        send({ type: "status", status: status() });
      }
    }
  } catch (e) {
    const d = s.engine.fail(s.last?.t ?? 0, String(e));
    s.last = d;
    if (d.changed) applyGain(false);
    send({ type: "status", status: status({ error: String(e) }) });
  } finally {
    s.busy = false;
  }
}

async function start(streamId: string, settings: Settings) {
  await stop();
  send({ type: "status", status: { ...status(), reason: "loading models" } });
  const m = await loadModels();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as unknown as MediaTrackConstraints,
    video: false,
  });

  const playCtx = new AudioContext();
  const src = playCtx.createMediaStreamSource(stream);
  const delay = playCtx.createDelay(5);
  delay.delayTime.value = settings.delay ? DELAY_S : 0;
  const gain = playCtx.createGain();
  src.connect(delay).connect(gain).connect(playCtx.destination);

  const anaCtx = new AudioContext({ sampleRate: 16000 });
  await anaCtx.audioWorklet.addModule(chrome.runtime.getURL("tap-worklet.js"));
  const tap = new AudioWorkletNode(anaCtx, "pmute-tap");
  const sink = anaCtx.createGain();
  sink.gain.value = 0;
  anaCtx.createMediaStreamSource(stream).connect(tap).connect(sink).connect(anaCtx.destination);

  m.vad.reset();
  session = {
    stream, playCtx, anaCtx, delay, gain, settings, busy: false, queue: [], last: null,
    engine: engineFor(settings), analyzer: new Analyzer(m.vad, m.emb, m.vps),
  };
  tap.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    session?.queue.push(ev.data);
    void pump();
  };
  stream.getAudioTracks()[0].addEventListener("ended", () => void stop());
  send({ type: "status", status: status({ reason: "listening" }) });
}

async function stop() {
  const s = session;
  if (!s) return;
  session = null;
  s.stream.getTracks().forEach((t) => t.stop());
  await Promise.allSettled([s.playCtx.close(), s.anaCtx.close()]);
  send({ type: "music", play: false });
  send({ type: "status", status: { ...status(), running: false, muted: false, reason: "stopped" } });
}

function updateSettings(settings: Settings) {
  if (!session) return;
  const wasMuted = session.engine.isMuted;
  session.settings = settings;
  session.delay.delayTime.setTargetAtTime(settings.delay ? DELAY_S : 0, session.playCtx.currentTime, 0.1);
  session.engine = engineFor(settings);
  if (wasMuted) applyGain(false);
}

chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type === "offscreen-start") {
    start(msg.streamId, msg.settings).catch((e) => {
      send({ type: "status", status: { ...status(), running: false, error: String(e), reason: "failed to start" } });
    });
  } else if (msg.type === "offscreen-stop") {
    void stop();
  } else if (msg.type === "offscreen-settings") {
    updateSettings(msg.settings);
  }
});
