"use client";

import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import FormFileInput from "../common/FormFileInput";
import { isAddress } from "ethers";
import init, {
    compute_precontract_values_v2,
    compute_precontract_extended_image_v2,
    compute_precontract_extended_image_crop_v2,
    compute_precontract_extended_image_dual_v2,
    compute_precontract_extended_audio_v2,
    compute_precontract_extended_audio_lowres_v2,
    compute_precontract_extended_audio_both_v2,
    compute_precontract_extended_video_v2,
    compute_precontract_extended_video_clip_v2,
    compute_precontract_extended_video_both_v2,
    bytes_to_hex,
} from "@/app/lib/crypto_lib";
import { useToast } from "@/app/lib/ToastContext";
import { CANONICAL_FPS, canonicalVideoDims } from "@/app/lib/videoCanonical";
import { hexToBytes } from "@/app/lib/helpers";

// Browser-side hash commitment fallback when SP1 ZK proof is unavailable.
// Computes proof = SHA256(preview_hash_bytes || brisque_float32_LE).
// Verifiable by /api/zk/verify (verifyHashCommitment path).
async function computeHashCommitment(previewHashHex: string, brisqueValue: number): Promise<{
    proof: string; c_k: string; thumbnail_hash: string; brisque: number;
}> {
    const hex = previewHashHex.replace("0x", "");
    const ckBytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < ckBytes.length; i++) ckBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const brisqueBuf = new ArrayBuffer(4);
    new DataView(brisqueBuf).setFloat32(0, brisqueValue, true);
    const combined = new Uint8Array(ckBytes.length + 4);
    combined.set(ckBytes);
    combined.set(new Uint8Array(brisqueBuf), ckBytes.length);
    const hashBuf = await crypto.subtle.digest("SHA-256", combined);
    const proof = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { proof, c_k: hex, thumbnail_hash: hex, brisque: brisqueValue };
}

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

// ── Video container helpers (must match circuits_v2.rs layout) ──
// Container: header(64B) || raw RGB24 frames || mono Int16-LE PCM
// Header: tag(1) | size(4) | dur(4) | br(4) | W(4) | H(4) | fps(4) | sr(4) | n_samp(4) | reserved(27)

/** Build canonical video container: header(64B) || all RGB24 frames || mono Int16-LE PCM.
 *
 * Frame extraction strategy:
 *   - If requestVideoFrameCallback is available: play at rate = min(60/fps, 16) so each
 *     display refresh captures exactly one target frame. Skipped frames (at high speeds)
 *     are filled by repeating the previous captured frame.
 *   - Fallback: sequential seek, one seek per frame (slow for high fps/long videos).
 *
 * Processing time ≈ duration × fps / 60  (e.g. 3 min @ 10 fps ≈ 30 s).
 */
async function buildVideoContainer(
    file: File, w: number, h: number, fps: number, duration: number, bitrateKbps: number, tag: number,
    onProgress?: (msg: string) => void,
): Promise<Uint8Array> {
    // ── Extract all RGB24 frames ──────────────────────────────────────────────
    const totalFrames = Math.round(duration * fps);
    const frameBytes  = w * h * 3;
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    await new Promise<void>((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = rej as any; });
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const allFramesBuf = new Uint8Array(totalFrames * frameBytes);

    const writeFrame = (frameIdx: number) => {
        const idata = ctx.getImageData(0, 0, w, h);
        const base = frameIdx * frameBytes;
        for (let p = 0; p < w * h; p++) {
            allFramesBuf[base + p * 3]     = idata.data[p * 4];
            allFramesBuf[base + p * 3 + 1] = idata.data[p * 4 + 1];
            allFramesBuf[base + p * 3 + 2] = idata.data[p * 4 + 2];
        }
    };

    // Seek to each target time so frame bytes match the listing's d_clip computation exactly.
    // (rvfc/playback gives different decoded pixels than seek on the same frames.)
    for (let f = 0; f < totalFrames; f++) {
        video.currentTime = f / fps;
        await new Promise<void>(r => { video.onseeked = () => r(); });
        ctx.drawImage(video, 0, 0, w, h);
        writeFrame(f);
        onProgress?.(`Extracting video frames… ${f + 1}/${totalFrames}`);
    }

    URL.revokeObjectURL(objectUrl);

    const yield_ = () => new Promise<void>(r => setTimeout(r, 0));

    // ── Decode audio to mono Int16-LE PCM ─────────────────────────────────────
    let sr = 44100;
    let nSamp = 0;
    let pcmBytes = new Uint8Array(0);
    onProgress?.("Decoding audio…");
    await yield_(); // let React render the status before the next blocking step
    try {
        const ab = await file.arrayBuffer();
        const tempCtx = new AudioContext();
        const audioBuffer = await tempCtx.decodeAudioData(ab);
        await tempCtx.close();
        sr = Math.min(audioBuffer.sampleRate, 96_000);
        nSamp = Math.round(audioBuffer.duration * sr);
        onProgress?.("Resampling audio…");
        await yield_();
        const offCtx = new OfflineAudioContext(1, nSamp, sr);
        const src = offCtx.createBufferSource();
        src.buffer = audioBuffer; src.connect(offCtx.destination); src.start(0);
        const rendered = await offCtx.startRendering();
        const ch = rendered.getChannelData(0);
        onProgress?.("Converting audio to PCM…");
        await yield_();
        // Pad to the next multiple of AUDIO_LOWRES_SAMPLES so the Rust circuit's
        // emit_audio_decimated_gates can access sample_idx * stride_k for all 240k
        // indices without exceeding the container bounds.
        const strideK = Math.max(1, Math.ceil(nSamp / AUDIO_LOWRES_SAMPLES));
        const nSampPadded = AUDIO_LOWRES_SAMPLES * strideK;
        const pcm = new Int16Array(nSampPadded); // zero-initialized; silence beyond nSamp
        for (let i = 0; i < nSamp; i++)
            pcm[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
        pcmBytes = new Uint8Array(pcm.buffer);
        nSamp = nSampPadded; // header byte 29 must store padded count
    } catch { /* no audio track */ }

    // ── Assemble container ────────────────────────────────────────────────────
    onProgress?.("Assembling container…");
    await yield_();
    // Pad frame data to 64-byte boundary so audio_start is block-aligned.
    // compile_circuit_extended_video_both_v2 requires audio_start % 64 == 0.
    const framePad = (64 - (allFramesBuf.length % 64)) % 64;
    const paddedFrameLen = allFramesBuf.length + framePad;
    const containerSize = 64 + paddedFrameLen + pcmBytes.length;
    const container = new Uint8Array(containerSize);
    const hdr = new DataView(container.buffer);
    container[0] = tag;
    hdr.setUint32(1,  containerSize, false);
    hdr.setUint32(5,  duration,      false);
    hdr.setUint32(9,  bitrateKbps,   false);
    hdr.setUint32(13, w,             false);
    hdr.setUint32(17, h,             false);
    hdr.setUint32(21, fps,           false);
    hdr.setUint32(25, sr,            false);
    hdr.setUint32(29, nSamp,         false);
    container.set(allFramesBuf, 64);
    // zero-fill gap (already zero from new Uint8Array) ensures audio_start alignment
    container.set(pcmBytes, 64 + paddedFrameLen);
    return container;
}

/** Extract top-left min(256,w)×min(256,h) RGB24 bytes from video container frame 0.
 *  Container layout: header(64B) || raw RGB24 frames top-down, no row padding.
 *  Mirrors emit_video_thumb_gates in circuits_v2.rs. */
function computeVideoThumbRgb(container: Uint8Array, w: number, h: number): Uint8Array {
    const TW = 256, TH = 256;
    const tw = Math.min(TW, w);
    const th = Math.min(TH, h);
    const out = new Uint8Array(TW * TH * 3);
    for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
            const src = 64 + (y * w + x) * 3;
            const dst = (y * TW + x) * 3;
            out[dst]     = container[src];
            out[dst + 1] = container[src + 1];
            out[dst + 2] = container[src + 2];
        }
    }
    return out;
}

// ── Audio PCM helpers (must match circuits_v2.rs audio constants) ──
// All audio variants: x = header(64B) || mono Int16 PCM at original sample rate.
// Header bytes 13-16: sample rate; bytes 17-20: total samples.
// d_crop  = SHA256(x[64..480064])              — first 240k samples, block-range
// d_lowres = SHA256(decimated)                 — N=240k samples at stride K=⌈total/N⌉
const AUDIO_CROP_SAMPLES   = 240_000; // fixed crop window (480 kB of PCM)
const AUDIO_LOWRES_SAMPLES = 240_000; // fixed lowres output size (480 kB of PCM)

/** Decode any audio file to mono Int16 PCM at original sample rate (≤96 kHz).
 *  PCM is zero-padded so the circuit's GetByte gates never read beyond the buffer:
 *    - at least AUDIO_CROP_SAMPLES for the crop hash
 *    - at least (AUDIO_LOWRES_SAMPLES-1)*stride_k+1 for the lowres hash
 *  Returns pcmBytes, sampleRate, and totalSamples for writing the header. */
async function decodeToFullPcm(file: File): Promise<{
    pcmBytes: Uint8Array;
    sampleRate: number;
    totalSamples: number;
}> {
    const ab = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(ab.slice(0));
    await tempCtx.close();
    const sampleRate    = Math.min(audioBuffer.sampleRate, 96_000);
    const actualSamples = Math.round(audioBuffer.duration * sampleRate);
    // stride_k mirrors the WASM circuit: div_ceil(actualSamples, N).max(1)
    const stride_k = Math.max(1, Math.ceil(actualSamples / AUDIO_LOWRES_SAMPLES));
    // pad so the last decimated GetByte is within bounds and crop region is covered
    const nSamples = Math.max(AUDIO_CROP_SAMPLES, (AUDIO_LOWRES_SAMPLES - 1) * stride_k + 1, actualSamples);
    const offCtx = new OfflineAudioContext(1, actualSamples, sampleRate);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuffer; src.connect(offCtx.destination); src.start(0);
    const rendered = await offCtx.startRendering();
    const ch = rendered.getChannelData(0);
    const pcm = new Int16Array(nSamples); // zero-initialised — pads short/mid-length audio
    for (let i = 0; i < actualSamples; i++)
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
    return { pcmBytes: new Uint8Array(pcm.buffer), sampleRate, totalSamples: actualSamples };
}

/** Extract AUDIO_LOWRES_SAMPLES decimated Int16 samples from x = header||PCM.
 *  stride K = ⌈total_samples / AUDIO_LOWRES_SAMPLES⌉ is read from header bytes 17-20.
 *  Mirrors the circuit's GetByte gates at offset 64 + i·K·2.
 *  No index clamping: the container is always padded to fit the last gate position. */
function decimatePcmFromContainer(fileBytes: Uint8Array): Int16Array {
    const hdr          = new DataView(fileBytes.buffer, fileBytes.byteOffset);
    const totalSamples = hdr.getUint32(17, false); // big-endian
    const strideK      = Math.max(1, Math.ceil(totalSamples / AUDIO_LOWRES_SAMPLES));
    const decimated    = new Int16Array(AUDIO_LOWRES_SAMPLES);
    for (let i = 0; i < AUDIO_LOWRES_SAMPLES; i++) {
        decimated[i] = hdr.getInt16(64 + i * strideK * 2, true); // Int16 little-endian
    }
    return decimated;
}

// For video: audio starts at audioStart (= d_size - n_samp*2), not byte 64.
function decimateVideoAudioFromContainer(fileBytes: Uint8Array, audioStart: number, nSamp: number): Int16Array {
    const dv       = new DataView(fileBytes.buffer, fileBytes.byteOffset);
    const strideK  = Math.max(1, Math.ceil(nSamp / AUDIO_LOWRES_SAMPLES));
    const decimated = new Int16Array(AUDIO_LOWRES_SAMPLES);
    for (let i = 0; i < AUDIO_LOWRES_SAMPLES; i++) {
        const srcIdx = Math.min(i * strideK, nSamp - 1);
        decimated[i] = dv.getInt16(audioStart + srcIdx * 2, true);
    }
    return decimated;
}

interface NewContractModalProps {
    onClose: () => void;
    vendorPk: string;
    title: string;
    prefillBuyerPk?: string;
    requestId?: number;
    prefillPrice?: string;
    prefillTipCompletion?: string;
    prefillTipDispute?: string;
    prefillTimeoutDelay?: string;
    listingType?: string;
    listingPreviewImage?: string | null;
    listingPreviewHash?: string | null;
    listingBrisqueValue?: number | null;
    listingAlgorithmSuite?: string | null;
    // Extended image description fields (for extended_image algorithm)
    listingExtImgThumbHash?: string | null;
    listingExtImgWidth?: number | null;
    listingExtImgHeight?: number | null;
    listingExtImgSize?: number | null;
    // Extended audio description fields (for extended_audio algorithm)
    listingPreviewAudio?: string | null;
    listingExtAudioPreviewHash?: string | null;
    listingExtAudioDuration?: number | null;
    listingExtAudioBitrate?: number | null;
    listingExtAudioSize?: number | null;
    // Extended image crop/dual fields
    listingPreviewCropImage?: string | null;
    listingExtImgCropHash?: string | null;
    listingExtImgCropX?: number | null;
    listingExtImgCropY?: number | null;
    // Extended audio lowres/both fields
    listingPreviewAudioLowres?: string | null;
    listingExtAudioLowresHash?: string | null;
    // Sample rate fields
    listingExtAudioPreviewSr?: number | null;
    listingExtAudioLowresSr?: number | null;
    // Extended video fields
    listingPreviewVideoThumb?: string | null;
    listingExtVideoThumbHash?: string | null;
    listingPreviewVideoClip?: string | null;
    listingExtVideoClipHash?: string | null;
    listingExtVideoWidth?: number | null;
    listingExtVideoHeight?: number | null;
    listingExtVideoDuration?: number | null;
    listingExtVideoBitrate?: number | null;
    listingExtVideoSize?: number | null;
    listingExtVideoFps?: number | null;
    listingExtVideoClipFrames?: number | null;
}

function dataUrlToObjectUrl(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    const mime  = dataUrl.slice(0, comma).match(/:(.*?);/)?.[1] ?? "video/webm";
    const bin   = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

const ALGORITHM_LABELS: Record<string, string> = {
    default: "Hash Commitment (default)",
    extended_image: "Thumb (256×256 scaled)",
    extended_image_crop: "Crop (256×256 native)",
    extended_image_dual: "Thumb + Crop (both)",
    extended_audio: "Preview (native rate, cropped)",
    extended_audio_lowres: "Full Low-res (4kHz Int8, 3min)",
    extended_audio_both: "Preview + Low-res (both)",
    extended_video: "Thumbnail (256×256, frame 0)",
    extended_video_clip: "Clip (first N frames)",
    extended_video_both: "Thumbnail + Clip (both)",
};

export default function NewContractModal({
    onClose,
    vendorPk,
    title,
    prefillBuyerPk,
    requestId,
    prefillPrice,
    prefillTipCompletion,
    prefillTipDispute,
    prefillTimeoutDelay,
    listingType,
    listingPreviewImage,
    listingPreviewHash,
    listingBrisqueValue,
    listingAlgorithmSuite,
    listingExtImgThumbHash,
    listingExtImgWidth,
    listingExtImgHeight,
    listingExtImgSize,
    listingPreviewAudio,
    listingExtAudioPreviewHash,
    listingExtAudioDuration,
    listingExtAudioBitrate,
    listingExtAudioSize,
    listingPreviewCropImage,
    listingExtImgCropHash,
    listingExtImgCropX,
    listingExtImgCropY,
    listingPreviewAudioLowres,
    listingExtAudioLowresHash,
    listingExtAudioPreviewSr,
    listingExtAudioLowresSr,
    listingPreviewVideoThumb,
    listingExtVideoThumbHash,
    listingPreviewVideoClip,
    listingExtVideoClipHash,
    listingExtVideoWidth,
    listingExtVideoHeight,
    listingExtVideoDuration,
    listingExtVideoBitrate,
    listingExtVideoSize,
    listingExtVideoFps,
    listingExtVideoClipFrames,
}: NewContractModalProps) {
    const [videoThumbBlobSrc, setVideoThumbBlobSrc] = useState<string | null>(null);
    const [videoClipBlobSrc, setVideoClipBlobSrc]   = useState<string | null>(null);
    useEffect(() => {
        if (!listingPreviewVideoThumb) { setVideoThumbBlobSrc(null); return; }
        const u = dataUrlToObjectUrl(listingPreviewVideoThumb);
        setVideoThumbBlobSrc(u);
        return () => URL.revokeObjectURL(u);
    }, [listingPreviewVideoThumb]);
    useEffect(() => {
        if (!listingPreviewVideoClip) { setVideoClipBlobSrc(null); return; }
        const u = dataUrlToObjectUrl(listingPreviewVideoClip);
        setVideoClipBlobSrc(u);
        return () => URL.revokeObjectURL(u);
    }, [listingPreviewVideoClip]);

    const [buyerPk, setBuyerPk] = useState(prefillBuyerPk ?? "");
    const [price, setPrice] = useState(prefillPrice ?? "");
    const [tipCompletion, setTipCompletion] = useState(prefillTipCompletion ?? "");
    const [tipDispute, setTipDispute] = useState(prefillTipDispute ?? "");
    const [version, setVersion] = useState("0");
    const [timeoutDelay, setTimeoutDelay] = useState(prefillTimeoutDelay ?? "");
    const [algorithms, setAlgorithms] = useState(listingAlgorithmSuite ?? "default");
    const [file, setFile] = useState<FileList | null>();
    const [imageHashStatus, setImageHashStatus] = useState<"idle" | "checking" | "match" | "mismatch">("idle");
    const [descThumbStatus, setDescThumbStatus] = useState<"idle" | "checking" | "ok" | "warn">("idle");
    const [audioPreviewStatus, setAudioPreviewStatus] = useState<"idle" | "checking" | "ok" | "warn">("idle");
    const [isComputing, setIsComputing] = useState(false);
    const [computingProgress, setComputingProgress] = useState<string | null>(null);
    const isExtendedAlgo = algorithms === "extended_image" || algorithms === "extended_image_crop" || algorithms === "extended_image_dual" || algorithms === "extended_audio" || algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both" || algorithms === "extended_video" || algorithms === "extended_video_clip" || algorithms === "extended_video_both";
    const { showToast } = useToast();

    // Electron mode state
    const [isElectron, setIsElectron] = useState(false);
    const [preOutElectron, setPreOutElectron] = useState<any | null>(null);

    // ZK proof state (proof comes from listing for zk algo, computed here for default)
    type ZkProofStatus = "idle" | "done" | "failed";
    const [zkProofStatus, setZkProofStatus] = useState<ZkProofStatus>("idle");
    const [zkProofData, setZkProofData] = useState<any | null>(null);

    // Reset pre-computed data and file selection when algorithm changes
    useEffect(() => {
        setPreOutElectron(null);
        setZkProofData(null);
        setZkProofStatus("idle");
        setFile(null);
        setImageHashStatus("idle");
        setAudioPreviewStatus("idle");
    }, [algorithms]);

    useEffect(() => {
        const anyWindow: any = typeof window !== "undefined" ? window : {};
        if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function") {
            setIsElectron(true);
        }
    }, []);

    // Note: d_thumb is computed from BMP pixel data (NN, BGR, bottom-to-top rows) —
    // the JPEG listing preview cannot be used to recompute the exact hash.
    // The actual verification is done at the Rust WASM level in check_received_ct_key_*.

    // For extended_audio variants: verify SHA256 of PCM bytes in preview matches d_preview.
    useEffect(() => {
        const isAudioAlgo = algorithms === "extended_audio" || algorithms === "extended_audio_both";
        if (!isAudioAlgo || !listingPreviewAudio || !listingExtAudioPreviewHash) return;
        setAudioPreviewStatus("checking");
        (async () => {
            try {
                const resp = await fetch(listingPreviewAudio);
                const buf = await resp.arrayBuffer();
                const pcmBytes = new Uint8Array(buf).slice(44); // skip WAV header
                const hashBuf = await crypto.subtle.digest("SHA-256", pcmBytes);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map(b => b.toString(16).padStart(2, "0")).join("");
                const expected = listingExtAudioPreviewHash.replace(/^0x/, "");
                setAudioPreviewStatus(hash === expected ? "ok" : "warn");
            } catch {
                setAudioPreviewStatus("idle");
            }
        })();
    }, [algorithms, listingPreviewAudio, listingExtAudioPreviewHash]);

    const handleElectronChooseFile = async () => {
        try {
            const anyWindow: any = typeof window !== "undefined" ? window : {};
            if (!anyWindow.electronAPI || typeof anyWindow.electronAPI.precompute !== "function") {
                showToast("Electron mode not detected.", "error");
                return null;
            }

            const preOut = await anyWindow.electronAPI.precompute();

            if (preOut.cancelled) {
                return null;
            }
            if (preOut.error) {
                showToast(`Precompute failed: ${preOut.error}`, "error");
                return null;
            }

            setPreOutElectron(preOut);

            // For image listings: compute fast hash commitment
            let localZkData: any = null;
            if (listingType === "image") {
                try {
                    if (listingPreviewHash && listingBrisqueValue != null) {
                        localZkData = await computeHashCommitment(listingPreviewHash, listingBrisqueValue);
                    }
                } catch { /* leave null */ }
                if (localZkData) {
                    setZkProofData(localZkData);
                    setZkProofStatus("done");
                }
            }

            // Return both preOut and the ZK data so callers aren't affected by stale React state
            return { preOut, zkData: localZkData };
        } catch (e: any) {
            showToast(`Error: ${e.message || e.toString()}`, "error");
            return null;
        }
    };

    const handleFileChange = async (files: FileList | null) => {
        setFile(files);
        setImageHashStatus("idle");

        if (listingType !== "image" || !listingPreviewHash || !files || files.length === 0) return;

        setImageHashStatus("checking");
        try {
            const f = files[0];

            if (algorithms === "extended_image" || algorithms === "extended_image_dual") {
                // Compare SHA-256 of NN-downscaled BGR thumbnail (BMP-based, matching circuit)
                const { bmpBytes, bmpWidth, bmpHeight } = await buildBmpBytesFromFile(f);
                const thumbBytes = computeThumbBytesFromBmp(bmpBytes, bmpWidth, bmpHeight);
                const hashBuf = await crypto.subtle.digest("SHA-256", thumbBytes.buffer as ArrayBuffer);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map((b) => b.toString(16).padStart(2, "0")).join("");
                setImageHashStatus(hash === listingExtImgThumbHash ? "match" : "mismatch");
                return;
            }
            if (algorithms === "extended_image_crop") {
                // No up-front hash check — crop is verified against listingExtImgCropHash when building container
                setImageHashStatus("idle");
                return;
            }

            const bitmap = await createImageBitmap(f);
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
            const rgbaBytes = ctx.getImageData(0, 0, width, height).data;
            const hashBuffer = await crypto.subtle.digest("SHA-256", rgbaBytes);
            const hash = Array.from(new Uint8Array(hashBuffer))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            setImageHashStatus(hash === listingPreviewHash ? "match" : "mismatch");
        } catch {
            setImageHashStatus("idle");
        }
    };

    const handleSubmit = async () => {
        try {
            // Valider les adresses (optionnel mais utile)
            if (!buyerPk || !isAddress(buyerPk)) {
                showToast("Käufer-Adresse ungültig", "warning");
                return;
            }
            if (!vendorPk || !isAddress(vendorPk)) {
                showToast("Verkäufer-Adresse ungültig", "warning");
                return;
            }

            // Si on est dans l'app desktop Electron, utiliser le résultat déjà pré-calculé
            // extended_image uses in-browser WASM (SOX container built here), so skip Electron path for it.
            const anyWindow: any = typeof window !== "undefined" ? window : {};
            if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function" && !isExtendedAlgo) {
                // Si l'utilisateur n'a pas encore cliqué sur "Choisir le fichier",
                // on lance automatiquement le flux de sélection + calcul ici.
                // Use already-computed preOut+zkData if available, else trigger file selection now
                let preOut = preOutElectron;
                let zkData = zkProofData; // may be set if user clicked "Choose file" earlier
                if (!preOut) {
                    const result = await handleElectronChooseFile();
                    if (!result) return;
                    preOut = result.preOut;
                    zkData = result.zkData; // use the directly returned value, not stale state
                }
                if (!preOut) return;

                const response_raw = await fetch("/api/precontracts", {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        preOut,
                        pk_buyer: buyerPk,
                        pk_vendor: vendorPk,
                        price,
                        tip_completion: tipCompletion,
                        tip_dispute: tipDispute,
                        protocol_version: version,
                        timeout_delay: timeoutDelay,
                        algorithm_suite: algorithms,
                        listing_type: listingType ?? null,
                        preview_image: listingPreviewImage ?? null,
                        preview_hash: listingPreviewHash ?? null,
                        brisque_value: listingBrisqueValue ?? null,
                        zk_proof: zkData?.proof ?? null,
                        zk_proof_full: zkData?.proof_full ?? null,
                        zk_h_pt: zkData?.h_pt ?? null,
                        zk_c_k: zkData?.c_k ?? null,
                        zk_thumbnail_hash: zkData?.thumbnail_hash ?? null,
                        zk_brisque: zkData?.brisque ?? null,
                        zk_vk_hash: zkData?.vk_hash ?? null,
                    }),
                });

                // Vérifier le Content-Type pour s'assurer que c'est du JSON
                const contentType = response_raw.headers.get("content-type") || "";
                const text = await response_raw.text();
                
            if (!response_raw.ok) {
                // Si ce n'est pas OK, essayer de parser le JSON pour obtenir le message d'erreur
                let errorMsg = `Erreur HTTP ${response_raw.status}`;
                let errorDetails: any = null;
                
                if (contentType.includes("application/json")) {
                    try {
                        const errorJson = JSON.parse(text);
                        errorMsg = errorJson.error || errorMsg;
                        errorDetails = errorJson.details;
                        
                        // Afficher les détails dans la console pour le débogage
                        if (errorDetails) {
                            console.error("Détails de l'erreur serveur:", errorDetails);
                        }
                    } catch (e) {
                        // Si on ne peut pas parser, utiliser le texte brut
                        errorMsg = text ? text.slice(0, 200) : errorMsg;
                        console.error("Impossible de parser la réponse d'erreur comme JSON:", text);
                    }
                } else {
                    // Si ce n'est pas du JSON, utiliser le texte brut (truncated)
                    errorMsg = text ? text.slice(0, 200) : errorMsg;
                    console.error("Réponse d'erreur n'est pas du JSON. Type:", contentType, "Texte:", text);
                }
                
                // Construire un message d'erreur plus informatif
                const fullErrorMsg = errorDetails?.stack 
                    ? `${errorMsg}\n\nDétails techniques (mode développement):\n${errorDetails.stack}`
                    : errorMsg;
                    
                throw new Error(fullErrorMsg);
            }
                
                // Maintenant parser le JSON seulement si la réponse est OK
                let json: any = {};
                try {
                    json = text ? JSON.parse(text) : {};
                } catch (e) {
                    console.error("Réponse non JSON de /api/precontracts (PUT):", text);
                    throw new Error(
                        `Réponse invalide du serveur (attendu JSON): ${text.slice(
                            0,
                            200
                        )}`
                    );
                }

                const { id, key, h_circuit, h_ct } = json;

                if (!preOut.ciphertext_path) {
                    throw new Error("ciphertext_path manquant dans la sortie precompute.");
                }
                if (
                    !anyWindow.electronAPI ||
                    typeof anyWindow.electronAPI.uploadCiphertext !== "function"
                ) {
                    throw new Error("electronAPI.uploadCiphertext non disponible.");
                }

                const uploadResult = await anyWindow.electronAPI.uploadCiphertext({
                    filePath: preOut.ciphertext_path,
                    contractId: id,
                });
                if (!uploadResult?.success) {
                    const uploadError =
                        uploadResult?.error ||
                        "Erreur inconnue lors de l'envoi du ciphertext.";
                    throw new Error(uploadError);
                }

                showToast(`Vertrag ${id} erstellt. Verschlüsselungsschlüssel: ${key}`, "success", 8000);
                localStorage.setItem(`h_circuit_${id}`, h_circuit);
                localStorage.setItem(`h_ct_${id}`, h_ct);
                localStorage.setItem(`key_${id}`, key);

                window.dispatchEvent(new Event("reloadData"));
                onClose();
                return;
            }

            // Web mode: encrypt in the browser using WASM, send only ciphertext to server
            if (!file || file.length === 0) {
                showToast("Please select a file", "warning");
                return;
            }
            if (listingType === "image" && imageHashStatus === "mismatch") {
                showToast("The selected image does not match the listing preview. Upload the correct image.", "error");
                return;
            }
            if ((algorithms === "extended_image" || algorithms === "extended_image_dual") && descThumbStatus === "warn") {
                showToast("The preview image does not match the committed description (d_thumb mismatch). This contract cannot be trusted.", "error");
                return;
            }
            if ((algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "warn") {
                showToast("The audio preview hash does not match. This listing may have been tampered with.", "error");
                return;
            }

            setIsComputing(true);

            // Ensure WASM is compiled and ready before calling any crypto_lib function.
            // Turbopack loads .wasm asynchronously so static imports are not sufficient.
            await init();

            let fileBytes = new Uint8Array(await file[0].arrayBuffer());
            const key = crypto.getRandomValues(new Uint8Array(16));

            // Track BMP build result for later use in precontract hash computation.
            let bmpBuildResult: { bmpBytes: Uint8Array; bmpWidth: number; bmpHeight: number } | null = null;

            // For extended_image: SOX container = header(64B) | canonical BMP
            // d_thumb is computed below from BMP pixels (NN, BGR, bottom-to-top — same as circuit).
            if (algorithms === "extended_image") {
                bmpBuildResult = await buildBmpBytesFromFile(file[0]);
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult;
                const containerSize = 64 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x00; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(bmpBytes, 64);
                fileBytes = container;
            }

            // extended_image_crop: header(64B) | BMP
            if (algorithms === "extended_image_crop") {
                if (listingExtImgCropX == null || listingExtImgCropY == null) {
                    showToast("No crop region found in listing. Cannot build contract.", "error");
                    return;
                }
                bmpBuildResult = await buildBmpBytesFromFile(file[0]);
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult;
                const containerSize = 64 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x02; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(bmpBytes, 64);
                fileBytes = container;
            }

            // extended_image_dual: header(64B) | BMP
            if (algorithms === "extended_image_dual") {
                if (listingExtImgCropX == null || listingExtImgCropY == null) {
                    showToast("No crop region found in listing. Cannot build contract.", "error");
                    return;
                }
                bmpBuildResult = await buildBmpBytesFromFile(file[0]);
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult;
                const containerSize = 64 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x03; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(bmpBytes, 64);
                fileBytes = container;
            }

            // All video variants: x = header(64B) || raw RGB24 frames || mono Int16-LE PCM.
            // fps is capped at 10 so processing stays ≤ duration×10/60 seconds.
            if (algorithms === "extended_video" || algorithms === "extended_video_clip" || algorithms === "extended_video_both") {
                // Apply canonical dims — idempotent for new listings, caps old listings that
                // stored original resolution and would cause OOM when building the container.
                const { cW: vw, cH: vh } = canonicalVideoDims(
                    listingExtVideoWidth  ?? 256,
                    listingExtVideoHeight ?? 256,
                );
                const vfps = CANONICAL_FPS;
                const vdur = listingExtVideoDuration ?? 0;
                const vbr  = listingExtVideoBitrate  ?? 0;
                const tag  = algorithms === "extended_video" ? 0x01 : algorithms === "extended_video_clip" ? 0x02 : 0x03;
                fileBytes = await buildVideoContainer(file[0], vw, vh, vfps, vdur, vbr, tag,
                    (msg) => setComputingProgress(msg),
                ) as Uint8Array<ArrayBuffer>;
                setComputingProgress(null);
            }

            // All audio variants: x = header(64B) || full mono Int16 PCM at original sample rate.
            // Header bytes 13-16: sample rate; bytes 17-20: total samples (for circuit stride K).
            if (algorithms === "extended_audio" || algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") {
                const { pcmBytes, sampleRate: audioSr, totalSamples } = await decodeToFullPcm(file[0]);
                const containerSize = 64 + pcmBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                const tag = algorithms === "extended_audio" ? 0x01 : algorithms === "extended_audio_lowres" ? 0x02 : 0x03;
                container[0] = tag;
                hView.setUint32(1,  containerSize, false);
                hView.setUint32(5,  listingExtAudioDuration ?? 0, false);
                hView.setUint32(9,  listingExtAudioBitrate ?? 0, false);
                hView.setUint32(13, audioSr, false);      // sample rate
                hView.setUint32(17, totalSamples, false); // total samples → circuit derives K
                container.set(pcmBytes, 64);
                fileBytes = container;
            }

            let precontract;
            const hdr = new DataView(fileBytes.buffer, fileBytes.byteOffset);
            const dSha = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
            const dSize = fileBytes.length;
            if (algorithms === "extended_image") {
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult!;
                const thumbBytes = computeThumbBytesFromBmp(bmpBytes, bmpWidth, bmpHeight);
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", thumbBytes.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_image_v2(
                    fileBytes, key, dSha, dThumb,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), 0, dSize,
                );
            } else if (algorithms === "extended_image_crop") {
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult!;
                const cropBytes = computeCropBytesFromBmp(bmpBytes, bmpWidth, bmpHeight, listingExtImgCropX!, listingExtImgCropY!);
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", cropBytes.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_image_crop_v2(
                    fileBytes, key, dSha, dCrop,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                    listingExtImgCropX!, listingExtImgCropY!,
                );
            } else if (algorithms === "extended_image_dual") {
                const { bmpBytes, bmpWidth, bmpHeight } = bmpBuildResult!;
                const thumbBytes = computeThumbBytesFromBmp(bmpBytes, bmpWidth, bmpHeight);
                const cropBytes = computeCropBytesFromBmp(bmpBytes, bmpWidth, bmpHeight, listingExtImgCropX!, listingExtImgCropY!);
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", thumbBytes.buffer as ArrayBuffer));
                const dCrop  = new Uint8Array(await crypto.subtle.digest("SHA-256", cropBytes.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_image_dual_v2(
                    fileBytes, key, dSha, dThumb, dCrop,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                    listingExtImgCropX!, listingExtImgCropY!,
                );
            } else if (algorithms === "extended_audio") {
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 64 + AUDIO_CROP_SAMPLES * 2)));
                precontract = compute_precontract_extended_audio_v2(
                    fileBytes, key, dSha, dCrop,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                );
            } else if (algorithms === "extended_audio_lowres") {
                const decimated = decimatePcmFromContainer(fileBytes);
                const dLowres = new Uint8Array(await crypto.subtle.digest("SHA-256", decimated.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_audio_lowres_v2(
                    fileBytes, key, dSha, dLowres,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                    hdr.getUint32(17, false), // total_samples — circuit derives stride K
                );
            } else if (algorithms === "extended_audio_both") {
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 64 + AUDIO_CROP_SAMPLES * 2)));
                const decimated = decimatePcmFromContainer(fileBytes);
                const dLowres  = new Uint8Array(await crypto.subtle.digest("SHA-256", decimated.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_audio_both_v2(
                    fileBytes, key, dSha, dCrop, dLowres,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                    hdr.getUint32(17, false), // total_samples — circuit derives stride K
                );
            } else if (algorithms === "extended_video") {
                const w = hdr.getUint32(13, false);
                const h = hdr.getUint32(17, false);
                const nSamp = hdr.getUint32(29, false);
                const audioStart = dSize - nSamp * 2;
                const thumbRgb = computeVideoThumbRgb(fileBytes, w, h);
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", thumbRgb.buffer as ArrayBuffer));
                const decimated = decimateVideoAudioFromContainer(fileBytes, audioStart, nSamp);
                const dLowres = new Uint8Array(await crypto.subtle.digest("SHA-256", decimated.buffer as ArrayBuffer));
                precontract = compute_precontract_extended_video_v2(
                    fileBytes, key, dSha, dThumb, dLowres,
                    dSize, hdr.getUint32(5, false), hdr.getUint32(9, false), w, h, hdr.getUint32(21, false),
                    hdr.getUint32(25, false), nSamp,
                );
            } else if (algorithms === "extended_video_clip") {
                const w = hdr.getUint32(13, false);
                const h = hdr.getUint32(17, false);
                const nSamp = hdr.getUint32(29, false);
                const audioStart = dSize - nSamp * 2;
                const cropLen = Math.min(480000, nSamp * 2);
                const clipFrames = listingExtVideoClipFrames ?? 0;
                const clipBytes = fileBytes.slice(64, 64 + clipFrames * w * h * 3);
                // Reuse the listing's clip hash so the precontract always matches what was advertised.
                // Recomputing from the container risks non-deterministic canvas/GPU decoding differences.
                const dClip = listingExtVideoClipHash
                    ? hexToBytes(listingExtVideoClipHash)
                    : new Uint8Array(await crypto.subtle.digest("SHA-256", clipBytes.buffer as ArrayBuffer));
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(audioStart, audioStart + cropLen).buffer as ArrayBuffer));
                precontract = compute_precontract_extended_video_clip_v2(
                    fileBytes, key, dSha, dClip, dCrop,
                    dSize, hdr.getUint32(5, false), hdr.getUint32(9, false), w, h, hdr.getUint32(21, false),
                    hdr.getUint32(25, false), nSamp,
                    clipFrames,
                );
            } else if (algorithms === "extended_video_both") {
                const w = hdr.getUint32(13, false);
                const h = hdr.getUint32(17, false);
                const nSamp = hdr.getUint32(29, false);
                const audioStart = dSize - nSamp * 2;
                const cropLen = Math.min(480000, nSamp * 2);
                const clipFrames = listingExtVideoClipFrames ?? 0;
                const thumbRgb = computeVideoThumbRgb(fileBytes, w, h);
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", thumbRgb.buffer as ArrayBuffer));
                const clipBytes = fileBytes.slice(64, 64 + clipFrames * w * h * 3);
                // Reuse the listing's clip hash so the precontract always matches what was advertised.
                const dClip = listingExtVideoClipHash
                    ? hexToBytes(listingExtVideoClipHash)
                    : new Uint8Array(await crypto.subtle.digest("SHA-256", clipBytes.buffer as ArrayBuffer));
                const decimated = decimateVideoAudioFromContainer(fileBytes, audioStart, nSamp);
                const dLowres = new Uint8Array(await crypto.subtle.digest("SHA-256", decimated.buffer as ArrayBuffer));
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(audioStart, audioStart + cropLen).buffer as ArrayBuffer));
                precontract = compute_precontract_extended_video_both_v2(
                    fileBytes, key, dSha, dThumb, dClip, dLowres, dCrop,
                    dSize, hdr.getUint32(5, false), hdr.getUint32(9, false), w, h, hdr.getUint32(21, false),
                    hdr.getUint32(25, false), nSamp,
                    clipFrames,
                );
            } else {
                precontract = compute_precontract_values_v2(fileBytes, key);
            }

            const preOut = {
                commitment_c_hex: bytes_to_hex(precontract.commitment.c),
                commitment_o_hex: bytes_to_hex(precontract.commitment.o),
                description_hex: bytes_to_hex(precontract.description),
                num_blocks: precontract.num_blocks,
                num_gates: precontract.num_gates,
                h_circuit_hex: bytes_to_hex(precontract.h_circuit),
                h_ct_hex: bytes_to_hex(precontract.h_ct),
                file: bytes_to_hex(precontract.ct),
                file_name: file[0].name,
            };

            // Web mode: compute hash commitment in browser (default algorithm only; ZK requires desktop app)
            let webZkData: any = null;
            if (listingType === "image" && algorithms === "default" && listingPreviewHash && listingBrisqueValue != null) {
                try {
                    webZkData = await computeHashCommitment(listingPreviewHash, listingBrisqueValue);
                } catch { /* leave null */ }
            }

            const response_raw = await fetch("/api/precontracts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    preOut,
                    pk_buyer: buyerPk,
                    pk_vendor: vendorPk,
                    price,
                    tip_completion: tipCompletion,
                    tip_dispute: tipDispute,
                    protocol_version: version,
                    timeout_delay: timeoutDelay,
                    algorithm_suite: algorithms,
                    listing_type: listingType ?? null,
                    preview_image: listingPreviewImage ?? null,
                    preview_hash: listingPreviewHash ?? null,
                    brisque_value: listingBrisqueValue ?? null,
                    zk_proof: webZkData?.proof ?? null,
                    zk_proof_full: null,
                    zk_h_ct: null,
                    zk_c_k: webZkData?.c_k ?? null,
                    zk_thumbnail_hash: webZkData?.thumbnail_hash ?? null,
                    zk_brisque: webZkData?.brisque ?? null,
                    ext_img_thumb_hash: (algorithms === "extended_image" || algorithms === "extended_image_dual") ? listingExtImgThumbHash ?? null : null,
                    ext_img_width: listingExtImgWidth ?? null,
                    ext_img_height: listingExtImgHeight ?? null,
                    ext_img_size: listingExtImgSize ?? null,
                    preview_crop_image: (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") ? listingPreviewCropImage ?? null : null,
                    ext_img_crop_hash: (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") ? listingExtImgCropHash ?? null : null,
                    ext_img_crop_x: (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") ? listingExtImgCropX ?? null : null,
                    ext_img_crop_y: (algorithms === "extended_image_crop" || algorithms === "extended_image_dual") ? listingExtImgCropY ?? null : null,
                    preview_audio: (algorithms === "extended_audio" || algorithms === "extended_audio_both") ? listingPreviewAudio ?? null : null,
                    ext_audio_preview_hash: (algorithms === "extended_audio" || algorithms === "extended_audio_both") ? listingExtAudioPreviewHash ?? null : null,
                    ext_audio_duration: listingExtAudioDuration ?? null,
                    ext_audio_bitrate: listingExtAudioBitrate ?? null,
                    ext_audio_size: listingExtAudioSize ?? null,
                    preview_audio_lowres: (algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") ? listingPreviewAudioLowres ?? null : null,
                    ext_audio_lowres_hash: (algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") ? listingExtAudioLowresHash ?? null : null,
                    ext_audio_preview_sr: (algorithms === "extended_audio" || algorithms === "extended_audio_both") ? listingExtAudioPreviewSr ?? null : null,
                    ext_audio_lowres_sr: (algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") ? listingExtAudioLowresSr ?? null : null,
                    preview_video_thumb: (algorithms === "extended_video" || algorithms === "extended_video_both") ? listingPreviewVideoThumb ?? null : null,
                    ext_video_thumb_hash: (algorithms === "extended_video" || algorithms === "extended_video_both") ? listingExtVideoThumbHash ?? null : null,
                    preview_video_clip: (algorithms === "extended_video_clip" || algorithms === "extended_video_both") ? listingPreviewVideoClip ?? null : null,
                    ext_video_clip_hash: (algorithms === "extended_video_clip" || algorithms === "extended_video_both") ? listingExtVideoClipHash ?? null : null,
                    ext_video_width: listingExtVideoWidth ?? null,
                    ext_video_height: listingExtVideoHeight ?? null,
                    ext_video_duration: listingExtVideoDuration ?? null,
                    ext_video_bitrate: listingExtVideoBitrate ?? null,
                    ext_video_size: listingExtVideoSize ?? null,
                    ext_video_fps: listingExtVideoFps ?? null,
                    ext_video_clip_frames: (algorithms === "extended_video_clip" || algorithms === "extended_video_both") ? listingExtVideoClipFrames ?? null : null,
                    ext_video_sr: listingType === "video" ? (hdr?.getUint32(25, false) ?? null) : null,
                    ext_video_n_samp: listingType === "video" ? (hdr?.getUint32(29, false) ?? null) : null,
                }),
            });

            setIsComputing(false);

            // Vérifier le Content-Type pour s'assurer que c'est du JSON
            const contentType = response_raw.headers.get("content-type") || "";
            const text = await response_raw.text();

            if (!response_raw.ok) {
                let errorMsg = `Erreur HTTP ${response_raw.status}`;
                let errorDetails: any = null;

                if (contentType.includes("application/json")) {
                    try {
                        const errorJson = JSON.parse(text);
                        errorMsg = errorJson.error || errorMsg;
                        errorDetails = errorJson.details;
                        if (errorDetails) {
                            console.error("Détails de l'erreur serveur:", errorDetails);
                        }
                    } catch (e) {
                        errorMsg = text ? text.slice(0, 200) : errorMsg;
                        console.error("Impossible de parser la réponse d'erreur comme JSON:", text);
                    }
                } else {
                    errorMsg = text ? text.slice(0, 200) : errorMsg;
                    console.error("Réponse d'erreur n'est pas du JSON. Type:", contentType, "Texte:", text);
                }

                const fullErrorMsg = errorDetails?.stack
                    ? `${errorMsg}\n\nDétails techniques (mode développement):\n${errorDetails.stack}`
                    : errorMsg;

                throw new Error(fullErrorMsg);
            }

            let json: any = {};
            try {
                json = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error("Réponse non JSON de /api/precontracts:", text);
                throw new Error(
                    `Réponse invalide du serveur (attendu JSON): ${text.slice(0, 200)}`
                );
            }

            const { id, h_circuit, h_ct } = json;

            localStorage.setItem(`h_circuit_${id}`, h_circuit);
            localStorage.setItem(`h_ct_${id}`, h_ct);
            localStorage.setItem(`key_${id}`, bytes_to_hex(key));

            if (requestId !== undefined) {
                await fetch(`/api/purchase-requests/${requestId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "fulfilled", contract_id: id }),
                });
            }

            showToast(`Vertrag ${id} erfolgreich erstellt.`, "success");
            window.dispatchEvent(new Event("reloadData"));
            onClose();
        } catch (e: any) {
            setIsComputing(false);
            console.error("Fehler bei der Vertragserstellung:", e);
            showToast(`Fehler: ${e.message || e.toString()}`, "error");
        }
    };

    return (
        <Modal title={title} onClose={onClose}>
            <div className="space-y-4 grid grid-cols-2 gap-4">
                {algorithms === "extended_image" && descThumbStatus === "checking" && (
                    <p className="col-span-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                        Verifying preview image against committed description…
                    </p>
                )}
                {algorithms === "extended_image" && descThumbStatus === "ok" && (
                    <p className="col-span-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                        ✓ Preview image matches the committed description (d_thumb verified).
                    </p>
                )}
                {algorithms === "extended_image" && descThumbStatus === "warn" && (
                    <div className="col-span-2 text-xs text-red-700 bg-red-50 border border-red-300 rounded p-3 font-medium">
                        ⚠ Warning: The preview image does NOT match the thumbnail hash committed in the
                        description (d_thumb mismatch). The vendor may have shown a different image than
                        what will be delivered. Do not accept this contract.
                    </div>
                )}
                <div>
                    <FormTextField
                        id="buyer-pk"
                        type="text"
                        value={buyerPk}
                        onChange={setBuyerPk}
                    >
                        Buyer's public key
                    </FormTextField>
                    {prefillBuyerPk && (
                        <p className="text-xs text-blue-600 mt-1">
                            Pre-filled from purchase request
                        </p>
                    )}
                </div>

                <div>
                    <FormTextField
                        id="price"
                        type="number"
                        value={price}
                        onChange={setPrice}
                    >
                        Price (ETH)
                    </FormTextField>
                </div>

                <div>
                    <FormTextField
                        id="tip-completion"
                        type="number"
                        value={tipCompletion}
                        onChange={setTipCompletion}
                    >
                        Tip for completion (ETH)
                    </FormTextField>
                </div>

                <div>
                    <FormTextField
                        id="tip-dispute"
                        type="number"
                        value={tipDispute}
                        onChange={setTipDispute}
                    >
                        Tip for dispute (ETH)
                    </FormTextField>
                </div>

                <FormTextField
                    id="timeout-delay"
                    type="number"
                    value={timeoutDelay}
                    onChange={setTimeoutDelay}
                >
                    Timeout delay (s)
                </FormTextField>

                <FormSelect
                    id="algorithms"
                    value={algorithms}
                    onChange={setAlgorithms}
                    options={
                        listingType === "image" ? ["default", "extended_image", "extended_image_crop", "extended_image_dual"] :
                        listingType === "audio" ? ["extended_audio", "extended_audio_lowres", "extended_audio_both"] :
                        listingType === "video" ? ["extended_video", "extended_video_clip", "extended_video_both"] :
                        ["default"]
                    }
                    optionLabels={ALGORITHM_LABELS}
                    disabled={listingType === "general" || !!listingAlgorithmSuite}
                >
                    Algorithm suite
                </FormSelect>

                <FormSelect
                    id="circuit-version"
                    value={version}
                    onChange={setVersion}
                    options={["0"]}
                    disabled
                >
                    Circuit version
                </FormSelect>

                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "checking" && (
                    <p className="col-span-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                        Verifying audio preview against committed hash…
                    </p>
                )}
                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "ok" && (
                    <p className="col-span-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                        ✓ Audio crop preview matches the committed description (d_crop verified).
                    </p>
                )}
                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "warn" && (
                    <div className="col-span-2 text-xs text-red-700 bg-red-50 border border-red-300 rounded p-3 font-medium">
                        ⚠ Warning: The audio crop preview does NOT match the committed hash (d_crop mismatch). Do not accept this contract.
                    </div>
                )}
                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && listingPreviewAudio && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-500 mb-1">Preview:</p>
                        <audio controls src={listingPreviewAudio} className="w-full h-8" />
                    </div>
                )}
                {(algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") && listingPreviewAudioLowres && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-500 mb-1">Full low-res audio (4kHz, up to 3min):</p>
                        <audio controls src={listingPreviewAudioLowres} className="w-full h-8" />
                    </div>
                )}
                {listingExtAudioDuration != null && (algorithms === "extended_audio" || algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both") && (
                    <p className="col-span-2 text-xs text-gray-400">
                        Duration: {listingExtAudioDuration}s · Bitrate: {listingExtAudioBitrate} kbps
                    </p>
                )}
                {(algorithms === "extended_video" || algorithms === "extended_video_both") && videoThumbBlobSrc && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-500 mb-1">Thumbnail (whole film, low-res):</p>
                        <video controls src={videoThumbBlobSrc} className="w-full max-h-48 rounded border border-gray-200 bg-black" preload="auto" />
                        {listingExtVideoThumbHash && <p className="text-xs font-mono text-gray-400 mt-1">Thumb hash: {listingExtVideoThumbHash.slice(0, 16)}…</p>}
                    </div>
                )}
                {(algorithms === "extended_video_clip" || algorithms === "extended_video_both") && videoClipBlobSrc && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-500 mb-1">Clip preview — first {listingExtVideoClipFrames} frames @ {listingExtVideoFps} fps:</p>
                        <video controls src={videoClipBlobSrc} className="w-full max-h-48 rounded border border-gray-200 bg-black" preload="auto" />
                        {listingExtVideoClipHash && <p className="text-xs font-mono text-gray-400 mt-1">Clip hash: {listingExtVideoClipHash.slice(0, 16)}…</p>}
                    </div>
                )}
                {listingExtVideoWidth != null && (algorithms === "extended_video" || algorithms === "extended_video_clip" || algorithms === "extended_video_both") && (
                    <p className="col-span-2 text-xs text-gray-400">
                        Resolution: {listingExtVideoWidth}×{listingExtVideoHeight} · Duration: {listingExtVideoDuration}s · {listingExtVideoFps} fps · Bitrate: {listingExtVideoBitrate} kbps
                    </p>
                )}
                {(algorithms === "extended_image_crop" || algorithms === "extended_image_dual") && listingPreviewCropImage && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-500 mb-1">Crop preview (256×256 native resolution):</p>
                        <img src={listingPreviewCropImage} alt="Crop" className="w-32 h-32 object-contain border border-gray-200 rounded" />
                        {listingExtImgCropX != null && <p className="text-xs text-gray-400 mt-1">Crop origin: {listingExtImgCropX}×{listingExtImgCropY} px (native)</p>}
                    </div>
                )}

                {(!isElectron || isExtendedAlgo) && (
                    <div className="col-span-2">
                        <FormFileInput
                            id="sold-file"
                            onChange={handleFileChange}
                            accept={
                                listingType === "image"
                                    ? "image/*"
                                    : listingType === "audio"
                                    ? "audio/*"
                                    : listingType === "video"
                                    ? "*/*"
                                    : undefined
                            }
                        >
                            {listingType === "image"
                                ? "Image file (must match listing preview)"
                                : listingType === "audio"
                                ? "Audio file (full track to deliver)"
                                : listingType === "video"
                                ? "SOX video container (header + raw RGB24 frames)"
                                : "File"}
                        </FormFileInput>
                        {listingType === "image" && imageHashStatus === "checking" && (
                            <p className="text-xs text-blue-600 mt-1">Verifying image matches listing preview…</p>
                        )}
                        {listingType === "image" && imageHashStatus === "match" && (
                            <p className="text-xs text-green-600 mt-1">✓ Image matches listing preview</p>
                        )}
                        {listingType === "image" && imageHashStatus === "mismatch" && (
                            <p className="text-xs text-red-600 mt-1 font-medium">
                                ✗ This image does not match the listing preview. You must upload the exact same image that was used to create the listing.
                            </p>
                        )}
                    </div>
                )}

                {isElectron && (
                    <div className="col-span-2 flex flex-col gap-2">
                        <Button
                            label="Choose file (local encryption)"
                            onClick={handleElectronChooseFile}
                            width="full"
                        />
                        {preOutElectron?.inputPath && (
                            <p className="text-xs text-gray-500 break-all">
                                Selected: {preOutElectron.inputPath}
                            </p>
                        )}
                        {zkProofStatus === "done" && zkProofData && (
                            <div className="text-xs text-green-700 space-y-0.5">
                                <p className="font-medium">
                                    ✓ Quality commitment ready — will be sent with precontract
                                </p>
                                <p className="text-gray-500">
                                    Type: Hash Commitment (SHA-256)
                                </p>
                                <p className="text-gray-400">
                                    The buyer will automatically verify this when they open the precontract.
                                </p>
                            </div>
                        )}
                        {zkProofStatus === "failed" && (
                            <p className="text-xs text-red-600">
                                Could not generate commitment. Submit anyway to proceed without proof.
                            </p>
                        )}
                    </div>
                )}

                <div className="col-span-2 flex gap-8">
                    <Button
                        label={isComputing ? (computingProgress ?? "Encrypting...") : "Submit"}
                        onClick={handleSubmit}
                        width="1/2"
                        isDisabled={isComputing}
                    />
                    <Button label="Cancel" onClick={onClose} width="1/2" isDisabled={isComputing} />
                </div>
            </div>
        </Modal>
    );
}
