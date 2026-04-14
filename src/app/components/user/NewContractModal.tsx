"use client";

import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import FormFileInput from "../common/FormFileInput";
import { isAddress } from "ethers";
import initWasm, {
    compute_precontract_values_v2,
    compute_precontract_extended_image_v2,
    compute_precontract_extended_image_crop_v2,
    compute_precontract_extended_image_dual_v2,
    compute_precontract_extended_audio_v2,
    compute_precontract_extended_audio_lowres_v2,
    compute_precontract_extended_audio_both_v2,
    bytes_to_hex,
} from "@/app/lib/crypto_lib";
import { useEthChfRate, ethToCHF } from "@/app/lib/useEthChfRate";
import { useToast } from "@/app/lib/ToastContext";

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
    // ZK proof pre-computed at listing time (for zk algorithm)
    listingZkProof?: string | null;
    listingZkProofFull?: string | null;
    listingZkHPt?: string | null;
    listingZkThumbnailHash?: string | null;
    listingZkBrisque?: number | null;
    listingZkVkHash?: string | null;
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
}

const ALGORITHM_LABELS: Record<string, string> = {
    default: "Hash Commitment (default)",
    extended_image: "Thumb (256×256 scaled)",
    extended_image_crop: "Crop (256×256 native)",
    extended_image_dual: "Thumb + Crop (both)",
    extended_audio: "Preview (native rate, cropped)",
    extended_audio_lowres: "Full Low-res (4kHz Int8, 3min)",
    extended_audio_both: "Preview + Low-res (both)",
    zk: "ZK Proof (SP1, ~1h)",
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
    listingZkProof,
    listingZkProofFull,
    listingZkHPt,
    listingZkThumbnailHash,
    listingZkBrisque,
    listingZkVkHash,
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
}: NewContractModalProps) {
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
    const isExtendedAlgo = algorithms === "extended_image" || algorithms === "extended_image_crop" || algorithms === "extended_image_dual" || algorithms === "extended_audio" || algorithms === "extended_audio_lowres" || algorithms === "extended_audio_both";
    const ethChfRate = useEthChfRate();
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

    // Auto-select ZK when in Electron and the listing already has a generated ZK proof
    useEffect(() => {
        if (isElectron && listingZkProof) {
            setAlgorithms("zk");
        }
    }, [isElectron, listingZkProof]);

    useEffect(() => {
        const anyWindow: any = typeof window !== "undefined" ? window : {};
        if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function") {
            setIsElectron(true);
        }
    }, []);

    // For extended_image: automatically verify that the preview image shown to the buyer
    // matches d_thumb (SHA256 of 256×256 RGB thumbnail) committed in the description.
    // This runs once when the modal opens for an extended_image listing.
    useEffect(() => {
        if (algorithms !== "extended_image" || !listingPreviewImage || !listingExtImgThumbHash) return;
        setDescThumbStatus("checking");
        (async () => {
            try {
                const resp = await fetch(listingPreviewImage);
                const blob = await resp.blob();
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(256, 256);
                const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                ctx.drawImage(bitmap, 0, 0, 256, 256);
                bitmap.close();
                const imgData = ctx.getImageData(0, 0, 256, 256);
                const rgb = new Uint8Array(196608);
                for (let i = 0; i < 65536; i++) {
                    rgb[i * 3]     = imgData.data[i * 4];
                    rgb[i * 3 + 1] = imgData.data[i * 4 + 1];
                    rgb[i * 3 + 2] = imgData.data[i * 4 + 2];
                }
                const hashBuf = await crypto.subtle.digest("SHA-256", rgb);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map(b => b.toString(16).padStart(2, "0")).join("");
                const expected = listingExtImgThumbHash.replace(/^0x/, "");
                setDescThumbStatus(hash === expected ? "ok" : "warn");
            } catch {
                setDescThumbStatus("idle");
            }
        })();
    }, [algorithms, listingPreviewImage, listingExtImgThumbHash]);

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

            // For image listings: use pre-computed ZK proof from listing (zk algo)
            // or compute fast hash commitment (default algo)
            let localZkData: any = null;
            if (listingType === "image") {
                if (algorithms === "zk") {
                    // ZK proof was already generated at listing time — use it directly
                    if (listingZkProof) {
                        localZkData = {
                            proof: listingZkProof,
                            proof_full: listingZkProofFull,
                            h_pt: listingZkHPt,
                            thumbnail_hash: listingZkThumbnailHash,
                            brisque: listingZkBrisque,
                            vk_hash: listingZkVkHash,
                        };
                        setZkProofData(localZkData);
                        setZkProofStatus("done");
                    } else {
                        showToast("No ZK proof found in listing. Please re-create the listing with ZK algorithm.", "warning");
                        setZkProofStatus("failed");
                    }
                } else {
                    // Hash Commitment mode (default): fast, no SP1
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
                // Compare SHA-256 of 256×256 scaled thumbnail
                const bitmap = await createImageBitmap(f);
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
                const hashBuf = await crypto.subtle.digest("SHA-256", rgbBytes);
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
            await initWasm();

            let fileBytes = new Uint8Array(await file[0].arrayBuffer());
            const key = crypto.getRandomValues(new Uint8Array(16));

            // Helper: draw full image to canvas and build canonical 24-bit bottom-up BMP bytes
            const buildBmpBytes = async (imgFile: File) => {
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
            };

            // Helper: extract 256×256 RGB pixels from image at (cropNX, cropNY)
            const buildCropRgb = async (imgFile: File, cropNX: number, cropNY: number) => {
                const bmp = await createImageBitmap(imgFile);
                const canvas = new OffscreenCanvas(256, 256);
                const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                const cropW = Math.min(256, bmp.width - cropNX);
                const cropH = Math.min(256, bmp.height - cropNY);
                ctx.drawImage(bmp, cropNX, cropNY, cropW, cropH, 0, 0, cropW, cropH);
                bmp.close();
                const imgData = ctx.getImageData(0, 0, 256, 256);
                const rgbBytes = new Uint8Array(196608);
                for (let i = 0; i < 65536; i++) {
                    rgbBytes[i * 3]     = imgData.data[i * 4];
                    rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
                    rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
                }
                return rgbBytes;
            };

            // Helper: build 256×256 scaled thumbnail RGB
            const buildThumbRgb = async (imgFile: File) => {
                const bmp = await createImageBitmap(imgFile);
                const tc = new OffscreenCanvas(256, 256);
                (tc.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(bmp, 0, 0, 256, 256);
                bmp.close();
                const imgData = (tc.getContext("2d") as OffscreenCanvasRenderingContext2D).getImageData(0, 0, 256, 256);
                const rgbBytes = new Uint8Array(196608);
                for (let i = 0; i < 65536; i++) {
                    rgbBytes[i * 3]     = imgData.data[i * 4];
                    rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
                    rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
                }
                return rgbBytes;
            };

            // For extended_image: convert any image to canonical 24-bit BMP in the browser,
            // then build the SOX container. The original file never leaves the browser unencrypted.
            // SOX container: header(64B) | thumb(196608B, 256×256 RGB) | canonical BMP
            if (algorithms === "extended_image") {
                const { bmpBytes, bmpWidth, bmpHeight } = await buildBmpBytes(file[0]);
                const thumbRgb = await buildThumbRgb(file[0]);
                const containerSize = 64 + 196608 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x00; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(thumbRgb, 64); container.set(bmpBytes, 196672);
                fileBytes = container;
            }

            // extended_image_crop: header(64B) | crop RGB(196608B, 256×256 native) | BMP
            if (algorithms === "extended_image_crop") {
                if (listingExtImgCropX == null || listingExtImgCropY == null) {
                    showToast("No crop region found in listing. Cannot build contract.", "error");
                    return;
                }
                const { bmpBytes, bmpWidth, bmpHeight } = await buildBmpBytes(file[0]);
                const cropRgb = await buildCropRgb(file[0], listingExtImgCropX, listingExtImgCropY);
                const containerSize = 64 + 196608 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x02; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(cropRgb, 64); container.set(bmpBytes, 196672);
                fileBytes = container;
            }

            // extended_image_dual: header(64B) | thumb(196608B) | crop(196608B) | BMP
            if (algorithms === "extended_image_dual") {
                if (listingExtImgCropX == null || listingExtImgCropY == null) {
                    showToast("No crop region found in listing. Cannot build contract.", "error");
                    return;
                }
                const { bmpBytes, bmpWidth, bmpHeight } = await buildBmpBytes(file[0]);
                const thumbRgb = await buildThumbRgb(file[0]);
                const cropRgb = await buildCropRgb(file[0], listingExtImgCropX, listingExtImgCropY);
                const containerSize = 64 + 196608 + 196608 + bmpBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x03; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, bmpWidth, false); hView.setUint32(9, bmpHeight, false);
                container.set(thumbRgb, 64); container.set(cropRgb, 64 + 196608);
                container.set(bmpBytes, 64 + 196608 + 196608);
                fileBytes = container;
            }

            // Audio container helper: fetch WAV data URL, skip 44-byte header → raw PCM.
            // Zero-pads to targetBytes if the WAV is shorter (preview may be shorter than
            // the full circuit budget when original audio has a high sample rate).
            // unsignedToSigned: WAV 8-bit is stored unsigned (+128 offset); undo to match
            // the signed two's-complement bytes the listing hash was computed over.
            const fetchPcm = async (wavDataUrl: string, targetBytes: number, unsignedToSigned = false) => {
                const resp = await fetch(wavDataUrl);
                const buf = await resp.arrayBuffer();
                const raw = new Uint8Array(buf).slice(44);
                const padded = new Uint8Array(targetBytes); // zero-initialised
                const copyLen = Math.min(raw.length, targetBytes);
                if (unsignedToSigned) {
                    // WAV byte = (signed + 128); two's-complement of signed = (WAV + 128) & 0xFF
                    for (let i = 0; i < copyLen; i++) padded[i] = (raw[i] + 128) & 0xFF;
                } else {
                    padded.set(raw.subarray(0, copyLen));
                }
                if (raw.length > targetBytes) throw new Error(`PCM too large: ${raw.length} > ${targetBytes}`);
                return padded;
            };

            // extended_audio: header(64B) | PCM preview(480,000B Int16) | original audio
            if (algorithms === "extended_audio") {
                if (!listingPreviewAudio) {
                    showToast("No audio preview found in listing. Cannot build contract.", "error");
                    return;
                }
                const pcmBytes = await fetchPcm(listingPreviewAudio, 480_000);
                const origAudioBytes = fileBytes;
                const containerSize = 64 + 480_000 + origAudioBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x01; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, listingExtAudioDuration ?? 0, false);
                hView.setUint32(9, listingExtAudioBitrate ?? 0, false);
                container.set(pcmBytes, 64);
                container.set(origAudioBytes, 64 + 480_000);
                fileBytes = container;
            }

            // extended_audio_lowres: header(64B) | lowres PCM(720,000B Int8) | original audio
            if (algorithms === "extended_audio_lowres") {
                if (!listingPreviewAudioLowres) {
                    showToast("No low-res audio found in listing. Cannot build contract.", "error");
                    return;
                }
                const lowresBytes = await fetchPcm(listingPreviewAudioLowres, 720_000, true);
                const origAudioBytes = fileBytes;
                const containerSize = 64 + 720_000 + origAudioBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x02; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, listingExtAudioDuration ?? 0, false);
                hView.setUint32(9, listingExtAudioBitrate ?? 0, false);
                container.set(lowresBytes, 64);
                container.set(origAudioBytes, 64 + 720_000);
                fileBytes = container;
            }

            // extended_audio_both: header(64B) | preview(480,000B) | lowres(720,000B) | original audio
            if (algorithms === "extended_audio_both") {
                if (!listingPreviewAudio || !listingPreviewAudioLowres) {
                    showToast("No audio preview or low-res found in listing. Cannot build contract.", "error");
                    return;
                }
                const pcmBytes    = await fetchPcm(listingPreviewAudio, 480_000);
                const lowresBytes = await fetchPcm(listingPreviewAudioLowres, 720_000, true);
                const origAudioBytes = fileBytes;
                const containerSize = 64 + 480_000 + 720_000 + origAudioBytes.length;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x03; hView.setUint32(1, containerSize, false);
                hView.setUint32(5, listingExtAudioDuration ?? 0, false);
                hView.setUint32(9, listingExtAudioBitrate ?? 0, false);
                container.set(pcmBytes, 64);
                container.set(lowresBytes, 64 + 480_000);
                container.set(origAudioBytes, 64 + 480_000 + 720_000);
                fileBytes = container;
            }

            let precontract;
            const hdr = new DataView(fileBytes.buffer, fileBytes.byteOffset);
            const dSha = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
            const dSize = fileBytes.length;
            if (algorithms === "extended_image") {
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 196672)));
                precontract = compute_precontract_extended_image_v2(
                    fileBytes, key, dSha, dThumb,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), 0, dSize,
                );
            } else if (algorithms === "extended_image_crop") {
                const dCrop = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 196672)));
                precontract = compute_precontract_extended_image_crop_v2(
                    fileBytes, key, dSha, dCrop,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                );
            } else if (algorithms === "extended_image_dual") {
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 196672)));
                const dCrop  = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(196672, 393280)));
                precontract = compute_precontract_extended_image_dual_v2(
                    fileBytes, key, dSha, dThumb, dCrop,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                );
            } else if (algorithms === "extended_audio") {
                const dPreview = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 480064)));
                precontract = compute_precontract_extended_audio_v2(
                    fileBytes, key, dSha, dPreview,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                );
            } else if (algorithms === "extended_audio_lowres") {
                const dLowres = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 720064)));
                precontract = compute_precontract_extended_audio_lowres_v2(
                    fileBytes, key, dSha, dLowres,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
                );
            } else if (algorithms === "extended_audio_both") {
                const dPreview = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 480064)));
                const dLowres  = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(480064, 1200064)));
                precontract = compute_precontract_extended_audio_both_v2(
                    fileBytes, key, dSha, dPreview, dLowres,
                    hdr.getUint32(5, false), hdr.getUint32(9, false), dSize,
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
                    {ethToCHF(price, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(price, ethChfRate)} CHF</p>
                    )}
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
                    {ethToCHF(tipCompletion, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(tipCompletion, ethChfRate)} CHF</p>
                    )}
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
                    {ethToCHF(tipDispute, ethChfRate) && (
                        <p className="text-xs text-gray-400 mt-1">≈ {ethToCHF(tipDispute, ethChfRate)} CHF</p>
                    )}
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
                        listingType === "image" ? ["default", "extended_image", "extended_image_crop", "extended_image_dual", "zk"] :
                        listingType === "audio" ? ["extended_audio", "extended_audio_lowres", "extended_audio_both"] :
                        ["default"]
                    }
                    optionLabels={ALGORITHM_LABELS}
                    disabledOptions={!isElectron ? ["zk"] : []}
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

                {!isElectron && listingType === "image" && listingAlgorithmSuite === "zk" && (
                    <p className="col-span-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-2">
                        This listing was configured for ZK Proof (SP1), which requires the desktop app. Using Hash Commitment instead.
                    </p>
                )}

                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "checking" && (
                    <p className="col-span-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                        Verifying audio preview against committed hash…
                    </p>
                )}
                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "ok" && (
                    <p className="col-span-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                        ✓ Audio preview matches the committed description (d_preview verified).
                    </p>
                )}
                {(algorithms === "extended_audio" || algorithms === "extended_audio_both") && audioPreviewStatus === "warn" && (
                    <div className="col-span-2 text-xs text-red-700 bg-red-50 border border-red-300 rounded p-3 font-medium">
                        ⚠ Warning: The audio preview does NOT match the committed hash (d_preview mismatch). Do not accept this contract.
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
                                    : undefined
                            }
                        >
                            {listingType === "image"
                                ? "Image file (must match listing preview)"
                                : listingType === "audio"
                                ? "Audio file (full track to deliver)"
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
                                    Type: {zkProofData.proof_full ? "SP1 ZK Proof (Groth16)" : "Hash Commitment (SHA-256)"}
                                    {typeof zkProofData.brisque === "number" ? ` · BRISQUE: ${zkProofData.brisque.toFixed(1)}` : ""}
                                </p>
                                <p className="text-gray-400">
                                    The buyer will automatically verify this when they open the precontract.
                                </p>
                            </div>
                        )}
                        {zkProofStatus === "failed" && (
                            <p className="text-xs text-red-600">
                                {algorithms === "zk"
                                    ? "No ZK proof in listing. Re-create the listing with ZK algorithm."
                                    : "Could not generate commitment. Submit anyway to proceed without proof."}
                            </p>
                        )}
                    </div>
                )}

                <div className="col-span-2 flex gap-8">
                    <Button
                        label={isComputing ? "Encrypting..." : "Submit"}
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
