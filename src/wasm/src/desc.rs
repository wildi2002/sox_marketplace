/// desc.rs — T/Q/D/H component computation for the SOX description function.
///
/// desc(x̂) = SHA256(T ‖ Q ‖ D ‖ H) where:
///   T = thumb(x̂)   — visual preview bytes
///   Q = quality(x̂) — ELA-light Laplacian fingerprint or RMS profile
///   D = dim(x̂)     — dimension/metadata bytes
///   H = SHA256(x̂)  — hash of the full canonical container
///
/// x̂ is the uncompressed canonical container (BMP for images, PCM for audio).

use crate::sha256::sha256;
use crate::circuits_v2::BMP_PIXELS_START_IN_X;

pub const THUMB_W: usize = 256;
pub const THUMB_H: usize = 256;
/// Bytes per 256×256 RGB24 thumbnail: 256×256×3 = 196608.
pub const THUMB_BYTES: usize = THUMB_W * THUMB_H * 3;
/// Bytes for ELA-light quality map: 256×256×1 = 65536.
pub const QUALITY_BYTES: usize = THUMB_W * THUMB_H;
/// Preview samples for audio: 240000 samples × 2 bytes = 480000 bytes.
pub const AUDIO_N: usize = 240_000;
pub const AUDIO_THUMB_BYTES: usize = AUDIO_N * 2;

// ── ELA-light quality ─────────────────────────────────────────────────────────

/// Compute ELA-light quality fingerprint from the full-resolution BMP in the SOX container.
///
/// Algorithm:
///   1. Decode full-resolution grayscale from BMP pixel data in x_hat (bottom-to-top rows).
///   2. Apply discrete Laplacian at full resolution with same-pixel boundary padding.
///   3. Amplify × 10 and clamp to [0, 255].
///   4. Tile-average to 256×256: each output cell receives the mean of all source pixels
///      that map to it via integer partitioning (equivalent to INTER_AREA).
///
/// Returns 65536 bytes (one grayscale byte per 256×256 output pixel).
/// These raw bytes are stored as Q in d = SHA256(T ‖ Q ‖ D).
/// The JET colormap is applied only for display on the frontend.
pub fn compute_ela_light(x_hat: &[u8], w: u32, h: u32) -> Vec<u8> {
    let iw = w as usize;
    let ih = h as usize;
    let row_stride = (iw * 3 + 3) / 4 * 4;

    // Step 1: full-resolution grayscale (BMP is bottom-to-top).
    let mut gray = vec![0u8; iw * ih];
    for y in 0..ih {
        let bmp_row = ih.saturating_sub(1 + y);
        let row_base = BMP_PIXELS_START_IN_X + bmp_row * row_stride;
        for x in 0..iw {
            let base = row_base + x * 3;
            if base + 2 < x_hat.len() {
                let lum = (x_hat[base] as u32
                    + x_hat[base + 1] as u32
                    + x_hat[base + 2] as u32)
                    / 3;
                gray[y * iw + x] = lum as u8;
            }
        }
    }

    // Step 2: discrete Laplacian at full resolution; amplify × 10 and clamp.
    let mut lap = vec![0u8; iw * ih];
    for y in 0..ih {
        for x in 0..iw {
            let c = gray[y * iw + x] as i32;
            let t = if y > 0 { gray[(y - 1) * iw + x] as i32 } else { c };
            let b = if y + 1 < ih { gray[(y + 1) * iw + x] as i32 } else { c };
            let l = if x > 0 { gray[y * iw + (x - 1)] as i32 } else { c };
            let r = if x + 1 < iw { gray[y * iw + (x + 1)] as i32 } else { c };
            let delta = (4 * c - t - b - l - r).unsigned_abs();
            lap[y * iw + x] = (10 * delta).min(255) as u8;
        }
    }

    // Step 3: tile-average to 256×256.
    let mut q = vec![0u8; THUMB_W * THUMB_H];
    for oy in 0..THUMB_H {
        let r0 = oy * ih / THUMB_H;
        let r1 = ((oy + 1) * ih / THUMB_H).max(r0 + 1);
        for ox in 0..THUMB_W {
            let c0 = ox * iw / THUMB_W;
            let c1 = ((ox + 1) * iw / THUMB_W).max(c0 + 1);
            let count = ((r1 - r0) * (c1 - c0)) as u32;
            let mut sum = 0u32;
            for ty in r0..r1 {
                for tx in c0..c1 {
                    sum += lap[ty * iw + tx] as u32;
                }
            }
            q[oy * THUMB_W + ox] = (sum / count).min(255) as u8;
        }
    }
    q
}

// ── Image thumbnail helpers ───────────────────────────────────────────────────

/// Extract 256×256 nearest-neighbour lowres thumbnail from a BMP in the SOX container.
///
/// Container layout: 64B SOX header ‖ BMP file (pixel data at byte 118, bottom-to-top rows).
/// Returns 196608 bytes (BGR channel order, top-to-bottom output).
pub fn compute_lowres_thumb(x_hat: &[u8], w: u32, h: u32) -> Vec<u8> {
    let img_w = w as usize;
    let img_h = h as usize;
    let row_stride = (img_w * 3 + 3) / 4 * 4;
    let mut thumb = vec![0u8; THUMB_BYTES];
    for oy in 0..THUMB_H {
        for ox in 0..THUMB_W {
            let sx = ox * img_w / THUMB_W;
            let sy = oy * img_h / THUMB_H;
            let bmp_row = img_h.saturating_sub(1 + sy);
            let base = BMP_PIXELS_START_IN_X + bmp_row * row_stride + sx * 3;
            let dst = oy * THUMB_W * 3 + ox * 3;
            if base + 2 < x_hat.len() {
                thumb[dst]     = x_hat[base];
                thumb[dst + 1] = x_hat[base + 1];
                thumb[dst + 2] = x_hat[base + 2];
            }
        }
    }
    thumb
}

/// Extract 256×256 full-resolution crop at pixel origin (cx, cy) from a BMP in the SOX container.
/// Returns 196608 bytes (BGR channel order, top-to-bottom output).
pub fn compute_crop_thumb(x_hat: &[u8], w: u32, h: u32, cx: u32, cy: u32) -> Vec<u8> {
    let img_w = w as usize;
    let img_h = h as usize;
    let crop_x = cx as usize;
    let crop_y = cy as usize;
    let row_stride = (img_w * 3 + 3) / 4 * 4;
    let mut crop = vec![0u8; THUMB_BYTES];
    for oy in 0..THUMB_H {
        for ox in 0..THUMB_W {
            let sx = crop_x + ox;
            let sy = crop_y + oy;
            let bmp_row = img_h.saturating_sub(1 + sy);
            let base = BMP_PIXELS_START_IN_X + bmp_row * row_stride + sx * 3;
            let dst = oy * THUMB_W * 3 + ox * 3;
            if base + 2 < x_hat.len() {
                crop[dst]     = x_hat[base];
                crop[dst + 1] = x_hat[base + 1];
                crop[dst + 2] = x_hat[base + 2];
            }
        }
    }
    crop
}

// ── Audio component helpers ───────────────────────────────────────────────────

/// Extract first N=240000 samples as Int16-LE bytes = 480000 bytes.
///
/// Container layout: 64B header ‖ Int16-LE PCM at original SR.
pub fn compute_audio_crop_thumb(x_hat: &[u8]) -> Vec<u8> {
    let pcm_start = 64usize;
    let pcm_end = (pcm_start + AUDIO_THUMB_BYTES).min(x_hat.len());
    let mut t = vec![0u8; AUDIO_THUMB_BYTES];
    t[..pcm_end - pcm_start].copy_from_slice(&x_hat[pcm_start..pcm_end]);
    t
}

/// Compute 256-segment RMS energy profile = 1024 bytes (256 × float32-BE).
pub fn compute_rms_profile(x_hat: &[u8], n_samp: u32) -> Vec<u8> {
    const M: usize = 256;
    let pcm = if x_hat.len() > 64 { &x_hat[64..] } else { &[] };
    let n = n_samp as usize;
    let seg_size = (n / M).max(1);
    let mut out = vec![0u8; M * 4];
    for seg in 0..M {
        let start = seg * seg_size;
        let end = ((seg + 1) * seg_size).min(pcm.len() / 2);
        let count = end.saturating_sub(start);
        let mut sum_sq: f64 = 0.0;
        for i in start..end {
            let s = i16::from_le_bytes([
                *pcm.get(i * 2).unwrap_or(&0),
                *pcm.get(i * 2 + 1).unwrap_or(&0),
            ]) as f64;
            sum_sq += s * s;
        }
        let rms = if count > 0 { (sum_sq / count as f64).sqrt() as f32 } else { 0f32 };
        out[seg * 4..seg * 4 + 4].copy_from_slice(&rms.to_be_bytes());
    }
    out
}

/// Compute 256-segment second-difference quality proxy Q = 1024 bytes (256 × u32-BE).
///
/// Each u32 = mean(|∇²[i]|) over that segment, where:
///   ∇²[i] = pcm[i+2] − 2·pcm[i+1] + pcm[i]   (discrete Laplacian / second difference)
///
/// Computed in i32 to avoid Int16 overflow. |∇²[i]| ≤ 4·32768 = 131072, fits in u32.
///
/// Properties:
///   • Pure integer arithmetic — circuit-compatible, no floating point.
///   • Second-order HF proxy: amplifies rapid curvature changes; ~17× higher for genuine
///     full-res than for upsampled low-res (which is smooth after sinc resampling).
///   • Attack detection: mean(|∇²|) collapses ~7× at the transition in a "both" attack,
///     showing a clear temporal drop at the splice point (~5.44 s in the test file).
pub fn compute_delta_quality(x_hat: &[u8], n_samp: u32) -> Vec<u8> {
    const M: usize = 256;
    let pcm = if x_hat.len() > 64 { &x_hat[64..] } else { &[] };
    let n_d2 = (n_samp as usize).saturating_sub(2);
    let seg_size = (n_d2 / M).max(1);
    let mut out = vec![0u8; M * 4];
    for seg in 0..M {
        let start = seg * seg_size;
        let end = ((seg + 1) * seg_size).min(n_d2);
        let count = end.saturating_sub(start);
        if count == 0 { continue; }
        let mut sum: u64 = 0;
        for i in start..end {
            let a = i16::from_le_bytes([
                *pcm.get(i * 2).unwrap_or(&0),
                *pcm.get(i * 2 + 1).unwrap_or(&0),
            ]) as i32;
            let b = i16::from_le_bytes([
                *pcm.get((i + 1) * 2).unwrap_or(&0),
                *pcm.get((i + 1) * 2 + 1).unwrap_or(&0),
            ]) as i32;
            let c = i16::from_le_bytes([
                *pcm.get((i + 2) * 2).unwrap_or(&0),
                *pcm.get((i + 2) * 2 + 1).unwrap_or(&0),
            ]) as i32;
            sum += (c - 2 * b + a).unsigned_abs() as u64;
        }
        let mean = (sum / count as u64) as u32;
        out[seg * 4..seg * 4 + 4].copy_from_slice(&mean.to_be_bytes());
    }
    out
}

// ── Image desc functions ──────────────────────────────────────────────────────

/// Compute desc components for extended_image (lowres thumbnail only).
///
/// Returns (d, T, Q, D, H) where:
///   T = 196608B lowres thumbnail
///   Q = 65536B ELA-light of T
///   D = 8B: w ‖ h (each BE u32)
///   H = SHA256(x̂) = 32B
///   d = SHA256(T ‖ Q ‖ D ‖ H) = 32B
pub fn compute_image_desc_lowres(
    x_hat: &[u8],
    w: u32,
    h: u32,
) -> ([u8; 32], Vec<u8>, Vec<u8>, Vec<u8>, [u8; 32]) {
    let t = compute_lowres_thumb(x_hat, w, h);
    let q = compute_ela_light(x_hat, w, h);
    let d_dim: Vec<u8> = [w.to_be_bytes(), h.to_be_bytes()].concat();
    let h_container: [u8; 32] = sha256(x_hat).try_into().expect("SHA256 is always 32 bytes");
    let d: [u8; 32] = sha256_tqdh(&t, &q, &d_dim, &h_container);
    (d, t, q, d_dim, h_container)
}

/// Compute desc components for extended_image_crop (crop thumbnail only).
///
/// D = 16B: w ‖ h ‖ cx ‖ cy
pub fn compute_image_desc_crop(
    x_hat: &[u8],
    w: u32,
    h: u32,
    cx: u32,
    cy: u32,
) -> ([u8; 32], Vec<u8>, Vec<u8>, Vec<u8>, [u8; 32]) {
    let t = compute_crop_thumb(x_hat, w, h, cx, cy);
    let q = compute_ela_light(x_hat, w, h);
    let d_dim: Vec<u8> = [w.to_be_bytes(), h.to_be_bytes(), cx.to_be_bytes(), cy.to_be_bytes()].concat();
    let h_container: [u8; 32] = sha256(x_hat).try_into().expect("SHA256 is always 32 bytes");
    let d: [u8; 32] = sha256_tqdh(&t, &q, &d_dim, &h_container);
    (d, t, q, d_dim, h_container)
}

/// Compute desc components for extended_image_dual (lowres + crop).
///
/// T = 393216B: T_lr ‖ T_cr
/// Q = 65536B: ELA-light of T_lr
/// D = 16B: w ‖ h ‖ cx ‖ cy
pub fn compute_image_desc_dual(
    x_hat: &[u8],
    w: u32,
    h: u32,
    cx: u32,
    cy: u32,
) -> ([u8; 32], Vec<u8>, Vec<u8>, Vec<u8>, [u8; 32]) {
    let t_lr = compute_lowres_thumb(x_hat, w, h);
    let t_cr = compute_crop_thumb(x_hat, w, h, cx, cy);
    let q = compute_ela_light(x_hat, w, h);
    let d_dim: Vec<u8> = [w.to_be_bytes(), h.to_be_bytes(), cx.to_be_bytes(), cy.to_be_bytes()].concat();
    let mut t = Vec::with_capacity(THUMB_BYTES * 2);
    t.extend_from_slice(&t_lr);
    t.extend_from_slice(&t_cr);
    let h_container: [u8; 32] = sha256(x_hat).try_into().expect("SHA256 is always 32 bytes");
    let d: [u8; 32] = sha256_tqdh(&t, &q, &d_dim, &h_container);
    (d, t, q, d_dim, h_container)
}

// ── Audio desc ────────────────────────────────────────────────────────────────

/// Compute desc components for extended_audio (crop variant: first 240k samples).
///
/// T = 480000B: first N=240000 Int16 samples
/// Q = 1024B: 256-segment delta proxy (256 × u32-BE mean |Δ[i]|)
/// D = 12B: dur ‖ sr ‖ n_samp (each BE u32)
pub fn compute_audio_desc(
    x_hat: &[u8],
    dur: u32,
    sr: u32,
    n_samp: u32,
) -> ([u8; 32], Vec<u8>, Vec<u8>, Vec<u8>, [u8; 32]) {
    let t = compute_audio_crop_thumb(x_hat);
    let q = compute_delta_quality(x_hat, n_samp);
    let d_dim: Vec<u8> = [dur.to_be_bytes(), sr.to_be_bytes(), n_samp.to_be_bytes()].concat();
    let h_container: [u8; 32] = sha256(x_hat).try_into().expect("SHA256 is always 32 bytes");
    let d: [u8; 32] = sha256_tqdh(&t, &q, &d_dim, &h_container);
    (d, t, q, d_dim, h_container)
}

// ── Video desc ────────────────────────────────────────────────────────────────

/// Compute desc components for extended_video.
///
/// T = 196608B: top-left 256×256 RGB24 of frame 0
/// Q = 66560B: ELA-light of T (65536B) ‖ audio RMS profile (1024B)
/// D = 24B: w ‖ h ‖ dur ‖ fps ‖ sr ‖ n_samp (each BE u32)
///
/// `frame0_start`: byte offset of frame 0 pixel data in x̂ (= 64 for the SOX video container).
/// `audio_start`: byte offset of audio PCM in x̂ (= 64 + num_frames × w × h × 3).
pub fn compute_video_desc(
    x_hat: &[u8],
    w: u32,
    h: u32,
    dur: u32,
    fps: u32,
    sr: u32,
    n_samp: u32,
    audio_start: usize,
) -> ([u8; 32], Vec<u8>, Vec<u8>, Vec<u8>, [u8; 32]) {
    // T: top-left 256×256 of frame 0 (top-down RGB24, no BMP padding)
    let tw = (256usize).min(w as usize);
    let th = (256usize).min(h as usize);
    let mut t = vec![0u8; THUMB_BYTES];
    for y in 0..th {
        for x in 0..tw {
            let src = 64 + y * (w as usize) * 3 + x * 3;
            let dst = y * THUMB_W * 3 + x * 3;
            if src + 2 < x_hat.len() {
                t[dst]     = x_hat[src];
                t[dst + 1] = x_hat[src + 1];
                t[dst + 2] = x_hat[src + 2];
            }
        }
    }

    // Q: ELA-light of frame 0 at full resolution (65536B) ‖ delta proxy of audio (1024B)
    let ela = compute_ela_light(x_hat, w, h);
    let rms = if audio_start < x_hat.len() {
        let mut audio_hat = vec![0u8; 64];
        audio_hat.extend_from_slice(&x_hat[audio_start..]);
        compute_delta_quality(&audio_hat, n_samp)
    } else {
        vec![0u8; 1024]
    };
    let mut q = Vec::with_capacity(ela.len() + rms.len());
    q.extend_from_slice(&ela);
    q.extend_from_slice(&rms);

    let d_dim: Vec<u8> = [
        w.to_be_bytes(), h.to_be_bytes(),
        dur.to_be_bytes(), fps.to_be_bytes(),
        sr.to_be_bytes(), n_samp.to_be_bytes(),
    ].concat();

    let h_container: [u8; 32] = sha256(x_hat).try_into().expect("SHA256 is always 32 bytes");
    let d: [u8; 32] = sha256_tqdh(&t, &q, &d_dim, &h_container);
    (d, t, q, d_dim, h_container)
}

// ── Verification ──────────────────────────────────────────────────────────────

/// Verify that SHA256(T ‖ Q ‖ D ‖ H) == d.  Buyer pre-payment check.
pub fn verify_desc_components(d: &[u8], t: &[u8], q: &[u8], dim: &[u8], h_container: &[u8]) -> bool {
    if d.len() != 32 { return false; }
    sha256_tqdh(t, q, dim, h_container).as_ref() == d
}

// ── Internal helper ───────────────────────────────────────────────────────────

fn sha256_tqdh(t: &[u8], q: &[u8], dim: &[u8], h: &[u8]) -> [u8; 32] {
    let mut tqdh = Vec::with_capacity(t.len() + q.len() + dim.len() + h.len());
    tqdh.extend_from_slice(t);
    tqdh.extend_from_slice(q);
    tqdh.extend_from_slice(dim);
    tqdh.extend_from_slice(h);
    sha256(&tqdh).try_into().expect("SHA256 is always 32 bytes")
}
