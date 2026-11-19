import puppeteer from "puppeteer-core";
const ext = new URL("../../dist", import.meta.url).pathname;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
const sw = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 20000 });
const id = new URL(sw.url()).host;
const errs = [];
const pop = await browser.newPage();
pop.on("pageerror", e => errs.push("popup: " + e.message));
pop.on("console", m => m.type() === "error" && errs.push("popup console: " + m.text()));
await pop.goto(`chrome-extension://${id}/popup.html`);
await new Promise(r => setTimeout(r, 1000));
console.log("popup speakers:", (await pop.$$eval("#speakers label", ls => ls.map(l => l.textContent + (l.querySelector("input").checked ? "[x]" : "[ ]")))).join(" | "));
const st = await browser.newPage();
st.on("pageerror", e => errs.push("selftest: " + e.message));
st.on("console", m => m.type() === "error" && errs.push("selftest console: " + m.text()));
await st.goto(`chrome-extension://${id}/selftest.html`);
await st.waitForFunction(() => /SELFTEST (OK|FAILED)/.test(document.getElementById("out").textContent), { timeout: 120000 });
console.log(await st.$eval("#out", e => e.textContent));
// service worker: offscreen document can be created
const swh = await sw.worker();
const offOk = await swh.evaluate(async () => {
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"], justification: "smoke" });
  const c = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return c.length;
});
console.log("offscreen documents:", offOk);
await new Promise(r => setTimeout(r, 1500));
const offT = (await browser.targets()).find(t => t.url().endsWith("offscreen.html"));
console.log("offscreen target present:", !!offT);
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no page errors");
await browser.close();
