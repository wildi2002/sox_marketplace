"use client";

import { useState } from "react";
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

type VerifyResult = { success: true; h_circuit: string; h_ct: string } | { success: false; error: string };

export default function NonAcceptedPrecontractModal({
    onClose,
    contract,
}: NonAcceptedPrecontractModalProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
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
    } = contract;

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
                    <Button label="Accept" onClick={handleAccept} width="1/2" />
                    <Button label="Reject" onClick={handleReject} width="1/2" />
                </div>
            </div>
        </Modal>
    );
}
