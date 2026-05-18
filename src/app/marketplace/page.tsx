"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "../lib/UserContext";
import { useToast } from "../lib/ToastContext";
import { ALL_PUBLIC_KEYS } from "../lib/blockchain/config";

type Listing = {
    id: number;
    title: string;
    description: string;
    price: number;
    tip_completion: number;
    tip_dispute: number;
    pk_vendor: string;
    pending_requests: number;
    created_at: string;
    listing_type?: string;
    algorithm_suite?: string;
    preview_image?: string;
    brisque_value?: number | null;
    preview_hash?: string | null;
    ext_img_thumb_hash?: string | null;
    ext_img_width?: number | null;
    ext_img_height?: number | null;
    ext_img_size?: number | null;
    preview_audio?: string | null;
    ext_audio_duration?: number | null;
    ext_audio_bitrate?: number | null;
    ext_audio_size?: number | null;
    preview_crop_image?: string | null;
    ext_img_crop_hash?: string | null;
    ext_img_crop_x?: number | null;
    ext_img_crop_y?: number | null;
    preview_audio_lowres?: string | null;
    ext_audio_lowres_hash?: string | null;
    ext_audio_preview_sr?: number | null;
    ext_audio_lowres_sr?: number | null;
    preview_video_thumb?: string | null;
    ext_video_thumb_hash?: string | null;
    preview_video_clip?: string | null;
    ext_video_clip_hash?: string | null;
    ext_video_width?: number | null;
    ext_video_height?: number | null;
    ext_video_duration?: number | null;
    ext_video_bitrate?: number | null;
    ext_video_size?: number | null;
    ext_video_fps?: number | null;
    ext_video_clip_frames?: number | null;
    // desc V3 fields: d = SHA256(T‖Q‖D)
    desc_d?: string | null;
    desc_dim?: string | null;
    desc_thumb?: string | null;
    desc_quality?: string | null;
};

type FilterType = "all" | "image" | "audio" | "video" | "general";

function QualityDot({ value }: { value: number | null | undefined }) {
    if (value === null || value === undefined) return null;
    const color = value < 30 ? "bg-emerald-400" : value < 60 ? "bg-amber-400" : "bg-red-400";
    const label = value < 30 ? "High quality" : value < 60 ? "Medium quality" : "Low quality";
    return (
        <span className="flex items-center gap-1 text-xs text-gray-500">
            <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
            {label}
        </span>
    );
}

function VerifiedBadge() {
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Verified preview
        </span>
    );
}

function formatDuration(secs: number) {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function shortAddr(pk: string) {
    return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

/* ─── Detail Drawer ─────────────────────────────────────────────────────── */

interface DrawerProps {
    listing: Listing;
    onClose: () => void;
    onRequest: (l: Listing) => void;
    requesting: boolean;
    isOwn: boolean;
    isLoggedIn: boolean;
}

/** A single audio player that converts a data URL to a blob URL for correct duration/seeking. */
function CardAudio({ src }: { src: string }) {
    const [blobSrc, setBlobSrc] = useState<string | null>(null);
    useEffect(() => {
        const url = dataUrlToObjectUrl(src);
        setBlobSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [src]);
    if (!blobSrc) return null;
    return <audio controls src={blobSrc} preload="metadata" style={{ display: "block", width: "100%", height: "36px" }} />;
}

/** Looping muted video thumbnail card — blob URL so Chrome can seek/know duration. */
function CardVideo({ src }: { src: string }) {
    const [blobSrc, setBlobSrc] = useState<string | null>(null);
    useEffect(() => {
        const url = dataUrlToObjectUrl(src);
        setBlobSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [src]);
    if (!blobSrc) return null;
    return (
        <video
            muted autoPlay loop playsInline preload="auto"
            src={blobSrc}
            className="w-full h-full object-contain"
        />
    );
}

/** Convert a data: URL to an object URL so the browser can seek / report duration. */
function dataUrlToObjectUrl(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    const meta  = dataUrl.slice(0, comma);
    const mime  = meta.match(/:(.*?);/)?.[1] ?? "audio/wav";
    const bin   = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

// Exact OpenCV COLORMAP_JET LUT (256 entries, RGB)
const JET: readonly [number,number,number][] = [
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

function ElaVideoPlayer({ frames, audioBins, duration }: { frames: Uint8Array; audioBins: Uint32Array; duration: number }) {
    const K = Math.floor(frames.length / 65536);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [barUrl,   setBarUrl]   = useState<string | null>(null);

    useEffect(() => {
        if (K === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
                if (cancelled) return;
                const frameDurUs = Math.round(duration * 1_000_000 / K);
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
                        const [r, g, b] = JET[f[i]];
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
    }, [frames, K, duration]);

    useEffect(() => {
        (async () => {
            const oc  = new OffscreenCanvas(256, 64);
            const ctx = oc.getContext("2d")!;
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
        <div className="space-y-1">
            {videoUrl
                ? <video controls src={videoUrl} preload="auto"
                        className="w-full rounded-lg border border-gray-100 bg-black"
                        style={{ imageRendering: "pixelated" }} />
                : <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">
                        Encoding ELA video…
                  </div>
            }
            {barUrl && (
                <img src={barUrl} alt="Audio second-difference quality"
                    className="w-full rounded border border-gray-100"
                    style={{ imageRendering: "pixelated" }} />
            )}
        </div>
    );
}

function ListingDrawer({ listing, onClose, onRequest, requesting, isOwn, isLoggedIn }: DrawerProps) {
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
    const drawerRef = useRef<HTMLDivElement>(null);

    const isImage = listing.listing_type === "image";
    const isAudio = listing.listing_type === "audio";
    const isVideo = listing.listing_type === "video";
    const hasPreview = !!(listing.preview_image || listing.preview_audio || listing.preview_audio_lowres || listing.preview_crop_image || listing.preview_video_thumb || listing.preview_video_clip);

    // Convert data URLs → Blob URLs for proper browser media handling (seekable, correct duration)
    const [audioSrc, setAudioSrc]          = useState<string | null>(null);
    const [audioLowSrc, setAudioLowSrc]    = useState<string | null>(null);
    const [videoThumbSrc, setVideoThumbSrc] = useState<string | null>(null);
    const [videoClipSrc, setVideoClipSrc]  = useState<string | null>(null);

    useEffect(() => {
        if (!listing.preview_audio) { setAudioSrc(null); return; }
        const url = dataUrlToObjectUrl(listing.preview_audio);
        setAudioSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [listing.preview_audio]);
    useEffect(() => {
        if (!listing.preview_audio_lowres) { setAudioLowSrc(null); return; }
        const url = dataUrlToObjectUrl(listing.preview_audio_lowres);
        setAudioLowSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [listing.preview_audio_lowres]);
    useEffect(() => {
        if (!listing.preview_video_thumb) { setVideoThumbSrc(null); return; }
        const url = dataUrlToObjectUrl(listing.preview_video_thumb);
        setVideoThumbSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [listing.preview_video_thumb]);
    useEffect(() => {
        if (!listing.preview_video_clip) { setVideoClipSrc(null); return; }
        const url = dataUrlToObjectUrl(listing.preview_video_clip);
        setVideoClipSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [listing.preview_video_clip]);

    const [qualityDataUrl, setQualityDataUrl]       = useState<string | null>(null);
    const [qualityVideoData, setQualityVideoData]   = useState<{ frames: Uint8Array; audioBins: Uint32Array; duration: number } | null>(null);
    useEffect(() => {
        if (!listing.desc_quality) { setQualityDataUrl(null); setQualityVideoData(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const raw = atob(listing.desc_quality!);
                const bytes = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

                // Video ELA quality: K×65536 raw ELA frames ‖ 1024 B audio second-diff
                if (bytes.length > 65536 + 1024 && (bytes.length - 1024) % 65536 === 0) {
                    const K = (bytes.length - 1024) / 65536;
                    const frames = bytes.slice(0, K * 65536);
                    const audioView = new DataView(bytes.buffer, bytes.byteOffset + K * 65536, 1024);
                    const audioBins = new Uint32Array(256);
                    for (let i = 0; i < 256; i++) audioBins[i] = audioView.getUint32(i * 4, false);
                    const duration = listing.ext_video_duration ?? K / 10;
                    if (!cancelled) { setQualityVideoData({ frames, audioBins, duration }); setQualityDataUrl(null); }
                    return;
                }

                let canvas: OffscreenCanvas;
                if (bytes.length === 65536) {
                    canvas = new OffscreenCanvas(256, 256);
                    const ctx = canvas.getContext("2d")!;
                    const id = ctx.createImageData(256, 256);
                    for (let i = 0; i < 65536; i++) {
                        const [r, g, b] = JET[bytes[i]];
                        id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = 255;
                    }
                    ctx.putImageData(id, 0, 0);
                } else if (bytes.length === 1024) {
                    canvas = new OffscreenCanvas(256, 64);
                    const ctx = canvas.getContext("2d")!;
                    const view = new DataView(bytes.buffer);
                    const rms = new Float32Array(256);
                    let maxRms = 0;
                    for (let i = 0; i < 256; i++) { rms[i] = view.getUint32(i * 4, false); if (rms[i] > maxRms) maxRms = rms[i]; }
                    const id = ctx.createImageData(256, 64);
                    for (let p = 0; p < 256 * 64; p++) { id.data[p*4]=200; id.data[p*4+1]=200; id.data[p*4+2]=200; id.data[p*4+3]=255; }
                    if (maxRms > 0) {
                        for (let x = 0; x < 256; x++) {
                            const barH = Math.round((rms[x] / maxRms) * 64);
                            for (let y = 64 - barH; y < 64; y++) {
                                const p = y * 256 + x;
                                id.data[p*4]=34; id.data[p*4+1]=197; id.data[p*4+2]=94; id.data[p*4+3]=255;
                            }
                        }
                    }
                    ctx.putImageData(id, 0, 0);
                } else { return; }

                const blob = await canvas.convertToBlob({ type: "image/png" });
                const dataUrl = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
                if (!cancelled) { setQualityDataUrl(dataUrl); setQualityVideoData(null); }
            } catch { if (!cancelled) { setQualityDataUrl(null); setQualityVideoData(null); } }
        })();
        return () => { cancelled = true; };
    }, [listing.desc_quality, listing.ext_video_duration]);

    // Close on Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // Prevent body scroll while drawer is open
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    const detailRows: { label: string; value: string }[] = [];
    if (listing.created_at) detailRows.push({ label: "Listed on", value: formatDate(listing.created_at) });
    if (isImage && listing.ext_img_width && listing.ext_img_height)
        detailRows.push({ label: "Resolution", value: `${listing.ext_img_width} × ${listing.ext_img_height} px` });
    if (isImage && listing.ext_img_size)
        detailRows.push({ label: "File size", value: formatFileSize(listing.ext_img_size) });
    // Image preview quality: show scale % for thumb, "native-res" for crop
    if (isImage && listing.ext_img_width && listing.ext_img_height) {
        const suite = listing.algorithm_suite;
        if (suite === "extended_image") {
            const scale = Math.round(256 / Math.max(listing.ext_img_width, listing.ext_img_height) * 100);
            detailRows.push({ label: "Thumb quality", value: `256×256 px (${scale}% of original)` });
        } else if (suite === "extended_image_crop" || suite === "extended_image_dual") {
            detailRows.push({ label: "Crop quality", value: "256×256 px native-res" });
        }
    }
    if (isAudio && listing.ext_audio_duration != null)
        detailRows.push({ label: "Duration", value: formatDuration(listing.ext_audio_duration) });
    if (isAudio && listing.ext_audio_bitrate != null)
        detailRows.push({ label: "Quality", value: `${listing.ext_audio_bitrate} kbps` });
    if (isAudio && listing.ext_audio_size)
        detailRows.push({ label: "File size", value: formatFileSize(listing.ext_audio_size) });
    // Audio preview quality
    if (isAudio && listing.ext_audio_preview_sr != null && listing.ext_audio_duration != null) {
        const previewSecs = Math.min(listing.ext_audio_duration, Math.round(240_000 / listing.ext_audio_preview_sr));
        detailRows.push({ label: "Preview quality", value: `${listing.ext_audio_preview_sr.toLocaleString()} Hz · Int16 · ${previewSecs}s` });
    }
    if (isAudio && listing.ext_audio_lowres_sr != null && listing.ext_audio_duration != null)
        detailRows.push({ label: "Low-res quality", value: `${listing.ext_audio_lowres_sr.toLocaleString()} Hz · Int8 · ${listing.ext_audio_duration}s` });
    if (isVideo && listing.ext_video_width && listing.ext_video_height)
        detailRows.push({ label: "Resolution", value: `${listing.ext_video_width} × ${listing.ext_video_height} px` });
    if (isVideo && listing.ext_video_duration != null)
        detailRows.push({ label: "Duration", value: formatDuration(listing.ext_video_duration) });
    if (isVideo && listing.ext_video_bitrate != null)
        detailRows.push({ label: "Bitrate", value: `${listing.ext_video_bitrate} kbps` });
    if (isVideo && listing.ext_video_size)
        detailRows.push({ label: "File size", value: formatFileSize(listing.ext_video_size) });
    if (isVideo && listing.ext_video_clip_frames != null)
        detailRows.push({ label: "Clip duration", value: `${listing.ext_video_clip_frames}s` });

    return (
        <>
            {/* Lightbox (on top of drawer) */}
            {lightboxSrc && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 cursor-zoom-out"
                    onClick={() => setLightboxSrc(null)}
                >
                    <img
                        src={lightboxSrc}
                        alt="Preview"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer panel */}
            <div
                ref={drawerRef}
                className="fixed right-0 top-0 h-full z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden"
                style={{ animation: "slideInRight 0.25s ease-out" }}
            >
                {/* Drawer header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                    <div className="flex items-center gap-2">
                        {isImage && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                                </svg>
                                Image
                            </span>
                        )}
                        {isAudio && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 18V5l12-2v13M9 18c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-2c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                                </svg>
                                Audio
                            </span>
                        )}
                        {isVideo && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                                </svg>
                                Video
                            </span>
                        )}
                        {!isImage && !isAudio && !isVideo && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                </svg>
                                File
                            </span>
                        )}
                        {hasPreview && <VerifiedBadge />}
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto">
                    {/* Image preview */}
                    {isImage && listing.preview_image && (
                        <div
                            className="w-full bg-gray-50 cursor-zoom-in overflow-hidden"
                            style={
                                listing.ext_img_width && listing.ext_img_height
                                    ? { aspectRatio: `${listing.ext_img_width}/${listing.ext_img_height}`, maxHeight: "340px" }
                                    : { height: "260px" }
                            }
                            onClick={() => setLightboxSrc(listing.preview_image!)}
                        >
                            <img
                                src={listing.preview_image}
                                alt={listing.title}
                                className={`w-full h-full ${listing.ext_img_width && listing.ext_img_height ? "object-fill" : "object-cover"}`}
                            />
                        </div>
                    )}
                    {isImage && !listing.preview_image && listing.preview_crop_image && (
                        <div
                            className="w-full h-64 bg-gray-50 flex items-center justify-center cursor-zoom-in overflow-hidden"
                            onClick={() => setLightboxSrc(listing.preview_crop_image!)}
                        >
                            <img src={listing.preview_crop_image} alt={listing.title} className="max-h-full max-w-full object-contain" />
                        </div>
                    )}
                    {/* Detail crop shown below main image */}
                    {isImage && listing.preview_image && listing.preview_crop_image && (
                        <div
                            className="relative border-t border-gray-100 bg-gray-900 cursor-zoom-in overflow-hidden max-h-48 flex items-center justify-center"
                            onClick={() => setLightboxSrc(listing.preview_crop_image!)}
                        >
                            <img src={listing.preview_crop_image} alt="Detail view" className="max-h-48 object-contain" />
                            <div className="absolute bottom-2 right-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded-full">Detail view</div>
                        </div>
                    )}

                    {/* Audio preview */}
                    {isAudio && (audioSrc || audioLowSrc) && (
                        <div className="px-6 pt-6 space-y-4" onClick={(e) => e.stopPropagation()}>
                            <div className="h-16 bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl flex items-center justify-center gap-3">
                                <svg className="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 18V5l12-2v13M9 18c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-2c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                                </svg>
                                <span className="text-purple-600 font-semibold">
                                    {listing.ext_audio_duration != null ? formatDuration(listing.ext_audio_duration) : "Audio file"}
                                </span>
                            </div>
                            {audioSrc && (
                                <div>
                                    <p className="text-xs font-medium text-gray-400 mb-1.5">
                                        Preview{listing.ext_audio_preview_sr != null && listing.ext_audio_duration != null
                                            ? ` — ${listing.ext_audio_preview_sr.toLocaleString()} Hz · Int16 · ${Math.min(listing.ext_audio_duration, Math.round(240_000 / listing.ext_audio_preview_sr))}s of ${listing.ext_audio_duration}s`
                                            : listing.ext_audio_preview_sr != null ? ` — ${listing.ext_audio_preview_sr.toLocaleString()} Hz · Int16` : ""}
                                    </p>
                                    <audio controls src={audioSrc} preload="metadata" style={{ display: "block", width: "100%", height: "40px" }} />
                                </div>
                            )}
                            {audioLowSrc && (
                                <div>
                                    <p className="text-xs font-medium text-gray-400 mb-1.5">
                                        Full low-res{listing.ext_audio_lowres_sr != null && listing.ext_audio_duration != null
                                            ? ` — ${listing.ext_audio_lowres_sr.toLocaleString()} Hz · Int8 · ${listing.ext_audio_duration}s`
                                            : listing.ext_audio_lowres_sr != null ? ` — ${listing.ext_audio_lowres_sr.toLocaleString()} Hz · Int8` : " (low quality)"}
                                    </p>
                                    <audio controls src={audioLowSrc} preload="metadata" style={{ display: "block", width: "100%", height: "40px" }} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Video preview */}
                    {isVideo && (listing.preview_video_thumb || listing.preview_video_clip) && (
                        <div className="space-y-3">
                            {/* Playable clip (extended_video_clip / extended_video_both) */}
                            {videoClipSrc && (
                                <div className="bg-black">
                                    <video
                                        controls
                                        src={videoClipSrc}
                                        className="w-full"
                                        style={{ maxHeight: "340px" }}
                                        preload="auto"
                                    />
                                </div>
                            )}
                            {/* Low-res thumbnail video (extended_video / extended_video_both) */}
                            {videoThumbSrc && (
                                <div className="px-6 pt-4" onClick={(e) => e.stopPropagation()}>
                                    <p className="text-xs font-medium text-gray-400 mb-1.5">
                                        Thumbnail (whole film, low-res)
                                    </p>
                                    <video
                                        controls
                                        loop
                                        src={videoThumbSrc}
                                        className="w-full max-h-48 rounded-lg border border-gray-100 bg-black"
                                        preload="auto"
                                    />
                                </div>
                            )}
                            {/* Metadata row */}
                            {!videoClipSrc && listing.preview_video_thumb && (
                                <div className="px-6 flex items-center gap-2 text-xs text-rose-600 font-medium">
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                                    </svg>
                                    {listing.ext_video_duration != null ? formatDuration(listing.ext_video_duration) : "Video"}
                                    {listing.ext_video_width && listing.ext_video_height ? ` · ${listing.ext_video_width}×${listing.ext_video_height}` : ""}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quality fingerprint (desc V3) */}
                    {qualityVideoData && (
                        <div className="px-6 pt-5 pb-1">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                ELA video quality
                            </p>
                            <ElaVideoPlayer frames={qualityVideoData.frames} audioBins={qualityVideoData.audioBins} duration={qualityVideoData.duration} />
                            <p className="text-xs text-gray-400 mt-1.5">
                                ELA-light video (256×256, {Math.round(qualityVideoData.frames.length / 65536)} frames) + audio second-difference — committed via desc(x̂) = SHA256(T‖Q‖D)
                            </p>
                        </div>
                    )}
                    {qualityDataUrl && (
                        <div className="px-6 pt-5 pb-1">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                {isAudio ? "RMS energy profile" : "ELA-light quality map"}
                            </p>
                            <img
                                src={qualityDataUrl}
                                alt="Quality map"
                                className="w-full rounded-lg border border-gray-100"
                                style={{ imageRendering: "pixelated" }}
                            />
                            <p className="text-xs text-gray-400 mt-1.5">
                                {isAudio
                                    ? "256-segment RMS energy of the audio — committed via desc(x̂) = SHA256(T‖Q‖D)"
                                    : "Per-pixel Laplacian of luminance (ELA-light) — committed via desc(x̂) = SHA256(T‖Q‖D)"}
                            </p>
                        </div>
                    )}

                    {/* Content */}
                    <div className="px-6 py-6 space-y-6">
                        {/* Title + quality */}
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <h2 className="text-xl font-bold text-gray-900 leading-snug">{listing.title}</h2>
                                {isImage && <QualityDot value={listing.brisque_value} />}
                            </div>
                        </div>

                        {/* Description */}
                        {listing.description && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Description</h3>
                                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
                            </div>
                        )}

                        {/* Details grid */}
                        {(detailRows.length > 0 || listing.pk_vendor) && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Details</h3>
                                <dl className="space-y-2.5">
                                    <div className="flex justify-between items-center">
                                        <dt className="text-sm text-gray-500">Seller</dt>
                                        <dd className="text-sm font-mono text-gray-700 bg-gray-50 px-2 py-0.5 rounded">
                                            {shortAddr(listing.pk_vendor)}
                                        </dd>
                                    </div>
                                    {detailRows.map(row => (
                                        <div key={row.label} className="flex justify-between items-center">
                                            <dt className="text-sm text-gray-500">{row.label}</dt>
                                            <dd className="text-sm text-gray-700 font-medium">{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}

                        {/* How it works */}
                        <div className="bg-blue-50 rounded-xl p-4">
                            <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">How it works</h3>
                            <ol className="space-y-1.5">
                                {["Send a purchase request to the seller.", "The seller prepares a secure contract for you to review.", "Once you approve and pay, the file is delivered — guaranteed by a smart contract."].map((step, i) => (
                                    <li key={i} className="flex gap-2.5 text-xs text-blue-800">
                                        <span className="shrink-0 w-4 h-4 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center font-bold text-[10px]">{i + 1}</span>
                                        {step}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                </div>

                {/* Sticky footer */}
                <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <span className="text-2xl font-bold text-gray-900">{listing.price} ETH</span>
                        </div>
                        {isOwn ? (
                            <span className="text-sm text-gray-400 bg-gray-50 border border-gray-200 px-4 py-2 rounded-xl">
                                Your listing
                            </span>
                        ) : !isLoggedIn ? (
                            <span className="text-sm text-gray-400">Log in to buy</span>
                        ) : (
                            <button
                                onClick={() => onRequest(listing)}
                                disabled={requesting}
                                className="px-6 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            >
                                {requesting ? (
                                    <span className="flex items-center gap-2">
                                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                        </svg>
                                        Requesting…
                                    </span>
                                ) : "Send request"}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); }
                    to   { transform: translateX(0); }
                }
            `}</style>
        </>
    );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */

export default function MarketplacePage() {
    const { user, login, logout } = useUser();
    const { showToast } = useToast();
    const [listings, setListings] = useState<Listing[]>([]);
    const [requesting, setRequesting] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<FilterType>("all");
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
    const [loginOpen, setLoginOpen] = useState(false);
    const [loginPk, setLoginPk] = useState(ALL_PUBLIC_KEYS[0]);
    const loginRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!loginOpen) return;
        const handler = (e: MouseEvent) => {
            if (loginRef.current && !loginRef.current.contains(e.target as Node))
                setLoginOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [loginOpen]);

    const fetchListings = async () => {
        const res = await fetch("/api/listings");
        setListings(await res.json());
    };

    useEffect(() => { fetchListings(); }, []);

    const handleRequest = async (listing: Listing) => {
        if (!user) { showToast("Please log in first", "warning"); return; }
        if (listing.pk_vendor.toLowerCase() === user.publicKey.toLowerCase()) {
            showToast("You can't buy your own listing", "warning"); return;
        }
        setRequesting(listing.id);
        try {
            const res = await fetch(`/api/listings/${listing.id}/requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pk_buyer: user.publicKey }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast("Request sent! The vendor will prepare your file and send you a contract to review.", "success", 7000);
            await fetchListings();
        } catch (e: any) {
            showToast(`Error: ${e.message}`, "error");
        } finally {
            setRequesting(null);
        }
    };

    const filtered = listings.filter((l) => {
        const matchesSearch =
            l.title.toLowerCase().includes(search.toLowerCase()) ||
            l.description?.toLowerCase().includes(search.toLowerCase());
        const matchesFilter =
            filter === "all" ||
            (filter === "image"   && l.listing_type === "image") ||
            (filter === "audio"   && l.listing_type === "audio") ||
            (filter === "video"   && l.listing_type === "video") ||
            (filter === "general" && (!l.listing_type || l.listing_type === "general"));
        return matchesSearch && matchesFilter;
    });

    const isOwnListing = (l: Listing) =>
        !!user && l.pk_vendor.toLowerCase() === user.publicKey.toLowerCase();

    const hasPreview = (l: Listing) =>
        !!(l.preview_image || l.preview_audio || l.preview_audio_lowres || l.preview_crop_image || l.preview_video_thumb || l.preview_video_clip);

    const counts = {
        all:     listings.length,
        image:   listings.filter(l => l.listing_type === "image").length,
        audio:   listings.filter(l => l.listing_type === "audio").length,
        video:   listings.filter(l => l.listing_type === "video").length,
        general: listings.filter(l => !l.listing_type || l.listing_type === "general").length,
    };

    return (
        <>
        {selectedListing && (
            <ListingDrawer
                listing={selectedListing}
                onClose={() => setSelectedListing(null)}
                onRequest={async (l) => { await handleRequest(l); setSelectedListing(null); }}
                requesting={requesting === selectedListing.id}
                isOwn={isOwnListing(selectedListing)}
                isLoggedIn={!!user}
            />
        )}

        <main className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
                    <h1 className="text-xl font-bold text-gray-900">Marketplace</h1>
                    <div className="flex items-center gap-2">
                        {/* Login / account widget */}
                        <div className="relative" ref={loginRef}>
                            {user ? (
                                <button
                                    onClick={() => setLoginOpen(o => !o)}
                                    className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
                                >
                                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                    <span className="font-mono text-xs text-gray-600">
                                        {user.publicKey.slice(0, 8)}…{user.publicKey.slice(-4)}
                                    </span>
                                    <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                                </button>
                            ) : (
                                <button
                                    onClick={() => setLoginOpen(o => !o)}
                                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                                    </svg>
                                    Login
                                </button>
                            )}
                            {loginOpen && (
                                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 p-4">
                                    {user ? (
                                        <>
                                            <p className="text-xs text-gray-400 mb-1">Logged in as</p>
                                            <p className="font-mono text-xs text-gray-700 break-all mb-3">{user.publicKey}</p>
                                            <button
                                                onClick={() => { logout(); setLoginOpen(false); }}
                                                className="w-full py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                                            >
                                                Logout
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-medium text-gray-800 mb-3">Login</p>
                                            <select
                                                value={loginPk}
                                                onChange={(e) => setLoginPk(e.target.value)}
                                                className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                {ALL_PUBLIC_KEYS.map((pk) => (
                                                    <option key={pk} value={pk}>{pk.slice(0, 16)}…{pk.slice(-8)}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => { login(loginPk); setLoginOpen(false); }}
                                                className="w-full py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                            >
                                                Login
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                            </svg>
                            <input
                                type="text"
                                placeholder="Search…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-52"
                            />
                        </div>
                        <button
                            onClick={fetchListings}
                            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                            title="Refresh"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Filter tabs */}
                <div className="max-w-6xl mx-auto px-6 flex gap-1 pb-0">
                    {(["all", "image", "audio", "video", "general"] as FilterType[]).map((f) => (
                        counts[f] > 0 || f === "all" ? (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                filter === f
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {f === "all" ? "All" : f === "image" ? "Images" : f === "audio" ? "Audio" : f === "video" ? "Videos" : "Files"}
                            {counts[f] > 0 && (
                                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${filter === f ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                                    {counts[f]}
                                </span>
                            )}
                        </button>
                        ) : null
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-6 py-8">
                {filtered.length === 0 ? (
                    <div className="text-center py-32">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                        </div>
                        <p className="text-gray-500 font-medium mb-1">No listings found</p>
                        <p className="text-sm text-gray-400">
                            {listings.length === 0
                                ? "Log in and visit your dashboard to post a listing."
                                : "Try a different search term or filter."}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filtered.map((listing) => {
                            const isImage = listing.listing_type === "image";
                            const isAudio = listing.listing_type === "audio";
                            const isVideo = listing.listing_type === "video";
                            const own = isOwnListing(listing);
                            const verified = hasPreview(listing);
                            const mainImage = listing.preview_image ?? listing.preview_crop_image ?? null;
                            const videoThumb = listing.preview_video_thumb ?? null;

                            return (
                                <div
                                    key={listing.id}
                                    className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col cursor-pointer group"
                                    onClick={() => setSelectedListing(listing)}
                                >
                                    {/* Image preview — one image only on the card */}
                                    {isImage && mainImage && (
                                        <div
                                            className="overflow-hidden bg-gray-50"
                                            style={
                                                listing.ext_img_width && listing.ext_img_height
                                                    ? { aspectRatio: `${listing.ext_img_width}/${listing.ext_img_height}`, maxHeight: "260px" }
                                                    : { height: "200px" }
                                            }
                                        >
                                            <img
                                                src={mainImage}
                                                alt={listing.title}
                                                className={`w-full h-full group-hover:scale-[1.02] transition-transform duration-300 ${listing.ext_img_width && listing.ext_img_height ? "object-fill" : "object-cover"}`}
                                            />
                                        </div>
                                    )}

                                    {/* Video — playable low-res thumbnail on the card */}
                                    {isVideo && videoThumb && (
                                        <div className="overflow-hidden bg-gray-900" style={{ height: "160px" }} onClick={(e) => e.stopPropagation()}>
                                            <CardVideo src={videoThumb} />
                                        </div>
                                    )}
                                    {isVideo && !videoThumb && listing.preview_video_clip && (
                                        <div className="h-32 bg-gray-900 flex flex-col items-center justify-center gap-2 cursor-pointer">
                                            <div className="w-12 h-12 rounded-full bg-rose-600/80 flex items-center justify-center group-hover:bg-rose-600 transition-colors">
                                                <svg className="w-6 h-6 text-white translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M8 5v14l11-7z"/>
                                                </svg>
                                            </div>
                                            <span className="text-xs text-gray-400">
                                                {listing.ext_video_duration != null ? formatDuration(listing.ext_video_duration) : "Click to view"}
                                            </span>
                                        </div>
                                    )}
                                    {isVideo && !videoThumb && !listing.preview_video_clip && (
                                        <div className="h-28 bg-gradient-to-r from-rose-50 to-rose-100 flex items-center justify-center gap-2">
                                            <svg className="w-8 h-8 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                                            </svg>
                                        </div>
                                    )}

                                    {/* Audio — one player on the card (lowres preferred) */}
                                    {isAudio && (
                                        <div className="px-4 pt-4 space-y-2" onClick={(e) => e.stopPropagation()}>
                                            <div className="h-10 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg flex items-center justify-center gap-2">
                                                <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M9 18V5l12-2v13M9 18c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-2c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                                                </svg>
                                                <span className="text-xs text-purple-500 font-medium">
                                                    {listing.ext_audio_duration != null ? formatDuration(listing.ext_audio_duration) : "Audio"}
                                                </span>
                                            </div>
                                            {(listing.preview_audio_lowres || listing.preview_audio) && (
                                                <CardAudio src={listing.preview_audio_lowres ?? listing.preview_audio!} />
                                            )}
                                        </div>
                                    )}

                                    {/* Card body */}
                                    <div className="px-4 py-3 flex flex-col gap-2">
                                        {/* Title + type badge on one line */}
                                        <div className="flex items-center gap-2 min-w-0">
                                            <h2 className="font-semibold text-gray-900 text-sm leading-snug truncate flex-1">{listing.title}</h2>
                                            {isImage && (
                                                <span className="shrink-0 text-[10px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Image</span>
                                            )}
                                            {isAudio && (
                                                <span className="shrink-0 text-[10px] font-medium text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-full">Audio</span>
                                            )}
                                            {isVideo && (
                                                <span className="shrink-0 text-[10px] font-medium text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full">Video</span>
                                            )}
                                            {!isImage && !isAudio && !isVideo && (
                                                <span className="shrink-0 text-[10px] font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full">File</span>
                                            )}
                                            {verified && <VerifiedBadge />}
                                        </div>

                                        {/* Meta + price on one line */}
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                                                {isImage && listing.ext_img_width && listing.ext_img_height && (
                                                    <span>{listing.ext_img_width}×{listing.ext_img_height}</span>
                                                )}
                                                {isImage && listing.ext_img_size && <span>{formatFileSize(listing.ext_img_size)}</span>}
                                                {isAudio && listing.ext_audio_duration != null && <span>{formatDuration(listing.ext_audio_duration)}</span>}
                                                {isAudio && listing.ext_audio_bitrate != null && <span>{listing.ext_audio_bitrate} kbps</span>}
                                                {isVideo && listing.ext_video_width && listing.ext_video_height && <span>{listing.ext_video_width}×{listing.ext_video_height}</span>}
                                                {isVideo && listing.ext_video_duration != null && <span>{formatDuration(listing.ext_video_duration)}</span>}
                                                {isImage && <QualityDot value={listing.brisque_value} />}
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <span className="text-sm font-bold text-gray-900">{listing.price} ETH</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-end">
                                            <span className="text-xs text-blue-600 font-medium group-hover:underline">View details →</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
        </>
    );
}
