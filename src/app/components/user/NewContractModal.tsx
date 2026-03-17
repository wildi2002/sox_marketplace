"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import FormFileInput from "../common/FormFileInput";
import { isAddress } from "ethers";
import initWasm, { compute_precontract_values, bytes_to_hex } from "@/app/lib/crypto_lib";
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
}

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
}: NewContractModalProps) {
    const [buyerPk, setBuyerPk] = useState(prefillBuyerPk ?? "");
    const [price, setPrice] = useState(prefillPrice ?? "");
    const [tipCompletion, setTipCompletion] = useState(prefillTipCompletion ?? "");
    const [tipDispute, setTipDispute] = useState(prefillTipDispute ?? "");
    const [version, setVersion] = useState("0");
    const [timeoutDelay, setTimeoutDelay] = useState(prefillTimeoutDelay ?? "");
    const [algorithms, setAlgorithms] = useState("default");
    const [file, setFile] = useState<FileList | null>();
    const [imageHashStatus, setImageHashStatus] = useState<"idle" | "checking" | "match" | "mismatch">("idle");
    const [isComputing, setIsComputing] = useState(false);
    const ethChfRate = useEthChfRate();
    const { showToast } = useToast();

    // Electron mode state
    const [isElectron, setIsElectron] = useState(false);
    const [preOutElectron, setPreOutElectron] = useState<any | null>(null);

    // ZK proof state (generated per precontract in Electron mode)
    type ZkProofStatus = "idle" | "generating" | "done" | "failed";
    const [zkProofStatus, setZkProofStatus] = useState<ZkProofStatus>("idle");
    const [zkProofData, setZkProofData] = useState<any | null>(null);
    const [zkElapsed, setZkElapsed] = useState(0);
    const zkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { if (zkTimerRef.current) clearInterval(zkTimerRef.current); }, []);

    useEffect(() => {
        const anyWindow: any = typeof window !== "undefined" ? window : {};
        if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function") {
            setIsElectron(true);
        }
    }, []);

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

            // For image listings: generate ZK proof (SP1 via Electron, fallback to hash commitment)
            let localZkData: any = null;
            if (listingType === "image") {
                setZkProofStatus("generating");
                setZkProofData(null);
                setZkElapsed(0);
                const start = Date.now();
                zkTimerRef.current = setInterval(() => setZkElapsed(Date.now() - start), 500);
                try {
                    let sp1Failed = true;
                    if (preOut.inputPath) {
                        const zkResult = await anyWindow.electronAPI.generateZkProof({ filePath: preOut.inputPath });
                        if (!zkResult.error) {
                            sp1Failed = false;
                            localZkData = zkResult;
                        }
                    }
                    if (sp1Failed && listingPreviewHash && listingBrisqueValue != null) {
                        // SP1 unavailable — fall back to browser hash commitment
                        localZkData = await computeHashCommitment(listingPreviewHash, listingBrisqueValue);
                    }
                } catch (e: any) {
                    // SP1 threw — try hash commitment fallback
                    if (listingPreviewHash && listingBrisqueValue != null) {
                        try {
                            localZkData = await computeHashCommitment(listingPreviewHash, listingBrisqueValue);
                        } catch { /* leave null */ }
                    }
                } finally {
                    if (zkTimerRef.current) { clearInterval(zkTimerRef.current); zkTimerRef.current = null; }
                }
                if (localZkData) {
                    setZkProofData(localZkData);
                    setZkProofStatus("done");
                } else {
                    setZkProofStatus("failed");
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
            const anyWindow: any = typeof window !== "undefined" ? window : {};
            if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function") {
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
                        // Fresh per-precontract ZK proof (generated locally in Electron)
                        zk_proof: zkData?.proof ?? null,
                        zk_proof_full: zkData?.proof_full ?? null,
                        zk_h_ct: zkData?.h_ct ?? null,
                        zk_c_k: zkData?.c_k ?? null,
                        zk_thumbnail_hash: zkData?.thumbnail_hash ?? null,
                        zk_brisque: zkData?.brisque ?? null,
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

            setIsComputing(true);
            await initWasm();

            const fileBytes = new Uint8Array(await file[0].arrayBuffer());
            const key = crypto.getRandomValues(new Uint8Array(16));
            const precontract = compute_precontract_values(fileBytes, key);

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

            // Web mode: compute hash commitment in browser if this is an image listing
            let webZkData: any = null;
            if (listingType === "image" && listingPreviewHash && listingBrisqueValue != null) {
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
                    options={["default"]}
                    disabled
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

                {!isElectron && (
                    <div className="col-span-2">
                        <FormFileInput
                            id="sold-file"
                            onChange={handleFileChange}
                            accept={listingType === "image" ? "image/*" : undefined}
                        >
                            {listingType === "image" ? "Image file (must match listing preview)" : "File"}
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
                            isDisabled={zkProofStatus === "generating"}
                        />
                        {preOutElectron?.inputPath && (
                            <p className="text-xs text-gray-500 break-all">
                                Selected: {preOutElectron.inputPath}
                            </p>
                        )}
                        {zkProofStatus === "generating" && (
                            <p className="text-xs text-blue-600">
                                Generating quality commitment… {(zkElapsed / 1000).toFixed(0)}s
                                {zkElapsed > 5000 ? " (SP1 proof — may take several minutes)" : ""}
                            </p>
                        )}
                        {zkProofStatus === "done" && zkProofData && (
                            <div className="text-xs text-green-700 space-y-0.5">
                                <p className="font-medium">
                                    ✓ Quality commitment ready — will be sent with precontract
                                </p>
                                <p className="text-gray-500">
                                    Type: {zkProofData.proof_full ? "SP1 ZK Proof (Groth16)" : "Hash Commitment (SHA-256 fallback)"}
                                    {typeof zkProofData.brisque === "number" ? ` · BRISQUE: ${zkProofData.brisque.toFixed(1)}` : ""}
                                </p>
                                <p className="text-gray-400">
                                    The buyer will automatically verify this when they open the precontract.
                                </p>
                            </div>
                        )}
                        {zkProofStatus === "failed" && (
                            <p className="text-xs text-red-600">
                                Could not generate quality commitment. Submit anyway to proceed without proof.
                            </p>
                        )}
                    </div>
                )}

                <div className="col-span-2 flex gap-8">
                    <Button
                        label={isComputing ? "Encrypting..." : zkProofStatus === "generating" ? "Generating ZK proof..." : "Submit"}
                        onClick={handleSubmit}
                        width="1/2"
                        isDisabled={isComputing || zkProofStatus === "generating"}
                    />
                    <Button label="Cancel" onClick={onClose} width="1/2" isDisabled={isComputing || zkProofStatus === "generating"} />
                </div>
            </div>
        </Modal>
    );
}
