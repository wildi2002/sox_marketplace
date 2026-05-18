"use client";

import { useEffect, useState, useRef } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { Contract } from "./NonAcceptedPrecontractsListView";
import init, {
    check_precontract_v2, bytes_to_hex,
    check_precontract_extended_image_v2,
    check_precontract_extended_image_crop_v2,
    check_precontract_extended_image_dual_v2,
    check_precontract_extended_audio_v2,
    check_precontract_extended_audio_lowres_v2,
    check_precontract_extended_audio_both_v2,
    check_precontract_extended_video_v2,
    check_precontract_extended_video_clip_v2,
    check_precontract_extended_video_both_v2,
} from "@/app/lib/crypto_lib";
import { hexToBytes, downloadFile } from "@/app/lib/helpers";
import { useToast } from "@/app/lib/ToastContext";

interface NonAcceptedPrecontractModalProps {
    onClose: () => void;
    contract?: Contract;
}

function dataUrlToObjectUrl(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    const mime  = dataUrl.slice(0, comma).match(/:(.*?);/)?.[1] ?? "video/webm";
    const bin   = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

// Exact OpenCV COLORMAP_JET LUT (256 entries, RGB) — matches ela-light.py
const JET_LUT: readonly [number,number,number][] = [
  [0,0,128],[0,0,132],[0,0,136],[0,0,140],[0,0,144],[0,0,148],[0,0,152],[0,0,156],
  [0,0,160],[0,0,164],[0,0,168],[0,0,172],[0,0,176],[0,0,180],[0,0,184],[0,0,188],
  [0,0,192],[0,0,196],[0,0,200],[0,0,204],[0,0,208],[0,0,212],[0,0,216],[0,0,220],
  [0,0,224],[0,0,228],[0,0,232],[0,0,236],[0,0,240],[0,0,244],[0,0,248],[0,0,252],
  [0,0,255],[0,4,255],[0,8,255],[0,12,255],[0,16,255],[0,20,255],[0,24,255],[0,28,255],
  [0,32,255],[0,36,255],[0,40,255],[0,44,255],[0,48,255],[0,52,255],[0,56,255],[0,60,255],
  [0,64,255],[0,68,255],[0,72,255],[0,76,255],[0,80,255],[0,84,255],[0,88,255],[0,92,255],
  [0,96,255],[0,100,255],[0,104,255],[0,108,255],[0,112,255],[0,116,255],[0,120,255],[0,124,255],
  [0,128,255],[0,132,255],[0,136,255],[0,140,255],[0,144,255],[0,148,255],[0,152,255],[0,156,255],
  [0,160,255],[0,164,255],[0,168,255],[0,172,255],[0,176,255],[0,180,255],[0,184,255],[0,188,255],
  [0,192,255],[0,196,255],[0,200,255],[0,204,255],[0,208,255],[0,212,255],[0,216,255],[0,220,255],
  [0,224,255],[0,228,255],[0,232,255],[0,236,255],[0,240,255],[0,244,255],[0,248,255],[0,252,255],
  [2,255,254],[6,255,250],[10,255,246],[14,255,242],[18,255,238],[22,255,234],[26,255,230],[30,255,226],
  [34,255,222],[38,255,218],[42,255,214],[46,255,210],[50,255,206],[54,255,202],[58,255,198],[62,255,194],
  [66,255,190],[70,255,186],[74,255,182],[78,255,178],[82,255,174],[86,255,170],[90,255,166],[94,255,162],
  [98,255,158],[102,255,154],[106,255,150],[110,255,146],[114,255,142],[118,255,138],[122,255,134],[126,255,130],
  [130,255,126],[134,255,122],[138,255,118],[142,255,114],[146,255,110],[150,255,106],[154,255,102],[158,255,98],
  [162,255,94],[166,255,90],[170,255,86],[174,255,82],[178,255,78],[182,255,74],[186,255,70],[190,255,66],
  [194,255,62],[198,255,58],[202,255,54],[206,255,50],[210,255,46],[214,255,42],[218,255,38],[222,255,34],
  [226,255,30],[230,255,26],[234,255,22],[238,255,18],[242,255,14],[246,255,10],[250,255,6],[254,255,1],
  [255,252,0],[255,248,0],[255,244,0],[255,240,0],[255,236,0],[255,232,0],[255,228,0],[255,224,0],
  [255,220,0],[255,216,0],[255,212,0],[255,208,0],[255,204,0],[255,200,0],[255,196,0],[255,192,0],
  [255,188,0],[255,184,0],[255,180,0],[255,176,0],[255,172,0],[255,168,0],[255,164,0],[255,160,0],
  [255,156,0],[255,152,0],[255,148,0],[255,144,0],[255,140,0],[255,136,0],[255,132,0],[255,128,0],
  [255,124,0],[255,120,0],[255,116,0],[255,112,0],[255,108,0],[255,104,0],[255,100,0],[255,96,0],
  [255,92,0],[255,88,0],[255,84,0],[255,80,0],[255,76,0],[255,72,0],[255,68,0],[255,64,0],
  [255,60,0],[255,56,0],[255,52,0],[255,48,0],[255,44,0],[255,40,0],[255,36,0],[255,32,0],
  [255,28,0],[255,24,0],[255,20,0],[255,16,0],[255,12,0],[255,8,0],[255,4,0],[255,0,0],
  [252,0,0],[248,0,0],[244,0,0],[240,0,0],[236,0,0],[232,0,0],[228,0,0],[224,0,0],
  [220,0,0],[216,0,0],[212,0,0],[208,0,0],[204,0,0],[200,0,0],[196,0,0],[192,0,0],
  [188,0,0],[184,0,0],[180,0,0],[176,0,0],[172,0,0],[168,0,0],[164,0,0],[160,0,0],
  [156,0,0],[152,0,0],[148,0,0],[144,0,0],[140,0,0],[136,0,0],[132,0,0],[128,0,0],
];

function ModalElaVideoPlayer({ frames, audioBins, duration }: { frames: Uint8Array; audioBins: Uint32Array; duration?: number }) {
    const K   = Math.floor(frames.length / 65536);
    const dur = duration ?? K / 10;
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [barUrl,   setBarUrl]   = useState<string | null>(null);

    useEffect(() => {
        if (K === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
                if (cancelled) return;
                const frameDurUs = Math.round(dur * 1_000_000 / K);
                const target = new ArrayBufferTarget();
                const muxer = new Muxer({
                    target,
                    video: { codec: "V_VP8", width: 256, height: 256, frameRate: 1 },
                    type: "webm",
                });
                const videoEncoder = new VideoEncoder({
                    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                    error: (e) => console.error("ELA encode:", e),
                });
                videoEncoder.configure({ codec: "vp8", width: 256, height: 256, bitrate: 200_000, framerate: 1 });
                for (let ki = 0; ki < K; ki++) {
                    if (cancelled) { videoEncoder.close(); return; }
                    const f  = frames.subarray(ki * 65536, (ki + 1) * 65536);
                    const id = new ImageData(256, 256);
                    for (let i = 0; i < 65536; i++) {
                        const [r, g, b] = JET_LUT[f[i]];
                        id.data[i*4]=r; id.data[i*4+1]=g; id.data[i*4+2]=b; id.data[i*4+3]=255;
                    }
                    const bitmap = await createImageBitmap(id);
                    const frame = new VideoFrame(bitmap, { timestamp: ki * frameDurUs, duration: frameDurUs, alpha: "discard" });
                    videoEncoder.encode(frame, { keyFrame: true });
                    frame.close();
                    bitmap.close();
                }
                await videoEncoder.flush();
                videoEncoder.close();
                muxer.finalize();
                if (cancelled) return;
                const blob = new Blob([target.buffer], { type: "video/webm" });
                setVideoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
            } catch (e) {
                console.error("ELA video encoding failed:", e);
            }
        })();
        return () => {
            cancelled = true;
            setVideoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        };
    }, [frames, K, dur]);

    useEffect(() => {
        (async () => {
            const oc  = new OffscreenCanvas(256, 64);
            const ctx = oc.getContext("2d") as OffscreenCanvasRenderingContext2D;
            const id  = ctx.createImageData(256, 64);
            for (let p = 0; p < 256 * 64; p++) {
                id.data[p*4]=200; id.data[p*4+1]=200; id.data[p*4+2]=200; id.data[p*4+3]=255;
            }
            const mx = audioBins.reduce((a, b) => Math.max(a, b), 0);
            if (mx > 0) {
                for (let x = 0; x < 256; x++) {
                    const h = Math.round(audioBins[x] / mx * 64);
                    for (let y = 64 - h; y < 64; y++) {
                        const p = y * 256 + x;
                        id.data[p*4]=34; id.data[p*4+1]=197; id.data[p*4+2]=94; id.data[p*4+3]=255;
                    }
                }
            }
            ctx.putImageData(id, 0, 0);
            const blob = await oc.convertToBlob({ type: "image/png" });
            const url  = await new Promise<string>(res => {
                const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob);
            });
            setBarUrl(url);
        })();
    }, [audioBins]);

    return (
        <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">ELA frames</p>
                {videoUrl
                    ? <video controls src={videoUrl} preload="auto"
                            className="w-full rounded-lg border border-gray-100 bg-black"
                            style={{ imageRendering: "pixelated" }} />
                    : <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">
                            Encoding…
                      </div>
                }
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">Audio profile</p>
                {barUrl
                    ? <img src={barUrl} alt="Audio second-difference quality"
                            className="w-full rounded border border-gray-100"
                            style={{ imageRendering: "pixelated" }} />
                    : <div className="w-full bg-gray-100 rounded" style={{ aspectRatio: "256/64" }} />
                }
            </div>
        </div>
    );
}

type VerifyResult =
    | { success: true; h_circuit: string; h_ct: string }
    | { success: false; error: string };

export default function NonAcceptedPrecontractModal({
    onClose,
    contract,
}: NonAcceptedPrecontractModalProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
    const [ctSize, setCtSize] = useState<number | null>(null);
    const [previewThumbStatus, setPreviewThumbStatus] = useState<"idle" | "checking" | "ok" | "warn">("idle");
    const [audioPreviewStatus, setAudioPreviewStatus] = useState<"idle" | "checking" | "ok" | "warn">("idle");
    const [descVerifyStatus, setDescVerifyStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
    const [descComputedHash, setDescComputedHash] = useState<string | null>(null);
    const [descAcceptedHash, setDescAcceptedHash] = useState<string | null>(null);
    const [descThumbDataUrl, setDescThumbDataUrl] = useState<string | null>(null);
    const [descQualityDataUrl, setDescQualityDataUrl] = useState<string | null>(null);
    const [descQualityVideoData, setDescQualityVideoData] = useState<{ frames: Uint8Array; audioBins: Uint32Array } | null>(null);
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
    const [videoThumbBlobSrc, setVideoThumbBlobSrc] = useState<string | null>(null);
    const [videoClipBlobSrc, setVideoClipBlobSrc]   = useState<string | null>(null);
    const { showToast } = useToast();

    if (!contract) return null;

    const {
        id,
        pk_buyer,
        pk_vendor,
        item_description,
        price,
        tip_completion,
        tip_dispute,
        protocol_version,
        timeout_delay,
        algorithm_suite,
        commitment,
        opening_value,
        listing_type,
        preview_image,
        preview_hash,
        ext_img_thumb_hash,
        ext_img_width,
        ext_img_height,
        ext_img_size,
        preview_audio,
        ext_audio_preview_hash,
        ext_audio_duration,
        ext_audio_bitrate,
        ext_audio_size,
        preview_crop_image,
        ext_img_crop_hash,
        ext_img_crop_x,
        ext_img_crop_y,
        preview_audio_lowres,
        ext_audio_lowres_hash,
        ext_audio_preview_sr,
        ext_audio_lowres_sr,
        preview_video_thumb,
        ext_video_thumb_hash,
        preview_video_clip,
        ext_video_clip_hash,
        ext_video_width,
        ext_video_height,
        ext_video_duration,
        ext_video_bitrate,
        ext_video_size,
        ext_video_fps,
        ext_video_clip_frames,
        desc_d,
        desc_dim,
        desc_thumb,
        desc_quality,
    } = contract;

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    // Original file size from listing metadata; for video parse from description hex
    let origSize: number | null = null;
    if (listing_type === "image") {
        origSize = ext_img_size ?? null;
    } else if (listing_type === "audio") {
        origSize = ext_audio_size ?? null;
    } else if (listing_type === "video") {
        origSize = ext_video_size ?? null;
        if (origSize == null) {
            // Fallback: parse dSize from description hex (first scalar field after hash fields)
            const descHex = (item_description || "").replace(/^0x/, "");
            const isBoth = algorithm_suite === "extended_video_both";
            const scalarBase = isBoth ? 320 : 192;
            if (descHex.length >= scalarBase + 8) {
                origSize = parseInt(descHex.slice(scalarBase, scalarBase + 8), 16);
            }
        }
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (!preview_video_thumb) { setVideoThumbBlobSrc(null); return; }
        const u = dataUrlToObjectUrl(preview_video_thumb);
        setVideoThumbBlobSrc(u);
        return () => URL.revokeObjectURL(u);
    }, [preview_video_thumb]);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (!preview_video_clip) { setVideoClipBlobSrc(null); return; }
        const u = dataUrlToObjectUrl(preview_video_clip);
        setVideoClipBlobSrc(u);
        return () => URL.revokeObjectURL(u);
    }, [preview_video_clip]);

    // For extended_image/dual: verify that the preview image shown to the buyer matches
    // d_thumb (SHA256 of 256×256 BGR thumbnail from BMP) committed in the description tuple.
    // d_thumb is at bytes 32-63 of item_description (hex chars 64-127).
    // The preview PNG was generated from BGR thumb bytes; we swap R↔B when reading back.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (algorithm_suite !== "extended_image" && algorithm_suite !== "extended_image_dual") return;
        if (!preview_image) { setPreviewThumbStatus("idle"); return; }

        // Extract d_thumb from item_description:
        // extended_image/dual: d_thumb at bytes 32-63 (hex 64-128)
        const descHex = (item_description || "").replace(/^0x/, "");
        const dThumbHex = descHex.length >= 128 ? descHex.slice(64, 128) : (ext_img_thumb_hash || "").replace(/^0x/, "");

        if (!dThumbHex) return;

        setPreviewThumbStatus("checking");
        (async () => {
            try {
                const resp = await fetch(preview_image);
                const blob = await resp.blob();
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(256, 256);
                const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                ctx.drawImage(bitmap, 0, 0, 256, 256);
                bitmap.close();
                const imgData = ctx.getImageData(0, 0, 256, 256);
                // d_thumb is SHA256 of BGR bytes — swap R↔B to match circuit order
                const bgr = new Uint8Array(196608);
                for (let i = 0; i < 65536; i++) {
                    bgr[i * 3]     = imgData.data[i * 4 + 2]; // B
                    bgr[i * 3 + 1] = imgData.data[i * 4 + 1]; // G
                    bgr[i * 3 + 2] = imgData.data[i * 4];     // R
                }
                const hashBuf = await crypto.subtle.digest("SHA-256", bgr);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map(b => b.toString(16).padStart(2, "0")).join("");
                setPreviewThumbStatus(hash === dThumbHex ? "ok" : "warn");
            } catch {
                setPreviewThumbStatus("idle");
            }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.id]);

    // For extended_audio/both: verify SHA256 of PCM preview bytes matches d_preview in description.
    // d_preview is at bytes 32-63 of item_description (hex chars 64-127).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (algorithm_suite !== "extended_audio" && algorithm_suite !== "extended_audio_both") return;
        if (desc_d) { setAudioPreviewStatus("idle"); return; } // desc V3: no d_preview sub-hash
        if (!preview_audio) { setAudioPreviewStatus("idle"); return; }

        // Extract d_preview from item_description or fall back to ext_audio_preview_hash
        const descHex = (item_description || "").replace(/^0x/, "");
        const dPreviewHex = descHex.length >= 128
            ? descHex.slice(64, 128)
            : (ext_audio_preview_hash || "").replace(/^0x/, "");

        if (!dPreviewHex) return;

        setAudioPreviewStatus("checking");
        (async () => {
            try {
                const resp = await fetch(preview_audio);
                const buf = await resp.arrayBuffer();
                const pcmBytes = new Uint8Array(buf).slice(44); // skip 44-byte WAV header
                const hashBuf = await crypto.subtle.digest("SHA-256", pcmBytes);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map(b => b.toString(16).padStart(2, "0")).join("");
                setAudioPreviewStatus(hash === dPreviewHex ? "ok" : "warn");
            } catch {
                setAudioPreviewStatus("idle");
            }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.id]);

    // Render desc_thumb and desc_quality as data URLs for visual inspection.
    // desc_thumb: base64 BGR bytes — 196608 B = single 256×256, 393216 B = dual (lowres‖crop)
    // desc_quality: base64 — 65536 B = ELA-light (JET colormap), 1024 B = RMS bar chart
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        setDescThumbDataUrl(null);
        setDescQualityDataUrl(null);
        setDescQualityVideoData(null);
        if (!desc_thumb && !desc_quality) return;
        (async () => {
            // desc_thumb is BGR 256×256 image bytes only for image listings
            if (desc_thumb && listing_type === "image") {
                try {
                    const tBin = atob(desc_thumb);
                    const isDual = tBin.length >= 393216;
                    const canvasW = isDual ? 512 : 256;
                    const canvas = new OffscreenCanvas(canvasW, 256);
                    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                    const imgData = ctx.createImageData(canvasW, 256);
                    const renderHalf = (offset: number, xOff: number) => {
                        for (let i = 0; i < 65536; i++) {
                            const base = offset + i * 3;
                            const px = (Math.floor(i / 256) * canvasW + xOff + (i % 256)) * 4;
                            imgData.data[px]     = base + 2 < tBin.length ? tBin.charCodeAt(base + 2) : 0;
                            imgData.data[px + 1] = base + 1 < tBin.length ? tBin.charCodeAt(base + 1) : 0;
                            imgData.data[px + 2] = base     < tBin.length ? tBin.charCodeAt(base)     : 0;
                            imgData.data[px + 3] = 255;
                        }
                    };
                    renderHalf(0, 0);
                    if (isDual) renderHalf(196608, 256);
                    ctx.putImageData(imgData, 0, 0);
                    const blob = await canvas.convertToBlob({ type: "image/png" });
                    const url = await new Promise<string>((res, rej) => {
                        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej;
                        r.readAsDataURL(blob);
                    });
                    setDescThumbDataUrl(url);
                } catch { /* ignore */ }
            }

            if (!desc_quality) return;
            try {
                const qBin = atob(desc_quality);
                if (qBin.length === 65536) {
                    // ELA-light: apply JET colormap
                    const canvas2 = new OffscreenCanvas(256, 256);
                    const ctx2 = canvas2.getContext("2d") as OffscreenCanvasRenderingContext2D;
                    const imgData2 = ctx2.createImageData(256, 256);
                    for (let i = 0; i < 65536; i++) {
                        const [r, g, b] = JET_LUT[qBin.charCodeAt(i)];
                        imgData2.data[i * 4]     = r;
                        imgData2.data[i * 4 + 1] = g;
                        imgData2.data[i * 4 + 2] = b;
                        imgData2.data[i * 4 + 3] = 255;
                    }
                    ctx2.putImageData(imgData2, 0, 0);
                    const blob2 = await canvas2.convertToBlob({ type: "image/png" });
                    const url2 = await new Promise<string>((res, rej) => {
                        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej;
                        r.readAsDataURL(blob2);
                    });
                    setDescQualityDataUrl(url2);
                } else if (qBin.length === 1024) {
                    // Second-difference profile: 256 uint32-BE values → bar chart
                    const qBuf = new Uint8Array(1024);
                    for (let i = 0; i < 1024; i++) qBuf[i] = qBin.charCodeAt(i);
                    const view = new DataView(qBuf.buffer);
                    const values: number[] = [];
                    let maxVal = 0;
                    for (let i = 0; i < 256; i++) {
                        const v = view.getUint32(i * 4, false);
                        values.push(v);
                        if (v > maxVal) maxVal = v;
                    }
                    const W = 256, H = 64;
                    const canvas3 = new OffscreenCanvas(W, H);
                    const ctx3 = canvas3.getContext("2d") as OffscreenCanvasRenderingContext2D;
                    const imgData3 = ctx3.createImageData(W, H);
                    for (let x = 0; x < W; x++) {
                        const norm = maxVal > 0 ? values[x] / maxVal : 0;
                        const barH = Math.round(norm * H);
                        for (let y = 0; y < H; y++) {
                            const idx = (y * W + x) * 4;
                            const lit = y >= H - barH;
                            imgData3.data[idx]     = lit ? 99  : 240;
                            imgData3.data[idx + 1] = lit ? 179 : 240;
                            imgData3.data[idx + 2] = lit ? 132 : 240;
                            imgData3.data[idx + 3] = 255;
                        }
                    }
                    ctx3.putImageData(imgData3, 0, 0);
                    const blob3 = await canvas3.convertToBlob({ type: "image/png" });
                    const url3 = await new Promise<string>((res, rej) => {
                        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej;
                        r.readAsDataURL(blob3);
                    });
                    setDescQualityDataUrl(url3);
                } else if (qBin.length > 65536 + 1024 && (qBin.length - 1024) % 65536 === 0) {
                    // Video ELA quality: K×65536 ELA frames ‖ 1024 B audio second-diff
                    const K = (qBin.length - 1024) / 65536;
                    const qBuf = new Uint8Array(qBin.length);
                    for (let i = 0; i < qBin.length; i++) qBuf[i] = qBin.charCodeAt(i);
                    const frames = qBuf.slice(0, K * 65536);
                    const audioBuf = qBuf.slice(K * 65536);
                    const audioView = new DataView(audioBuf.buffer);
                    const audioBins = new Uint32Array(256);
                    for (let i = 0; i < 256; i++) audioBins[i] = audioView.getUint32(i * 4, false);
                    setDescQualityVideoData({ frames, audioBins });
                }
            } catch { /* ignore */ }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.id]);

    // desc V3 buyer pre-payment check: verify SHA256(T ‖ Q ‖ D) = d
    // Falls back to the first 32 bytes of item_description when desc_d is not a separate field.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        const descHex = (item_description || "").replace(/^0x/, "");
        const effectiveD = desc_d?.replace(/^0x/, "").toLowerCase()
            ?? (descHex.length >= 64 ? descHex.slice(0, 64).toLowerCase() : null);

        if (!effectiveD || !desc_thumb || !desc_quality || !desc_dim) {
            setDescVerifyStatus("idle");
            setDescComputedHash(null);
            setDescAcceptedHash(null);
            return;
        }
        setDescVerifyStatus("checking");
        setDescAcceptedHash(effectiveD);
        (async () => {
            try {
                const tBin = atob(desc_thumb);
                const t = new Uint8Array(tBin.length);
                for (let i = 0; i < tBin.length; i++) t[i] = tBin.charCodeAt(i);

                const qBin = atob(desc_quality);
                const q = new Uint8Array(qBin.length);
                for (let i = 0; i < qBin.length; i++) q[i] = qBin.charCodeAt(i);

                const dHex = desc_dim.replace(/^0x/, "");
                const d = new Uint8Array(dHex.length / 2);
                for (let i = 0; i < d.length; i++) d[i] = parseInt(dHex.slice(i * 2, i * 2 + 2), 16);

                const tqd = new Uint8Array(t.length + q.length + d.length);
                tqd.set(t, 0);
                tqd.set(q, t.length);
                tqd.set(d, t.length + q.length);
                const hashBuf = await crypto.subtle.digest("SHA-256", tqd);
                const computed = Array.from(new Uint8Array(hashBuf))
                    .map(b => b.toString(16).padStart(2, "0")).join("");
                setDescComputedHash(computed);
                setDescVerifyStatus(computed === effectiveD ? "ok" : "fail");
            } catch {
                setDescVerifyStatus("fail");
            }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.id]);

    const handleVerifyCommitment = async () => {
        setIsVerifying(true);
        setVerifyResult(null);
        try {
            await init();
            // 1. Fetch ciphertext from server (only the encrypted bytes, never plaintext)
            const fileRes = await fetch(`/api/files/${id}`);
            if (!fileRes.ok) {
                const err = await fileRes.json().catch(() => ({}));
                throw new Error(err.error || `Could not fetch ciphertext (HTTP ${fileRes.status})`);
            }
            const { file: ctHex } = await fileRes.json();
            const ctBytes = hexToBytes(ctHex);
            setCtSize(ctBytes.length);

            // 3. Verify commitment in the browser.
            // Extended algorithm suites use algorithm-specific circuits; dispatch to the correct
            // check_precontract_extended_*_v2 WASM function which uses the right circuit internally.
            const descBytes = hexToBytes(item_description);
            let result;
            switch (algorithm_suite) {
                case "extended_image":
                    result = check_precontract_extended_image_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_image_crop":
                    result = check_precontract_extended_image_crop_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_image_dual":
                    result = check_precontract_extended_image_dual_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_audio":
                    result = check_precontract_extended_audio_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_audio_lowres":
                    result = check_precontract_extended_audio_lowres_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_audio_both":
                    result = check_precontract_extended_audio_both_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_video":
                    result = check_precontract_extended_video_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_video_clip":
                    result = check_precontract_extended_video_clip_v2(descBytes, commitment, opening_value, ctBytes); break;
                case "extended_video_both":
                    result = check_precontract_extended_video_both_v2(descBytes, commitment, opening_value, ctBytes); break;
                default:
                    // Basic V2 circuit (default, zk, hash commitment)
                    result = check_precontract_v2(item_description, commitment, opening_value, ctBytes); break;
            }

            if (result.success) {
                const h_circuit_hex = bytes_to_hex(result.h_circuit);
                const h_ct_hex = bytes_to_hex(result.h_ct);
                localStorage.setItem(`h_circuit_${id}`, h_circuit_hex);
                localStorage.setItem(`h_ct_${id}`, h_ct_hex);
                setVerifyResult({ success: true, h_circuit: h_circuit_hex, h_ct: h_ct_hex });
            } else {
                setVerifyResult({ success: false, error: "Commitment does not match the received ciphertext." });
            }
        } catch (e: any) {
            const msg = e.message || String(e);
            const isWasmTrap = msg.toLowerCase().includes("unreachable");
            setVerifyResult({
                success: false,
                error: isWasmTrap
                    ? "Circuit compilation failed (internal WASM error). The vendor must recreate this contract."
                    : msg,
            });
        } finally {
            setIsVerifying(false);
        }
    };

    const handleAccept = async () => {
        try {
            const acceptResponse = await fetch("/api/precontracts/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });

            if (!acceptResponse.ok) {
                throw new Error(`Error accepting contract: ${acceptResponse.status}`);
            }

            // Download ciphertext locally for the buyer's records
            try {
                const fileResponse = await fetch(`/api/files/${id}`);
                if (fileResponse.ok) {
                    const { file: ctHex } = await fileResponse.json();
                    if (ctHex) {
                        downloadFile(hexToBytes(ctHex), `contract_${id}_ciphertext.enc`);
                    }
                }
            } catch (downloadError) {
                console.warn("Could not download ciphertext:", downloadError);
            }

            window.dispatchEvent(new Event("reloadData"));
            showToast(`Vertrag ${id} akzeptiert. Ciphertext heruntergeladen.`, "success");
            onClose();
        } catch (error: any) {
            showToast(`Fehler beim Akzeptieren: ${error.message || error}`, "error");
        }
    };

    const handleReject = async () => {
        await fetch("/api/precontracts/reject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        window.dispatchEvent(new Event("reloadData"));
        showToast(`Vertrag ${id} abgelehnt`, "info");
        onClose();
    };

    return (
        <>
        {lightboxSrc && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
                onClick={() => setLightboxSrc(null)}
            >
                <img
                    src={lightboxSrc}
                    alt="Preview"
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        )}
        <Modal title="Precontract Details" onClose={onClose}>
            <div className="grid grid-cols-2 gap-4">
                {listing_type === "audio" && (algorithm_suite === "extended_audio" || algorithm_suite === "extended_audio_lowres" || algorithm_suite === "extended_audio_both") && (() => {
                    const descHex = (item_description || "").replace(/^0x/, "");
                    // desc V3: d = SHA256(T‖Q‖D) — single 32-byte commitment
                    const dShaHex = descHex.slice(0, 64);
                    // Parse D from desc_dim (desc V3) if available: [duration_s, sample_rate, n_samples]
                    const dimHex = (desc_dim || "").replace(/^0x/, "");
                    const dimU32s: number[] = [];
                    for (let i = 0; i + 7 < dimHex.length; i += 8)
                        dimU32s.push(parseInt(dimHex.slice(i, i + 8), 16));
                    const tBytes = desc_thumb ? Math.round(atob(desc_thumb).length) : 0;
                    const qBytes = desc_quality ? Math.round(atob(desc_quality).length) : 0;
                    return (
                    <div className={`col-span-2 rounded border p-3 text-sm ${
                        audioPreviewStatus === "warn"
                            ? "bg-red-50 border-red-300"
                            : descVerifyStatus === "ok" || audioPreviewStatus === "ok"
                            ? "bg-green-50 border-green-300"
                            : descVerifyStatus === "fail"
                            ? "bg-red-50 border-red-300"
                            : "bg-purple-50 border-purple-200"
                    }`}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="font-semibold text-gray-800">Audio Description</p>
                            <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-purple-100 text-purple-800">
                                SHA256(T ‖ Q ‖ D)
                            </span>
                        </div>

                        {/* T — Preview */}
                        <div className="mb-3">
                            <p className="text-xs font-semibold text-gray-600 mb-1.5">
                                T — Preview
                                {tBytes > 0 && <span className="font-normal text-gray-400 ml-1">({(tBytes / 1024).toFixed(0)} KB Int16 PCM)</span>}
                            </p>
                            {preview_audio && (
                                <div className="mb-1.5">
                                    <p className="text-xs text-gray-500 mb-1">
                                        Preview{ext_audio_preview_sr != null && ext_audio_duration != null
                                            ? ` — ${ext_audio_preview_sr.toLocaleString()} Hz · Int16 · first ${Math.min(ext_audio_duration, Math.round(240_000 / ext_audio_preview_sr))}s of ${ext_audio_duration}s`
                                            : ""}:
                                    </p>
                                    <audio controls src={preview_audio} className="w-full h-8" />
                                </div>
                            )}
                            {preview_audio_lowres && (
                                <div className="mb-1.5">
                                    <p className="text-xs text-gray-500 mb-1">
                                        Full low-res{ext_audio_lowres_sr != null && ext_audio_duration != null
                                            ? ` — ${ext_audio_lowres_sr.toLocaleString()} Hz · Int8 · ${ext_audio_duration}s`
                                            : ""}:
                                    </p>
                                    <audio controls src={preview_audio_lowres} className="w-full h-8" />
                                </div>
                            )}
                        </div>

                        {/* Q — Second-difference profile */}
                        <div className="mb-3">
                            <p className="text-xs font-semibold text-gray-600 mb-1.5">
                                Q — Second-difference profile
                                {qBytes === 1024 && <span className="font-normal text-gray-400 ml-1">(1024 B · 256×uint32 BE)</span>}
                            </p>
                            {descQualityDataUrl
                                ? <img src={descQualityDataUrl} alt="Q second-difference"
                                        className="w-full rounded border border-gray-200"
                                        style={{ imageRendering: "pixelated", height: 48 }} />
                                : desc_quality && <div className="text-xs text-gray-400 italic">Rendering…</div>
                            }
                        </div>

                        {/* D — Metadata */}
                        <div className="mb-3 font-mono text-xs text-gray-500 space-y-0.5 bg-white/60 rounded p-2">
                            <p className="font-sans text-xs font-semibold text-gray-600 mb-1">D — Metadata</p>
                            {dimU32s.length >= 1
                                ? <>
                                    <p><span className="text-gray-400">{"duration".padEnd(8)}</span> {dimU32s[0]} s</p>
                                    {dimU32s[1] != null && <p><span className="text-gray-400">{"sr".padEnd(8)}</span> {dimU32s[1].toLocaleString()} Hz</p>}
                                    {dimU32s[2] != null && <p><span className="text-gray-400">{"n_samp".padEnd(8)}</span> {dimU32s[2].toLocaleString()}</p>}
                                </>
                                : <>
                                    {ext_audio_duration != null && <p><span className="text-gray-400">{"duration".padEnd(8)}</span> {ext_audio_duration} s</p>}
                                    {ext_audio_bitrate  != null && <p><span className="text-gray-400">{"bitrate".padEnd(8)}</span> {ext_audio_bitrate} kbps</p>}
                                    {ext_audio_size     != null && <p><span className="text-gray-400">{"size".padEnd(8)}</span> {ext_audio_size.toLocaleString()} B</p>}
                                </>
                            }
                            <p className="pt-1 border-t border-gray-200 mt-1">
                                <span className="text-gray-400 font-sans">d</span>
                                <span className="text-gray-400 font-sans text-[10px] ml-1 mr-2">(committed SHA256(T‖Q‖D))</span>
                                {dShaHex.slice(0, 32)}…
                            </p>
                        </div>

                        {/* SHA256(T‖Q‖D) verification */}
                        {descAcceptedHash !== null && (
                            <div className="flex items-start gap-2 text-xs">
                                <span className={`shrink-0 font-bold ${
                                    descVerifyStatus === "checking" ? "text-blue-500" :
                                    descVerifyStatus === "ok"       ? "text-green-700" :
                                    descVerifyStatus === "fail"     ? "text-red-700" : "text-gray-400"
                                }`}>{descVerifyStatus === "checking" ? "…" : descVerifyStatus === "ok" ? "✓" : descVerifyStatus === "fail" ? "✗" : "·"}</span>
                                <div>
                                    <span className="font-medium text-gray-700">SHA256(T ‖ Q ‖ D) == d</span>
                                    <span className="text-gray-500 ml-1">— verified locally in your browser</span>
                                    {descVerifyStatus === "fail" && (
                                        <p className="mt-1 font-semibold text-red-800">⚠ Verification FAILED — T, Q, or D does not match d!</p>
                                    )}
                                    {descVerifyStatus === "ok" && (
                                        <div className="mt-0.5 text-green-700">
                                            <p>Authentic — SHA256(T ‖ Q ‖ D) matches the committed d.</p>
                                            <div className="mt-1 font-mono text-[10px] space-y-0.5 text-gray-600">
                                                <p><span className="text-gray-400 select-none">d (accepted) </span>{descAcceptedHash ?? "…"}</p>
                                                <p><span className="text-gray-400 select-none">computed     </span>{descComputedHash ?? "…"}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    );
                })()}

                {/* Extended video: T/Q/D structured description */}
                {listing_type === "video" && (algorithm_suite === "extended_video" || algorithm_suite === "extended_video_clip" || algorithm_suite === "extended_video_both") && (() => {
                    const descHex = (item_description || "").replace(/^0x/, "");
                    const isClip  = algorithm_suite === "extended_video_clip";
                    const isBoth  = algorithm_suite === "extended_video_both";
                    // desc V3: d = SHA256(T‖Q‖D) — single 32-byte commitment, no sub-hashes
                    const dShaHex = descHex.slice(0, 64);
                    const qBytes  = desc_quality ? Math.round(atob(desc_quality).length) : 0;
                    return (
                        <div className={`col-span-2 rounded border p-3 text-sm ${
                            descVerifyStatus === "fail"     ? "bg-red-50 border-red-300" :
                            descVerifyStatus === "ok"       ? "bg-green-50 border-green-300" :
                            descVerifyStatus === "checking" ? "bg-blue-50 border-blue-200" :
                            "bg-green-50 border-green-200"
                        }`}>
                            <div className="flex items-center justify-between mb-3">
                                <p className="font-semibold text-gray-800">Video Description</p>
                                <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-green-100 text-green-800">
                                    T ‖ Q ‖ D
                                </span>
                            </div>

                            {/* T — Thumbnail / Clip */}
                            <div className="mb-3">
                                <p className="text-xs font-semibold text-gray-600 mb-1.5">T — Thumbnail / Clip</p>
                                <div className="flex gap-3">
                                    {videoThumbBlobSrc && !isClip && (
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-500 mb-1">Thumbnail (whole film, low-res):</p>
                                            <video controls src={videoThumbBlobSrc} className="w-full max-h-48 rounded border border-gray-200 bg-black" preload="auto" />
                                        </div>
                                    )}
                                    {videoClipBlobSrc && (isClip || isBoth) && (
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-500 mb-1">Clip — first {ext_video_clip_frames} frames @ {ext_video_fps} fps:</p>
                                            <video controls src={videoClipBlobSrc} className="w-full max-h-48 rounded border border-gray-200 bg-black" preload="auto" />
                                        </div>
                                    )}
                                    {!videoThumbBlobSrc && !videoClipBlobSrc && (
                                        <p className="text-xs text-gray-400 italic">No preview available.</p>
                                    )}
                                </div>
                            </div>

                            {/* Q — ELA video ‖ Audio second-difference */}
                            <div className="mb-3">
                                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                                    Q — ELA video ‖ Audio profile
                                    {qBytes > 0 && <span className="font-normal text-gray-400 ml-1">({(qBytes / (1024*1024)).toFixed(1)} MB · {Math.round((qBytes - 1024) / 65536)} ELA frames + 1024 B audio)</span>}
                                </p>
                                {descQualityVideoData
                                    ? <ModalElaVideoPlayer frames={descQualityVideoData.frames} audioBins={descQualityVideoData.audioBins} duration={ext_video_duration ?? undefined} />
                                    : desc_quality
                                    ? <div className="w-full aspect-video bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">Decoding ELA quality…</div>
                                    : <p className="text-xs text-gray-400 italic">No quality data.</p>
                                }
                            </div>

                            {/* D — Metadata */}
                            <div className="font-mono text-xs text-gray-500 space-y-0.5 bg-white/60 rounded p-2 mb-2">
                                <p className="font-sans text-xs font-semibold text-gray-600 mb-1">D — Metadata</p>
                                {ext_video_size     != null && <p><span className="text-gray-400">{"size".padEnd(8)}</span> {ext_video_size.toLocaleString()} B</p>}
                                {ext_video_duration != null && <p><span className="text-gray-400">{"duration".padEnd(8)}</span> {ext_video_duration} s</p>}
                                {ext_video_bitrate  != null && <p><span className="text-gray-400">{"bitrate".padEnd(8)}</span> {ext_video_bitrate} kbps</p>}
                                {ext_video_width    != null && <p><span className="text-gray-400">{"W×H".padEnd(8)}</span> {ext_video_width}×{ext_video_height}</p>}
                                {ext_video_fps      != null && <p><span className="text-gray-400">{"fps".padEnd(8)}</span> {ext_video_fps}</p>}
                                <p className="pt-1 border-t border-gray-200 mt-1">
                                    <span className="text-gray-400 font-sans">d</span>
                                    <span className="text-gray-400 font-sans text-[10px] ml-1 mr-2">(committed SHA256(T‖Q‖D))</span>
                                    {dShaHex.slice(0, 32)}…
                                </p>
                            </div>

                            {/* SHA256(T‖Q‖D) verification */}
                            {descAcceptedHash !== null && (
                                <div className="flex items-start gap-2 text-xs">
                                    <span className={`shrink-0 font-bold ${
                                        descVerifyStatus === "checking" ? "text-blue-500" :
                                        descVerifyStatus === "ok"       ? "text-green-700" :
                                        descVerifyStatus === "fail"     ? "text-red-700" : "text-gray-400"
                                    }`}>{descVerifyStatus === "checking" ? "…" : descVerifyStatus === "ok" ? "✓" : descVerifyStatus === "fail" ? "✗" : "·"}</span>
                                    <div>
                                        <span className="font-medium text-gray-700">SHA256(T ‖ Q ‖ D) == d</span>
                                        <span className="text-gray-500 ml-1">— verified locally in your browser</span>
                                        {descVerifyStatus === "fail" && (
                                            <p className="mt-1 font-semibold text-red-800">⚠ Verification FAILED — T, Q, or D does not match d!</p>
                                        )}
                                        {descVerifyStatus === "ok" && (
                                            <div className="mt-0.5 text-green-700">
                                                <p>Authentic — SHA256(T ‖ Q ‖ D) matches the committed d.</p>
                                                <div className="mt-1 font-mono text-[10px] space-y-0.5 text-gray-600">
                                                    <p><span className="text-gray-400 select-none">d (accepted) </span>{descAcceptedHash ?? "…"}</p>
                                                    <p><span className="text-gray-400 select-none">computed     </span>{descComputedHash ?? "…"}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {listing_type === "image" && (
                    <>
                        {/* desc V3 buyer pre-payment verification: SHA256(T ‖ Q ‖ D) = d */}
                        {desc_d && (() => {
                            // Parse D (dim bytes) as sequence of BE u32s
                            const dimHex = (desc_dim || "").replace(/^0x/, "");
                            const dimU32s: number[] = [];
                            for (let i = 0; i + 7 < dimHex.length; i += 8) {
                                dimU32s.push(parseInt(dimHex.slice(i, i + 8), 16));
                            }
                            // Determine label based on number of u32 values
                            const dimLabels: [string, number][] = dimU32s.length === 2
                                ? [["w", dimU32s[0]], ["h", dimU32s[1]]]
                                : dimU32s.length === 3
                                ? [["dur", dimU32s[0]], ["sr", dimU32s[1]], ["n_samp", dimU32s[2]]]
                                : dimU32s.length === 4
                                ? [["w", dimU32s[0]], ["h", dimU32s[1]], ["cx", dimU32s[2]], ["cy", dimU32s[3]]]
                                : dimU32s.map((v, i) => [`u32[${i}]`, v] as [string, number]);
                            const tBytes = desc_thumb ? Math.round(desc_thumb.length * 3 / 4) : 0;
                            const qBytes = desc_quality ? Math.round(desc_quality.length * 3 / 4) : 0;
                            const isRms = qBytes === 1024;
                            return (
                            <div className={`col-span-2 rounded border p-3 text-sm ${
                                descVerifyStatus === "fail"     ? "bg-red-50 border-red-300" :
                                descVerifyStatus === "ok"       ? "bg-green-50 border-green-300" :
                                descVerifyStatus === "checking" ? "bg-blue-50 border-blue-200" :
                                "bg-gray-50 border-gray-200"
                            }`}>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="font-semibold text-gray-800">Description Verification (Circuit-verified)</p>
                                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                        descVerifyStatus === "ok"   ? "bg-green-100 text-green-800" :
                                        descVerifyStatus === "fail" ? "bg-red-100 text-red-800" :
                                        "bg-gray-100 text-gray-600"
                                    }`}>SHA256(T ‖ Q ‖ D)</span>
                                </div>
                                <p className="text-xs text-gray-500 mb-3">
                                    The vendor publishes T (preview), Q (quality map), and D (metadata).
                                    Your browser verifies SHA256(T ‖ Q ‖ D) = d before you pay — no ciphertext required.
                                </p>

                                {/* Visual previews of T and Q */}
                                {(descThumbDataUrl || descQualityDataUrl) && (
                                    <div className="flex gap-3 mb-3">
                                        {descThumbDataUrl && (
                                            <div className="flex-1">
                                                <p className="text-xs text-gray-500 mb-1 font-medium">
                                                    T — {tBytes >= 2 * 196608 ? "lowres ‖ crop (256×256 each)" : tBytes >= 196608 ? "256×256 thumbnail" : "preview"}
                                                    <span className="text-gray-400 ml-1">({tBytes.toLocaleString()} B)</span>
                                                </p>
                                                <img
                                                    src={descThumbDataUrl}
                                                    alt="T preview"
                                                    className={`${tBytes >= 2 * 196608 ? "w-64 h-32" : "w-32 h-32"} object-contain border border-gray-200 rounded cursor-zoom-in`}
                                                    onClick={() => setLightboxSrc(descThumbDataUrl)}
                                                />
                                                {tBytes >= 2 * 196608 && (
                                                    <p className="text-xs text-gray-400 mt-0.5">Left: lowres · Right: crop</p>
                                                )}
                                            </div>
                                        )}
                                        {descQualityDataUrl && (
                                            <div className="flex-1">
                                                <p className="text-xs text-gray-500 mb-1 font-medium">
                                                    Q — {isRms ? "256-segment RMS profile" : "ELA-light sharpness map (256×256)"}
                                                    <span className="text-gray-400 ml-1">({qBytes.toLocaleString()} B)</span>
                                                </p>
                                                <img
                                                    src={descQualityDataUrl}
                                                    alt="Q quality"
                                                    className={`${isRms ? "w-full h-16" : "w-32 h-32"} object-contain border border-gray-200 rounded cursor-zoom-in`}
                                                    style={isRms ? { imageRendering: "pixelated" } : {}}
                                                    onClick={() => setLightboxSrc(descQualityDataUrl)}
                                                />
                                                {!isRms && (
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        Bright = high-frequency edge. Flat areas = dark, sharp edges = bright.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* D metadata */}
                                <div className="font-mono text-xs text-gray-500 space-y-0.5 bg-white/60 rounded p-2 mb-2">
                                    <p className="font-sans text-xs font-semibold text-gray-600 mb-1">D — Dimensions</p>
                                    {dimLabels.map(([label, val]) => (
                                        <p key={label}><span className="text-gray-400">{label.padEnd(6)}</span> {label === "sr" ? `${val.toLocaleString()} Hz` : label === "dur" ? `${val} s` : label === "n_samp" ? val.toLocaleString() : `${val} px`}</p>
                                    ))}
                                    <p className="mt-1 pt-1 border-t border-gray-200">
                                        <span className="text-gray-400 font-sans">d</span>
                                        <span className="text-gray-400 font-sans text-[10px] ml-1 mr-2">(committed SHA256(T‖Q‖D))</span>
                                        {(descAcceptedHash ?? "").slice(0, 32)}…
                                    </p>
                                </div>

                                {/* Verification result */}
                                <div className="flex items-start gap-2 text-xs">
                                    <span className={`shrink-0 font-bold ${
                                        descVerifyStatus === "checking" ? "text-blue-500" :
                                        descVerifyStatus === "ok"       ? "text-green-700" :
                                        descVerifyStatus === "fail"     ? "text-red-700" :
                                        "text-gray-400"
                                    }`}>
                                        {descVerifyStatus === "checking" ? "…" :
                                         descVerifyStatus === "ok"       ? "✓" :
                                         descVerifyStatus === "fail"     ? "✗" : "·"}
                                    </span>
                                    <div>
                                        <span className="font-medium text-gray-700">SHA256(T ‖ Q ‖ D) == d</span>
                                        <span className="text-gray-500 ml-1">— verified locally in your browser</span>
                                        {descVerifyStatus === "fail" && (
                                            <p className="mt-1 font-semibold text-red-800">
                                                ⚠ Verification FAILED — T, Q, or D does not match d!
                                            </p>
                                        )}
                                        {descVerifyStatus === "ok" && (
                                            <div className="mt-0.5 text-green-700">
                                                <p>Authentic — SHA256(T ‖ Q ‖ D) matches the committed d.</p>
                                                <div className="mt-1 font-mono text-[10px] space-y-0.5 text-gray-600">
                                                    <p><span className="text-gray-400 select-none">d (accepted) </span>{descAcceptedHash ?? "…"}</p>
                                                    <p><span className="text-gray-400 select-none">computed     </span>{descComputedHash ?? "…"}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            );
                        })()}

                    </>
                )}

                <div><strong>Contract ID:</strong> {id}</div>
                <div>
                    <strong>Price:</strong> {price} ETH
                </div>
                <div className="col-span-2 font-mono text-sm">
                    <strong>Vendor:</strong> {pk_vendor}
                </div>
                <div className="col-span-2 font-mono text-sm">
                    <strong>Buyer:</strong> {pk_buyer}
                </div>
                <div>
                    <strong>Tip Completion:</strong> {tip_completion} ETH
                </div>
                <div>
                    <strong>Tip Dispute:</strong> {tip_dispute} ETH
                </div>
                <div><strong>Timeout:</strong> {timeout_delay} s</div>
                <div><strong>Protocol Version:</strong> {protocol_version}</div>
                <div>
                    <strong>Algorithm:</strong>{" "}
                    {algorithm_suite === "extended_image" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Extended Desc (Thumb 256×256)</span>
                    ) : algorithm_suite === "extended_image_crop" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Extended Desc (Crop native-res)</span>
                    ) : algorithm_suite === "extended_image_dual" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Extended Desc (Thumb + Crop)</span>
                    ) : algorithm_suite === "extended_audio" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">Extended Desc (Audio preview)</span>
                    ) : algorithm_suite === "extended_audio_lowres" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">Extended Desc (Audio low-res)</span>
                    ) : algorithm_suite === "extended_audio_both" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">Extended Desc (Audio preview+lowres)</span>
                    ) : algorithm_suite === "extended_video" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Extended Desc (Video thumbnail)</span>
                    ) : algorithm_suite === "extended_video_clip" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Extended Desc (Video clip)</span>
                    ) : algorithm_suite === "extended_video_both" ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Extended Desc (Video thumb+clip)</span>
                    ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">Hash Commitment</span>
                    )}
                </div>

                {/* Commitment verification section */}
                <div className="col-span-2 border-t border-gray-300 pt-4">
                    <p className="text-sm text-gray-600 mb-3">
                        Verify that the vendor's commitment matches the encrypted file.
                        This runs entirely in your browser — no data leaves your machine unencrypted.
                    </p>

                    <Button
                        label={isVerifying ? "Verifying…" : "Verify Commitment (Browser)"}
                        onClick={handleVerifyCommitment}
                        isDisabled={isVerifying}
                    />

                    {verifyResult && (
                        <div
                            className={`mt-3 p-3 rounded text-sm ${
                                verifyResult.success
                                    ? "bg-green-100 border border-green-400 text-green-800"
                                    : "bg-red-100 border border-red-400 text-red-800"
                            }`}
                        >
                            {verifyResult.success ? (
                                <>
                                    <p className="font-semibold mb-1">✓ Commitment valid</p>
                                    <p className="text-xs font-mono break-all">
                                        h_circuit: {verifyResult.h_circuit.slice(0, 20)}…
                                    </p>
                                    <p className="text-xs font-mono break-all">
                                        h_ct: {verifyResult.h_ct.slice(0, 20)}…
                                    </p>
                                    <p className="text-xs mt-1 text-green-700">
                                        Accumulators saved to localStorage.
                                    </p>
                                    {ctSize != null && (
                                        <div className="mt-2 pt-2 border-t border-green-300 font-mono text-xs space-y-0.5">
                                            <p className="font-sans font-semibold text-green-800 mb-1">File Size Info</p>
                                            {origSize != null && (
                                                <p><span className="text-green-600">Plaintext </span>{formatBytes(origSize)} <span className="text-green-500">({origSize.toLocaleString()} B)</span></p>
                                            )}
                                            <p><span className="text-green-600">CT (LZ4)  </span>{formatBytes(ctSize)} <span className="text-green-500">({ctSize.toLocaleString()} B)</span></p>
                                            {origSize != null && origSize > 0 && (() => {
                                                const savedBytes = origSize - ctSize;
                                                const pct = Math.round((savedBytes / origSize) * 100);
                                                return savedBytes > 0
                                                    ? <p><span className="text-green-600">Saved     </span>{pct}% ({formatBytes(savedBytes)})</p>
                                                    : <p><span className="text-green-600">Overhead  </span>+{formatBytes(-savedBytes)} <span className="text-green-500">(incompressible)</span></p>;
                                            })()}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="font-semibold mb-1">✗ Commitment INVALID</p>
                                    <p>{verifyResult.error}</p>
                                    <p className="text-xs mt-1">Do not accept this contract.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Action buttons */}
                <div className="col-span-2 flex gap-4 pt-2">
                    <Button
                        label="Accept"
                        onClick={handleAccept}
                        width="1/2"
                        isDisabled={previewThumbStatus === "warn" || audioPreviewStatus === "warn"}
                    />
                    <Button label="Reject" onClick={handleReject} width="1/2" />
                </div>
                {previewThumbStatus === "warn" && (
                    <p className="col-span-2 text-xs text-red-700 font-medium text-center bg-red-50 border border-red-200 rounded p-2">
                        ⚠ Accept is blocked: the advertised preview does not match the committed description (d_thumb mismatch).
                    </p>
                )}
                {audioPreviewStatus === "warn" && (
                    <p className="col-span-2 text-xs text-red-700 font-medium text-center bg-red-50 border border-red-200 rounded p-2">
                        ⚠ Accept is blocked: the audio preview does not match the committed hash (d_preview mismatch).
                    </p>
                )}
            </div>
        </Modal>
        </>
    );
}
