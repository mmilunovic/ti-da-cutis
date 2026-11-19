# Parliament Mute — Chrome extension

Plays music over chosen speakers on YouTube parliament streams. Everything runs locally in the browser.

## Install (unpacked)
1. Open `chrome://extensions`, switch on **Developer mode** (top right).
2. **Load unpacked** → pick `extension/dist`.
3. Pin the extension (puzzle icon → pin).

## Use
1. Open a parliament session on YouTube (live or recorded) and press play.
2. Click the extension icon. Optionally paste a YouTube music link and pick who to mute.
3. Click **Start on this tab**. The first start takes a second to load the models.
4. With the debug badge on, the bottom-left of the page shows the state, the best-matching voice and its score.
   Press **Alt+W** whenever it does something wrong; export the log from the popup.

The icon shows `on` while listening and `♪` while muted. If music doesn't start, open the pinned music
tab once and press play (Chrome's autoplay rules), then it will keep working.

`selftest.html` (chrome-extension://<id>/selftest.html) loads the models and reports timings.

## Develop
```
npm install
npm run build        # -> dist/ (models from ../models, voiceprints from ../data/voiceprints.json)
npm run typecheck
npm test             # decision logic, Python parity, replay on real clips (needs data/clips)
```
Settings live in `chrome.storage.local`. Voiceprints come from `pipeline` (`pmute export`).
