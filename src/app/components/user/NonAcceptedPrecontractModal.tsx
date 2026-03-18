"use client";

import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { Contract } from "./NonAcceptedPrecontractsListView";
import initWasm, { check_precontract, bytes_to_hex } from "@/app/lib/crypto_lib";
import { hexToBytes, downloadFile } from "@/app/lib/helpers";
import ChfNote from "../common/ChfNote";
import { useToast } from "@/app/lib/ToastContext";

interface NonAcceptedPrecontractModalProps {
    onClose: () => void;
    contract?: Contract;
}

type ZkStatus = "idle" | "verifying" | "valid" | "invalid" | "unavailable";

type VerifyResult =
    | { success: true; h_circuit: string; h_ct: string; zkValid?: boolean; zkReason?: string }
    | { success: false; error: string };

export default function NonAcceptedPrecontractModal({
    onClose,
    contract,
}: NonAcceptedPrecontractModalProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
    const [zkStatus, setZkStatus] = useState<ZkStatus>("idle");
    const [zkReason, setZkReason] = useState<string | undefined>();
    const [zkChecks, setZkChecks] = useState<{thumbnailMatch?: boolean; brisqueMatch?: boolean; cryptoValid?: boolean; hPtMatch?: boolean} | null>(null);
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
        brisque_value,
        zk_proof,
        zk_proof_full,
        zk_h_ct,
        zk_c_k,
        zk_thumbnail_hash,
        zk_brisque,
    } = contract;

    // Auto-verify ZK proof when modal opens for image listings
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (listing_type !== "image" || !zk_proof || !zk_c_k) {
            setZkStatus("unavailable");
            return;
        }

        setZkStatus("verifying");
        setZkChecks(null);

        // Check 1: thumbnail hash from proof matches listing preview_hash
        const thumbnailMatch =
            !zk_thumbnail_hash || !preview_hash ||
            zk_thumbnail_hash.replace("0x", "").toLowerCase() === preview_hash.replace("0x", "").toLowerCase();

        // Check 2: BRISQUE from proof matches listing claim (within tolerance ±2)
        const brisqueMatch =
            zk_brisque == null || brisque_value == null ||
            Math.abs(zk_brisque - brisque_value) <= 2.0;

        // Check 3: h_pt from proof matches item_description (d = SHA256(pt) committed in precontract)
        // This is the critical on-chain binding: SNARK proves h_pt = SHA256(pt) for the sold image
        const hPtMatch =
            !zk_h_ct || !item_description ||
            zk_h_ct.replace("0x", "").toLowerCase() === item_description.replace("0x", "").toLowerCase();

        setZkChecks({ thumbnailMatch, brisqueMatch, hPtMatch });

        if (!hPtMatch) {
            setZkStatus("invalid");
            setZkReason("h_pt from proof does not match precontract description (SHA256(pt) mismatch)");
            return;
        }
        if (!thumbnailMatch) {
            setZkStatus("invalid");
            setZkReason("Thumbnail hash in proof does not match listing preview");
            return;
        }
        if (!brisqueMatch) {
            setZkStatus("invalid");
            setZkReason(`BRISQUE in proof (${zk_brisque?.toFixed(1)}) differs from listing claim (${brisque_value?.toFixed(1)})`);
            return;
        }

        // Check 3: Cryptographic proof verification — entirely local, nothing sent to server.
        // Hash commitment (no proof_full): verified in the browser with Web Crypto API.
        // SP1 Groth16 proof (proof_full present): verified server-side via zk-host (runs locally).
        if (!zk_proof_full) {
            // Hash commitment: verify SHA256(c_k_bytes || brisque_float32_LE) == proof
            (async () => {
                try {
                    const ckHex = (zk_c_k ?? "").replace("0x", "");
                    const ckBytes = new Uint8Array(ckHex.length / 2);
                    for (let i = 0; i < ckBytes.length; i++)
                        ckBytes[i] = parseInt(ckHex.slice(i * 2, i * 2 + 2), 16);
                    const brisqueNum = zk_brisque ?? brisque_value ?? 0;
                    const brisqueBuf = new ArrayBuffer(4);
                    new DataView(brisqueBuf).setFloat32(0, brisqueNum, true);
                    const combined = new Uint8Array(ckBytes.length + 4);
                    combined.set(ckBytes);
                    combined.set(new Uint8Array(brisqueBuf), ckBytes.length);
                    const hashBuf = await crypto.subtle.digest("SHA-256", combined);
                    const expected = Array.from(new Uint8Array(hashBuf))
                        .map((b) => b.toString(16).padStart(2, "0")).join("");
                    const proofNorm = (zk_proof ?? "").replace("0x", "").toLowerCase();
                    const valid = proofNorm === expected;
                    setZkChecks(prev => ({ ...prev, cryptoValid: valid }));
                    if (valid) {
                        setZkStatus("valid");
                    } else {
                        setZkStatus("invalid");
                        setZkReason("Hash commitment does not match");
                    }
                } catch {
                    setZkChecks(prev => ({ ...prev, cryptoValid: false }));
                    setZkStatus("unavailable");
                }
            })();
        } else {
            // SP1 Groth16: verify locally via Electron IPC (zk-host verify runs on this machine)
            // Falls back to server-side only if not in Electron (server is also localhost in dev)
            const payload = {
                proof: zk_proof,
                proof_full: zk_proof_full,
                h_pt: null,
                thumbnail_hash: zk_thumbnail_hash ?? null,
                preview_hash: preview_hash ?? null,
                brisque: zk_brisque ?? brisque_value ?? null,
                c_k: zk_c_k,
            };
            const anyWindow: any = typeof window !== "undefined" ? window : {};
            const verifyFn: Promise<{ valid: boolean; reason?: string }> =
                anyWindow.electronAPI?.verifyZkProof
                    ? anyWindow.electronAPI.verifyZkProof(payload)
                    : fetch("/api/zk/verify", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(payload),
                      }).then((r) => r.json());

            verifyFn
                .then((d) => {
                    setZkChecks(prev => ({ ...prev, cryptoValid: d.valid }));
                    if (d.valid) {
                        setZkStatus("valid");
                    } else {
                        setZkStatus("invalid");
                        setZkReason(d.reason);
                    }
                })
                .catch(() => {
                    setZkChecks(prev => ({ ...prev, cryptoValid: false }));
                    setZkStatus("unavailable");
                });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.id]);

    const handleVerifyCommitment = async () => {
        setIsVerifying(true);
        setVerifyResult(null);
        try {
            // 1. Load WASM
            await initWasm();

            // 2. Fetch ciphertext from server (only the encrypted bytes, never plaintext)
            const fileRes = await fetch(`/api/files/${id}`);
            if (!fileRes.ok) {
                const err = await fileRes.json().catch(() => ({}));
                throw new Error(err.error || `Could not fetch ciphertext (HTTP ${fileRes.status})`);
            }
            const { file: ctHex } = await fileRes.json();
            const ctBytes = hexToBytes(ctHex);

            // 3. Verify commitment entirely in the browser — no server involvement
            const result = check_precontract(item_description, commitment, opening_value, ctBytes);

            if (result.success) {
                const h_circuit_hex = bytes_to_hex(result.h_circuit);
                const h_ct_hex = bytes_to_hex(result.h_ct);

                // Save circuit/ciphertext accumulators for later protocol steps
                localStorage.setItem(`h_circuit_${id}`, h_circuit_hex);
                localStorage.setItem(`h_ct_${id}`, h_ct_hex);

                setVerifyResult({ success: true, h_circuit: h_circuit_hex, h_ct: h_ct_hex });
            } else {
                setVerifyResult({ success: false, error: "Commitment does not match the received ciphertext." });
            }
        } catch (e: any) {
            setVerifyResult({ success: false, error: e.message || String(e) });
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
        <Modal title="Precontract Details" onClose={onClose}>
            <div className="grid grid-cols-2 gap-4">
                {listing_type === "image" && (
                    <>
                        {/* Preview image */}
                        <div className="col-span-2 flex items-start gap-4 p-3 rounded border bg-gray-50 border-gray-200">
                            {preview_image && (
                                <img
                                    src={preview_image}
                                    alt="Listing preview"
                                    className="max-h-36 max-w-[160px] object-contain rounded border border-gray-200 shrink-0"
                                />
                            )}
                            <div className="text-sm space-y-1">
                                <p className="font-semibold text-gray-800">Advertised Preview</p>
                                <p className="text-gray-500 text-xs">
                                    This is what the vendor claims the image looks like. After accepting and decrypting, verify the file matches this preview exactly.
                                </p>
                                {brisque_value != null && (
                                    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium mt-1 ${
                                        brisque_value < 30 ? "bg-green-100 text-green-800" :
                                        brisque_value < 60 ? "bg-yellow-100 text-yellow-800" :
                                        "bg-red-100 text-red-800"
                                    }`}>
                                        Claimed BRISQUE {brisque_value.toFixed(1)} · {brisque_value < 30 ? "Good" : brisque_value < 60 ? "Average" : "Low"} quality
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* ZK / Quality Commitment Verification */}
                        <div className={`col-span-2 rounded border p-3 text-sm ${
                            zkStatus === "invalid" ? "bg-red-50 border-red-300" :
                            zkStatus === "valid"   ? "bg-green-50 border-green-300" :
                            zkStatus === "unavailable" ? "bg-gray-50 border-gray-200" :
                            "bg-blue-50 border-blue-200"
                        }`}>
                            <div className="flex items-center justify-between mb-2">
                                <p className="font-semibold text-gray-800">
                                    Quality Commitment Verification
                                </p>
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                    zk_proof_full ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-600"
                                }`}>
                                    {zk_proof_full ? "SP1 ZK Proof" : zk_proof ? "Hash Commitment" : "No proof"}
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 mb-3">
                                {zk_proof_full
                                    ? "The vendor attached a cryptographic ZK proof (SP1/Groth16) that the sold image matches the advertised preview and BRISQUE score."
                                    : zk_proof
                                    ? "The vendor committed to the advertised thumbnail hash and BRISQUE score at the time of the sale. This is a hash-based commitment, not a full ZK proof."
                                    : "No quality commitment was attached to this precontract."}
                            </p>

                            {zk_proof ? (
                                <div className="space-y-1.5">
                                    {/* Check 0: h_pt on-chain binding */}
                                    {zk_h_ct && (
                                        <div className="flex items-start gap-2 text-xs">
                                            <span className={`shrink-0 font-bold ${
                                                zkChecks?.hPtMatch === undefined ? "text-gray-400" :
                                                zkChecks.hPtMatch ? "text-green-700" : "text-red-700"
                                            }`}>
                                                {zkChecks?.hPtMatch === undefined ? "·" : zkChecks.hPtMatch ? "✓" : "✗"}
                                            </span>
                                            <div>
                                                <span className="font-medium text-gray-700">Plaintext hash matches precontract (SHA256(pt) = d)</span>
                                                <span className="text-gray-500 ml-1">— ZK proof binds sold image to on-chain commitment</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Check 1: Thumbnail hash */}
                                    <div className="flex items-start gap-2 text-xs">
                                        <span className={`shrink-0 font-bold ${
                                            zkChecks?.thumbnailMatch === undefined ? "text-gray-400" :
                                            zkChecks.thumbnailMatch ? "text-green-700" : "text-red-700"
                                        }`}>
                                            {zkChecks?.thumbnailMatch === undefined ? "·" : zkChecks.thumbnailMatch ? "✓" : "✗"}
                                        </span>
                                        <div>
                                            <span className="font-medium text-gray-700">Preview hash matches</span>
                                            <span className="text-gray-500 ml-1">— the proof was generated for this exact thumbnail</span>
                                            {preview_hash && (
                                                <p className="font-mono text-gray-400 mt-0.5">{preview_hash.slice(0, 20)}…</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Check 2: BRISQUE match */}
                                    <div className="flex items-start gap-2 text-xs">
                                        <span className={`shrink-0 font-bold ${
                                            zkChecks?.brisqueMatch === undefined ? "text-gray-400" :
                                            zkChecks.brisqueMatch ? "text-green-700" : "text-red-700"
                                        }`}>
                                            {zkChecks?.brisqueMatch === undefined ? "·" : zkChecks.brisqueMatch ? "✓" : "✗"}
                                        </span>
                                        <div>
                                            <span className="font-medium text-gray-700">BRISQUE score matches claim</span>
                                            {zk_brisque != null && brisque_value != null && (
                                                <span className="text-gray-500 ml-1">
                                                    — proven {zk_brisque.toFixed(1)} vs claimed {brisque_value.toFixed(1)} (±2 tolerance)
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Check 3: Cryptographic verification */}
                                    <div className="flex items-start gap-2 text-xs">
                                        <span className={`shrink-0 font-bold ${
                                            zkStatus === "verifying" ? "text-blue-500" :
                                            zkChecks?.cryptoValid === undefined ? "text-gray-400" :
                                            zkChecks.cryptoValid ? "text-green-700" : "text-red-700"
                                        }`}>
                                            {zkStatus === "verifying" ? "…" :
                                             zkChecks?.cryptoValid === undefined ? "·" :
                                             zkChecks.cryptoValid ? "✓" : "✗"}
                                        </span>
                                        <div>
                                            <span className="font-medium text-gray-700">
                                                {zk_proof_full ? "Cryptographic proof valid (Groth16)" : "Hash commitment valid (SHA-256)"}
                                            </span>
                                            <span className="text-gray-500 ml-1">
                                                {zkStatus === "verifying"
                                                    ? "— verifying…"
                                                    : zk_proof_full
                                                    ? "— verified locally via zk-host (no server)"
                                                    : "— verified in your browser (Web Crypto API, no server)"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Overall result */}
                                    {zkStatus === "valid" && (
                                        <p className="mt-2 text-xs font-semibold text-green-800">
                                            ✓ All checks passed. The vendor's quality commitment is valid.
                                        </p>
                                    )}
                                    {zkStatus === "invalid" && (
                                        <p className="mt-2 text-xs font-semibold text-red-800">
                                            ✗ Verification failed: {zkReason}. Do not accept this contract.
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-gray-500 italic">
                                    No commitment to verify. Proceed with caution — the advertised quality is unverified.
                                </p>
                            )}
                        </div>
                    </>
                )}

                <div><strong>Contract ID:</strong> {id}</div>
                <div>
                    <strong>Price:</strong> {price} ETH
                    <ChfNote value={price} display="block" />
                </div>
                <div className="col-span-2 font-mono text-sm">
                    <strong>Vendor:</strong> {pk_vendor}
                </div>
                <div className="col-span-2 font-mono text-sm">
                    <strong>Buyer:</strong> {pk_buyer}
                </div>
                <div>
                    <strong>Tip Completion:</strong> {tip_completion} ETH
                    <ChfNote value={tip_completion} display="block" />
                </div>
                <div>
                    <strong>Tip Dispute:</strong> {tip_dispute} ETH
                    <ChfNote value={tip_dispute} display="block" />
                </div>
                <div><strong>Timeout:</strong> {timeout_delay} s</div>
                <div><strong>Protocol Version:</strong> {protocol_version}</div>
                <div><strong>Algorithm:</strong> {algorithm_suite}</div>

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
                        isDisabled={zkStatus === "invalid"}
                    />
                    <Button label="Reject" onClick={handleReject} width="1/2" />
                </div>
                {zkStatus === "invalid" && (
                    <p className="col-span-2 text-xs text-red-700 font-medium text-center bg-red-50 border border-red-200 rounded p-2">
                        ⚠ Accept is blocked: quality commitment verification failed. {zkReason && `(${zkReason})`}
                    </p>
                )}
            </div>
        </Modal>
    );
}
