"use client";

import fixWebmDuration from "fix-webm-duration";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import { useEthChfRate, ethToCHF } from "@/app/lib/useEthChfRate";
import { useToast } from "@/app/lib/ToastContext";
import { CANONICAL_FPS, canonicalVideoDims } from "@/app/lib/videoCanonical";

interface PostListingModalProps {
    onClose: () => void;
    vendorPk: string;
}

type ListingType = "general" | "image" | "audio" | "video";

// Video thumbnail: top-left 256×256 RGB24 of frame 0, matching circuits_v2 emit_video_thumb_gates.
const VIDEO_THUMB_W = 256;
const VIDEO_THUMB_H = 256;
const VIDEO_CLIP_SECONDS = 3; // default clip duration for extended_video_clip / _both

// ── Video preview encoding helpers ──────────────────────────────────────────

function getBestWebMCodec(): string {
    if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
        if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8";
    }
    return "video/webm";
}

function dataUrlToObjectUrl(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    const mime  = dataUrl.slice(0, comma).match(/:(.*?);/)?.[1] ?? "video/webm";
    const bin   = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

/**
 * Re-encodes the entire video at low resolution (~320px wide, 200 kbps VP9 WebM) with audio.
 *
 * Uses WebCodecs (VideoEncoder + AudioEncoder) + webm-muxer so that every frame
 * gets a correct PTS — producing a proper full-duration file regardless of how
 * fast we seek through the source.  Output fps is 5; audio is mono Opus 64 kbps.
 *
 * Falls back silently if VideoEncoder / AudioEncoder are unavailable (older browsers).
 */
async function encodeVideoLowRes(
    src: string, origW: number, origH: number, dur: number,
    audioBuffer: AudioBuffer | null,
    onProgress?: (done: number, total: number) => void,
): Promise<string> {
    const scale  = Math.min(1, 320 / Math.max(origW, origH));
    const outW   = Math.max(2, Math.round(origW * scale / 2) * 2);
    const outH   = Math.max(2, Math.round(origH * scale / 2) * 2);
    const OUT_FPS = 5;
    const totalVideoFrames = Math.ceil(dur * OUT_FPS);

    const { Muxer, ArrayBufferTarget } = await import("webm-muxer");

    // ── Muxer ──────────────────────────────────────────────────────────────
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: { codec: "V_VP9", width: outW, height: outH, frameRate: OUT_FPS },
        audio: { codec: "A_OPUS", numberOfChannels: 1, sampleRate: 48000 },
        firstTimestampBehavior: "offset",
    });

    // ── Video encoder ───────────────────────────────────────────────────────
    const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? undefined),
        error: (e) => { throw e; },
    });
    videoEncoder.configure({
        codec: "vp09.00.10.08",
        width: outW, height: outH,
        bitrate: 200_000,
        framerate: OUT_FPS,
        latencyMode: "quality",
    });

    // ── Audio encoder ───────────────────────────────────────────────────────
    const OUT_SR = 48_000;
    const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? undefined),
        error: (e) => { throw e; },
    });
    audioEncoder.configure({
        codec: "opus",
        numberOfChannels: 1,
        sampleRate: OUT_SR,
        bitrate: 64_000,
    });

    // ── Video frames: seek to each frame and encode ─────────────────────────
    const vid = document.createElement("video");
    vid.src = src;
    vid.muted = true;
    await new Promise<void>((res, rej) => { vid.onloadedmetadata = () => res(); vid.onerror = rej as any; });

    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext("2d")!;

    for (let fi = 0; fi < totalVideoFrames; fi++) {
        const t = Math.min(fi / OUT_FPS, dur - 0.001);
        // Set onseeked BEFORE currentTime to avoid the race where the event fires before the handler.
        if (fi === 0 && vid.readyState >= 2) {
            // Frame 0: video is already at t=0, no seek needed.
        } else {
            await new Promise<void>(r => { vid.onseeked = () => r(); vid.currentTime = t; });
        }
        ctx.drawImage(vid, 0, 0, outW, outH);
        const frame = new VideoFrame(canvas, {
            timestamp: Math.round(t * 1_000_000),
            duration:  Math.round(1_000_000 / OUT_FPS),
        });
        videoEncoder.encode(frame, { keyFrame: fi % (OUT_FPS * 2) === 0 });
        frame.close();
        onProgress?.(fi + 1, totalVideoFrames);
        // Yield to keep UI responsive between frame encodes.
        await new Promise<void>(r => setTimeout(r, 0));
    }

    // ── Audio: resample the shared AudioBuffer (decoded once in processVideoFile) ──
    if (audioBuffer) try {
        // Resample to 48 kHz mono via OfflineAudioContext.
        const offCtx = new OfflineAudioContext(1, Math.ceil(OUT_SR * audioBuffer.duration), OUT_SR);
        const srcNode = offCtx.createBufferSource();
        srcNode.buffer = audioBuffer;
        srcNode.connect(offCtx.destination);
        srcNode.start(0);
        const rendered = await offCtx.startRendering();
        const f32 = rendered.getChannelData(0);

        // Feed audio in 20 ms chunks.
        const CHUNK = Math.ceil(OUT_SR * 0.02);
        for (let i = 0; i < f32.length; i += CHUNK) {
            const slice = f32.slice(i, Math.min(i + CHUNK, f32.length));
            const ad = new AudioData({
                format: "f32",
                sampleRate: OUT_SR,
                numberOfFrames: slice.length,
                numberOfChannels: 1,
                timestamp: Math.round((i / OUT_SR) * 1_000_000),
                data: slice,
            });
            audioEncoder.encode(ad);
            ad.close();
        }
    } catch { /* silent if video has no audio track */ }

    await videoEncoder.flush();
    videoEncoder.close();
    await audioEncoder.flush();
    audioEncoder.close();
    muxer.finalize();

    return blobToDataUrl(new Blob([target.buffer], { type: "video/webm" }));
}

/**
 * Re-encodes the first `clipSec` seconds at full resolution (VP9 ~5 Mbps + Opus 128 kbps).
 * Uses WebCodecs + webm-muxer so frames get correct PTS and audio works without
 * requiring an unmuted autoplay gesture.
 */
async function encodeVideoClip(src: string, origW: number, origH: number, clipSec: number, audioBuffer: AudioBuffer | null): Promise<string> {
    const OUT_FPS = 30;
    const totalFrames = Math.ceil(clipSec * OUT_FPS);

    const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: { codec: "V_VP9", width: origW, height: origH, frameRate: OUT_FPS },
        audio: { codec: "A_OPUS", numberOfChannels: 1, sampleRate: 48000 },
        firstTimestampBehavior: "offset",
    });

    const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? undefined),
        error: (e) => { throw e; },
    });
    videoEncoder.configure({
        codec: "vp09.00.10.08",
        width: origW, height: origH,
        bitrate: 5_000_000,
        framerate: OUT_FPS,
        latencyMode: "quality",
    });

    const OUT_SR = 48_000;
    const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? undefined),
        error: (e) => { throw e; },
    });
    audioEncoder.configure({ codec: "opus", numberOfChannels: 1, sampleRate: OUT_SR, bitrate: 128_000 });

    // ── Video: seek to each frame in [0, clipSec) ─────────────────────────
    const vid = document.createElement("video");
    vid.src = src;
    vid.muted = true;
    await new Promise<void>((res, rej) => { vid.onloadedmetadata = () => res(); vid.onerror = rej as any; });

    const canvas = document.createElement("canvas");
    canvas.width = origW; canvas.height = origH;
    const ctx = canvas.getContext("2d")!;

    for (let fi = 0; fi < totalFrames; fi++) {
        const t = fi / OUT_FPS;
        if (fi === 0 && vid.readyState >= 2) {
            // already at t=0
        } else {
            await new Promise<void>(r => { vid.onseeked = () => r(); vid.currentTime = t; });
        }
        ctx.drawImage(vid, 0, 0, origW, origH);
        const frame = new VideoFrame(canvas, {
            timestamp: Math.round(t * 1_000_000),
            duration:  Math.round(1_000_000 / OUT_FPS),
        });
        videoEncoder.encode(frame, { keyFrame: fi % (OUT_FPS * 2) === 0 });
        frame.close();
        await new Promise<void>(r => setTimeout(r, 0));
    }

    // ── Audio: first clipSec seconds from the shared AudioBuffer ─────────
    if (audioBuffer) try {
        const clipSamples = Math.ceil(OUT_SR * clipSec);
        const offCtx = new OfflineAudioContext(1, clipSamples, OUT_SR);
        const srcNode = offCtx.createBufferSource();
        srcNode.buffer = audioBuffer;
        srcNode.connect(offCtx.destination);
        srcNode.start(0);
        const rendered = await offCtx.startRendering();
        const f32 = rendered.getChannelData(0);

        const CHUNK = Math.ceil(OUT_SR * 0.02);
        for (let i = 0; i < f32.length; i += CHUNK) {
            const slice = f32.slice(i, Math.min(i + CHUNK, f32.length));
            const ad = new AudioData({
                format: "f32", sampleRate: OUT_SR,
                numberOfFrames: slice.length, numberOfChannels: 1,
                timestamp: Math.round((i / OUT_SR) * 1_000_000),
                data: slice,
            });
            audioEncoder.encode(ad);
            ad.close();
        }
    } catch { /* silent if no audio track */ }

    await videoEncoder.flush();
    videoEncoder.close();
    await audioEncoder.flush();
    audioEncoder.close();
    muxer.finalize();

    return blobToDataUrl(new Blob([target.buffer], { type: "video/webm" }));
}

// Fixed crop window: 240 000 Int16 samples = 480 000 bytes (circuit constant).
// At 44.1 kHz ≈ 5.4 s; at 8 kHz ≈ 30 s — duration adapts naturally to source SR.
const AUDIO_CROP_SAMPLES = 240_000;
const AUDIO_CROP_BYTES   = AUDIO_CROP_SAMPLES * 2; // 480 000

// Fixed lowres output: N = 240 000 Int16 samples regardless of audio length.
// Stride K = ⌈total_samples / N⌉ — analogous to image NN thumbnail stride K_x/K_y.
// Quality scales inversely with duration (longer audio → larger K → coarser lowres).
const AUDIO_LOWRES_SAMPLES = 240_000;
const AUDIO_LOWRES_BYTES   = AUDIO_LOWRES_SAMPLES * 2; // 480 000

// ── BMP pixel helpers (must match circuits_v2.rs BMP_PIXELS_START_IN_X = 118) ──

/** Build canonical 24-bit bottom-up BMP bytes from any image file. */
async function buildBmpBytesFromFile(imgFile: File): Promise<{ bmpBytes: Uint8Array; bmpWidth: number; bmpHeight: number }> {
    const bmp = await createImageBitmap(imgFile);
    const bW = bmp.width, bH = bmp.height;
    const fc = new OffscreenCanvas(bW, bH);
    (fc.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(bmp, 0, 0);
    bmp.close();
    const px = (fc.getContext("2d") as OffscreenCanvasRenderingContext2D).getImageData(0, 0, bW, bH).data;
    const rowSize = (bW * 3 + 3) & ~3;
    const pixelSize = rowSize * bH;
    const bmpBytes = new Uint8Array(54 + pixelSize);
    const bv = new DataView(bmpBytes.buffer);
    bmpBytes[0] = 0x42; bmpBytes[1] = 0x4D;
    bv.setUint32(2, 54 + pixelSize, true); bv.setUint32(6, 0, true); bv.setUint32(10, 54, true);
    bv.setUint32(14, 40, true); bv.setInt32(18, bW, true); bv.setInt32(22, bH, true);
    bv.setUint16(26, 1, true); bv.setUint16(28, 24, true); bv.setUint32(30, 0, true);
    bv.setUint32(34, pixelSize, true); bv.setInt32(38, 2835, true); bv.setInt32(42, 2835, true);
    for (let y = 0; y < bH; y++) {
        const srcY = bH - 1 - y;
        for (let x = 0; x < bW; x++) {
            const s = (srcY * bW + x) * 4, d = 54 + y * rowSize + x * 3;
            bmpBytes[d] = px[s + 2]; bmpBytes[d + 1] = px[s + 1]; bmpBytes[d + 2] = px[s];
        }
    }
    return { bmpBytes, bmpWidth: bW, bmpHeight: bH };
}

/** Extract 256×256 NN-downscaled BGR bytes from BMP — same algorithm as circuit. */
function computeThumbBytesFromBmp(bmpBytes: Uint8Array, imgW: number, imgH: number): Uint8Array {
    const rowStride = (imgW * 3 + 3) & ~3;
    const out = new Uint8Array(256 * 256 * 3);
    for (let oy = 0; oy < 256; oy++) {
        for (let ox = 0; ox < 256; ox++) {
            const sx = Math.floor(ox * imgW / 256);
            const sy = Math.floor(oy * imgH / 256);
            const bmpRow = imgH - 1 - sy;
            const src = 54 + bmpRow * rowStride + sx * 3;
            const dst = (oy * 256 + ox) * 3;
            out[dst] = bmpBytes[src]; out[dst + 1] = bmpBytes[src + 1]; out[dst + 2] = bmpBytes[src + 2];
        }
    }
    return out;
}

/** Extract 256×256 native-res BGR crop at (cropX, cropY) from BMP — same algorithm as circuit. */
function computeCropBytesFromBmp(bmpBytes: Uint8Array, imgW: number, imgH: number, cropX: number, cropY: number): Uint8Array {
    const rowStride = (imgW * 3 + 3) & ~3;
    const out = new Uint8Array(256 * 256 * 3);
    for (let ty = 0; ty < 256; ty++) {
        for (let tx = 0; tx < 256; tx++) {
            const sx = cropX + tx;
            const sy = cropY + ty;
            const bmpRow = imgH - 1 - sy;
            const src = 54 + bmpRow * rowStride + sx * 3;
            const dst = (ty * 256 + tx) * 3;
            out[dst] = bmpBytes[src]; out[dst + 1] = bmpBytes[src + 1]; out[dst + 2] = bmpBytes[src + 2];
        }
    }
    return out;
}

/** Decode any audio file to a mono Int16-LE PCM preview at the ORIGINAL sample rate.
 *  Budget: 240 000 samples = 480 000 bytes (circuit constant).
 *  The audio is simply cropped — Hz and quality are NOT changed.
 *  Duration = min(full length, 240 000 / sampleRate). */
async function buildAudioPreview(file: File): Promise<{
    wavDataUrl: string;
    previewHash: string;
    durationSecs: number;
    bitrateKbps: number;
    pcmBytes: Uint8Array;
    sampleRate: number;
}> {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    await tempCtx.close();

    const durationSecs = Math.round(audioBuffer.duration);
    const bitrateKbps  = Math.round((file.size * 8) / audioBuffer.duration / 1000);

    // Keep the original sample rate — Web Audio supports up to 96 000 Hz.
    const sampleRate = Math.min(audioBuffer.sampleRate, 96_000);
    // Crop to however many samples fit in the budget (no padding for longer audio).
    const actualSamples = Math.min(AUDIO_CROP_SAMPLES, Math.round(audioBuffer.duration * sampleRate));

    const offlineCtx = new OfflineAudioContext(1, actualSamples, sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const rendered = await offlineCtx.startRendering();
    const channelData = rendered.getChannelData(0);

    // Container PCM: always AUDIO_CROP_BYTES (zero-padded when audio is short).
    const pcmInt16 = new Int16Array(AUDIO_CROP_SAMPLES); // zero-initialised
    for (let i = 0; i < actualSamples; i++) {
        pcmInt16[i] = Math.max(-32768, Math.min(32767, Math.round(channelData[i] * 32767)));
    }
    const pcmBytes = new Uint8Array(pcmInt16.buffer);

    // SHA256 over full 480 000 bytes (circuit constant)
    const hashBuf = await crypto.subtle.digest("SHA-256", pcmBytes);
    const previewHash = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");

    // Preview WAV: only actualSamples × 2 bytes — no trailing silence.
    const wavByteCount = actualSamples * 2;
    const wavBuf = new ArrayBuffer(44 + wavByteCount);
    const v = new DataView(wavBuf);
    v.setUint32(0,  0x52494646, false); // "RIFF"
    v.setUint32(4,  36 + wavByteCount, true);
    v.setUint32(8,  0x57415645, false); // "WAVE"
    v.setUint32(12, 0x666D7420, false); // "fmt "
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);            // PCM
    v.setUint16(22, 1, true);            // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true); // byteRate = rate × 1ch × 2B
    v.setUint16(32, 2, true);              // blockAlign
    v.setUint16(34, 16, true);             // 16-bit
    v.setUint32(36, 0x64617461, false);   // "data"
    v.setUint32(40, wavByteCount, true);
    // Copy raw Int16 bytes (not element values) into the WAV buffer
    new Uint8Array(wavBuf, 44).set(new Uint8Array(pcmInt16.buffer, 0, wavByteCount));

    const wavBlob = new Blob([wavBuf], { type: "audio/wav" });
    const wavDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(wavBlob);
    });

    return { wavDataUrl, previewHash, durationSecs, bitrateKbps, pcmBytes, sampleRate };
}

/** Decode file to full mono Int16 PCM and compute the decimated lowres hash.
 *  Stride K = ⌈total_samples / AUDIO_LOWRES_SAMPLES⌉ is derived from the actual duration,
 *  mirroring how the circuit reads K from the header field total_samples.
 *  Returns the hash hex, K, total sample count, and original sample rate so the
 *  caller can write the header fields for the canonical container. */
async function pcmDecimatedHash(file: File): Promise<{
    hash: string;
    strideK: number;
    totalSamples: number;
    sampleRate: number;
}> {
    const ab = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(ab.slice(0));
    await tempCtx.close();
    const sampleRate    = Math.min(audioBuffer.sampleRate, 96_000);
    const totalSamples  = Math.round(audioBuffer.duration * sampleRate);
    const strideK       = Math.ceil(totalSamples / AUDIO_LOWRES_SAMPLES);
    const offCtx = new OfflineAudioContext(1, totalSamples, sampleRate);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuffer; src.connect(offCtx.destination); src.start(0);
    const rendered = await offCtx.startRendering();
    const ch = rendered.getChannelData(0);
    // Full PCM
    const fullPcm = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++)
        fullPcm[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
    // Decimate: take every strideK-th sample — 1D NN downscaling
    const decimated = new Int16Array(AUDIO_LOWRES_SAMPLES);
    for (let i = 0; i < AUDIO_LOWRES_SAMPLES; i++)
        decimated[i] = fullPcm[Math.min(i * strideK, totalSamples - 1)];
    const hashBuf = await crypto.subtle.digest("SHA-256", decimated.buffer);
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return { hash, strideK, totalSamples, sampleRate };
}

/** Decode any audio file to a 4 kHz Int8 WAV for browser playback preview.
 *  The returned wavDataUrl is for listening only — NOT for hash commitment.
 *  d_lowres is computed separately via pcmDecimatedHash (1D NN decimation). */
async function buildLowresAudio(file: File): Promise<{
    wavDataUrl: string;
    durationSecs: number;
    bitrateKbps: number;
    effectiveSampleRate: number;
    originalSampleRate: number;
}> {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    await tempCtx.close();

    const durationSecs = audioBuffer.duration;
    const bitrateKbps  = Math.round((file.size * 8) / durationSecs / 1000);
    const originalSampleRate = Math.min(audioBuffer.sampleRate, 96_000);

    const effectiveSampleRate = Math.max(200, Math.min(4_000, Math.round(AUDIO_LOWRES_BYTES / durationSecs)));
    const actualSamples = Math.min(AUDIO_LOWRES_BYTES, Math.round(durationSecs * effectiveSampleRate));

    const offlineCtx = new OfflineAudioContext(1, actualSamples, effectiveSampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const rendered = await offlineCtx.startRendering();
    const channelData = rendered.getChannelData(0);

    const pcmInt8 = new Int8Array(AUDIO_LOWRES_BYTES); // zero-initialised
    for (let i = 0; i < actualSamples; i++) {
        pcmInt8[i] = Math.max(-128, Math.min(127, Math.round(channelData[i] * 127)));
    }

    // WAV for browser preview: only actualSamples bytes (no trailing silence).
    const wavBuf = new ArrayBuffer(44 + actualSamples);
    const v = new DataView(wavBuf);
    v.setUint32(0,  0x52494646, false); // "RIFF"
    v.setUint32(4,  36 + actualSamples, true);
    v.setUint32(8,  0x57415645, false); // "WAVE"
    v.setUint32(12, 0x666D7420, false); // "fmt "
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);            // PCM
    v.setUint16(22, 1, true);            // mono
    v.setUint32(24, effectiveSampleRate, true);
    v.setUint32(28, effectiveSampleRate, true); // byteRate = rate × 1ch × 1B
    v.setUint16(32, 1, true);            // blockAlign
    v.setUint16(34, 8, true);            // 8-bit
    v.setUint32(36, 0x64617461, false); // "data"
    v.setUint32(40, actualSamples, true);
    // WAV 8-bit is unsigned: offset signed by +128
    const wavData = new Uint8Array(wavBuf, 44);
    for (let i = 0; i < actualSamples; i++) {
        wavData[i] = pcmInt8[i] + 128;
    }

    const wavBlob = new Blob([wavBuf], { type: "audio/wav" });
    const wavDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(wavBlob);
    });

    return { wavDataUrl, durationSecs, bitrateKbps, effectiveSampleRate, originalSampleRate };
}

// Downscale any image (given as data URL) to max 400px for upload as public thumbnail.
// Only this thumbnail goes to the server — the original stays local.
async function downsizeToThumbnail(dataUrl: string): Promise<string> {
    const img = await createImageBitmap(await fetch(dataUrl).then((r) => r.blob()));
    const maxDim = 400;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0, width, height);
    img.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function generateThumbnailAndHash(file: File): Promise<{
    previewDataUrl: string;
    previewHash: string;
    rgbaBytes: Uint8ClampedArray;
    width: number;
    height: number;
}> {
    const bitmap = await createImageBitmap(file);
    const maxDim = 400;
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    const rgbaBytes = imageData.data;

    const hashBuffer = await crypto.subtle.digest("SHA-256", rgbaBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const previewHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const previewDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

    return { previewDataUrl, previewHash, rgbaBytes, width, height };
}

declare global {
    interface Window {
        electronAPI?: {
            analyzeImage: () => Promise<{
                success?: boolean;
                cancelled?: boolean;
                error?: string;
                filePath?: string;
                imageDataUrl?: string;
                thumbnail_hash?: string;
                brisque?: number;
            }>;
            generateZkProof: (payload: { filePath: string }) => Promise<any>;
            generateZkProofForListing: (payload: { listingId: number; filePath: string }) => Promise<any>;
            precompute: () => Promise<any>;
            uploadCiphertext: (payload: any) => Promise<any>;
        };
    }
}

export default function PostListingModal({ onClose, vendorPk }: PostListingModalProps) {
    const [listingType, setListingType] = useState<ListingType>("general");
    const handleListingTypeChange = (type: ListingType) => {
        setListingType(type);
        setAlgorithms(type === "image" ? "default" : type === "audio" ? "extended_audio" : type === "video" ? "extended_video" : "default");
        setSelectedFile(null);
        setSelectedImageDataUrl(null);
        setPreviewDataUrl(null);
        setPreviewHash(null);
        setBrisqueValue(null);
        setExtImgThumbHash(null);
        setExtImgWidth(null);
        setExtImgHeight(null);
        setExtImgSize(null);
        setAudioPreviewUrl(null);
        setAudioPreviewHash(null);
        setAudioDuration(null);
        setAudioBitrate(null);
        setAudioSize(null);
        setAudioLowresUrl(null);
        setAudioLowresHash(null);
        setAudioPreviewSr(null);
        setAudioLowresSr(null);
        setCropHash(null);
        setCropPreviewDataUrl(null);
        setCropX(null);
        setCropY(null);
        setCropBoxX(0);
        setCropBoxY(0);
        setVideoThumbDataUrl(null);
        setVideoThumbHash(null);
        setVideoClipDataUrl(null);
        setVideoClipHash(null);
        setVideoWidth(null);
        setVideoHeight(null);
        setVideoDuration(null);
        setVideoBitrate(null);
        setVideoSize(null);
        setVideoFps(null);
        setVideoClipFrames(null);
    };
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [tipCompletion, setTipCompletion] = useState("");
    const [tipDispute, setTipDispute] = useState("");
    const [timeoutDelay, setTimeoutDelay] = useState("");
    const [algorithms, setAlgorithms] = useState("default");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewZoom, setPreviewZoom] = useState(false);

    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const [previewHash, setPreviewHash] = useState<string | null>(null);
    const [brisqueValue, setBrisqueValue] = useState<number | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzingMsg, setAnalyzingMsg] = useState<string>("Processing video…");
    const [zkProofData, setZkProofData] = useState<any | null>(null);
    const [zkProofStatus, setZkProofStatus] = useState<"idle" | "generating" | "done" | "failed">("idle");
    const [imageFilePath, setImageFilePath] = useState<string | null>(null);
    // Extended image description fields (parsed from BMP container header)
    const [extImgThumbHash, setExtImgThumbHash] = useState<string | null>(null);
    const [extImgWidth, setExtImgWidth] = useState<number | null>(null);
    const [extImgHeight, setExtImgHeight] = useState<number | null>(null);
    const [extImgSize, setExtImgSize] = useState<number | null>(null);
    // Extended audio description fields
    const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
    const [audioPreviewHash, setAudioPreviewHash] = useState<string | null>(null);
    const [audioDuration, setAudioDuration] = useState<number | null>(null);
    const [audioBitrate, setAudioBitrate] = useState<number | null>(null);
    const [audioSize, setAudioSize] = useState<number | null>(null);
    // Low-res audio fields (extended_audio_lowres / extended_audio_both)
    const [audioLowresUrl, setAudioLowresUrl] = useState<string | null>(null);
    const [audioLowresHash, setAudioLowresHash] = useState<string | null>(null);
    // Sample rate fields: preview uses original SR; lowres uses adaptive SR
    const [audioPreviewSr, setAudioPreviewSr] = useState<number | null>(null);
    const [audioLowresSr, setAudioLowresSr] = useState<number | null>(null);
    // Image crop fields (extended_image_crop / extended_image_dual)
    const [cropHash, setCropHash] = useState<string | null>(null);
    const [cropPreviewDataUrl, setCropPreviewDataUrl] = useState<string | null>(null);
    const [cropX, setCropX] = useState<number | null>(null);
    const [cropY, setCropY] = useState<number | null>(null);
    // Crop selection UI state (in display px, relative to image element)
    const [cropBoxX, setCropBoxX] = useState(0);
    const [cropBoxY, setCropBoxY] = useState(0);
    const cropImgRef = useRef<HTMLImageElement>(null);
    const cropDragStart = useRef<{ mx: number; my: number; bx: number; by: number } | null>(null);
    // Video fields
    const [videoThumbDataUrl, setVideoThumbDataUrl] = useState<string | null>(null);
    const [videoThumbHash, setVideoThumbHash] = useState<string | null>(null);
    const [videoClipDataUrl, setVideoClipDataUrl] = useState<string | null>(null);
    const [videoClipHash, setVideoClipHash] = useState<string | null>(null);
    const [videoWidth, setVideoWidth] = useState<number | null>(null);
    const [videoHeight, setVideoHeight] = useState<number | null>(null);
    const [videoDuration, setVideoDuration] = useState<number | null>(null);
    const [videoBitrate, setVideoBitrate] = useState<number | null>(null);
    const [videoSize, setVideoSize] = useState<number | null>(null);  // canonical container size
    const [videoFps, setVideoFps] = useState<number | null>(null);
    const [videoClipFrames, setVideoClipFrames] = useState<number | null>(null);
    const [videoSr, setVideoSr] = useState<number | null>(null);
    const [videoNSamp, setVideoNSamp] = useState<number | null>(null);

    // Blob URLs for video preview players (converted from data URLs for Chrome seekability)
    const [videoThumbBlobSrc, setVideoThumbBlobSrc] = useState<string | null>(null);
    const [videoClipBlobSrc, setVideoClipBlobSrc]   = useState<string | null>(null);
    useEffect(() => {
        if (!videoThumbDataUrl) { setVideoThumbBlobSrc(null); return; }
        const url = dataUrlToObjectUrl(videoThumbDataUrl);
        setVideoThumbBlobSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [videoThumbDataUrl]);
    useEffect(() => {
        if (!videoClipDataUrl) { setVideoClipBlobSrc(null); return; }
        const url = dataUrlToObjectUrl(videoClipDataUrl);
        setVideoClipBlobSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [videoClipDataUrl]);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const ethChfRate = useEthChfRate();
    const { showToast } = useToast();

    const isElectron = typeof window !== "undefined" && !!window.electronAPI;

    // Electron mode: open native file dialog, run zk-host analyze locally.
    // The full original image never leaves the vendor's machine:
    // - zk-host analyze runs locally, returns only thumbnail_hash + BRISQUE
    // - We downscale the full imageDataUrl to a 400px thumbnail here in the browser
    // - Only this small thumbnail (public advertisement) is sent to the server
    // - If algorithms="zk", also generate the SP1 ZK proof here at listing time
    const processImageDataUrl = async (dataUrl: string, algo: string) => {
        setPreviewDataUrl(null);
        setPreviewHash(null);
        setBrisqueValue(null);
        setExtImgThumbHash(null);
        setExtImgWidth(null);
        setExtImgHeight(null);
        setExtImgSize(null);
        if (algo === "default") return;
        const blob = await fetch(dataUrl).then((r) => r.blob());
        // Build BMP from the data URL to get exact pixel data matching the circuit.
        const bmpFile = new File([blob], "img.bmp", { type: blob.type });
        const { bmpBytes, bmpWidth: width, bmpHeight: height } = await buildBmpBytesFromFile(bmpFile);
        if (algo === "extended_image") {
            const bmpRowSize = (width * 3 + 3) & ~3;
            const bmpSize = 54 + bmpRowSize * height;
            const containerSize = 64 + bmpSize;
            setExtImgWidth(width);
            setExtImgHeight(height);
            setExtImgSize(containerSize);
        }
        // Compute d_thumb from BMP pixels (NN, BGR, bottom-to-top — same as circuit)
        const thumbBytes = computeThumbBytesFromBmp(bmpBytes, width, height);
        const thumbHashBuf = await crypto.subtle.digest("SHA-256", thumbBytes.buffer as ArrayBuffer);
        const thumbHash = Array.from(new Uint8Array(thumbHashBuf))
            .map((b) => b.toString(16).padStart(2, "0")).join("");
        setExtImgThumbHash(thumbHash);
        setPreviewHash(thumbHash);
        // Generate preview image from BGR thumb bytes (convert BGR→RGBA for display)
        const previewCanvas = new OffscreenCanvas(256, 256);
        const previewCtx = previewCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        const previewImgData = previewCtx.createImageData(256, 256);
        for (let i = 0; i < 65536; i++) {
            previewImgData.data[i * 4]     = thumbBytes[i * 3 + 2]; // R (from BGR)
            previewImgData.data[i * 4 + 1] = thumbBytes[i * 3 + 1]; // G
            previewImgData.data[i * 4 + 2] = thumbBytes[i * 3];     // B
            previewImgData.data[i * 4 + 3] = 255;
        }
        previewCtx.putImageData(previewImgData, 0, 0);
        const thumbBlob = await previewCanvas.convertToBlob({ type: "image/png" });
        const previewUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(thumbBlob);
        });
        setPreviewDataUrl(previewUrl);
    };

    const handleElectronSelectImage = async () => {
        if (!window.electronAPI) return;
        setIsAnalyzing(true);
        setZkProofData(null);
        setZkProofStatus("idle");
        try {
            const result = await window.electronAPI.analyzeImage();
            if (result.cancelled) return;
            if (result.error) { showToast(`Image analysis failed: ${result.error}`, "error"); return; }
            if (!result.imageDataUrl) { showToast("Image analysis returned no preview data", "error"); return; }
            setSelectedImageDataUrl(result.imageDataUrl);
            setImageFilePath(result.filePath ?? null);
            if (algorithms === "extended_image") {
                await processImageDataUrl(result.imageDataUrl, "extended_image");
            } else if (algorithms === "default") {
                // Hash Commitment: no preview
                setPreviewDataUrl(null);
                setPreviewHash(null);
                setBrisqueValue(null);
            } else {
                // ZK: use native thumbnail + BRISQUE
                const thumbnailDataUrl = await downsizeToThumbnail(result.imageDataUrl);
                setPreviewDataUrl(thumbnailDataUrl);
                setPreviewHash(result.thumbnail_hash ?? null);
                setBrisqueValue(result.brisque ?? null);
            }
        } catch (e: any) {
            showToast(`Image analysis error: ${e.message}`, "error");
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Process image file for the given algorithm. Called on file select and on algorithm change.
    // - "default" (Hash Commitment): no preview, no BRISQUE — file is selected at fulfillment time only.
    // - "extended_image": browser converts to canonical BMP, computes 256×256 thumbnail + hash + dimensions.
    // - "zk": browser generates thumbnail + BRISQUE score.
    // The original image file is NEVER sent to the server.
    const processImageFile = async (file: File, algo: string) => {
        setIsAnalyzing(true);
        setPreviewDataUrl(null);
        setPreviewHash(null);
        setBrisqueValue(null);
        setExtImgThumbHash(null);
        setExtImgWidth(null);
        setExtImgHeight(null);
        setExtImgSize(null);
        setCropHash(null);
        setCropPreviewDataUrl(null);
        setCropX(null);
        setCropY(null);
        setCropBoxX(0);
        setCropBoxY(0);

        if (algo === "default") {
            setIsAnalyzing(false);
            return;
        }

        try {
            if (algo === "extended_image" || algo === "extended_image_crop" || algo === "extended_image_dual") {
                // Build canonical BMP to get exact pixel data matching the circuit.
                const { bmpBytes, bmpWidth: width, bmpHeight: height } = await buildBmpBytesFromFile(file);

                // Container = header(64B) + BMP (no pre-embedded thumb/crop sections)
                const bmpRowSize = (width * 3 + 3) & ~3;
                const bmpSize = 54 + bmpRowSize * height;
                const containerSize = 64 + bmpSize;
                setExtImgWidth(width);
                setExtImgHeight(height);
                setExtImgSize(containerSize);

                if (algo === "extended_image" || algo === "extended_image_dual") {
                    // Compute d_thumb from BMP pixels (NN, BGR, bottom-to-top — same as circuit)
                    const thumbBytes = computeThumbBytesFromBmp(bmpBytes, width, height);
                    const thumbHashBuf = await crypto.subtle.digest("SHA-256", thumbBytes.buffer as ArrayBuffer);
                    const thumbHash = Array.from(new Uint8Array(thumbHashBuf))
                        .map((b) => b.toString(16).padStart(2, "0")).join("");
                    setExtImgThumbHash(thumbHash);
                    setPreviewHash(thumbHash);

                    // Generate preview from BGR thumb bytes (convert BGR→RGBA for display)
                    const previewCanvas = new OffscreenCanvas(256, 256);
                    const previewCtx = previewCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                    const previewImgData = previewCtx.createImageData(256, 256);
                    for (let i = 0; i < 65536; i++) {
                        previewImgData.data[i * 4]     = thumbBytes[i * 3 + 2]; // R (from BGR)
                        previewImgData.data[i * 4 + 1] = thumbBytes[i * 3 + 1]; // G
                        previewImgData.data[i * 4 + 2] = thumbBytes[i * 3];     // B
                        previewImgData.data[i * 4 + 3] = 255;
                    }
                    previewCtx.putImageData(previewImgData, 0, 0);
                    const blob = await previewCanvas.convertToBlob({ type: "image/png" });
                    const previewUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    setPreviewDataUrl(previewUrl);
                }

                // For crop algorithms: crop selection is done interactively via the UI after file load.
            } else {
                // ZK: generate thumbnail + BRISQUE score
                const { previewDataUrl: dataUrl, previewHash: hash, rgbaBytes, width, height } = await generateThumbnailAndHash(file);
                setPreviewDataUrl(dataUrl);
                setPreviewHash(hash);
                const imageHex = Array.from(rgbaBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
                try {
                    const res = await fetch("/api/zk/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ image_hex: imageHex, width, height }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (typeof data.brisque === "number") setBrisqueValue(data.brisque);
                    }
                } catch (e: any) {
                    console.warn("BRISQUE server call failed:", e?.message);
                }
            }
        } catch (err: any) {
            showToast(`Image processing error: ${err.message}`, "error");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const processAudioFile = async (file: File, algo: string = algorithms) => {
        setIsAnalyzing(true);
        setAudioPreviewUrl(null);
        setAudioPreviewHash(null);
        setAudioDuration(null);
        setAudioBitrate(null);
        setAudioSize(null);
        setAudioLowresUrl(null);
        setAudioLowresHash(null);
        try {
            const needsPreview = algo === "extended_audio" || algo === "extended_audio_both";
            const needsLowres  = algo === "extended_audio_lowres" || algo === "extended_audio_both";

            let durationSecs = 0, bitrateKbps = 0, originalSr = 44100;

            if (needsPreview) {
                const result = await buildAudioPreview(file);
                durationSecs = result.durationSecs;
                bitrateKbps  = result.bitrateKbps;
                originalSr   = result.sampleRate;
                setAudioPreviewUrl(result.wavDataUrl);
                setAudioPreviewHash(result.previewHash);
                setAudioPreviewSr(result.sampleRate);
            }
            if (needsLowres) {
                const lowresResult = await pcmDecimatedHash(file);
                setAudioLowresHash(lowresResult.hash);
                if (!needsPreview) {
                    // for extended_audio_lowres, get duration/bitrate from the WAV builder
                    const wavResult = await buildLowresAudio(file);
                    setAudioLowresUrl(wavResult.wavDataUrl);
                    setAudioLowresSr(wavResult.effectiveSampleRate);
                    durationSecs = Math.round(wavResult.durationSecs);
                    bitrateKbps  = wavResult.bitrateKbps;
                    originalSr   = lowresResult.sampleRate;
                } else {
                    // for extended_audio_both, WAV was already built by buildAudioPreview path... no
                    // we still need the lowres WAV for playback
                    const wavResult = await buildLowresAudio(file);
                    setAudioLowresUrl(wavResult.wavDataUrl);
                    setAudioLowresSr(wavResult.effectiveSampleRate);
                }
            }

            setAudioDuration(durationSecs || null);
            setAudioBitrate(bitrateKbps || null);

            // All variants: x = header(64B) || full mono Int16 PCM
            // Container size = 64 + max(AUDIO_CROP_SAMPLES, actualSamples) × 2
            // (at least AUDIO_CROP_SAMPLES so d_crop range is always defined)
            const estimatedSamples = Math.max(AUDIO_CROP_SAMPLES, Math.round(durationSecs * originalSr));
            setAudioSize(64 + estimatedSamples * 2);
        } catch (err: any) {
            showToast(`Audio processing error: ${err.message}`, "error");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleWebAudioSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        await processAudioFile(file, algorithms);
    };

    const handleAlgorithmChange = (algo: string) => {
        setAlgorithms(algo);
        if (listingType === "audio" && selectedFile) {
            processAudioFile(selectedFile, algo);
        } else if (listingType === "video" && selectedFile) {
            processVideoFile(selectedFile, algo);
        } else if (selectedFile && algo !== "default") {
            processImageFile(selectedFile, algo);
        } else if (selectedImageDataUrl && algo !== "default") {
            setIsAnalyzing(true);
            processImageDataUrl(selectedImageDataUrl, algo).finally(() => setIsAnalyzing(false));
        } else {
            setPreviewDataUrl(null);
            setPreviewHash(null);
            setBrisqueValue(null);
            setExtImgThumbHash(null);
            setExtImgWidth(null);
            setExtImgHeight(null);
            setExtImgSize(null);
            setCropHash(null);
            setCropPreviewDataUrl(null);
            setCropX(null);
            setCropY(null);
        }
    };

    const handleWebImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        await processImageFile(file, algorithms);
    };

    // Crop box drag handlers
    const handleCropMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        cropDragStart.current = { mx: e.clientX, my: e.clientY, bx: cropBoxX, by: cropBoxY };
        const onMove = (ev: MouseEvent) => {
            if (!cropDragStart.current || !cropImgRef.current) return;
            const img = cropImgRef.current;
            const displayW = img.offsetWidth;
            const displayH = img.offsetHeight;
            const natW = img.naturalWidth;
            const natH = img.naturalHeight;
            const boxW = Math.min(256 * displayW / natW, displayW);
            const boxH = Math.min(256 * displayH / natH, displayH);
            const dx = ev.clientX - cropDragStart.current.mx;
            const dy = ev.clientY - cropDragStart.current.my;
            const newX = Math.max(0, Math.min(cropDragStart.current.bx + dx, displayW - boxW));
            const newY = Math.max(0, Math.min(cropDragStart.current.by + dy, displayH - boxH));
            setCropBoxX(newX);
            setCropBoxY(newY);
        };
        const onUp = () => {
            cropDragStart.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [cropBoxX, cropBoxY]);

    const applyCrop = useCallback(async () => {
        if (!selectedFile || !cropImgRef.current) return;
        const img = cropImgRef.current;
        const displayW = img.offsetWidth;
        const displayH = img.offsetHeight;
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        const scaleX = natW / displayW;
        const scaleY = natH / displayH;

        const nativeX = Math.min(Math.round(cropBoxX * scaleX), Math.max(0, natW - 256));
        const nativeY = Math.min(Math.round(cropBoxY * scaleY), Math.max(0, natH - 256));

        // Build BMP and extract crop bytes matching the circuit algorithm (BGR, bottom-to-top rows)
        const { bmpBytes, bmpWidth, bmpHeight } = await buildBmpBytesFromFile(selectedFile);
        const cropBytes = computeCropBytesFromBmp(bmpBytes, bmpWidth, bmpHeight, nativeX, nativeY);
        const hashBuf = await crypto.subtle.digest("SHA-256", cropBytes.buffer as ArrayBuffer);
        const hash = Array.from(new Uint8Array(hashBuf))
            .map(b => b.toString(16).padStart(2, "0")).join("");

        // Generate a visual crop preview (BGR→RGBA for display)
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        const cropImgData = ctx.createImageData(256, 256);
        for (let i = 0; i < 65536; i++) {
            cropImgData.data[i * 4]     = cropBytes[i * 3 + 2]; // R (from BGR)
            cropImgData.data[i * 4 + 1] = cropBytes[i * 3 + 1]; // G
            cropImgData.data[i * 4 + 2] = cropBytes[i * 3];     // B
            cropImgData.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(cropImgData, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        setCropHash(hash);
        setCropPreviewDataUrl(url);
        setCropX(nativeX);
        setCropY(nativeY);
    }, [selectedFile, cropBoxX, cropBoxY]);

    const processVideoFile = useCallback(async (file: File, algo: string) => {
        setIsAnalyzing(true);
        setAnalyzingMsg("Analysing video…");
        setVideoThumbDataUrl(null); setVideoThumbHash(null);
        setVideoClipDataUrl(null); setVideoClipHash(null);
        setVideoWidth(null); setVideoHeight(null);
        setVideoDuration(null); setVideoBitrate(null);
        setVideoSize(null); setVideoFps(null); setVideoClipFrames(null);
        setVideoSr(null); setVideoNSamp(null);
        try {
            const objectUrl = URL.createObjectURL(file);
            // HTMLCanvasElement required (not OffscreenCanvas) so video frames render correctly
            const video = document.createElement("video");
            video.src = objectUrl;
            video.muted = true;
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => resolve();
                video.onerror = reject as any;
            });
            const origW = video.videoWidth;
            const origH = video.videoHeight;
            const dur   = Math.round(video.duration);
            // Canonical container dimensions: downscaled so the container fits in memory.
            // W,H ≥ 256 is required by the d_thumb circuit; long edge capped at ~480px.
            const { cW, cH } = canonicalVideoDims(origW, origH);
            const fps = CANONICAL_FPS;
            const needsThumb  = algo === "extended_video" || algo === "extended_video_both";
            const needsClip   = algo === "extended_video_clip" || algo === "extended_video_both";
            const clipSec     = Math.min(VIDEO_CLIP_SECONDS, dur);
            const nClipFrames = Math.round(clipSec * fps);

            // Canvas at canonical resolution — all hash computations use these dimensions.
            const canvas = document.createElement("canvas");
            canvas.width = cW; canvas.height = cH;
            const ctx = canvas.getContext("2d")!;

            // ── Hash: top-left 256×256 of frame 0 at canonical resolution (circuit d_thumb) ──
            if (video.readyState >= 2) {
                // already at t=0
            } else {
                await new Promise<void>(r => { video.onseeked = () => r(); video.currentTime = 0; });
            }
            ctx.drawImage(video, 0, 0, cW, cH);
            const thumbImgData = ctx.getImageData(0, 0, VIDEO_THUMB_W, VIDEO_THUMB_H);
            const thumbRgb = new Uint8Array(VIDEO_THUMB_W * VIDEO_THUMB_H * 3);
            for (let i = 0; i < VIDEO_THUMB_W * VIDEO_THUMB_H; i++) {
                thumbRgb[i * 3]     = thumbImgData.data[i * 4];
                thumbRgb[i * 3 + 1] = thumbImgData.data[i * 4 + 1];
                thumbRgb[i * 3 + 2] = thumbImgData.data[i * 4 + 2];
            }
            const thumbHashBuf = await crypto.subtle.digest("SHA-256", thumbRgb.buffer as ArrayBuffer);
            const thumbHash = Array.from(new Uint8Array(thumbHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

            // ── Hash: first nClipFrames raw RGB24 frames at canonical resolution (circuit d_clip) ──
            let clipHash: string | null = null;
            if (needsClip && nClipFrames > 0) {
                const frameBytes = cW * cH * 3;
                const clipBuf = new Uint8Array(nClipFrames * frameBytes);
                for (let f = 0; f < nClipFrames; f++) {
                    await new Promise<void>(r => { video.onseeked = () => r(); video.currentTime = f / fps; });
                    ctx.drawImage(video, 0, 0, cW, cH);
                    const idata = ctx.getImageData(0, 0, cW, cH);
                    const base = f * frameBytes;
                    for (let p = 0; p < cW * cH; p++) {
                        clipBuf[base + p * 3]     = idata.data[p * 4];
                        clipBuf[base + p * 3 + 1] = idata.data[p * 4 + 1];
                        clipBuf[base + p * 3 + 2] = idata.data[p * 4 + 2];
                    }
                }
                const clipHashBuf = await crypto.subtle.digest("SHA-256", clipBuf.buffer as ArrayBuffer);
                clipHash = Array.from(new Uint8Array(clipHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
            }

            const bitrateKbps = Math.round((file.size * 8 / 1024) / dur);

            // Decode audio once; share the resulting AudioBuffer with both encode functions.
            // Skipped for files > 1 GB to avoid OOM (decodeAudioData detaches the ArrayBuffer).
            const MAX_AUDIO_FILE_SIZE = 1_000_000_000;
            let audioBuffer: AudioBuffer | null = null;
            let sr = 44100;
            let nSamp = Math.round(dur * sr); // estimate; refined below if decode succeeds
            if (file.size <= MAX_AUDIO_FILE_SIZE) {
                try {
                    const ab = await file.arrayBuffer(); // detached by decodeAudioData
                    const tempCtx = new AudioContext();
                    audioBuffer = await tempCtx.decodeAudioData(ab);
                    await tempCtx.close();
                    sr = Math.min(audioBuffer.sampleRate, 96_000);
                    nSamp = Math.round(audioBuffer.duration * sr);
                } catch { /* silent video */ }
            }

            // Canonical container size: header(64) + F×cW×cH×3 + mono Int16 PCM
            const totalFrames = Math.round(dur * fps);
            const containerSize = 64 + totalFrames * cW * cH * 3 + nSamp * 2;

            // Store original resolution for display; circuit uses canonical dims derived at contract time.
            setVideoWidth(origW); setVideoHeight(origH); setVideoDuration(dur);
            setVideoBitrate(bitrateKbps); setVideoSize(containerSize); setVideoFps(fps);
            setVideoSr(sr); setVideoNSamp(nSamp);

            // ── Preview videos via WebCodecs ──────────────────────────────────
            // Thumbnail: whole film re-encoded at ~320px width, 200 kbps VP9
            if (needsThumb) {
                setVideoThumbHash(thumbHash);
                const thumbVideoUrl = await encodeVideoLowRes(objectUrl, cW, cH, dur, audioBuffer,
                    (done, total) => setAnalyzingMsg(`Encoding thumbnail… ${done}/${total} frames`));
                setAnalyzingMsg("Processing video…");
                setVideoThumbDataUrl(thumbVideoUrl);
            }
            // Clip: first clipSec seconds at full resolution, ~5 Mbps
            if (needsClip && nClipFrames > 0 && clipHash) {
                setVideoClipHash(clipHash);
                setVideoClipFrames(nClipFrames);
                setAnalyzingMsg(`Encoding first ${clipSec}s clip…`);
                const clipVideoUrl = await encodeVideoClip(objectUrl, cW, cH, clipSec, audioBuffer);
                setAnalyzingMsg("Processing video…");
                setVideoClipDataUrl(clipVideoUrl);
            }

            URL.revokeObjectURL(objectUrl);
        } catch (e: any) {
            showToast(`Video processing error: ${e.message}`, "error");
        } finally {
            setIsAnalyzing(false);
        }
    }, [showToast]);

    const handleVideoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        await processVideoFile(file, algorithms);
    }, [algorithms, processVideoFile]);

    const handleSubmit = async () => {
        if (!title.trim()) {
            showToast("Title is required", "warning");
            return;
        }
        if (!price || isNaN(parseFloat(price))) {
            showToast("A valid price is required", "warning");
            return;
        }
        if (listingType === "image" && (algorithms === "extended_image" || algorithms === "extended_image_crop" || algorithms === "extended_image_dual") && extImgWidth == null) {
            showToast("Please select an image file", "warning");
            return;
        }
        if (listingType === "image" && (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") && !cropHash) {
            showToast("Please apply a crop region before posting", "warning");
            return;
        }
        if (listingType === "image" && algorithms === "zk" && !previewDataUrl) {
            showToast("Please select an image file", "warning");
            return;
        }
        if (listingType === "audio" && (algorithms === "extended_audio" || algorithms === "extended_audio_both") && !audioPreviewUrl) {
            showToast("Please select an audio file", "warning");
            return;
        }
        if (listingType === "audio" && (algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") && !audioLowresUrl) {
            showToast("Please select an audio file", "warning");
            return;
        }
        if (listingType === "audio" && !audioSize) {
            showToast("Please select an audio file", "warning");
            return;
        }
        if (listingType === "video" && !videoSize) {
            showToast("Please select a video file", "warning");
            return;
        }
        if (listingType === "video" && (algorithms === "extended_video" || algorithms === "extended_video_both") && !videoThumbHash) {
            showToast("Please select a video file to generate thumbnail", "warning");
            return;
        }
        if (listingType === "video" && (algorithms === "extended_video_clip" || algorithms === "extended_video_both") && !videoClipHash) {
            showToast("Please select a video file to generate clip hash", "warning");
            return;
        }
        // Hash Commitment: no preview required at listing time — file provided at fulfillment

        setIsSubmitting(true);
        try {
            const body: Record<string, any> = {
                title: title.trim(),
                description: description.trim(),
                price: parseFloat(price),
                tip_completion: parseFloat(tipCompletion) || 0,
                tip_dispute: parseFloat(tipDispute) || 0,
                timeout_delay: parseInt(timeoutDelay) || 3600,
                algorithm_suite: algorithms,
                pk_vendor: vendorPk,
                listing_type: listingType,
            };

            if (listingType === "image") {
                body.preview_image = previewDataUrl;
                body.preview_hash = previewHash;
                body.brisque_value = brisqueValue;
                if (algorithms === "extended_image" || algorithms === "extended_image_crop" || algorithms === "extended_image_dual") {
                    body.ext_img_thumb_hash = extImgThumbHash;
                    body.ext_img_width = extImgWidth;
                    body.ext_img_height = extImgHeight;
                    body.ext_img_size = extImgSize;
                }
                if (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") {
                    body.preview_crop_image = cropPreviewDataUrl;
                    body.ext_img_crop_hash = cropHash;
                    body.ext_img_crop_x = cropX;
                    body.ext_img_crop_y = cropY;
                }
            }
            if (listingType === "audio") {
                body.ext_audio_duration    = audioDuration;
                body.ext_audio_bitrate     = audioBitrate;
                body.ext_audio_size        = audioSize;
                if (algorithms === "extended_audio" || algorithms === "extended_audio_both") {
                    body.preview_audio          = audioPreviewUrl;
                    body.ext_audio_preview_hash = audioPreviewHash;
                    body.ext_audio_preview_sr   = audioPreviewSr;
                }
                if (algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") {
                    body.preview_audio_lowres  = audioLowresUrl;
                    body.ext_audio_lowres_hash = audioLowresHash;
                    body.ext_audio_lowres_sr   = audioLowresSr;
                }
            }

            if (listingType === "video") {
                body.ext_video_width    = videoWidth;
                body.ext_video_height   = videoHeight;
                body.ext_video_duration = videoDuration;
                body.ext_video_bitrate  = videoBitrate;
                body.ext_video_size     = videoSize;  // canonical container size
                body.ext_video_fps      = videoFps;
                body.ext_video_sr       = videoSr;
                body.ext_video_n_samp   = videoNSamp;
                if (algorithms === "extended_video" || algorithms === "extended_video_both") {
                    body.preview_video_thumb  = videoThumbDataUrl;
                    body.ext_video_thumb_hash = videoThumbHash;
                }
                if (algorithms === "extended_video_clip" || algorithms === "extended_video_both") {
                    body.preview_video_clip    = videoClipDataUrl;
                    body.ext_video_clip_hash   = videoClipHash;
                    body.ext_video_clip_frames = videoClipFrames;
                }
            }

            const res = await fetch("/api/listings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to create listing");

            // If ZK algorithm selected, kick off background proof generation (Electron only)
            if (algorithms === "zk" && imageFilePath && window.electronAPI?.generateZkProofForListing) {
                const listingId = Number(data.id);
                // Fire-and-forget — the main process will PATCH the listing when done
                window.electronAPI.generateZkProofForListing({ listingId, filePath: imageFilePath })
                    .catch(() => {/* background — errors are non-blocking */});
                showToast("Listing posted. ZK proof is generating in the background.", "success", 6000);
            } else {
                showToast("Listing posted successfully.", "success");
            }

            window.dispatchEvent(new Event("reloadData"));
            onClose();
        } catch (e: any) {
            showToast(`Error: ${e.message}`, "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const brisqueBadgeColor =
        brisqueValue === null
            ? "bg-gray-200 text-gray-600"
            : brisqueValue < 30
            ? "bg-green-200 text-green-800"
            : brisqueValue < 60
            ? "bg-yellow-200 text-yellow-800"
            : "bg-red-200 text-red-800";

    return (
        <Modal title="Post New Listing" onClose={onClose}>
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex gap-2">
                    <button
                        type="button"
                        onClick={() => handleListingTypeChange("general")}
                        className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                            listingType === "general"
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                        File / General
                    </button>
                    <button
                        type="button"
                        onClick={() => handleListingTypeChange("image")}
                        className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                            listingType === "image"
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                        Image
                    </button>
                    <button
                        type="button"
                        onClick={() => handleListingTypeChange("audio")}
                        className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                            listingType === "audio"
                                ? "bg-purple-600 text-white border-purple-600"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                        Audio
                    </button>
                    <button
                        type="button"
                        onClick={() => handleListingTypeChange("video")}
                        className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                            listingType === "video"
                                ? "bg-green-600 text-white border-green-600"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                        Video
                    </button>
                </div>

                {listingType === "image" && (
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Image file</label>
                        {isElectron ? (
                            <button
                                type="button"
                                onClick={handleElectronSelectImage}
                                disabled={isAnalyzing}
                                className="px-3 py-1.5 rounded border border-gray-300 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                            >
                                {isAnalyzing ? "Analyzing…" : "Select Image…"}
                            </button>
                        ) : (
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleWebImageSelect}
                                disabled={isAnalyzing}
                                className="block w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 disabled:opacity-50"
                            />
                        )}
                        {algorithms === "extended_image" && !previewDataUrl && !isAnalyzing && (
                            <p className="mt-1 text-xs text-gray-500">
                                Select any image (PNG, JPEG, BMP…). Dimensions and thumbnail hash are computed locally — the original is never sent to the server.
                            </p>
                        )}
                        {isAnalyzing && (
                            <p className="mt-2 text-xs text-blue-600">
                                {algorithms === "extended_image" ? "Computing dimensions and thumbnail hash…" : "Computing thumbnail hash and BRISQUE…"}
                            </p>
                        )}
                        {(algorithms === "extended_image_crop" || algorithms === "extended_image_dual") && !previewDataUrl && !isAnalyzing && selectedFile && (
                            <p className="mt-1 text-xs text-blue-600">
                                Image loaded. Drag the blue box below to select the crop region, then click <strong>Apply Crop</strong>.
                            </p>
                        )}
                        {algorithms === "zk" && previewDataUrl && !isAnalyzing && (
                            <p className="mt-2 text-xs text-orange-600">ZK proof will be generated in the background after posting (~1 hour). The listing will appear in the marketplace once the proof is ready.</p>
                        )}
                        {previewDataUrl && (
                            <div className="mt-3 flex items-start gap-3">
                                <div
                                    className="overflow-hidden border border-gray-200 rounded cursor-zoom-in shrink-0"
                                    style={
                                        algorithms === "extended_image" && extImgWidth && extImgHeight
                                            ? {
                                                aspectRatio: `${extImgWidth}/${extImgHeight}`,
                                                maxHeight: "120px",
                                                maxWidth: "200px",
                                              }
                                            : { width: "120px", height: "120px" }
                                    }
                                    onClick={() => setPreviewZoom(true)}
                                    title="Click to enlarge"
                                >
                                    <img
                                        src={previewDataUrl}
                                        alt="Preview"
                                        className={algorithms === "extended_image" && extImgWidth && extImgHeight ? "w-full h-full object-fill" : "w-full h-full object-contain"}
                                    />
                                </div>
                                <div className="text-xs text-gray-500 space-y-1">
                                    {previewHash && (
                                        <p className="font-mono break-all">
                                            Hash: {previewHash.slice(0, 16)}…
                                        </p>
                                    )}
                                    {algorithms === "extended_image" ? (
                                        <>
                                            {extImgWidth != null && <p>Width: {extImgWidth} px</p>}
                                            {extImgHeight != null && <p>Height: {extImgHeight} px</p>}
                                            {extImgSize != null && <p>Size: {extImgSize.toLocaleString()} B</p>}
                                        </>
                                    ) : (
                                        <>
                                            {brisqueValue !== null && (
                                                <span className={`inline-block px-2 py-0.5 rounded text-xs ${brisqueBadgeColor}`}>
                                                    BRISQUE: {brisqueValue.toFixed(1)}
                                                </span>
                                            )}
                                            {brisqueValue === null && !isAnalyzing && (
                                                <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-xs">
                                                    BRISQUE unavailable
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Crop selection UI — shown when a crop algorithm is active and a file is loaded */}
                {listingType === "image" && (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") && selectedFile && extImgWidth != null && (
                    <div className="col-span-2 mt-2">
                        <p className="text-xs text-gray-500 mb-1">
                            Drag the blue box to select the 256×256 native-pixel crop region.
                            {cropHash && <span className="text-green-600 ml-2">✓ Crop applied</span>}
                        </p>
                        <div className="relative inline-block border border-gray-300 rounded overflow-hidden" style={{ maxWidth: "100%" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                ref={cropImgRef}
                                src={URL.createObjectURL(selectedFile)}
                                alt="Crop"
                                style={{ maxWidth: "100%", maxHeight: "300px", display: "block" }}
                            />
                            {/* Draggable crop box */}
                            {cropImgRef.current && (() => {
                                const img = cropImgRef.current!;
                                const dw = img.offsetWidth || 300;
                                const dh = img.offsetHeight || 200;
                                const natW = img.naturalWidth || extImgWidth || 1;
                                const natH = img.naturalHeight || extImgHeight || 1;
                                const boxW = Math.min(256 * dw / natW, dw);
                                const boxH = Math.min(256 * dh / natH, dh);
                                return (
                                    <div
                                        onMouseDown={handleCropMouseDown}
                                        style={{
                                            position: "absolute",
                                            left: cropBoxX,
                                            top: cropBoxY,
                                            width: boxW,
                                            height: boxH,
                                            border: "2px solid #3b82f6",
                                            background: "rgba(59,130,246,0.15)",
                                            cursor: "grab",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                );
                            })()}
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                            <button
                                type="button"
                                onClick={applyCrop}
                                className="px-3 py-1 text-sm rounded border border-blue-500 text-blue-700 bg-blue-50 hover:bg-blue-100"
                            >
                                Apply Crop
                            </button>
                            {cropPreviewDataUrl && (
                                <div className="flex items-center gap-2">
                                    <img src={cropPreviewDataUrl} alt="Crop preview" className="w-16 h-16 object-contain border border-gray-200 rounded" />
                                    <div className="text-xs text-gray-500">
                                        <p>Pos: {cropX}×{cropY} px (native)</p>
                                        <p className="font-mono break-all">Hash: {cropHash?.slice(0, 16)}…</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {listingType === "audio" && (
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Audio file</label>
                        <input
                            type="file"
                            accept="audio/*"
                            onChange={handleWebAudioSelect}
                            disabled={isAnalyzing}
                            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 disabled:opacity-50"
                        />
                        {!audioSize && !isAnalyzing && (
                            <p className="mt-1 text-xs text-gray-500">
                                Select MP3, WAV, FLAC or AAC. Preview/low-res audio is generated locally — the original is never sent to the server.
                            </p>
                        )}
                        {isAnalyzing && (
                            <p className="mt-2 text-xs text-purple-600">Decoding audio and building preview…</p>
                        )}
                        {audioSize != null && !isAnalyzing && (
                            <div className="mt-3 space-y-2">
                                {audioPreviewUrl && (
                                    <>
                                        <p className="text-xs text-gray-500">
                                            Preview{audioPreviewSr != null && audioDuration != null
                                                ? ` — ${audioPreviewSr.toLocaleString()} Hz · Int16 · ${Math.min(audioDuration, Math.round(240_000 / audioPreviewSr))}s of ${audioDuration}s`
                                                : audioPreviewSr != null ? ` — ${audioPreviewSr.toLocaleString()} Hz · Int16` : ""}:
                                        </p>
                                        <audio controls src={audioPreviewUrl} className="w-full h-8" />
                                        {audioPreviewHash && (
                                            <p className="text-xs font-mono text-gray-400 break-all">Preview hash: {audioPreviewHash.slice(0, 16)}…</p>
                                        )}
                                    </>
                                )}
                                {audioLowresUrl && (
                                    <>
                                        <p className="text-xs text-gray-500">
                                            Full low-res{audioLowresSr != null && audioDuration != null
                                                ? ` — ${audioLowresSr.toLocaleString()} Hz · Int8 · ${audioDuration}s`
                                                : audioLowresSr != null ? ` — ${audioLowresSr.toLocaleString()} Hz · Int8` : ""}:
                                        </p>
                                        <audio controls src={audioLowresUrl} className="w-full h-8" />
                                        {audioLowresHash && (
                                            <p className="text-xs font-mono text-gray-400 break-all">Low-res hash: {audioLowresHash.slice(0, 16)}…</p>
                                        )}
                                    </>
                                )}
                                <div className="text-xs text-gray-500 space-y-0.5">
                                    {audioDuration != null && <p>Duration: {audioDuration} s</p>}
                                    {audioBitrate  != null && <p>Bitrate: ~{audioBitrate} kbps</p>}
                                    {audioSize     != null && <p>Container size: {audioSize.toLocaleString()} B</p>}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {listingType === "video" && (
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Video file</label>
                        <input
                            type="file"
                            accept="video/*"
                            onChange={handleVideoSelect}
                            disabled={isAnalyzing}
                            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 disabled:opacity-50"
                        />
                        {!videoSize && !isAnalyzing && (
                            <p className="mt-1 text-xs text-gray-500">
                                Select MP4, WebM, MKV… Thumbnail and clip hash are computed locally — the original is never sent to the server.
                            </p>
                        )}
                        {isAnalyzing && <p className="mt-2 text-xs text-green-600">{analyzingMsg}</p>}
                        {videoSize != null && !isAnalyzing && (
                            <div className="mt-3 space-y-2">
                                {videoThumbBlobSrc && (
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Thumbnail (whole film, low-res WebM):</p>
                                        <video controls src={videoThumbBlobSrc} className="w-full max-h-52 rounded border border-gray-200 bg-black" preload="auto" />
                                        {videoThumbHash && <p className="text-xs font-mono text-gray-400 break-all mt-1">Thumb hash: {videoThumbHash.slice(0, 16)}…</p>}
                                    </div>
                                )}
                                {videoClipBlobSrc && (
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Clip preview — first {videoClipFrames} frames @ {videoFps} fps (full resolution):
                                        </p>
                                        <video controls src={videoClipBlobSrc} className="w-full max-h-52 rounded border border-gray-200 bg-black" preload="auto" />
                                        {videoClipHash && <p className="text-xs font-mono text-gray-400 break-all mt-1">Clip hash: {videoClipHash.slice(0, 16)}…</p>}
                                    </div>
                                )}
                                <div className="text-xs text-gray-500 space-y-0.5">
                                    {videoWidth != null && videoHeight != null && <p>Resolution: {videoWidth}×{videoHeight}</p>}
                                    {videoDuration != null && <p>Duration: {videoDuration} s</p>}
                                    {videoBitrate  != null && <p>Bitrate: ~{videoBitrate} kbps</p>}
                                    {videoFps      != null && <p>FPS: {videoFps}</p>}
                                    {videoSize     != null && <p>Container size (raw): {videoSize.toLocaleString()} B</p>}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="col-span-2">
                    <FormTextField id="listing-title" type="text" value={title} onChange={setTitle}>
                        Product Title
                    </FormTextField>
                </div>

                <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                    </label>
                    <textarea
                        className="w-full border border-gray-300 rounded p-2 text-sm"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe what you are selling..."
                    />
                </div>

                <div>
                    <FormTextField id="listing-price" type="number" value={price} onChange={setPrice}>
                        Price (ETH)
                    </FormTextField>
                    {ethToCHF(price, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(price, ethChfRate)} CHF</p>
                    )}
                </div>

                <div>
                    <FormTextField id="listing-tip-completion" type="number" value={tipCompletion} onChange={setTipCompletion}>
                        Tip for completion (ETH)
                    </FormTextField>
                    {ethToCHF(tipCompletion, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(tipCompletion, ethChfRate)} CHF</p>
                    )}
                </div>

                <div>
                    <FormTextField id="listing-tip-dispute" type="number" value={tipDispute} onChange={setTipDispute}>
                        Tip for dispute (ETH)
                    </FormTextField>
                    {ethToCHF(tipDispute, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(tipDispute, ethChfRate)} CHF</p>
                    )}
                </div>

                <FormTextField id="listing-timeout" type="number" value={timeoutDelay} onChange={setTimeoutDelay}>
                    Timeout delay (s)
                </FormTextField>

                <FormSelect
                    id="listing-algorithms"
                    value={algorithms}
                    onChange={handleAlgorithmChange}
                    options={
                        listingType === "image" ? ["default", "extended_image", "extended_image_crop", "extended_image_dual", "zk"] :
                        listingType === "audio" ? ["extended_audio", "extended_audio_lowres", "extended_audio_both"] :
                        listingType === "video" ? ["extended_video", "extended_video_clip", "extended_video_both"] :
                        ["default"]
                    }
                    optionLabels={{
                        default: "Hash Commitment (default)",
                        extended_image: "Thumb (256×256 scaled)",
                        extended_image_crop: "Crop (256×256 native)",
                        extended_image_dual: "Thumb + Crop (both)",
                        extended_audio: "Preview (native rate, cropped)",
                        extended_audio_lowres: "Full Low-res (adaptive rate, full duration)",
                        extended_audio_both: "Preview + Low-res (both)",
                        extended_video: "Thumbnail (256×256, frame 0)",
                        extended_video_clip: "Clip (first 3s raw frames)",
                        extended_video_both: "Thumbnail + Clip (both)",
                        zk: "ZK Proof (SP1, ~1h)",
                    }}
                    disabled={listingType === "general"}
                >
                    Algorithm suite
                </FormSelect>


                <div className="col-span-2 flex gap-4">
                    <Button
                        label={isSubmitting ? "Posting..." : "Post Listing"}
                        onClick={handleSubmit}
                        width="1/2"
                        isDisabled={isSubmitting || isAnalyzing}
                    />
                    <Button label="Cancel" onClick={onClose} width="1/2" />
                </div>
            </div>

            {previewZoom && previewDataUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
                    onClick={() => setPreviewZoom(false)}
                >
                    <img
                        src={previewDataUrl}
                        alt="Preview"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </Modal>
    );
}
