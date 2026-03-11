"use client";

import { useEffect, useRef, useState } from "react";
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
type ZkStatus = "idle" | "computing_brisque" | "computing_zk" | "done" | "unavailable";

function hexToBytes(hex: string): Uint8Array {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

async function computeZkCommitment(
    previewHashHex: string,
    brisqueValue: number
): Promise<{ proof: string; c_k: string }> {
    const c_k = previewHashHex;
    const ckBytes = hexToBytes(c_k);
    const brisqueBuf = new ArrayBuffer(4);
    new DataView(brisqueBuf).setFloat32(0, brisqueValue, true); // little-endian
    const combined = new Uint8Array(ckBytes.length + 4);
    combined.set(ckBytes);
    combined.set(new Uint8Array(brisqueBuf), ckBytes.length);
    const hashBuf = await crypto.subtle.digest("SHA-256", combined);
    const proof = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return { proof, c_k };
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

export default function PostListingModal({ onClose, vendorPk }: PostListingModalProps) {
    const [listingType, setListingType] = useState<ListingType>("general");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [tipCompletion, setTipCompletion] = useState("");
    const [tipDispute, setTipDispute] = useState("");
    const [timeoutDelay, setTimeoutDelay] = useState("");
    const [algorithms, setAlgorithms] = useState("default");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const [previewHash, setPreviewHash] = useState<string | null>(null);
    const [brisqueValue, setBrisqueValue] = useState<number | null>(null);
    const [zkStatus, setZkStatus] = useState<ZkStatus>("idle");
    const [zkProof, setZkProof] = useState<string | null>(null);
    const [zkProofFull, setZkProofFull] = useState<string | null>(null);
    const [zkHCt, setZkHCt] = useState<string | null>(null);
    const [zkCK, setZkCK] = useState<string | null>(null);
    const [zkThumbnailHash, setZkThumbnailHash] = useState<string | null>(null);

    const [zkElapsed, setZkElapsed] = useState(0);
    const zkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const ethChfRate = useEthChfRate();

    // Cleanup timer on unmount
    useEffect(() => () => { if (zkTimerRef.current) clearInterval(zkTimerRef.current); }, []);
    const { showToast } = useToast();

    const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 50 * 1024 * 1024) {
            showToast("Image file is larger than 50 MB. This may cause slow processing.", "warning");
        }

        setImageFile(file);
        setPreviewDataUrl(null);
        setPreviewHash(null);
        setBrisqueValue(null);
        setZkStatus("idle");
        setZkProof(null);
        setZkProofFull(null);
        setZkHCt(null);
        setZkCK(null);
        setZkThumbnailHash(null);
        setZkElapsed(0);
        if (zkTimerRef.current) { clearInterval(zkTimerRef.current); zkTimerRef.current = null; }

        try {
            const { previewDataUrl: dataUrl, previewHash: hash, rgbaBytes, width, height } = await generateThumbnailAndHash(file);
            setPreviewDataUrl(dataUrl);
            setPreviewHash(hash);

            // Step 1: send original image + RGBA fallback to server for BRISQUE + ZK proof
            setZkStatus("computing_brisque");
            const startTime = Date.now();
            zkTimerRef.current = setInterval(() => setZkElapsed(Date.now() - startTime), 100);

            // Read original file bytes for full ZK proof (JPEG/PNG)
            const fileBytes = new Uint8Array(await file.arrayBuffer());
            const imageFileHex = Array.from(fileBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
            // RGBA fallback for Python BRISQUE
            const imageHex = Array.from(rgbaBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

            let brisqueVal: number | null = null;
            let zkProofVal: string | null = null;
            let zkHCtVal: string | null = null;
            let zkCKVal: string | null = null;
            let zkAvailable = false;

            try {
                const zkRes = await fetch("/api/zk/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image_file_hex: imageFileHex, image_hex: imageHex, width, height }),
                });
                if (zkRes.ok) {
                    const zkData = await zkRes.json();
                    brisqueVal = zkData.brisque ?? null;
                    setBrisqueValue(brisqueVal);
                    if (zkData.available) {
                        zkProofVal = zkData.proof ?? null;
                        zkHCtVal = zkData.h_ct ?? null;
                        zkCKVal = zkData.c_k ?? null;
                        zkAvailable = true;
                        setZkProofFull(zkData.proof_full ?? null);
                        setZkThumbnailHash(zkData.thumbnail_hash ?? null);
                    }
                }
            } catch (e: any) {
                console.warn("ZK/BRISQUE server call failed:", e?.message);
            }

            if (zkTimerRef.current) { clearInterval(zkTimerRef.current); zkTimerRef.current = null; }

            if (zkAvailable && zkProofVal) {
                // Full SP1 ZK proof from server
                setZkProof(zkProofVal);
                setZkHCt(zkHCtVal);
                setZkCK(zkCKVal);
                setZkStatus("done");
            } else if (brisqueVal !== null) {
                // Fallback: hash-based commitment in browser
                setZkStatus("computing_zk");
                const { proof, c_k } = await computeZkCommitment(hash, brisqueVal);
                setZkProof(proof);
                setZkCK(c_k);
                setZkHCt(null);
                setZkStatus("done");
            } else {
                setZkStatus("unavailable");
            }
        } catch (err: any) {
            if (zkTimerRef.current) { clearInterval(zkTimerRef.current); zkTimerRef.current = null; }
            showToast(`Image processing error: ${err.message}`, "error");
            setZkStatus("unavailable");
        }
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
        if (listingType === "image" && !imageFile) {
            showToast("Please select an image file", "warning");
            return;
        }

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
                body.zk_proof = zkProof;
                body.zk_proof_full = zkProofFull;
                body.zk_h_ct = zkHCt;
                body.zk_c_k = zkCK;
                body.zk_thumbnail_hash = zkThumbnailHash;
            }

            const res = await fetch("/api/listings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to create listing");

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
                        onClick={() => setListingType("general")}
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
                        onClick={() => setListingType("image")}
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
                        <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageSelect}
                            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50"
                        />
                        {previewDataUrl && (
                            <div className="mt-3 flex items-start gap-3">
                                <img
                                    src={previewDataUrl}
                                    alt="Preview"
                                    className="max-w-[200px] max-h-[200px] object-contain border border-gray-200 rounded"
                                />
                                <div className="text-xs text-gray-500 space-y-1">
                                    {previewHash && (
                                        <p className="font-mono break-all">
                                            SHA-256: {previewHash.slice(0, 16)}…
                                        </p>
                                    )}
                                    {zkStatus === "computing_brisque" && (
                                        <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                                            Computing BRISQUE… {(zkElapsed / 1000).toFixed(1)}s
                                        </span>
                                    )}
                                    {zkStatus === "computing_zk" && (
                                        <span className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                                            Computing ZK proof…
                                        </span>
                                    )}
                                    {zkStatus === "done" && (
                                        <span className="inline-block px-2 py-0.5 rounded bg-green-100 text-green-700">
                                            ZK proof ready ({(zkElapsed / 1000).toFixed(1)}s)
                                        </span>
                                    )}
                                    {zkStatus === "unavailable" && (
                                        <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                                            ZK unavailable
                                        </span>
                                    )}
                                    {brisqueValue !== null && (
                                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${brisqueBadgeColor}`}>
                                            BRISQUE: {brisqueValue.toFixed(1)}
                                        </span>
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
                    onChange={setAlgorithms}
                    options={["default"]}
                    disabled
                >
                    Algorithm suite
                </FormSelect>

                <div className="col-span-2 flex gap-4">
                    <Button
                        label={isSubmitting ? "Posting..." : "Post Listing"}
                        onClick={handleSubmit}
                        width="1/2"
                        isDisabled={isSubmitting}
                    />
                    <Button label="Cancel" onClick={onClose} width="1/2" />
                </div>
            </div>
        </Modal>
    );
}
