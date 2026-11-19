"""Step 1+2: VAD -> fixed windows -> speaker embeddings.

Writes, under <derived>/:
  segments.jsonl   one record per window (aligned row-by-row with embeddings.npy)
  embeddings.npy   float32 (N, 256), L2-normalized
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from .models import FRAME_SHIFT_S, SR, SileroVAD, SpeakerEmbedder, fbank

WINDOW_S = 1.5          # same window the extension will use live
HOP_S = 0.75            # 50% overlap for enrollment / analysis
MIN_SPEECH_RATIO = 0.6  # window must be >= 60% speech per VAD
VAD_THRESHOLD = 0.5
BATCH = 64


def read_manifest(path: Path) -> list[dict]:
    recs = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    latest: dict[str, dict] = {}
    for r in recs:  # later records win (re-runs append)
        latest[r["clip_id"]] = r
    return [r for r in latest.values() if r["status"] == "ok"]


def run(manifest: Path, clips_root: Path, models_dir: Path, derived: Path) -> None:
    derived.mkdir(parents=True, exist_ok=True)
    vad = SileroVAD(models_dir / "silero_vad.onnx")
    emb = SpeakerEmbedder(models_dir / "wespeaker_resnet34_lm.onnx")
    win_frames = int(round(WINDOW_S / FRAME_SHIFT_S))

    seg_out = (derived / "segments.jsonl").open("w")
    all_embs: list[np.ndarray] = []
    for clip in read_manifest(manifest):
        t0 = time.time()
        path = clips_root / clip["speaker"] / f'{clip["clip_id"]}.wav'
        wav, sr = sf.read(path, dtype="float32")
        assert sr == SR and wav.ndim == 1, f"{path}: expected 16 kHz mono"

        probs = vad.probs(wav)
        speech = probs > VAD_THRESHOLD
        feats = fbank(wav)

        starts = np.arange(0.0, len(wav) / SR - WINDOW_S + 1e-9, HOP_S)
        keep, ratios = [], []
        for s in starts:
            a, b = int(s / vad.frame_s), int((s + WINDOW_S) / vad.frame_s)
            r = float(speech[a:b].mean()) if b > a else 0.0
            f0 = int(round(s / FRAME_SHIFT_S))
            if r >= MIN_SPEECH_RATIO and f0 + win_frames <= len(feats):
                keep.append(s)
                ratios.append(r)

        clip_embs = []
        for i in range(0, len(keep), BATCH):
            batch = []
            for s in keep[i:i + BATCH]:
                f0 = int(round(s / FRAME_SHIFT_S))
                w = feats[f0:f0 + win_frames]
                batch.append(w - w.mean(axis=0, keepdims=True))
            clip_embs.append(emb.embed_frames(np.stack(batch)))
        clip_embs = np.concatenate(clip_embs) if clip_embs else np.zeros((0, 256), np.float32)
        all_embs.append(clip_embs)

        for j, (s, r) in enumerate(zip(keep, ratios)):
            seg_out.write(json.dumps({
                "window_id": f'{clip["clip_id"]}#{j:05d}',
                "clip_id": clip["clip_id"], "speaker": clip["speaker"],
                "video_id": clip["video_id"], "split": clip.get("split", "enroll"),
                "start_s": round(float(s), 3), "end_s": round(float(s) + WINDOW_S, 3),
                "video_t_s": round(clip["start_s"] + float(s), 3),
                "speech_ratio": round(r, 3),
            }) + "\n")
        dur = len(wav) / SR
        print(f'{clip["clip_id"]:<40} {dur/60:5.1f} min  windows={len(keep):5d} '
              f'({len(keep)/max(len(starts),1):.0%} kept)  speech={speech.mean():.0%}  {time.time()-t0:.0f}s',
              flush=True)

    seg_out.close()
    np.save(derived / "embeddings.npy", np.concatenate(all_embs).astype(np.float32))
