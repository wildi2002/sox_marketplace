/** Frames per second stored in the canonical SOX container. */
export const CANONICAL_FPS = 1;

/**
 * Canonical container dimensions from the original video resolution.
 * Constraints: W,H ≥ 256 (required by the d_thumb circuit), long edge ≤ 480 px.
 * Idempotent: applying twice returns the same result.
 */
export function canonicalVideoDims(origW: number, origH: number): { cW: number; cH: number } {
    const MAX_DIM = 480, MIN_DIM = 256;
    let scale = Math.min(1, MAX_DIM / Math.max(origW, origH));
    if (Math.min(origW, origH) * scale < MIN_DIM) {
        scale = MIN_DIM / Math.min(origW, origH);
    }
    const cW = Math.max(MIN_DIM, Math.round(origW * scale / 2) * 2);
    const cH = Math.max(MIN_DIM, Math.round(origH * scale / 2) * 2);
    return { cW, cH };
}
