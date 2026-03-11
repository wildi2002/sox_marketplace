use image::imageops::FilterType;
use image::{DynamicImage, ImageBuffer, Rgb};
use crate::sha256_utils::sha256;

/// Decode image (JPEG/PNG), resize to fit 400×400 preserving aspect ratio,
/// return SHA256 of RGBA pixel bytes.
pub fn thumbnail_hash(image_bytes: &[u8]) -> Result<[u8; 32], String> {
    let img = load_image(image_bytes)?;
    let (orig_w, orig_h) = (img.width(), img.height());
    let max_dim = 400u32;

    let (new_w, new_h) = if orig_w == 0 || orig_h == 0 {
        (max_dim, max_dim)
    } else {
        let scale_w = max_dim as f64 / orig_w as f64;
        let scale_h = max_dim as f64 / orig_h as f64;
        let scale = scale_w.min(scale_h);
        let nw = ((orig_w as f64 * scale).round() as u32).max(1);
        let nh = ((orig_h as f64 * scale).round() as u32).max(1);
        (nw, nh)
    };

    let resized = image::imageops::resize(&img.to_rgba8(), new_w, new_h, FilterType::Lanczos3);
    let raw = resized.as_raw();
    Ok(sha256(raw))
}

/// Decode JPEG or PNG image bytes to DynamicImage.
/// Uses zune-jpeg for JPEG (no threading, SP1-compatible), and image crate for PNG.
pub fn load_image(image_bytes: &[u8]) -> Result<DynamicImage, String> {
    if is_jpeg(image_bytes) {
        decode_jpeg(image_bytes)
    } else {
        image::load_from_memory(image_bytes)
            .map_err(|e| format!("Failed to load image: {e}"))
    }
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xD8
}

fn decode_jpeg(jpeg_bytes: &[u8]) -> Result<DynamicImage, String> {
    use zune_jpeg::JpegDecoder;
    use zune_jpeg::zune_core::bytestream::ZCursor;
    use zune_jpeg::zune_core::colorspace::ColorSpace;
    use zune_jpeg::zune_core::options::DecoderOptions;

    let options = DecoderOptions::new_fast()
        .jpeg_set_out_colorspace(ColorSpace::RGB);

    let cursor = ZCursor::new(jpeg_bytes);
    let mut decoder = JpegDecoder::new_with_options(cursor, options);
    decoder.decode_headers().map_err(|e| format!("JPEG header error: {e:?}"))?;

    let info = decoder.info().ok_or("No JPEG info")?;
    let (width, height) = (info.width as u32, info.height as u32);

    let pixels = decoder.decode().map_err(|e| format!("JPEG decode error: {e:?}"))?;

    // pixels is RGB8 (3 bytes per pixel)
    let img_buf: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, pixels)
            .ok_or("Failed to create ImageBuffer from JPEG pixels")?;

    Ok(DynamicImage::ImageRgb8(img_buf))
}
