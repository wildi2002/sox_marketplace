#!/usr/bin/env python3
"""
Compute BRISQUE score from an image file (JPEG/PNG).
Usage: python3 brisque_from_file.py <image_path>
Output: {"brisque": <float>}
"""
import sys
import json

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: brisque_from_file.py <image_path>"}))
        sys.exit(1)

    image_path = sys.argv[1]

    try:
        from PIL import Image
        import numpy as np
    except ImportError as e:
        print(json.dumps({"error": f"PIL/numpy not available: {e}"}))
        sys.exit(1)

    try:
        from brisque import BRISQUE
    except ImportError as e:
        print(json.dumps({"error": f"brisque not available: {e}"}))
        sys.exit(1)

    try:
        img = Image.open(image_path).convert('RGB')
        rgb = np.array(img)
        score = float(BRISQUE().score(rgb))
        print(json.dumps({"brisque": score}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
