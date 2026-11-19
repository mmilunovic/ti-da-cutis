// Build the unpacked extension into dist/.  node build.mjs [--watch]
import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const MODELS = process.env.PMUTE_MODELS ?? "../models";
const VOICEPRINTS = process.env.PMUTE_VOICEPRINTS ?? "../data/voiceprints.json";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/ort", { recursive: true });
mkdirSync("dist/models", { recursive: true });
cpSync("static", "dist", { recursive: true });
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  cpSync(`node_modules/onnxruntime-web/dist/${f}`, `dist/ort/${f}`);
}
for (const f of ["silero_vad.onnx", "wespeaker_resnet34_lm.onnx"]) {
  if (!existsSync(`${MODELS}/${f}`)) throw new Error(`missing model ${MODELS}/${f}`);
  cpSync(`${MODELS}/${f}`, `dist/models/${f}`);
}
cpSync(VOICEPRINTS, "dist/voiceprints.json");

const opts = {
  entryPoints: {
    background: "src/background.ts", offscreen: "src/offscreen.ts", popup: "src/popup.ts",
    content: "src/content.ts", music: "src/music.ts",
  },
  outdir: "dist", bundle: true, format: "esm", target: "chrome116", sourcemap: true, logLevel: "info",
};
// content scripts and injected scripts can't be ES modules
const iife = { ...opts, entryPoints: { content: "src/content.ts", music: "src/music.ts" }, format: "iife" };
const esm = { ...opts, entryPoints: { background: "src/background.ts", offscreen: "src/offscreen.ts", popup: "src/popup.ts", selftest: "src/selftest.ts" } };

if (process.argv.includes("--watch")) {
  await (await context(esm)).watch();
  await (await context(iife)).watch();
} else {
  await build(esm);
  await build(iife);
}
