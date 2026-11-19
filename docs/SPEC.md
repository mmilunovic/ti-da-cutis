# Parliament Mute: product and technical spec

Status: the draft below (v0.1) was written before the design interview. Where it disagrees with
"Decisions made since the draft", the decisions win.

## Decisions made since the draft

- Main use case is the live stream; recorded videos use the same in-browser pipeline. No offline precompute.
- Voice only. Caption OCR was dropped (captions appear too briefly to be useful).
- Mute rule: mute after 2 s of sustained match; unmute after 1 s of other speech; at least 2 s of music once started; silence changes nothing; short interjections stay audible; on errors, unmute.
- No audio delay. The first 2–3 s of each turn are heard. (A 3 s delay was prototyped and removed from the UI.)
- While muted, music plays from a YouTube link: a normal tab opens on the first mute and loops, the browser switches to it on each mute and back to the session on unmute.
- Voiceprints are built from user-cut single-speaker clips (scripts/cut_clips.py, data/clips.csv), not from captions.
- Non-target voiceprints (Bakić, Gašić) are kept as competitors: the best-scoring voice must be a muted MP above threshold.
- Default threshold 0.4 (0.5 was the evaluated operating point).
- One mute-logic implementation, in TypeScript (extension/src/engine/decide.ts).
- Stack: Python pipeline; TypeScript + esbuild extension; onnxruntime-web (WASM); WeSpeaker ResNet34-LM; Silero VAD.
- No "always hear" list and no Spotify in v1.

## 1. What this is

A Chrome extension for people who watch National Assembly of Serbia (Narodna skupština) sessions on YouTube. While a session plays, the extension recognizes when a chosen MP is speaking and silences them. Everyone else stays audible, including the chair (the speaker of parliament or a deputy speaker).

The first version only mutes. Later versions can play the user's own music over the muted parts or show a small "muted: <name>" indicator.

The user picks who to mute from a list of MPs the extension knows. The extension does not pick anyone and does not rank or label politicians. It is a personal filter, like a mute button that knows who is talking.

All recognition runs locally in the browser. No audio, video or viewing history leaves the user's machine.

## 2. Who it's for

1. Me (Milos), first. I watch sessions and want to skip specific speakers without scrubbing through the video by hand.
2. Later, other people who watch Serbian parliament on YouTube, distributed through the Chrome Web Store and possibly Firefox Add-ons.

Version 1 has to work well for me before anything is built for sharing, but the architecture must not make sharing hard later. In practice: voiceprints are loaded from a hosted file, not hard-coded, and nothing depends on my machine.

## 3. How it should feel

- I open a session on YouTube, click the extension icon, and press Start. Chrome requires one click per tab before it allows tab audio capture.
- A blocked MP starts speaking. Their name caption appears in the bottom-left corner of the video, and the audio goes silent before I hear their first sentence.
- The caption fades out after a few seconds while the MP keeps talking. The audio stays silent.
- The chair interrupts ("vreme je isteklo", time's up). I hear the chair.
- The MP replies to the chair. Silent again, even though no caption appears this time.
- A different MP, not on my list, speaks. I hear them.
- If it gets something wrong, I can see why in a debug overlay, and later report it with one click.

The whole stream plays about 2 seconds behind YouTube's own timeline. That delay gives the extension time to decide before the sound reaches me. Video and audio must stay in sync (see 7.4).

## 4. Scope

### In scope for v1
- Chrome, Manifest V3, desktop.
- Recorded sessions (VOD) on YouTube. Live streams should also work, since the pipeline is the same, but VOD is what I test on.
- Caption OCR plus voice matching, combined into a single mute decision.
- A small set of targets: 3–5 MPs to mute, plus every person who chairs, enrolled as "always hear".
- An offline Python pipeline that builds voiceprints from session recordings.
- An evaluation harness that reports how often each MP gets muted wrongly, how often they're missed, and how long a switch to the right state takes.
- Loading the extension unpacked for personal use.

### Out of scope for v1 (but don't block it)
- Playing music over muted parts.
- Public distribution, store listing, and the update flow for voiceprints.
- Firefox and mobile.
- Other parliaments, other languages, other YouTube channels.
- A crowd-sourced feedback backend.
- Fine-tuning any model.

## 5. System overview

There are two halves: an offline pipeline that runs on my laptop (or GCP later), and the extension, which runs entirely in the browser.

```
OFFLINE (Python, CPU, laptop or Cloud Run job)

  session videos --cut--> clip DB --reads--> enrollment job --produces--> voiceprints.json --push--> static host
  (MP4/WAV I provide)     (WAVs + tables)    (embed, normalize,           (vectors,                   (GCS bucket or
                                              tune thresholds, eval)        thresholds, names)          GitHub Pages)

BROWSER (Chrome MV3 extension, everything local)

  popup ----sets----> service worker <----fetches---- static host
                            |
                       sends prints
                            v
  YouTube tab --frame--> content script --name--> offscreen document --plays--> speakers
       |                 (OCR caption)            (tab capture, VAD,             (delayed 2 s,
       +-------------------captures audio-------->  voice match, decide, gate)    muted or not)
```

### Components

| Component | Where | Responsibility |
|---|---|---|
| Clip harvester | Python | Turns full session recordings into labeled single-speaker clips. Uses caption OCR as weak labels and diarization to find turn boundaries. Produces candidate clips for me to review. |
| Clip DB | Files + SQLite or Parquet | Stores the `speakers` and `clips` tables (section 6). |
| Enrollment job | Python | Embeds clips with the exact ONNX model the browser uses, averages them into per-speaker voiceprints, applies normalization, tunes thresholds on held-out data, writes `voiceprints.json` and an eval report. |
| Eval harness | Python | Replays a labeled session through the same decision logic as the browser, offline and faster than real time. This is the main tool for tuning. |
| Static host | GCS or GitHub Pages | Serves a versioned `voiceprints.json`. OPEN: which one. |
| Popup / options | Extension UI | Choose MPs to mute, Start/Stop for the current tab, show status, toggle the debug overlay. |
| Service worker | Extension | Fetches and caches voiceprints, checks for updates, stores settings in `chrome.storage.sync`, passes messages between parts. |
| Content script | youtube.com | Crops the caption region from the `<video>` element about once per second, runs OCR in a worker, fuzzy-matches against known names, sends `caption` events. Also delays the video picture to match the audio (7.4). |
| Offscreen document | Extension | Owns the audio: `chrome.tabCapture` stream → AudioContext → delay → gain → output. Taps the undelayed audio into VAD and the embedding model. Runs the decision state machine and schedules gain changes ahead of time. |

## 6. Data

### 6.1 What I provide
- 5–10 full session recordings (MP4 or WAV). The sandbox can't download from YouTube, so I download them myself.
- A speaker list: the MPs to mute, everyone who chairs, and their names written exactly as the caption shows them (Cyrillic, Latin, or both).
- 3–4 full-resolution screenshots of the name caption.
- At least one held-out session (20+ minutes is enough) where I mark rough speaker turns by hand. This is the evaluation ground truth and is never used for enrollment.

### 6.2 How much audio per person
| Role | Target |
|---|---|
| MP to mute | 3–5 min clean speech, from at least 3 different sessions |
| Chair (each person) | Same |
| Other MPs, used as negatives for normalization and thresholds | 10–20 people, about 1 min each |
| Evaluation | 1–2 full sessions, labeled, held out |

Clip rules: 10–60 s, one speaker only, no heckling or applause, 16 kHz mono WAV.

### 6.3 Tables
`speakers`: `id` (e.g. `mp_0007`), `display_name`, `name_variants` (Cyrillic and Latin spellings, used for OCR matching), `role` (`mp` | `chair`), `notes`.

`clips`: `clip_id`, `speaker_id`, `source` (file or URL), `start_s`, `end_s`, `path`, `split` (`enroll` | `eval` | `cohort`), `label_source` (`caption_ocr` | `manual` | `diarization`), `reviewed` (bool).

### 6.4 `voiceprints.json`
```json
{
  "schema_version": 1,
  "model": { "name": "wespeaker-resnet34-lm", "sha256": "...", "sample_rate": 16000 },
  "normalization": { "global_mean": [...], "cohort_ref": "cohort.bin" },
  "speakers": [
    { "id": "mp_0007", "display_name": "...", "name_variants": ["...", "..."],
      "role": "mp", "voiceprint": [256 floats], "t_on": 0.62, "t_off": 0.45 }
  ],
  "created_at": "..."
}
```
The extension refuses a file whose `model.sha256` doesn't match the bundled model.

## 7. How recognition works

### 7.1 Signals
1. **Caption OCR.** A strong but sparse signal. When it shows a name, that's very likely who just started speaking. When it shows nothing, that tells us nothing.
2. **Voice match.** Continuous but noisy. One embedding per 1.5 s window, computed every 0.5 s, only while VAD detects speech. Scored against every enrolled voiceprint after normalization.
3. **Chair match.** Same mechanism, but a confident match means "unmute now".

### 7.2 Decision logic (intent; details OPEN)
- A caption names a blocked MP → mute and set them as the current target.
- A caption names anyone else → unmute and clear the target.
- Chair voice matched above threshold → unmute.
- Muted, and the target's smoothed score drops below `t_off` for N windows in a row → unmute.
- Not muted, and any blocked MP's smoothed score goes above `t_on` → mute and set them as the target.
- Silence never changes the state.
- Fail open: if the model or the capture breaks, unmute and show an error. Wrongly silencing the stream is worse than missing a mute.

### 7.3 Accuracy measures that don't need fine-tuning
- Enroll only from parliament audio, across several sessions.
- Subtract the global mean of all in-domain embeddings before comparing.
- Normalize scores against the cohort of other MPs (adaptive symmetric normalization, AS-norm).
- Per-speaker thresholds tuned on the eval split.
- Smooth scores over time. Mute quickly, unmute cautiously.
- Optional: while a caption confirms a blocked MP, blend a few seconds of their live embeddings into their voiceprint for that session only. OPEN: whether this drifts.

### 7.4 Delay and sync
The audio is delayed by D seconds (default 2.0) so the decision happens before the sound plays. The picture has to be delayed by the same D, or speech won't match lips. OPEN: how. Options: (a) hold the YouTube video D seconds behind by rate control or seeking, (b) draw delayed frames to a canvas laid over the player, (c) accept the lip-sync offset in v1. This is the main technical risk, so prototype it first.

### 7.5 Models
| Purpose | Model | Notes |
|---|---|---|
| Speaker embedding | WeSpeaker ResNet34 (VoxCeleb), ONNX | ~25 MB fp32, ~7 MB int8. The same file is used in Python and in onnxruntime-web. Fallbacks: CAM++, ECAPA-TDNN. |
| Voice activity | Silero VAD, ONNX | ~2 MB. |
| OCR | Tesseract.js, `srp` / `srp_latn` | Runs only on the caption crop. |
| Diarization (offline only) | pyannote 3.x | Clip harvesting only, never in the browser. |

Serbian should not matter much: speaker embeddings mostly don't depend on the language. The domain gap that does matter is parliament microphones and room echo vs VoxCeleb, which 7.3 addresses.

## 8. Success criteria

Measured on the held-out session(s) by the eval harness, using the same decision logic as the extension:
- Wrong mutes: less than X% of non-target speech gets muted (OPEN: X, my guess is 2%).
- Missed mutes: less than Y% of target speech is heard (OPEN: Y, my guess is 5%, with most of it in the first second of a turn).
- Switch latency: median time to the correct state after a speaker change, reported per target.
- The chair is never muted for more than one window.
- In the browser: no audible glitches, CPU use acceptable on my laptop (OPEN: budget), video and audio in sync per 7.4.

The eval report shows these per speaker, plus score histograms (target vs everyone else) and a list of the worst segments with timestamps so I can listen to them.

## 9. Privacy and legal
- No audio, video or viewing data leaves the browser. Only `voiceprints.json` is downloaded.
- Voiceprints of identifiable people are biometric personal data under GDPR, and Serbia's ZZPL follows the same model. That's fine for personal use. Before any public release, get advice on whether publishing politicians' voiceprints is allowed. Fallback for a public version: captions-only by default, with voice matching only on voiceprints the user builds locally from recordings they provide.
- Downloading YouTube videos runs against YouTube's Terms of Service. Prefer official parliament recordings as the source wherever they exist.
- The extension takes no political position. Store copy and UI stay neutral.

## 10. Milestones
1. **Spike: sync and capture.** Tab capture → delay → gain works on a YouTube session. Video and audio sync solved or consciously accepted. No ML.
2. **Caption-only mute.** OCR the caption, mute on a blocked name, unmute after a fixed time. A useful baseline and a fallback.
3. **Offline pipeline.** Harvester, clip DB, enrollment, eval harness. An eval report on the held-out session.
4. **Voice in the browser.** VAD + embedding running in the offscreen document, decision logic shared with the eval harness, debug overlay.
5. **Tuning.** 2–4 rounds of watching real sessions and adjusting from the eval report.
6. **Sharing (later).** Hosted voiceprints, options page, store listing, legal check.

## 11. Repo layout (proposal)
```
/pipeline        Python: harvest, clipdb, enroll, eval, shared decision logic
/extension       MV3: manifest, service worker, offscreen, content script, popup
/shared          decision-logic spec + test vectors used by both Python and JS
/models          ONNX files + checksums (or fetched by script)
/data            gitignored: recordings, clips, labels
/reports         eval outputs
```
The decision logic exists twice (Python for eval, JS for the browser). Both must pass the same test vectors in `/shared` so they can't drift apart. OPEN: alternatively compile one implementation to both (for example, Rust to WASM plus Python bindings).

## 12. Open questions for grilling
1. Video sync: option (a), (b) or (c) from 7.4?
2. Delay D: fixed 2 s, or configurable?
3. Caption behavior: does it reliably appear at the start of every turn? Is it the same for replies, procedural points and the chair? Cyrillic, Latin, or both?
4. Does the chair ever get a caption? Are deputy speakers captioned differently?
5. How should a heckle or a short interjection from a blocked MP during someone else's speech be handled: mute it, or ignore anything shorter than K seconds?
6. Should audio during muted parts be fully silent or ducked (for example -30 dB) so I still know something is happening?
7. Does live-stream support matter for v1, or only VOD?
8. Thresholds: global, or per speaker from the start?
9. Should session-level voiceprint adaptation (7.3) exist in v1?
10. What CPU budget is acceptable? Must it run on a low-end laptop?
11. Static host: GCS or GitHub Pages? Versioning scheme?
12. Single decision-logic implementation or two with shared tests?
13. What does the debug overlay show: scores, current target, caption reads?
14. Feedback button in v1 (local log only), or later?
15. Name matching: how fuzzy, and what happens when two MPs have similar names?
16. What's the minimum enrollment audio per person before a speaker can be added?
17. Is a "captions only" mode worth shipping as a separate product option?
18. Music over muted parts: the user's own file, a URL, or a built-in playlist? (Post-v1, but affects the audio graph design.)
