# Models

| File | Model | Source | License |
|---|---|---|---|
| `wespeaker_resnet34_lm.onnx` | WeSpeaker ResNet34-LM speaker embedding, trained on VoxCeleb | [WeSpeaker](https://github.com/wenet-e2e/wespeaker) pretrained models, ONNX export from the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models) release | CC BY 4.0 (follows the VoxCeleb dataset license, as stated in WeSpeaker's docs/pretrained.md) |
| `silero_vad.onnx` | Silero VAD v5 | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) | MIT |

Checksums are in `SHA256SUMS`. The same files are copied into `extension/dist/models/` by the build.

WeSpeaker: Wang et al., "Wespeaker: A research and production oriented speaker embedding learning toolkit", ICASSP 2023.
VoxCeleb: Nagrani et al. 2017; Chung et al. 2018.
