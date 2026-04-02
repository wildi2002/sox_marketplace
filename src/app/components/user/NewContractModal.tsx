"use client";

import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import FormFileInput from "../common/FormFileInput";
import { isAddress } from "ethers";
import initWasm, { compute_precontract_values_v2, compute_precontract_extended_image_v2, bytes_to_hex } from "@/app/lib/crypto_lib";
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
}

const ALGORITHM_LABELS: Record<string, string> = {
    default: "Hash Commitment (default)",
    extended_image: "Extended Desc (BMP container)",
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
    const [isComputing, setIsComputing] = useState(false);
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
    // matches d_thumb (SHA256 of 32×32 RGB thumbnail) committed in the description.
    // This runs once when the modal opens for an extended_image listing.
    useEffect(() => {
        if (algorithms !== "extended_image" || !listingPreviewImage || !listingExtImgThumbHash) return;
        setDescThumbStatus("checking");
        (async () => {
            try {
                const resp = await fetch(listingPreviewImage);
                const blob = await resp.blob();
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(32, 32);
                const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                ctx.drawImage(bitmap, 0, 0, 32, 32);
                bitmap.close();
                const imgData = ctx.getImageData(0, 0, 32, 32);
                const rgb = new Uint8Array(3072);
                for (let i = 0; i < 1024; i++) {
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

            if (algorithms === "extended_image") {
                // For extended_image: compare SHA-256 of 32×32 RGB thumbnail against listing preview hash
                const bitmap = await createImageBitmap(f);
                const tCanvas = new OffscreenCanvas(32, 32);
                const tCtx = tCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                tCtx.drawImage(bitmap, 0, 0, 32, 32);
                bitmap.close();
                const imgData = tCtx.getImageData(0, 0, 32, 32);
                const rgbBytes = new Uint8Array(3072);
                for (let i = 0; i < 1024; i++) {
                    rgbBytes[i * 3]     = imgData.data[i * 4];
                    rgbBytes[i * 3 + 1] = imgData.data[i * 4 + 1];
                    rgbBytes[i * 3 + 2] = imgData.data[i * 4 + 2];
                }
                const hashBuf = await crypto.subtle.digest("SHA-256", rgbBytes);
                const hash = Array.from(new Uint8Array(hashBuf))
                    .map((b) => b.toString(16).padStart(2, "0")).join("");
                setImageHashStatus(hash === listingPreviewHash ? "match" : "mismatch");
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
            if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function" && algorithms !== "extended_image") {
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
            if (algorithms === "extended_image" && descThumbStatus === "warn") {
                showToast("The preview image does not match the committed description (d_thumb mismatch). This contract cannot be trusted.", "error");
                return;
            }

            setIsComputing(true);
            await initWasm();

            let fileBytes = new Uint8Array(await file[0].arrayBuffer());
            const key = crypto.getRandomValues(new Uint8Array(16));

            // For extended_image: convert any image to canonical 24-bit BMP in the browser,
            // then build the SOX container. The original file never leaves the browser unencrypted.
            // SOX container: header(64B) | thumb(3072B, 32×32 RGB) | canonical BMP
            if (algorithms === "extended_image") {
                const bitmap = await createImageBitmap(file[0]);
                const bmpWidth = bitmap.width;
                const bmpHeight = bitmap.height;

                // Draw full image to canvas for canonical BMP conversion
                const fullCanvas = new OffscreenCanvas(bmpWidth, bmpHeight);
                const fullCtx = fullCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                fullCtx.drawImage(bitmap, 0, 0);

                // Build 32×32 thumbnail for SOX header
                const tCanvas = new OffscreenCanvas(32, 32);
                const tCtx = tCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
                tCtx.drawImage(bitmap, 0, 0, 32, 32);
                bitmap.close();
                const thumbImgData = tCtx.getImageData(0, 0, 32, 32);
                const rgbBytes = new Uint8Array(3072);
                for (let i = 0; i < 1024; i++) {
                    rgbBytes[i * 3]     = thumbImgData.data[i * 4];
                    rgbBytes[i * 3 + 1] = thumbImgData.data[i * 4 + 1];
                    rgbBytes[i * 3 + 2] = thumbImgData.data[i * 4 + 2];
                }

                // Convert to canonical 24-bit bottom-up BMP (matches size computed at listing time)
                const fullImgData = fullCtx.getImageData(0, 0, bmpWidth, bmpHeight);
                const { data: px } = fullImgData;
                const bmpRowSize = (bmpWidth * 3 + 3) & ~3;
                const bmpPixelSize = bmpRowSize * bmpHeight;
                const bmpFileSize = 54 + bmpPixelSize;
                const bmpBytes = new Uint8Array(bmpFileSize);
                const bv = new DataView(bmpBytes.buffer);
                bmpBytes[0] = 0x42; bmpBytes[1] = 0x4D;          // "BM"
                bv.setUint32(2, bmpFileSize, true);               // file size LE
                bv.setUint32(6, 0, true);                         // reserved
                bv.setUint32(10, 54, true);                       // pixel data offset
                bv.setUint32(14, 40, true);                       // DIB header size
                bv.setInt32(18, bmpWidth, true);                  // width
                bv.setInt32(22, bmpHeight, true);                 // height (positive = bottom-up)
                bv.setUint16(26, 1, true);                        // color planes
                bv.setUint16(28, 24, true);                       // bits per pixel
                bv.setUint32(30, 0, true);                        // no compression
                bv.setUint32(34, bmpPixelSize, true);             // pixel data size
                bv.setInt32(38, 2835, true);                      // ~72 dpi
                bv.setInt32(42, 2835, true);
                bv.setUint32(46, 0, true);
                bv.setUint32(50, 0, true);
                for (let y = 0; y < bmpHeight; y++) {
                    const srcY = bmpHeight - 1 - y;               // flip rows for bottom-up BMP
                    for (let x = 0; x < bmpWidth; x++) {
                        const s = (srcY * bmpWidth + x) * 4;
                        const d = 54 + y * bmpRowSize + x * 3;
                        bmpBytes[d]     = px[s + 2];              // B
                        bmpBytes[d + 1] = px[s + 1];              // G
                        bmpBytes[d + 2] = px[s];                  // R
                    }
                }

                // Build SOX container: header(64B) | thumb(3072B) | bmp
                const containerSize = 64 + 3072 + bmpFileSize;
                const container = new Uint8Array(containerSize);
                const hView = new DataView(container.buffer);
                container[0] = 0x00;                              // format = BMP
                hView.setUint32(1, containerSize, false);         // container size (BE)
                hView.setUint32(5, bmpWidth, false);              // width (BE)
                hView.setUint32(9, bmpHeight, false);             // height (BE)
                container.set(rgbBytes, 64);                      // thumbnail
                container.set(bmpBytes, 3136);                    // canonical BMP
                fileBytes = container;
            }

            let precontract;
            if (algorithms === "extended_image") {
                // Extended image: derive all description fields from the actual SOX container
                // so the buyer can verify at precontract time that d_thumb matches the advertised thumbnail.
                // SOX container layout: [0]=format, [1..4]=size BE, [5..8]=width BE, [9..12]=height BE,
                //                        [13..63]=reserved, [64..3135]=32×32 RGB thumb, [3136+]=BMP
                const dSha   = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
                const dThumb = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes.slice(64, 3136)));
                const hdr    = new DataView(fileBytes.buffer, fileBytes.byteOffset);
                const dWidth  = hdr.getUint32(5, false);   // BE
                const dHeight = hdr.getUint32(9, false);   // BE
                const dSize   = fileBytes.length;
                console.log("[extended_image] description will be 76B:", {
                    dSha: Array.from(dSha).map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,16)+"...",
                    dThumb: Array.from(dThumb).map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,16)+"...",
                    dWidth, dHeight, dSize,
                    listingThumbHash: listingExtImgThumbHash?.slice(0,16)+"...",
                    thumbMatchesListing: Array.from(dThumb).map(b=>b.toString(16).padStart(2,"0")).join("") === (listingExtImgThumbHash||"").replace(/^0x/,""),
                });
                precontract = compute_precontract_extended_image_v2(
                    fileBytes, key, dSha, dThumb,
                    dWidth, dHeight,
                    0, // d_format = 0 (BMP)
                    dSize,
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
                    ext_img_thumb_hash: algorithms === "extended_image" ? listingExtImgThumbHash ?? null : null,
                    ext_img_width: algorithms === "extended_image" ? listingExtImgWidth ?? null : null,
                    ext_img_height: algorithms === "extended_image" ? listingExtImgHeight ?? null : null,
                    ext_img_size: algorithms === "extended_image" ? listingExtImgSize ?? null : null,
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
                    options={listingType === "image" ? ["default", "extended_image", "zk"] : ["default"]}
                    optionLabels={ALGORITHM_LABELS}
                    disabledOptions={!isElectron ? ["zk"] : []}
                    disabled={listingType !== "image"}
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

                {(!isElectron || algorithms === "extended_image") && (
                    <div className="col-span-2">
                        <FormFileInput
                            id="sold-file"
                            onChange={handleFileChange}
                            accept={
                                listingType === "image"
                                    ? "image/*"
                                    : undefined
                            }
                        >
                            {listingType === "image"
                                ? "Image file (must match listing preview)"
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
