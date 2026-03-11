#!/usr/bin/env python3
"""
Compute BRISQUE score from raw RGBA bytes stored in a binary file.
Usage: python3 brisque_score.py <rgba_file_path> <width> <height>
Output: {"brisque": <float>}
"""
import sys
import json
import numpy as np

def main():
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: brisque_score.py <rgba_file_path> <width> <height>"}))
        sys.exit(1)

    file_path = sys.argv[1]
    width = int(sys.argv[2])
    height = int(sys.argv[3])

    try:
        from brisque import BRISQUE
    except ImportError as e:
        print(json.dumps({"error": f"brisque not available: {e}"}))
        sys.exit(1)

    with open(file_path, "rb") as f:
        raw = f.read()

    expected = width * height * 4
    if len(raw) != expected:
        print(json.dumps({"error": f"Expected {expected} bytes, got {len(raw)}"}))
        sys.exit(1)

    # RGBA -> RGB
    rgba = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 4))
    rgb = rgba[:, :, :3].copy()

    bq = BRISQUE()
    score = float(bq.score(rgb))

    print(json.dumps({"brisque": score}))

if __name__ == "__main__":
    main()
