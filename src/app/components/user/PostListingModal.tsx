"use client";

import { useRef, useState } from "react";
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

type ListingType = "general" | "image";

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
        if (type !== "image") {
            setAlgorithms("default");
            setSelectedFile(null);
            setSelectedImageDataUrl(null);
            setPreviewDataUrl(null);
            setPreviewHash(null);
            setBrisqueValue(null);
            setExtImgThumbHash(null);
            setExtImgWidth(null);
            setExtImgHeight(null);
            setExtImgSize(null);
        }
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
            const containerSize = 64 + 3072 + (54 + bmpRowSize * height);
            setExtImgWidth(width);
            setExtImgHeight(height);
            setExtImgSize(containerSize);
        }
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
    // - "extended_image": browser converts to canonical BMP, computes 32×32 thumbnail + hash + dimensions.
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

        if (algo === "default") {
            // Hash Commitment: nothing to compute at listing time
            setIsAnalyzing(false);
            return;
        }

        try {
            if (algo === "extended_image") {
                // Accept any image — browser converts to canonical 24-bit BMP for the SOX container.
                // Only the 32×32 thumbnail and its hash go to the server.
                const bitmap = await createImageBitmap(file);
                const { width, height } = bitmap;

                // SOX container will hold a canonical 24-bit bottom-up BMP; compute its exact size now.
                const bmpRowSize = (width * 3 + 3) & ~3;
                const bmpSize = 54 + bmpRowSize * height;
                const containerSize = 64 + 3072 + bmpSize;
                setExtImgWidth(width);
                setExtImgHeight(height);
                setExtImgSize(containerSize);

                // Build 32×32 thumbnail for preview and hash
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

    const handleAlgorithmChange = (algo: string) => {
        setAlgorithms(algo);
        if (selectedFile && algo !== "default") {
            // Web mode: re-process the already-selected file with the new algorithm
            processImageFile(selectedFile, algo);
        } else if (selectedImageDataUrl && algo !== "default") {
            // Electron mode: re-process from stored data URL
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
        }
    };

    const handleWebImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        await processImageFile(file, algorithms);
    };

    const handleSubmit = async () => {
        if (!title.trim()) {
            showToast("Title is required", "warning");
            return;
        }
        if (!price || isNaN(parseFloat(price))) {
            showToast("A valid price is required", "warning");
            return;
        }
        if (listingType === "image" && algorithms === "extended_image" && extImgWidth == null) {
            showToast("Please select an image file", "warning");
            return;
        }
        if (listingType === "image" && algorithms === "zk" && !previewDataUrl) {
            showToast("Please select an image file", "warning");
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
                if (algorithms === "extended_image") {
                    body.ext_img_thumb_hash = extImgThumbHash;
                    body.ext_img_width = extImgWidth;
                    body.ext_img_height = extImgHeight;
                    body.ext_img_size = extImgSize;
                }
                // ZK proof is generated in the background after posting — not sent here
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
                        {algorithms === "zk" && previewDataUrl && !isAnalyzing && (
                            <p className="mt-2 text-xs text-orange-600">ZK proof will be generated in the background after posting (~1 hour). The listing will appear in the marketplace once the proof is ready.</p>
                        )}
                        {previewDataUrl && (
                            <div className="mt-3 flex items-start gap-3">
                                <img
                                    src={previewDataUrl}
                                    alt="Preview"
                                    title="Click to enlarge"
                                    onClick={() => setPreviewZoom(true)}
                                    className="w-[100px] h-[100px] object-contain border border-gray-200 rounded cursor-zoom-in"
                                />
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
                    options={listingType === "image" ? ["default", "extended_image", "zk"] : ["default"]}
                    optionLabels={{ default: "Hash Commitment (default)", extended_image: "Extended Desc (image)", zk: "ZK Proof (SP1, ~1h)" }}
                    disabled={listingType !== "image"}
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
