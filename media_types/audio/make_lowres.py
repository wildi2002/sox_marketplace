"""
Produce two variants from the full-res MP3:

  _lowres.wav  — entire audio resampled to the SOX lowres sample rate.
                 SR = min(4000, round(480000 / duration_secs))
                 Matches buildLowresAudio() in PostListingModal.tsx.

  _both.wav    — as in the extended_audio_both algorithm:
                   first 240 000 samples at original SR (full-quality preview),
                   then the rest resampled down → up through the lowres pipeline
                   (quality collapses to ~lowres_sr effective resolution).
                 Concatenated into a single 44.1 kHz WAV so the transition is
                 audible at one consistent sample rate.
"""

import numpy as np
import librosa
import soundfile as sf
from pathlib import Path

FILE = Path(__file__).parent / "starostin-comedy-cartoon-funny.mp3"
AUDIO_CROP_SAMPLES = 240_000   # fixed circuit constant
AUDIO_LOWRES_BYTES = 480_000   # 240 000 × Int16 = 480 000 bytes

# ── Load at original sample rate ──────────────────────────────────────────────
y, sr = librosa.load(str(FILE), sr=None, mono=True)
total_samples = len(y)
duration_secs = total_samples / sr
# lowres SR: same formula as frontend buildLowresAudio
lowres_sr = min(4_000, max(200, round(AUDIO_LOWRES_BYTES / duration_secs)))

print(f"Source  : {FILE.name}")
print(f"SR      : {sr} Hz,  {total_samples} samples,  {duration_secs:.2f} s")
print(f"Lowres SR: {lowres_sr} Hz  (480 000 B budget / {duration_secs:.2f} s)")
print()

# ── 1. _lowres.wav ────────────────────────────────────────────────────────────
y_low = librosa.resample(y, orig_sr=sr, target_sr=lowres_sr)
out_low = FILE.parent / (FILE.stem + "_lowres.wav")
sf.write(str(out_low), y_low, lowres_sr, subtype="PCM_16")
print(f"Saved  : {out_low.name}")
print(f"         {len(y_low)} samples @ {lowres_sr} Hz  ({len(y_low)/lowres_sr:.2f} s)")
print()

# ── 2. _both.wav ──────────────────────────────────────────────────────────────
# Part A: first AUDIO_CROP_SAMPLES at original SR — verbatim, full quality.
preview = y[:AUDIO_CROP_SAMPLES]
print(f"Preview : {len(preview)} samples @ {sr} Hz  ({len(preview)/sr:.2f} s)  [full res]")

# Part B: remaining samples — resample down to lowres_sr then back up to sr.
# Round-tripping through ~3 kHz destroys the high-frequency content,
# matching what a buyer hears for the non-preview portion.
if total_samples > AUDIO_CROP_SAMPLES:
    rest = y[AUDIO_CROP_SAMPLES:]
    rest_down = librosa.resample(rest, orig_sr=sr, target_sr=lowres_sr)
    rest_up   = librosa.resample(rest_down, orig_sr=lowres_sr, target_sr=sr)
    # Trim/pad to exactly match the original rest length (resampling can drift by ±1)
    target_len = len(rest)
    if len(rest_up) > target_len:
        rest_up = rest_up[:target_len]
    elif len(rest_up) < target_len:
        rest_up = np.pad(rest_up, (0, target_len - len(rest_up)))
    print(f"Rest    : {len(rest)} samples  →  {len(rest_down)} @ {lowres_sr} Hz  →  back to {sr} Hz  [low res]")
    both = np.concatenate([preview, rest_up])
else:
    both = preview

out_both = FILE.parent / (FILE.stem + "_both.wav")
sf.write(str(out_both), both, sr, subtype="PCM_16")
print(f"\nSaved  : {out_both.name}")
print(f"         {len(both)} samples @ {sr} Hz  ({len(both)/sr:.2f} s)")
print(f"         transition at sample 240 000  =  {240_000/sr:.2f} s")
