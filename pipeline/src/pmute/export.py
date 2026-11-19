"""Step 5: build voiceprints.json for the extension from cleaned windows of all videos."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .clean import robust_centroid

DISPLAY = {"vucic": "Aleksandar Vučić", "brnabic": "Ana Brnabić", "jovanov": "Milenko Jovanov",
           "bakic": "Jovo Bakić", "gasic": "Jugoslav Gašić"}
DEFAULT_TARGETS = {"vucic", "brnabic", "jovanov"}
DEFAULT_THRESHOLD = 0.5


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(derived: Path, models_dir: Path, out_path: Path) -> None:
    segs = [json.loads(l) for l in (derived / "segments.jsonl").read_text().splitlines()]
    clean = [json.loads(l) for l in (derived / "clean.jsonl").read_text().splitlines()]
    X = np.load(derived / "embeddings.npy")
    keep = np.array([c["keep"] for c in clean])
    spk = np.array([s["speaker"] for s in segs])
    vid = np.array([s["video_id"] for s in segs])

    speakers = []
    for s in sorted(set(spk)):
        m = keep & (spk == s)
        vp = robust_centroid(X[m])
        speakers.append({
            "id": s, "display_name": DISPLAY.get(s, s),
            "default_muted": s in DEFAULT_TARGETS,
            "voiceprint": [round(float(v), 6) for v in vp],
            "windows": int(m.sum()), "videos": sorted(set(vid[m])),
            "threshold": DEFAULT_THRESHOLD,
        })
    doc = {
        "schema_version": 1,
        "model": {"file": "wespeaker_resnet34_lm.onnx", "sha256": sha256(models_dir / "wespeaker_resnet34_lm.onnx"),
                  "sample_rate": 16000, "window_s": 1.5, "fbank": "kaldi 80 mel, 25/10 ms, hamming, dither 0, x32768, per-window CMN"},
        "vad": {"file": "silero_vad.onnx", "sha256": sha256(models_dir / "silero_vad.onnx")},
        "default_threshold": DEFAULT_THRESHOLD,
        "speakers": speakers,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False))
    for s in speakers:
        print(f'{s["id"]:<8} windows={s["windows"]:5d} videos={len(s["videos"])} muted={s["default_muted"]}')
    print(f"wrote {out_path} ({out_path.stat().st_size/1024:.1f} KB)")
