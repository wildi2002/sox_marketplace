"use client";

import { useCallback, useRef, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import { useEthChfRate, ethToCHF } from "@/app/lib/useEthChfRate";
import { useToast } from "@/app/lib/ToastContext";

interface PostListingModalProps {
    onClose: () => void;
    vendorPk: string;
}

type ListingType = "general" | "image" | "audio";

// Fixed preview budget: 240 000 Int16 samples = 480 000 bytes (circuit constant).
// Original sample rate is kept unchanged; duration = 240 000 / sampleRate.
const AUDIO_PREVIEW_SAMPLES = 240_000;
const AUDIO_PREVIEW_BYTES   = AUDIO_PREVIEW_SAMPLES * 2; // 480 000

// Fixed lowres budget: 720 000 Int8 samples (same circuit constant as Rust).
// Sample rate adapts to cover the FULL duration — exactly like a 256×256 image
// thumbnail (fixed byte budget, quality scales with content size).
const AUDIO_LOWRES_BYTES    = 720_000;

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
    const actualSamples = Math.min(AUDIO_PREVIEW_SAMPLES, Math.round(audioBuffer.duration * sampleRate));

    const offlineCtx = new OfflineAudioContext(1, actualSamples, sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const rendered = await offlineCtx.startRendering();
    const channelData = rendered.getChannelData(0);

    // Container PCM: always AUDIO_PREVIEW_BYTES (zero-padded when audio is short).
    const pcmInt16 = new Int16Array(AUDIO_PREVIEW_SAMPLES); // zero-initialised
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

/** Decode any audio file to a fixed 720 000-sample Int8 low-res version.
 *  The sample rate adapts so all 720 000 samples span the FULL original duration —
 *  same principle as the 256×256 image thumbnail (fixed byte budget, quality scales). */
async function buildLowresAudio(file: File): Promise<{
    wavDataUrl: string;
    lowresHash: string;
    durationSecs: number;
    bitrateKbps: number;
    effectiveSampleRate: number;
}> {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    await tempCtx.close();

    const durationSecs = audioBuffer.duration;
    const bitrateKbps  = Math.round((file.size * 8) / durationSecs / 1000);

    // Adaptive sample rate: capped at 4 000 Hz (very low quality ceiling).
    // Minimum 200 Hz for very long tracks.
    const effectiveSampleRate = Math.max(200, Math.min(4_000, Math.round(AUDIO_LOWRES_BYTES / durationSecs)));

    // Actual samples needed to cover the full duration at this rate (may be < AUDIO_LOWRES_BYTES).
    const actualSamples = Math.min(AUDIO_LOWRES_BYTES, Math.round(durationSecs * effectiveSampleRate));

    // Render only as many samples as the audio actually has.
    const offlineCtx = new OfflineAudioContext(1, actualSamples, effectiveSampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const rendered = await offlineCtx.startRendering();
    const channelData = rendered.getChannelData(0);

    // Container PCM: always exactly AUDIO_LOWRES_BYTES bytes (zero-padded for short tracks).
    // The circuit verifies SHA256 over all 720 000 bytes at fixed offset 64.
    const pcmInt8 = new Int8Array(AUDIO_LOWRES_BYTES); // zero-initialised
    for (let i = 0; i < actualSamples; i++) {
        pcmInt8[i] = Math.max(-128, Math.min(127, Math.round(channelData[i] * 127)));
    }
    const pcmBytes = new Uint8Array(pcmInt8.buffer);

    const hashBuf = await crypto.subtle.digest("SHA-256", pcmBytes);
    const lowresHash = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("");

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

    return { wavDataUrl, lowresHash, durationSecs, bitrateKbps, effectiveSampleRate };
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
        setAlgorithms(type === "image" ? "default" : type === "audio" ? "extended_audio" : "default");
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
        const bitmap = await createImageBitmap(blob);
        const { width, height } = bitmap;
        if (algo === "extended_image") {
            const bmpRowSize = (width * 3 + 3) & ~3;
            const containerSize = 64 + 196608 + (54 + bmpRowSize * height);
            setExtImgWidth(width);
            setExtImgHeight(height);
            setExtImgSize(containerSize);
        }
        const tCanvas = new OffscreenCanvas(256, 256);
        const tCtx = tCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        tCtx.drawImage(bitmap, 0, 0, 256, 256);
        bitmap.close();
        const imgData = tCtx.getImageData(0, 0, 256, 256);
        const rgbBytes = new Uint8Array(196608);
        for (let i = 0; i < 65536; i++) {
            rgbBytes[i * 3]     = imgData.data[i * 4];
            rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
            rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
        }
        const thumbHashBuf = await crypto.subtle.digest("SHA-256", rgbBytes);
        const thumbHash = Array.from(new Uint8Array(thumbHashBuf))
            .map((b) => b.toString(16).padStart(2, "0")).join("");
        setExtImgThumbHash(thumbHash);
        setPreviewHash(thumbHash);
        const thumbBlob = await tCanvas.convertToBlob({ type: "image/png" });
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
                const bitmap = await createImageBitmap(file);
                const { width, height } = bitmap;

                const bmpRowSize = (width * 3 + 3) & ~3;
                // extended_image: header + thumb + BMP
                // extended_image_crop: header + crop + BMP
                // extended_image_dual: header + thumb + crop + BMP
                const bmpSize = 54 + bmpRowSize * height;
                const thumbPart = (algo === "extended_image" || algo === "extended_image_dual") ? 196608 : 0;
                const cropPart  = (algo === "extended_image_crop" || algo === "extended_image_dual") ? 196608 : 0;
                const containerSize = 64 + thumbPart + cropPart + bmpSize;
                setExtImgWidth(width);
                setExtImgHeight(height);
                setExtImgSize(containerSize);

                if (algo === "extended_image" || algo === "extended_image_dual") {
                    // Build 256×256 scaled thumbnail
                    const tCanvas = new OffscreenCanvas(256, 256);
                    const tCtx = tCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                    tCtx.drawImage(bitmap, 0, 0, 256, 256);
                    const imgData = tCtx.getImageData(0, 0, 256, 256);
                    const rgbBytes = new Uint8Array(196608);
                    for (let i = 0; i < 65536; i++) {
                        rgbBytes[i * 3]     = imgData.data[i * 4];
                        rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
                        rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
                    }
                    const thumbHashBuf = await crypto.subtle.digest("SHA-256", rgbBytes);
                    const thumbHash = Array.from(new Uint8Array(thumbHashBuf))
                        .map((b) => b.toString(16).padStart(2, "0")).join("");
                    setExtImgThumbHash(thumbHash);
                    setPreviewHash(thumbHash);

                    const blob = await tCanvas.convertToBlob({ type: "image/png" });
                    const previewUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    setPreviewDataUrl(previewUrl);
                }

                bitmap.close();
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

            let durationSecs = 0, bitrateKbps = 0;

            if (needsPreview) {
                const result = await buildAudioPreview(file);
                durationSecs = result.durationSecs;
                bitrateKbps  = result.bitrateKbps;
                setAudioPreviewUrl(result.wavDataUrl);
                setAudioPreviewHash(result.previewHash);
                setAudioPreviewSr(result.sampleRate);
            }
            if (needsLowres) {
                const result = await buildLowresAudio(file);
                setAudioLowresUrl(result.wavDataUrl);
                setAudioLowresHash(result.lowresHash);
                setAudioLowresSr(result.effectiveSampleRate);
                if (!needsPreview) {
                    durationSecs = Math.round(result.durationSecs);
                    bitrateKbps  = result.bitrateKbps;
                }
            }

            setAudioDuration(durationSecs || null);
            setAudioBitrate(bitrateKbps || null);

            // Container sizes:
            // extended_audio:        header(64) + preview(480000) + original
            // extended_audio_lowres: header(64) + lowres(720000)  + original
            // extended_audio_both:   header(64) + preview(480000) + lowres(720000) + original
            const previewPart = needsPreview ? AUDIO_PREVIEW_BYTES : 0;
            const lowresPart  = needsLowres  ? AUDIO_LOWRES_BYTES  : 0;
            const containerSize = 64 + previewPart + lowresPart + file.size;
            setAudioSize(containerSize);
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
        const cropW = Math.min(256, natW - nativeX);
        const cropH = Math.min(256, natH - nativeY);

        const bitmap = await createImageBitmap(selectedFile);
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bitmap, nativeX, nativeY, cropW, cropH, 0, 0, cropW, cropH);
        bitmap.close();

        const imgData = ctx.getImageData(0, 0, 256, 256);
        const rgbBytes = new Uint8Array(196608);
        for (let i = 0; i < 65536; i++) {
            rgbBytes[i * 3]     = imgData.data[i * 4];
            rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
            rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
        }
        const hashBuf = await crypto.subtle.digest("SHA-256", rgbBytes);
        const hash = Array.from(new Uint8Array(hashBuf))
            .map(b => b.toString(16).padStart(2, "0")).join("");

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
