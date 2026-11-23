"""Step 4: can the model tell the targets apart on videos it didn't learn from?

Leave-one-video-out (LOVO): for each target speaker T and each of T's videos V, T's voiceprint is
built only from T's other videos, plus a global mean (for centering) from every window not in V.
Positives = T's windows in V. Negatives = every other speaker's windows.

Scores are reported per 1.5 s window and smoothed over 3 consecutive windows (~3 s of audio),
which is closer to what the mute rule sees ("2 s of sustained match").

Writes <reports>/separation.html and <reports>/separation.json.
"""
from __future__ import annotations

import base64
import html
import io
import json
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .clean import robust_centroid, unit  # noqa: E402

SMOOTH = 3
TARGET_MIN_VIDEOS = 2
FIXED_THRESHOLDS = (0.4, 0.5, 0.55)


def smooth_by_clip(scores: np.ndarray, clip_ids: np.ndarray) -> np.ndarray:
    out = scores.copy()
    for c in np.unique(clip_ids):
        m = clip_ids == c
        s = scores[m]
        k = np.ones(SMOOTH) / SMOOTH
        pad = np.pad(s, (SMOOTH // 2, SMOOTH - 1 - SMOOTH // 2), mode="edge")
        out[m] = np.convolve(pad, k, mode="valid")
    return out


def eer(pos: np.ndarray, neg: np.ndarray) -> tuple[float, float]:
    thr = np.unique(np.concatenate([pos, neg]))
    best = (1.0, 0.0)
    gap_best = 2.0
    for t in thr[:: max(1, len(thr) // 4000)]:
        frr = (pos < t).mean()
        far = (neg >= t).mean()
        if abs(frr - far) < gap_best:
            gap_best, best = abs(frr - far), ((frr + far) / 2, float(t))
    return best


def rate_at(pos: np.ndarray, neg: np.ndarray, t: float) -> tuple[float, float]:
    return float((pos < t).mean()), float((neg >= t).mean())


def fig_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def yt(seg: dict) -> str:
    return f'https://www.youtube.com/watch?v={seg["video_id"]}&t={int(seg["video_t_s"])}s'


def run(derived: Path, reports: Path) -> None:
    reports.mkdir(parents=True, exist_ok=True)
    segs = [json.loads(l) for l in (derived / "segments.jsonl").read_text().splitlines()]
    clean = [json.loads(l) for l in (derived / "clean.jsonl").read_text().splitlines()]
    embs = np.load(derived / "embeddings.npy")
    keep = np.array([c["keep"] for c in clean])
    segs_all, embs_all = segs, embs
    segs = [s for s, k in zip(segs, keep) if k]
    X = embs[keep]

    spk = np.array([s["speaker"] for s in segs])
    vid = np.array([s["video_id"] for s in segs])
    clip = np.array([s["clip_id"] for s in segs])
    videos_of = {s: sorted(set(vid[spk == s])) for s in np.unique(spk)}
    targets = [s for s, v in videos_of.items() if len(v) >= TARGET_MIN_VIDEOS]
    speakers = sorted(videos_of)

    def balanced_mean(mask: np.ndarray) -> np.ndarray:
        groups = sorted(set(zip(spk[mask], vid[mask])))
        return np.mean([unit(X[mask & (spk == a) & (vid == b)].mean(0)) for a, b in groups], 0)

    def scores(V: str, T: str, centered: bool) -> np.ndarray:
        train = (spk == T) & (vid != V)
        if centered:
            m = balanced_mean(vid != V)
            vp = unit(robust_centroid(unit(X[train] - m)))
            return unit(X - m) @ vp
        return X @ robust_centroid(X[train])

    results = {}
    hist_imgs = {}
    worst = {}
    for T in targets:
        acc = {"raw": ([], []), "cen": ([], [])}
        P_s, N_s, P_idx, N_idx = [], [], [], []
        per_video = []
        for V in videos_of[T]:
            p = np.where((spk == T) & (vid == V))[0]
            n = np.where(spk != T)[0]
            for key, cen in (("raw", False), ("cen", True)):
                sc = scores(V, T, cen)
                acc[key][0].append(sc[p])
                acc[key][1].append(sc[n])
            ss = smooth_by_clip(scores(V, T, False), clip)
            P_s.append(ss[p]); N_s.append(ss[n]); P_idx.append(p); N_idx.append(n)
            e, _ = eer(ss[p], ss[n])
            per_video.append({"held_out_video": V, "pos_windows": int(len(p)), "eer_smoothed": round(e, 4)})
        P_s, N_s = np.concatenate(P_s), np.concatenate(N_s)
        P_idx, N_idx = np.concatenate(P_idx), np.concatenate(N_idx)
        e_raw, _ = eer(np.concatenate(acc["raw"][0]), np.concatenate(acc["raw"][1]))
        e_cen, _ = eer(np.concatenate(acc["cen"][0]), np.concatenate(acc["cen"][1]))
        e_s, _ = eer(P_s, N_s)
        # threshold: every other speaker individually triggers <= 2% of their windows (fail open)
        neg_spk = spk[N_idx]
        q98 = {o: float(np.quantile(N_s[neg_spk == o], 0.98)) for o in np.unique(neg_spk)}
        t_far2 = max(q98.values())
        frr2, far2 = rate_at(P_s, N_s, t_far2)
        imp = {o: round(float((N_s[neg_spk == o] >= t_far2).mean()), 4) for o in sorted(q98)}

        results[T] = {
            "videos": videos_of[T], "per_video": per_video,
            "eer_window_raw": round(e_raw, 4), "eer_window_centered": round(e_cen, 4),
            "eer_smoothed": round(e_s, 4), "threshold_far2": round(t_far2, 4),
            "miss_at_far2": round(frr2, 4), "far_at_far2": round(far2, 4),
            "closest_other_speaker": max(q98, key=q98.get),
            "false_accept_by_speaker_at_far2": imp,
            "pos_score_p05": round(float(np.quantile(P_s, 0.05)), 4),
            "neg_score_p98_by_speaker": {k: round(v, 4) for k, v in sorted(q98.items())},
            "n_pos": int(len(P_s)), "n_neg": int(len(N_s)),
        }

        fig, ax = plt.subplots(figsize=(6.4, 2.8))
        bins = np.linspace(min(N_s.min(), P_s.min()), max(N_s.max(), P_s.max()), 70)
        for o, col in zip(sorted(q98), ["#888780", "#B4B2A9", "#5F5E5A", "#D3D1C7"]):
            ax.hist(N_s[neg_spk == o], bins=bins, alpha=0.55, density=True, label=o, color=col)
        ax.hist(P_s, bins=bins, alpha=0.75, density=True, label=f"{T} (held-out video)", color="#185FA5")
        ax.axvline(t_far2, color="#A32D2D", ls="--", lw=1, label="threshold")
        ax.set_xlabel("smoothed cosine score (~3 s)")
        ax.set_yticks([])
        ax.legend(fontsize=8, frameon=False)
        ax.spines[["top", "right", "left"]].set_visible(False)
        hist_imgs[T] = fig_b64(fig)

        lo, hi = np.argsort(P_s)[:8], np.argsort(-N_s)[:8]
        worst[T] = {"missed": [(segs[P_idx[i]], float(P_s[i])) for i in lo],
                    "false": [(segs[N_idx[i]], float(N_s[i])) for i in hi]}

    # what the extension would decide on each unseen video (raw smoothed scores, per-target thresholds)
    conf = defaultdict(lambda: defaultdict(int))
    for V in sorted(set(vid)):
        names = [T for T in targets if ((spk == T) & (vid != V)).any()]
        if not names:
            continue
        idx = np.where(vid == V)[0]
        S = np.stack([smooth_by_clip(scores(V, T, False), clip)[idx] for T in names], 1)
        margin = S - np.array([results[T]["threshold_far2"] for T in names])
        for row, i in zip(margin, idx):
            j = int(row.argmax())
            conf[spk[i]][names[j] if row[j] >= 0 else "(no mute)"] += 1

    # honest check: score ALL windows (cleaning flatters the test side), fixed global thresholds
    spk_all = np.array([s_["speaker"] for s_ in segs_all])
    vid_all = np.array([s_["video_id"] for s_ in segs_all])
    clip_all = np.array([s_["clip_id"] for s_ in segs_all])
    uncleaned = {}
    for T in targets:
        for thr in FIXED_THRESHOLDS:
            m1, m3, f1, f3 = [], [], defaultdict(list), defaultdict(list)
            for V in videos_of[T]:
                vp = robust_centroid(X[(spk == T) & (vid != V)])
                s1 = embs_all @ vp
                s3 = smooth_by_clip(s1, clip_all)
                p_ = (spk_all == T) & (vid_all == V)
                m1.append(s1[p_] < thr); m3.append(s3[p_] < thr)
                for o in set(spk_all) - {T}:
                    f1[o].append(s1[spk_all == o] >= thr); f3[o].append(s3[spk_all == o] >= thr)
            cat = lambda v: float(np.concatenate(v).mean())
            uncleaned.setdefault(T, {})[str(thr)] = {
                "miss_window": round(cat(m1), 4), "miss_smoothed": round(cat(m3), 4),
                "worst_false_accept_window": round(max(cat(v) for v in f1.values()), 4),
                "worst_false_accept_smoothed": round(max(cat(v) for v in f3.values()), 4),
                "worst_speaker": max(f1, key=lambda o: cat(f1[o])),
            }

    out_json = {"targets": results, "uncleaned_fixed_threshold": uncleaned, "confusion": {k: dict(v) for k, v in conf.items()},
                "smoothing_windows": SMOOTH, "window_s": 1.5, "hop_s": 0.75}
    (reports / "separation.json").write_text(json.dumps(out_json, indent=2))

    summary = json.loads((derived / "clean_summary.json").read_text())
    _write_html(reports / "separation.html", results, hist_imgs, worst, conf, targets, speakers, summary, videos_of, uncleaned)
    for T, r in results.items():
        print(f"{T:<8} EER window raw={r['eer_window_raw']:.1%} centered={r['eer_window_centered']:.1%} "
              f"smoothed={r['eer_smoothed']:.1%} | thr={r['threshold_far2']:.3f} miss={r['miss_at_far2']:.1%} closest={r['closest_other_speaker']}")


def _write_html(path, results, imgs, worst, conf, targets, speakers, clean_summary, videos_of, uncleaned):
    e = html.escape
    cols = targets + ["(no mute)"]
    pct = lambda x: f"{100*x:.1f}%"
    parts = [f"""<!doctype html><meta charset="utf-8"><title>Parliament Mute: separation report</title>
<style>body{{font:15px/1.55 -apple-system,system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#2c2c2a}}
h1{{font-size:22px;font-weight:500}}h2{{font-size:18px;font-weight:500;margin-top:32px}}h3{{font-size:16px;font-weight:500}}
table{{border-collapse:collapse;margin:8px 0;font-size:13px}}td,th{{border:1px solid #d3d1c7;padding:4px 8px;text-align:right}}
th{{background:#f1efe8;font-weight:500}}td:first-child,th:first-child{{text-align:left}}.muted{{color:#5f5e5a;font-size:13px}}
img{{max-width:100%}}a{{color:#185FA5}}</style>
<h1>Parliament Mute: separation report</h1>
<p class="muted">Model: WeSpeaker ResNet34 (VoxCeleb), 1.5 s windows, hop 0.75 s, smoothing over {SMOOTH} windows (~3 s).
Each target's voiceprint is built only from its <em>other</em> videos (leave-one-video-out), so every score below is on unseen recordings.
Scores are raw cosine (no centering) unless labeled. Lower EER is better. "Miss" = share of the target's speech still heard when the threshold is set so that <em>each</em> other speaker individually triggers music on at most 2% of their speech.</p>
<h2>Summary</h2><table><tr><th>Target</th><th>Videos</th><th>EER per window</th><th>EER centered</th><th>EER smoothed</th><th>Miss @ 2% false mutes</th><th>Threshold</th></tr>"""]
    for T in targets:
        r = results[T]
        parts.append(f"<tr><td>{e(T)}</td><td>{len(r['videos'])}</td><td>{pct(r['eer_window_raw'])}</td><td>{pct(r['eer_window_centered'])}</td>"
                     f"<td>{pct(r['eer_smoothed'])}</td><td>{pct(r['miss_at_far2'])}</td><td>{r['threshold_far2']:.3f}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>Stricter check: all windows, fixed threshold</h2><p class='muted'>Cleaning removes each clip's least typical windows, "
                 "which flatters the numbers above. Here every window counts (including the chair's intros and heckles inside clips), "
                 "with one global threshold. \"Worst false mute\" is the single most-confused other speaker.</p>"
                 "<table><tr><th>Target</th><th>Threshold</th><th>Miss 1.5 s</th><th>Miss ~3 s</th><th>Worst false mute 1.5 s</th><th>Worst false mute ~3 s</th><th>Most confused with</th></tr>")
    for T in targets:
        for thr, u in uncleaned[T].items():
            parts.append(f"<tr><td>{e(T)}</td><td>{thr}</td><td>{pct(u['miss_window'])}</td><td>{pct(u['miss_smoothed'])}</td>"
                         f"<td>{pct(u['worst_false_accept_window'])}</td><td>{pct(u['worst_false_accept_smoothed'])}</td><td>{e(u['worst_speaker'])}</td></tr>")
    parts.append("</table>")
    parts.append("<h2>Who triggers false mutes</h2><p class='muted'>Share of each other speaker's windows scoring above the target's threshold.</p><table><tr><th>Speaker</th>" + "".join(f"<th>vs {e(t)}</th>" for t in targets) + "</tr>")
    for s in speakers:
        parts.append(f"<tr><td>{e(s)}</td>" + "".join(
            f"<td>{pct(results[t]['false_accept_by_speaker_at_far2'][s]) if s in results[t]['false_accept_by_speaker_at_far2'] else '—'}</td>" for t in targets) + "</tr>")
    parts.append("</table>")

    parts.append("<h2>What would happen on unseen video</h2><p class='muted'>Each row is a true speaker; columns are what the extension would decide per smoothed window (row-normalized).</p>"
                 "<table><tr><th>True speaker</th>" + "".join(f"<th>{e(c)}</th>" for c in cols) + "</tr>")
    for s in speakers:
        tot = sum(conf[s].values()) or 1
        parts.append(f"<tr><td>{e(s)}</td>" + "".join(f"<td>{pct(conf[s].get(c, 0)/tot)}</td>" for c in cols) + "</tr>")
    parts.append("</table>")

    for T in targets:
        r = results[T]
        parts.append(f"<h2>{e(T)}</h2><img src='data:image/png;base64,{imgs[T]}'>")
        parts.append("<table><tr><th>Held-out video</th><th>Windows</th><th>EER smoothed</th></tr>" + "".join(
            f"<tr><td><a href='https://www.youtube.com/watch?v={pv['held_out_video']}'>{pv['held_out_video']}</a></td><td>{pv['pos_windows']}</td><td>{pct(pv['eer_smoothed'])}</td></tr>"
            for pv in r["per_video"]) + "</table>")
        for title, key in (("Hardest to recognize (lowest scores, listen to these)", "missed"), ("Most similar other speakers (highest impostor scores)", "false")):
            parts.append(f"<h3>{title}</h3><table><tr><th>Speaker</th><th>Clip time</th><th>Score</th><th>Listen</th></tr>")
            for seg, sc in worst[T][key]:
                parts.append(f"<tr><td>{e(seg['speaker'])}</td><td>{seg['start_s']:.1f}s</td><td>{sc:.3f}</td><td><a href='{yt(seg)}'>YouTube @ {int(seg['video_t_s'])}s</a></td></tr>")
            parts.append("</table>")

    parts.append("<h2>Cleaning: what was dropped</h2><table><tr><th>Clip</th><th>Windows</th><th>Dropped</th><th>In first 15 s</th></tr>")
    for c in clean_summary:
        parts.append(f"<tr><td>{e(c['clip_id'])}</td><td>{c['windows']}</td><td>{c['dropped']} ({pct(c['dropped_frac'])})</td><td>{c['first15_dropped']}/{c['first15_windows']}</td></tr>")
    parts.append("</table><p class='muted'>Dropped intervals with YouTube links are in data/derived/clean_summary.json.</p>")
    path.write_text("".join(parts))
