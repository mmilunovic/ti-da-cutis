import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
const svg = readFileSync("icons/icon.svg", "utf8");
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: `icons/icon${s}.png`, omitBackground: true });
}
// preview sheet on light and dark
await p.setViewport({ width: 420, height: 310 });
const row = (bg) => `<div style="background:${bg};padding:12px;display:flex;gap:16px;align-items:center">` + [16,32,48,128].map(s=>`<img src="data:image/png;base64,${readFileSync(`icons/icon${s}.png`).toString("base64")}" width="${s}" height="${s}">`).join("") + "</div>";
await p.setContent(`<body style="margin:0">${row("#ffffff")}${row("#2c2c2a")}</body>`);
await p.screenshot({ path: "icons/preview.png" });
await b.close();
