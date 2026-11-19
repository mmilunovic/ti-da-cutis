# Ti da ćutiš ti si...

A Chrome extension for watching Serbian National Assembly sessions on YouTube. It recognizes chosen MPs by their voice and plays music while they talk. Everyone else stays audible.

Recognition runs entirely in your browser. No audio leaves your machine.

Out of the box it recognizes Aleksandar Vučić, Ana Brnabić and Milenko Jovanov.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension/dist` folder.
4. Open a parliament session on YouTube, click the extension icon, paste a YouTube link for the music, and press **Start on this tab**.

The first time someone on the list starts talking, the music opens in a new tab and loops. When they stop, it pauses and you're switched back to the session.

## How it works

- The extension captures the tab's audio. Every 0.5 s it embeds the last 1.5 s with a speaker-recognition model (WeSpeaker ResNet34, ONNX, running in WebAssembly) and compares the result with stored voiceprints.
- An MP is muted after about 2 s of continuous match. Short interjections stay audible. Music stops after 1 s of someone else speaking.
- You'll hear the first 2–3 s of each turn before the music starts.
- Other MPs' voiceprints (currently Jovo Bakić and Jugoslav Gašić) are compared too, so a voice that sounds more like them than like a muted MP never triggers music.

On videos the voiceprints weren't built from, the three MPs are told apart with under 2% of their speech missed and almost no false mutes (threshold 0.5, about 3 s of speech). Only five voices have been tested so far. MPs nobody has enrolled can still trigger a wrong mute, especially at the default threshold of 0.4.

## Repository

| Path | What's there |
|---|---|
| `extension/` | Chrome extension (TypeScript). `dist/` is the built, ready-to-load version. |
| `pipeline/` | Python: silence removal, embeddings, outlier cleaning, separation report, voiceprint export |
| `scripts/cut_clips.py` | Cuts labeled clips from YouTube with yt-dlp |
| `data/clips.csv` | The labels used for the current voiceprints (video, speaker, time range) |
| `data/voiceprints.json` | Voiceprints bundled with the extension |
| `models/` | ONNX models, see `models/README.md` for sources and licenses |
| `docs/SPEC.md` | Original design spec, with the decisions made since at the top |

Audio clips are not in the repo. Recreate them from `data/clips.csv`.

## Adding a speaker or rebuilding voiceprints

```bash
brew install yt-dlp ffmpeg
python3 scripts/cut_clips.py               # cuts data/clips.csv into data/clips/
cd pipeline && pip install -e .
pmute all --repo ..                        # segment, clean, report, export voiceprints
cd ../extension && npm install && npm run build
```

Add rows to `data/clips.csv` (one person speaking per row, at least 2 different videos per person). New people show up in the popup once `default_muted` is set for them in `pipeline/src/pmute/export.py`.

## Tests

```bash
cd extension
npm test          # mute logic, Python/TypeScript feature parity, replay on real clips (needs data/clips)
npm run smoke     # loads the built extension in headless Chrome
```

## Note on the data

`data/voiceprints.json` contains voice embeddings of public figures, built from public parliament broadcasts. In the EU and Serbia, voice embeddings that identify a person can count as biometric personal data.
