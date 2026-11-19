"""ONNX model wrappers: Silero VAD (v5) and WeSpeaker ResNet34 speaker embeddings.

The browser extension must reproduce exactly the same feature pipeline:
  16 kHz mono float in [-1, 1]  ->  x * 32768  ->  Kaldi fbank (80 mel bins, 25 ms / 10 ms,
  hamming window, dither 0, snip_edges)  ->  per-window mean subtraction (CMN)  ->  model.
"""
from __future__ import annotations

from pathlib import Path

import kaldi_native_fbank as knf
import numpy as np
import onnxruntime as ort

SR = 16000
FRAME_SHIFT_S = 0.010


def _session(path: Path) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 0
    return ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])


class SileroVAD:
    """Frame-level speech probabilities, one per 512-sample chunk (32 ms)."""

    CHUNK = 512
    CONTEXT = 64

    def __init__(self, path: Path):
        self.sess = _session(path)

    def probs(self, wav: np.ndarray) -> np.ndarray:
        n = len(wav) // self.CHUNK
        state = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, self.CONTEXT), dtype=np.float32)
        sr = np.array(SR, dtype=np.int64)
        out = np.empty(n, dtype=np.float32)
        for i in range(n):
            chunk = wav[i * self.CHUNK:(i + 1) * self.CHUNK].astype(np.float32)[None, :]
            x = np.concatenate([context, chunk], axis=1)
            p, state = self.sess.run(None, {"input": x, "state": state, "sr": sr})
            out[i] = p[0, 0]
            context = x[:, -self.CONTEXT:]
        return out

    @property
    def frame_s(self) -> float:
        return self.CHUNK / SR


def fbank(wav: np.ndarray) -> np.ndarray:
    """Kaldi-compatible 80-dim log mel fbank for a whole signal. Returns (frames, 80)."""
    opts = knf.FbankOptions()
    opts.frame_opts.samp_freq = SR
    opts.frame_opts.dither = 0.0
    opts.frame_opts.window_type = "hamming"
    opts.frame_opts.snip_edges = True
    opts.mel_opts.num_bins = 80
    opts.energy_floor = 0.0
    fb = knf.OnlineFbank(opts)
    fb.accept_waveform(SR, (wav * 32768.0).astype(np.float32).tolist())
    fb.input_finished()
    return np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)]).astype(np.float32)


class SpeakerEmbedder:
    def __init__(self, path: Path):
        self.sess = _session(path)

    def embed_frames(self, feats: np.ndarray) -> np.ndarray:
        """feats: (B, T, 80) already CMN-normalized. Returns L2-normalized (B, 256)."""
        e = self.sess.run(None, {"feats": feats.astype(np.float32)})[0]
        return e / np.linalg.norm(e, axis=1, keepdims=True)
