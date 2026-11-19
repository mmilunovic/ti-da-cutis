"""pmute — offline pipeline for Parliament Mute.

  pmute segment   VAD + 1.5 s windows + embeddings      -> derived/segments.jsonl, embeddings.npy
  pmute clean     per-speaker outlier filter             -> derived/clean.jsonl, clean_summary.json
  pmute report    cross-video separation report (HTML)   -> reports/separation.html
  pmute export    voiceprints for the extension          -> data/voiceprints.json
  pmute all       all of the above
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(prog="pmute")
    ap.add_argument("step", choices=["segment", "clean", "report", "export", "all"])
    ap.add_argument("--repo", type=Path, default=Path("."), help="repo root (contains data/, models/)")
    ap.add_argument("--clips", type=Path, default=None, help="override data/clips location")
    ap.add_argument("--out", type=Path, default=None, help="override output root (default: repo)")
    a = ap.parse_args()

    repo = a.repo
    clips = a.clips or repo / "data" / "clips"
    out = a.out or repo
    derived = out / "data" / "derived"
    reports = out / "reports"

    if a.step in ("segment", "all"):
        from . import segment
        segment.run(repo / "data" / "manifest.jsonl", clips, repo / "models", derived)
    if a.step in ("clean", "all"):
        from . import clean
        clean.run(derived)
    if a.step in ("report", "all"):
        from . import report
        report.run(derived, reports)
    if a.step in ("export", "all"):
        from . import export
        export.run(derived, repo / "models", out / "data" / "voiceprints.json")


if __name__ == "__main__":
    main()
