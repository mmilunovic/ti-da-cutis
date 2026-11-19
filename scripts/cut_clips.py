"""Cut labeled single-speaker audio clips from YouTube, one at a time.

Setup (macOS):  brew install yt-dlp ffmpeg
Usage:          python3 scripts/cut_clips.py            (defaults below)
                python3 scripts/cut_clips.py data/clips.csv data/

Input  data/clips.csv   columns: speaker,url,start,end,split
                        times as SS, MM:SS or H:MM:SS; split = enroll | tune | test
Output data/clips/<speaker>/<clip_id>.wav   16 kHz mono WAV
       data/manifest.jsonl                  one JSON record per clip, appended as each finishes

Re-running is safe: clips already in the manifest with status "ok" (and present on disk) are skipped.
Failures are recorded with status "failed" and the batch continues.
"""
import csv
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CSV_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else "data/clips.csv")
ROOT = Path(sys.argv[2] if len(sys.argv) > 2 else "data")
CLIPS_DIR = ROOT / "clips"
MANIFEST = ROOT / "manifest.jsonl"
DURATION_TOLERANCE_S = 3.0


def find_tools() -> list[str]:
    if shutil.which("yt-dlp"):
        ytdlp = ["yt-dlp"]
    elif importlib.util.find_spec("yt_dlp"):
        ytdlp = [sys.executable, "-m", "yt_dlp"]
    else:
        sys.exit("yt-dlp not found. Install it with:  brew install yt-dlp   (or: python3 -m pip install -U yt-dlp)")
    missing = [t for t in ("ffmpeg", "ffprobe") if not shutil.which(t)]
    if missing:
        sys.exit(f"{', '.join(missing)} not found. Install with:  brew install ffmpeg")
    return ytdlp


YTDLP: list[str] = []


def to_seconds(t: str) -> int:
    parts = [int(p) for p in t.strip().split(":")]
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def hms(s: float) -> str:
    s = int(round(s))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def video_id(url: str) -> str:
    u = urlparse(url)
    return parse_qs(u.query).get("v", [u.path.rsplit("/", 1)[-1]])[0]


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


_titles: dict[str, str] = {}


def video_title(url: str) -> str:
    vid = video_id(url)
    if vid not in _titles:
        r = subprocess.run([*YTDLP, "--skip-download", "--print", "title", url],
                           capture_output=True, text=True)
        _titles[vid] = r.stdout.strip() if r.returncode == 0 else ""
    return _titles[vid]


def load_done() -> set[str]:
    if not MANIFEST.exists():
        return set()
    done = set()
    for line in MANIFEST.read_text().splitlines():
        rec = json.loads(line)
        if rec["status"] == "ok" and Path(rec["path"]).exists():
            done.add(rec["clip_id"])
    return done


def append(rec: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> None:
    global YTDLP
    YTDLP = find_tools()
    rows = list(csv.DictReader(CSV_PATH.open()))
    done = load_done()
    totals: dict[str, float] = defaultdict(float)
    n = len(rows)

    for i, r in enumerate(rows, 1):
        speaker, url = r["speaker"].strip(), r["url"].strip()
        start, end = to_seconds(r["start"]), to_seconds(r["end"])
        split = (r.get("split") or "enroll").strip()
        vid = video_id(url)
        clip_id = f"{speaker}__{vid}__{start:05d}-{end:05d}"
        out_dir = CLIPS_DIR / speaker
        out_path = out_dir / f"{clip_id}.wav"

        print(f"\n[{i}/{n}] {speaker:<10} {vid}  {hms(start)} -> {hms(end)}  ({hms(end - start)})  split={split}")
        if clip_id in done:
            print("    skip: already in manifest")
            continue
        if end <= start:
            print("    FAILED: end is not after start")
            append({"clip_id": clip_id, "speaker": speaker, "status": "failed", "error": "end<=start",
                    "url": url, "start_s": start, "end_s": end, "path": str(out_path)})
            continue

        out_dir.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        proc = subprocess.run([
            *YTDLP, "--no-playlist", "-x", "--audio-format", "wav",
            "--download-sections", f"*{hms(start)}-{hms(end)}",
            "--postprocessor-args", "ExtractAudio:-ar 16000 -ac 1",
            "--force-overwrites", "--force-keyframes-at-cuts",
            "-o", str(out_dir / f"{clip_id}.%(ext)s"),
            url,
        ])

        rec = {
            "clip_id": clip_id, "speaker": speaker, "split": split,
            "video_id": vid, "url": url, "video_title": video_title(url),
            "start_s": start, "end_s": end, "expected_s": end - start,
            "path": str(out_path), "sample_rate": 16000, "channels": 1,
            "reviewed": False, "notes": (r.get("notes") or "").strip(),
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        if proc.returncode != 0 or not out_path.exists():
            rec.update(status="failed", error=f"yt-dlp exit {proc.returncode}")
            append(rec)
            print(f"    FAILED: yt-dlp exit {proc.returncode}")
            continue

        dur = probe_duration(out_path)
        warn = abs(dur - (end - start)) > DURATION_TOLERANCE_S
        rec.update(status="ok", duration_s=round(dur, 2), duration_mismatch=warn)
        append(rec)
        totals[speaker] += dur
        print(f"    saved {out_path}  {hms(dur)}  in {time.time() - t0:.0f}s"
              + ("   WARNING: duration differs from requested range" if warn else ""))

    print("\nThis run:")
    for s, d in sorted(totals.items()):
        print(f"  {s:<10} {hms(d)}")
    print(f"Manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
