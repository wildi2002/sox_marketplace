import cv2
import numpy as np


def compute_ela_light(img_bgr: np.ndarray) -> np.ndarray:
    """
    Compute Q = quality(x_hat) exactly as desc.rs does.

    Algorithm (matches desc.rs compute_ela_light byte-for-byte given the same pixels):
      1. Grayscale: (B + G + R) // 3   — integer average, not ITU weights.
      2. Discrete 4-neighbour Laplacian with same-pixel boundary padding.
      3. Amplify x10, clamp to [0, 255].
      4. Tile-average to 256x256 using integer partitioning (matches Rust code).

    Returns: 256x256 uint8 array of raw Q bytes (grayscale).
    """
    h, w = img_bgr.shape[:2]

    # Step 1: integer average grayscale (B + G + R) // 3
    gray = (img_bgr[:, :, 0].astype(np.uint32)
            + img_bgr[:, :, 1].astype(np.uint32)
            + img_bgr[:, :, 2].astype(np.uint32)) // 3
    gray = gray.astype(np.int32)

    # Step 2: discrete Laplacian with same-pixel boundary padding
    # top row / bottom row / left col / right col → copy center
    t = np.empty_like(gray); t[1:] = gray[:-1]; t[0] = gray[0]
    b = np.empty_like(gray); b[:-1] = gray[1:]; b[-1] = gray[-1]
    l = np.empty_like(gray); l[:, 1:] = gray[:, :-1]; l[:, 0] = gray[:, 0]
    r = np.empty_like(gray); r[:, :-1] = gray[:, 1:]; r[:, -1] = gray[:, -1]
    delta = np.abs(4 * gray - t - b - l - r)

    # Step 3: amplify x10, clamp
    lap = np.clip(10 * delta, 0, 255).astype(np.uint8)

    # Step 4: tile-average to 256x256 (integer partitioning as in Rust)
    out_size = 256
    q = np.zeros((out_size, out_size), dtype=np.uint8)
    for oy in range(out_size):
        r0 = oy * h // out_size
        r1 = max((oy + 1) * h // out_size, r0 + 1)
        for ox in range(out_size):
            c0 = ox * w // out_size
            c1 = max((ox + 1) * w // out_size, c0 + 1)
            q[oy, ox] = lap[r0:r1, c0:c1].mean()

    return q


def generate_ela_light_image(image_path: str, output_path: str) -> None:
    """
    Load image, compute Q, apply OpenCV JET colormap, save to output_path.
    The JET colormap is identical to the LUT used in the frontend (marketplace/page.tsx).
    """
    img = cv2.imread(image_path)
    if img is None:
        print(f"Could not read: {image_path}")
        return

    q = compute_ela_light(img)
    heatmap = cv2.applyColorMap(q, cv2.COLORMAP_JET)
    cv2.imwrite(output_path, heatmap)
    print(f"Saved: {output_path}  (mean Q = {q.mean():.2f})")


generate_ela_light_image('./media_types/images/Igel.jpeg',             './media_types/images/Igel_ela.jpeg')
generate_ela_light_image('./media_types/images/Igel_sox_preview.jpeg', './media_types/images/Igel_sox_preview_ela.jpeg')
