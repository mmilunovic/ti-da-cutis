"""Step 3: drop windows that don't sound like the clip's labeled speaker.

Per clip: robust centroid (iteratively re-estimated on the most typical 80% of windows), then a
window is dropped when
  * its similarity to the clip centroid is an outlier (below median - 3 * MAD), or
  * it is closer to another speaker's centroid than to its own speaker's.
This catches the chair's introduction, heckles, applause and crosstalk.

Writes <derived>/clean.jsonl (aligned with segments.jsonl) and <derived>/clean_summary.json.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

MAD_K = 3.0
FIRST_S = 15.0


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def robust_centroid(x: np.ndarray, keep_frac: float = 0.8, iters: int = 3) -> np.ndarray:
    c = unit(x.mean(0))
    for _ in range(iters):
        s = x @ c
        k = max(1, int(len(x) * keep_frac))
        c = unit(x[np.argsort(-s)[:k]].mean(0))
    return c


def load(derived: Path) -> tuple[list[dict], np.ndarray]:
    segs = [json.loads(l) for l in (derived / "segments.jsonl").read_text().splitlines()]
    embs = np.load(derived / "embeddings.npy")
    assert len(segs) == len(embs)
    return segs, embs


def merge_intervals(times: list[float], width: float, gap: float = 0.8) -> list[list[float]]:
    out: list[list[float]] = []
    for t in sorted(times):
        if out and t <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], t + width)
        else:
            out.append([t, t + width])
    return out


def run(derived: Path) -> None:
    segs, embs = load(derived)
    by_clip: dict[str, list[int]] = defaultdict(list)
    by_spk: dict[str, list[int]] = defaultdict(list)
    for i, s in enumerate(segs):
        by_clip[s["clip_id"]].append(i)
        by_spk[s["speaker"]].append(i)

    spk_c = {k: robust_centroid(embs[v]) for k, v in by_spk.items()}
    spk_names = sorted(spk_c)
    C = np.stack([spk_c[k] for k in spk_names])

    rows: list[dict] = [None] * len(segs)  # type: ignore[list-item]
    summary = []
    for clip_id, idx in by_clip.items():
        idx = np.array(idx)
        x = embs[idx]
        c = robust_centroid(x)
        sim = x @ c
        med = np.median(sim)
        mad = 1.4826 * np.median(np.abs(sim - med))
        thr = med - MAD_K * mad
        spk = segs[idx[0]]["speaker"]
        own = spk_names.index(spk)
        all_sims = x @ C.T
        others = np.where(np.arange(len(spk_names)) == own, -np.inf, all_sims)
        best_other = others.argmax(1)
        closer_other = others.max(1) > all_sims[:, own]

        dropped_t = []
        n_first = n_first_drop = 0
        for j, i in enumerate(idx):
            reason = None
            if sim[j] < thr:
                reason = "outlier"
            elif closer_other[j]:
                reason = f"closer_to:{spk_names[best_other[j]]}"
            rows[i] = {
                "window_id": segs[i]["window_id"], "keep": reason is None, "reason": reason,
                "sim_clip": round(float(sim[j]), 4),
                "sim_own_speaker": round(float(all_sims[j, own]), 4),
                "best_other": spk_names[best_other[j]],
                "sim_best_other": round(float(others[j].max()), 4),
            }
            first = segs[i]["start_s"] < FIRST_S
            n_first += first
            if reason:
                dropped_t.append(segs[i]["start_s"])
                n_first_drop += first

        vid, off = segs[idx[0]]["video_id"], segs[idx[0]]["video_t_s"] - segs[idx[0]]["start_s"]
        intervals = merge_intervals(dropped_t, 1.5)
        summary.append({
            "clip_id": clip_id, "speaker": spk, "windows": int(len(idx)),
            "dropped": len(dropped_t), "dropped_frac": round(len(dropped_t) / len(idx), 4),
            "first15_windows": int(n_first), "first15_dropped": int(n_first_drop),
            "threshold": round(float(thr), 4), "median_sim": round(float(med), 4),
            "dropped_intervals": [
                {"clip_start_s": round(a, 2), "clip_end_s": round(b, 2),
                 "youtube": f"https://www.youtube.com/watch?v={vid}&t={int(off + a)}s"}
                for a, b in intervals
            ],
        })
        print(f"{clip_id:<40} windows={len(idx):5d} dropped={len(dropped_t):4d} "
              f"({len(dropped_t)/len(idx):.1%})  first15: {n_first_drop}/{n_first}  "
              f"intervals={len(intervals)}")

    with (derived / "clean.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    (derived / "clean_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
