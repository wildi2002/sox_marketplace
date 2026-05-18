"use client";

import Modal from "../common/Modal";
import Button from "../common/Button";
import {
    Contract,
    DISPUTE_STATES,
    OPTIMISTIC_STATES,
} from "./OngoingContractsListView";
import { useToast } from "@/app/lib/ToastContext";
import { useEffect, useState } from "react";
import {
    getBasicInfo,
    getDetails,
    sendKey,
    sendPayment,
    endOptimisticTimeout,
} from "@/app/lib/blockchain/optimistic";
import { ENTRY_POINT_V8, EIP7702_DELEGATE } from "@/app/lib/blockchain/config";
import {
    finishDispute,
    getChallenge,
    getLatestChallengeResponse,
    giveOpinion,
    respondChallenge,
    submitCommitment,
    submitCommitmentLeft,
    submitCommitmentLeftDirect,
    submitCommitmentRight,
    getDisputeDetails,
    getDisputeState,
} from "@/app/lib/blockchain/dispute";
import { downloadFile, fileToBytes, openFile } from "@/app/lib/helpers";
import { formatEther } from "ethers";
import init, {
    bytes_to_hex,
    check_received_ct_key,
    check_received_ct_key_extended_image_v2,
    check_received_ct_key_extended_image_crop_v2,
    check_received_ct_key_extended_image_dual_v2,
    check_received_ct_key_extended_audio_v2,
    check_received_ct_key_extended_audio_lowres_v2,
    check_received_ct_key_extended_audio_both_v2,
    check_received_ct_key_extended_video_v2,
    check_received_ct_key_extended_video_clip_v2,
    check_received_ct_key_extended_video_both_v2,
    compile_circuit_v2_wasm,
    compile_circuit_extended_image_v2_wasm,
    compile_circuit_extended_image_crop_v2_wasm,
    compile_circuit_extended_image_dual_v2_wasm,
    compile_circuit_extended_audio_v2_wasm,
    compile_circuit_extended_audio_lowres_v2_wasm,
    compile_circuit_extended_audio_both_v2_wasm,
    compile_circuit_extended_video_v2_wasm,
    compile_circuit_extended_video_clip_v2_wasm,
    compile_circuit_extended_video_both_v2_wasm,
    compute_proof_right_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    hex_to_bytes,
    hpre_v2,
    make_argument,
} from "@/app/lib/crypto_lib";

interface OngoingContractModalProps {
    onClose: () => void;
    contract?: Contract;
    publicKey: string;
}

function timestampToString(timestamp: bigint) {
    const timeNumber = Number(timestamp);
    const date = new Date(timeNumber * 1000);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const language = navigator.language;
    return `${date.toLocaleDateString(language, {
        timeZone,
    })}, ${date.toLocaleTimeString(language, {
        timeZone,
    })}`;
}

const formatWei = (v: any): string => {
    if (v === "Loading..." || v === null || v === undefined) return String(v);
    try { return formatEther(BigInt(String(v))); } catch { return String(v); }
};

// I'm so sorry for this code, I don't have time to refactor it properly before
// submitting it :((

export default function OngoingContractModal({
    onClose,
    contract,
    publicKey,
}: OngoingContractModalProps) {
    const { showToast } = useToast();
    if (!contract) return;

    const {
        id,
        pk_buyer,
        pk_vendor,
        price,
        item_description,
        tip_completion,
        tip_dispute,
        opening_value,
        optimistic_smart_contract,
        dispute_smart_contract,
        pk_sb,
        pk_sv,
        num_blocks,
        num_gates,
        file_name,
        algorithm_suite,
    } = contract;

    const [key, setKey] = useState("Loading...");
    const [state, setState] = useState(-1);
    const [nextTimeout, setNextTimeout] = useState("Loading...");
    const [buyer, setBuyer] = useState(pk_buyer);
    const [vendor, setVendor] = useState(pk_vendor);
    const [sponsor, setSponsor] = useState(contract.sponsor);
    const [bSponsor, setBSponsor] = useState("Loading...");
    const [vSponsor, setVSponsor] = useState("Loading...");
    const [completionTip, setCompletionTip] = useState(contract.tip_completion);
    const [disputeTip, setDisputeTip] = useState(contract.tip_dispute);
    const [sponsorDeposit, setSponsorDeposit] = useState("Loading...");
    const [buyerDeposit, setBuyerDeposit] = useState("Loading...");
    const [bSponsorDeposit, setBSponsorDeposit] = useState("Loading...");
    const [vSponsorDeposit, setVSponsorDeposit] = useState("Loading...");
    const [detailsShown, setShowDetails] = useState(false);
    const [keyInput, setKeyInput] = useState(
        localStorage.getItem(`key_${id}`)!
    );
    const [challengeBtnLabel, setChallengeLabel] = useState(
        "Respond to challenge"
    );
    const [step9Count, setStep9Count] = useState<number | null>(null);
    const [lastLosingPartyWasVendor, setLastLosingPartyWasVendor] = useState<boolean | null>(null);
    const [currentBuyer, setCurrentBuyer] = useState<string | null>(null);
    const [currentVendor, setCurrentVendor] = useState<string | null>(null);
    
    // États pour le paiement
    const [paymentStatus, setPaymentStatus] = useState<"idle" | "submitting" | "pending" | "confirmed" | "error">("idle");
    const [paymentMode, setPaymentMode] = useState<"direct" | "eip-7702">("eip-7702");
    const [paymentUserOpHash, setPaymentUserOpHash] = useState<string | null>(null);
    const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    
    // Calculer le montant du paiement (price en wei)
    // Le montant du paiement doit inclure le prix + le tip de complétion
    const paymentAmount = (Number(price) || 0) + (Number(tip_completion) || 0);
    
    // État pour indiquer si un paiement est en cours
    const paymentBusy = paymentStatus === "submitting" || paymentStatus === "pending";
    
    // Vérifier si EIP-7702 est configuré
    const eip7702Configured = !!(ENTRY_POINT_V8 && EIP7702_DELEGATE);

    // Fonction pour rafraîchir les données du contrat
    const refreshContractData = async () => {
        try {
            const data = await getBasicInfo(optimistic_smart_contract, !!dispute_smart_contract);
            if (!data) return;

            setKey(data.key == "0x" ? "No key" : data.key);
            const newState = Number(data.state);
            console.log(`🔄 Rafraîchissement: État du contrat = ${newState} (${DISPUTE_STATES[newState] || "Unknown"})`);
            setState(newState);
            setNextTimeout(timestampToString(data.nextTimeout));
            
            if (data.step9Count !== undefined) {
                setStep9Count(data.step9Count);
            }
            if (data.lastLosingPartyWasVendor !== undefined) {
                setLastLosingPartyWasVendor(data.lastLosingPartyWasVendor);
            }
            if (data.currentBuyer) {
                setCurrentBuyer(data.currentBuyer);
            }
            if (data.currentVendor) {
                setCurrentVendor(data.currentVendor);
            }
        } catch (error) {
            console.error("Erreur lors du rafraîchissement des données:", error);
        }
    };

    useEffect(() => {
        refreshContractData();
        
        if (dispute_smart_contract) {
            getDisputeDetails(dispute_smart_contract).then((disputeInfo) => {
                if (disputeInfo) {
                    setCurrentBuyer(disputeInfo.buyer);
                    setCurrentVendor(disputeInfo.vendor);
                    setStep9Count(disputeInfo.step9Count);
                    setLastLosingPartyWasVendor(disputeInfo.lastLosingPartyWasVendor);
                }
            });
        }
        
        // Écouter l'événement reloadData pour rafraîchir les données
        const handleReloadData = () => {
            refreshContractData();
        };
        
        window.addEventListener("reloadData", handleReloadData);
        
        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, [optimistic_smart_contract, dispute_smart_contract]);

    const handleShowdetails = async () => {
        const details = await getDetails(optimistic_smart_contract);
        if (!details) return;

        setKey(details.key == "0x" ? "No key" : details.key);
        setState(Number(details.state));

        setNextTimeout(timestampToString(details.nextTimeout));

        setBuyer(details.buyer);
        setVendor(details.vendor);
        setSponsor(details.sponsor);
        setBSponsor(details.bSponsor);
        setVSponsor(details.vSponsor);
        setCompletionTip(details.completionTip);
        setDisputeTip(details.disputeTip);
        setSponsorDeposit(details.sponsorDeposit);
        setBuyerDeposit(details.buyerDeposit);
        setBSponsorDeposit(details.bSponsorDeposit);
        setVSponsorDeposit(details.vSponsorDeposit);

        if (dispute_smart_contract) {
            const disputeInfo = await getDisputeDetails(dispute_smart_contract);
            if (disputeInfo) {
                setStep9Count(disputeInfo.step9Count);
                setLastLosingPartyWasVendor(disputeInfo.lastLosingPartyWasVendor);
                setCurrentBuyer(disputeInfo.buyer);
                setCurrentVendor(disputeInfo.vendor);
            }
        }

        setShowDetails(true);
    };

    const displayButtons = () => {
        if (dispute_smart_contract) return displayDisputeButtons();
        return displayOptimisticButtons();
    };

    const renderPaymentStatus = () => {
        if (paymentStatus === "idle") {
            return (
                <div className="text-xs text-gray-500">
                    Mode: {eip7702Configured ? "EIP-7702 (sponsor gas)" : "Direct transaction"}
                </div>
            );
        }

        if (paymentStatus === "submitting") {
            return (
                <div className="text-xs text-gray-600">
                    Sending payment via EIP-7702...
                </div>
            );
        }

        if (paymentStatus === "pending") {
            return (
                <div className="text-xs text-gray-600 break-all">
                    <div>Payment submitted, waiting for inclusion.</div>
                    {paymentUserOpHash && (
                        <div>UserOp: {paymentUserOpHash}</div>
                    )}
                    {paymentTxHash && <div>Tx: {paymentTxHash}</div>}
                </div>
            );
        }

        if (paymentStatus === "confirmed") {
            return (
                <div className="text-xs text-green-700 break-all">
                    Payment confirmed.
                    {paymentTxHash ? ` Tx: ${paymentTxHash}` : ""}
                </div>
            );
        }

        return (
            <div className="text-xs text-red-600 break-all">
                Payment failed: {paymentError || "Unknown error"}
            </div>
        );
    };

    /*
        enum OptimisticState {
            WaitPayment,
            WaitKey,
            WaitSB,
            WaitSV,
            WaitDisputeStart,
            InDispute,
            End
        }
    */
    const displayOptimisticButtons = () => {
        switch (state) {
            case 0: // WaitPayment
                if (publicKey == pk_buyer)
                    return (
                        <div className="flex flex-col gap-2 w-full">
                            <div className="text-sm text-gray-600">
                                Item price: <strong>{Number(price)} ETH</strong> + completion tip: <strong>{Number(tip_completion)} ETH</strong>
                            </div>
                            <Button
                                label={`Pay ${paymentAmount} ETH`}
                                onClick={clickSendPayment}
                                isDisabled={paymentBusy}
                            />
                            {renderPaymentStatus()}
                        </div>
                    );
                break;

            case 1: // WaitKey
                if (publicKey == pk_vendor)
                    return (
                        <div className="flex gap-8 justify-between w-full items-center">
                            <input
                                value={keyInput}
                                onChange={(e) => setKeyInput(e.target.value)}
                                className="w-2/3 border border-gray-300 p-2 rounded"
                                placeholder="Key (hex)"
                            ></input>
                            <Button
                                label="Send key"
                                onClick={clickSendKey}
                                width="1/3"
                            />
                        </div>
                    );
                break;

            case 2: // WaitSB
                if (publicKey == pk_buyer)
                    return (
                        <>
                            <div className="flex gap-8 justify-between w-full items-center mb-4">
                                <Button
                                    label="Decrypt file"
                                    onClick={clickDecryptFile}
                                />
                            </div>
                            <div className="flex gap-8 justify-between w-full items-center mb-4">
                                <Button
                                    label={`Post argument`}
                                    onClick={clickBuyerPostArgument}
                                />
                            </div>
                            <div className="flex gap-8 justify-between w-full items-center">
                                <Button
                                    label="Complete transaction"
                                    onClick={clickCompleteTransaction}
                                />
                            </div>
                        </>
                    );
                break;

            case 3: // WaitSV
                if (publicKey == pk_vendor)
                    return (
                        <div className="flex gap-8 justify-between w-full items-center">
                            <Button
                                label={`Post argument`}
                                onClick={clickVendorPostArgument}
                            />
                        </div>
                    );
                break;
        }
        return <Button label="Close" onClick={onClose} />;
    };

    const clickSendPayment = async () => {
        // Empêcher les doubles clics
        if (paymentBusy) {
            console.warn("Paiement déjà en cours, ignorer le clic");
            return;
        }
        const mode = eip7702Configured ? "eip-7702" : "direct";
        console.log(`💳 Mode de paiement: ${mode.toUpperCase()}`);

        setPaymentStatus("submitting");
        setPaymentMode(mode);
        setPaymentUserOpHash(null);
        setPaymentTxHash(null);
        setPaymentError(null);

        try {
            console.log("💳 Début du paiement...", {
                publicKey,
                contract: contract.optimistic_smart_contract,
                amount: paymentAmount,
                mode,
            });

            const res = await sendPayment(
                publicKey,
                contract.optimistic_smart_contract,
                paymentAmount,
                {
                    mode,
                    waitForReceipt: true,
                }
            );

            console.log("✅ Résultat du paiement:", res);

            // Traiter le résultat selon le mode utilisé
            if (res.mode === "direct") {
                setPaymentMode("direct");
                setPaymentTxHash(res.transactionHash);
                setPaymentStatus("confirmed");
                console.log("✅ Paiement confirmé (transaction directe)");
                showToast("Zahlung wurde übertragen.", "success");
                // Rafraîchir les données et fermer après un délai
                setTimeout(() => {
                    window.dispatchEvent(new Event("reloadData"));
                    onClose();
                }, 2000);
            } else if (res.mode === "eip-7702") {
                setPaymentMode("eip-7702");
                setPaymentUserOpHash(res.userOpHash);
                if (res.transactionHash) {
                    setPaymentTxHash(res.transactionHash);
                }
                if (res.receipt) {
                    setPaymentStatus("confirmed");
                    console.log("✅ Paiement confirmé (EIP-7702)");
                    showToast("Zahlung wurde übertragen.", "success");
                    setTimeout(() => {
                        window.dispatchEvent(new Event("reloadData"));
                        onClose();
                    }, 2000);
                } else {
                    setPaymentStatus("pending");
                    console.log("⏳ Paiement en attente de confirmation (EIP-7702)");
                }
            }
        } catch (error: any) {
            console.error("❌ Erreur lors du paiement:", error);
            console.error("   Message:", error?.message);
            console.error("   Stack:", error?.stack);
            console.error("   Error object:", error);
            
            setPaymentStatus("error");
            const errorMessage = error?.message || error?.toString() || "Unknown error";
            setPaymentError(errorMessage);
            
            // Afficher l'erreur à l'utilisateur
            showToast(`Fehler bei der Zahlung: ${errorMessage}`, "error");
            
            // NE PAS fermer le modal en cas d'erreur pour que l'utilisateur puisse voir l'erreur
            // et réessayer si nécessaire
        }
    };

    const clickSendKey = async () => {
        try {
            console.log("Envoi de la clé...", {
                publicKey,
                contract: contract.optimistic_smart_contract,
                keyInput: keyInput ? keyInput.substring(0, 20) + "..." : "0x"
            });
            
            const userOpHash = await sendKey(
                publicKey,
                contract.optimistic_smart_contract,
                keyInput ? keyInput : "0x"
            );
            
            console.log("Résultat de l'envoi de la clé:", userOpHash);
            
            if (userOpHash) {
                // Attendre la confirmation de la UserOperation
                showToast(`Schlüssel gesendet! Hash: ${userOpHash.substring(0, 20)}…\nWarte auf Bestätigung…`, "info");
                
                try {
                    const { waitForUserOperationReceipt } = await import("@/app/lib/blockchain/userops");
                    console.log("⏳ Attente de la confirmation de la UserOperation...");
                    
                    const receipt = await waitForUserOperationReceipt(userOpHash, {
                        timeoutMs: 60000, // 60 secondes
                        pollIntervalMs: 2000, // Toutes les 2 secondes
                    });
                    
                    console.log("✅ UserOperation confirmée:", receipt);
                    let keyCheckMessage = "";
                    try {
                        const basicInfo = await getBasicInfo(
                            optimistic_smart_contract,
                            false
                        );
                        const onChainKey = basicInfo?.key || "0x";
                        const keyHex = onChainKey.startsWith("0x")
                            ? onChainKey.slice(2)
                            : onChainKey;
                        if (keyHex.length % 2 !== 0) {
                            keyCheckMessage =
                                "\n⚠️ Clé on-chain: longueur hex invalide.";
                        } else {
                            const keyBytesLength = keyHex.length / 2;
                            keyCheckMessage =
                                keyBytesLength === 16
                                    ? "\n✅ Clé on-chain: 16 bytes."
                                    : `\n⚠️ Clé on-chain: ${keyBytesLength} bytes (attendu 16).`;
                        }
                    } catch (keyError) {
                        console.warn("⚠️ Impossible de vérifier la clé:", keyError);
                        keyCheckMessage = "\n⚠️ Impossible de vérifier la clé on-chain.";
                    }
                    if (receipt?.receipt?.transactionHash) {
                        showToast(`Schlüssel bestätigt! Tx: ${receipt.receipt.transactionHash.substring(0, 20)}…${keyCheckMessage}`, "success");
                    } else {
                        showToast(`Schlüssel bestätigt! UserOp: ${userOpHash.substring(0, 20)}…${keyCheckMessage}`, "success");
                    }
                    
                    // Rafraîchir les données après confirmation
                    window.dispatchEvent(new Event("reloadData"));
                    
                    // Rafraîchir les données locales du modal
                    setTimeout(() => {
                        refreshContractData();
                    }, 2000);
                } catch (waitError: any) {
                    console.error("⚠️ Erreur lors de l'attente de confirmation:", waitError);
                    const waitErrorMessage = waitError?.message || waitError?.toString() || "Erreur inconnue";
                    
                    // La UserOperation a été envoyée, même si on ne peut pas attendre la confirmation
                    showToast(
                        `Schlüssel an Bundler gesendet (${userOpHash.substring(0, 20)}…)\n⚠️ Noch nicht bestätigt.\nGrund: ${waitErrorMessage}`,
                        "warning", 8000
                    );
                    
                    // Planifier un rafraîchissement périodique pour vérifier si la clé est finalement confirmée
                    const checkInterval = setInterval(async () => {
                        try {
                            const { getUserOperationReceipt } = await import("@/app/lib/blockchain/userops");
                            const receipt = await getUserOperationReceipt(userOpHash);
                            if (receipt) {
                                clearInterval(checkInterval);
                                console.log("✅ UserOperation confirmée après attente:", receipt);
                                showToast(`Schlüssel bestätigt! Tx: ${receipt?.receipt?.transactionHash?.substring(0, 20) || userOpHash.substring(0, 20)}…`, "success");
                                window.dispatchEvent(new Event("reloadData"));
                                refreshContractData();
                            }
                        } catch (err) {
                            // Ignorer les erreurs de vérification périodique
                        }
                    }, 5000); // Vérifier toutes les 5 secondes
                    
                    // Arrêter la vérification après 5 minutes
                    setTimeout(() => {
                        clearInterval(checkInterval);
                    }, 300000);
                    
                    window.dispatchEvent(new Event("reloadData"));
                }
            } else {
                showToast("Schlüssel erfolgreich gesendet!", "success");
                window.dispatchEvent(new Event("reloadData"));
            }
            
            // Ne pas fermer le modal immédiatement pour que l'utilisateur voie le changement
            // onClose();
        } catch (error: any) {
            console.error("Erreur lors de l'envoi de la clé:", error);
            const errorMessage = error?.message || error?.toString() || "Erreur inconnue";
            
            // Si l'erreur est "Already known", c'est que la UserOperation est déjà dans le mempool
            if (errorMessage.includes("Already known") || errorMessage.includes("already known")) {
                showToast("Schlüssel wird bereits gesendet (UserOperation bereits beim Bundler). Daten werden automatisch aktualisiert.", "info", 6000);
                window.dispatchEvent(new Event("reloadData"));
            } else {
                showToast(`Fehler beim Senden des Schlüssels: ${errorMessage}`, "error");
            }
        }
    };

    const clickDecryptFile = async () => {
        await init();
        let file: File | null = null;
        // if (confirm("Do you want to select a local file ?")) {
        //     file = await openFile();
        // }

        let ct: Uint8Array | null = null;
        if (file) {
            ct = await fileToBytes(file);
        } else {
            ct = hex_to_bytes(
                (
                    await (
                        await fetch(`/api/files/${id}`, {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                            },
                        })
                    ).json()
                ).file
            );
        }

        // --- Decryption (sync) ---
        let success: boolean;
        let downloadBytes: Uint8Array;
        let downloadName: string;
        const isExtImg       = algorithm_suite === "extended_image";
        const isExtImgCrop   = algorithm_suite === "extended_image_crop";
        const isExtImgDual   = algorithm_suite === "extended_image_dual";
        const isExtAudio     = algorithm_suite === "extended_audio";
        const isExtAudioLow  = algorithm_suite === "extended_audio_lowres";
        const isExtAudioBoth = algorithm_suite === "extended_audio_both";
        const isExtVideo     = algorithm_suite === "extended_video";
        const isExtVideoClip = algorithm_suite === "extended_video_clip";
        const isExtVideoBoth = algorithm_suite === "extended_video_both";
        const isAnyExtImg    = isExtImg || isExtImgCrop || isExtImgDual;
        const isAnyExtAudio  = isExtAudio || isExtAudioLow || isExtAudioBoth;
        const isAnyExtVideo  = isExtVideo || isExtVideoClip || isExtVideoBoth;

        const descBytesForCheck = (isAnyExtImg || isAnyExtAudio || isAnyExtVideo) ? hex_to_bytes(item_description) : null;
        const descLen = descBytesForCheck?.length ?? 0;
        try {
            let result;
            if      (isExtImg       && descLen === 76)  result = check_received_ct_key_extended_image_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtImgCrop   && descLen === 84)  result = check_received_ct_key_extended_image_crop_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtImgDual   && descLen === 116) result = check_received_ct_key_extended_image_dual_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtAudio     && descLen === 76)  result = check_received_ct_key_extended_audio_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtAudioLow  && descLen === 76)  result = check_received_ct_key_extended_audio_lowres_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtAudioBoth && descLen === 108) result = check_received_ct_key_extended_audio_both_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtVideo     && descLen === 88)  result = check_received_ct_key_extended_video_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtVideoClip && descLen === 92)  result = check_received_ct_key_extended_video_clip_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else if (isExtVideoBoth && descLen === 124) result = check_received_ct_key_extended_video_both_v2(ct, hex_to_bytes(key), descBytesForCheck!);
            else                                        result = check_received_ct_key(ct, hex_to_bytes(key), item_description);
            success = result.success;
            const raw = result.decrypted_file;

            if (isAnyExtImg) {
                // Strip SOX image header to get the BMP bytes.
                // All image containers: header(64B) | BMP → BMP at offset 64
                const bmpOffset = 64;
                let bmpStart = -1;
                for (const off of [bmpOffset, 0]) {
                    if (raw.length > off + 1 && raw[off] === 0x42 && raw[off + 1] === 0x4D) {
                        bmpStart = off; break;
                    }
                }
                if (bmpStart === -1) {
                    for (let i = 0; i < Math.min(raw.length - 1, 8192); i++) {
                        if (raw[i] === 0x42 && raw[i + 1] === 0x4D) { bmpStart = i; break; }
                    }
                }
                downloadBytes = bmpStart >= 0 ? raw.slice(bmpStart) : raw;
            } else if (isAnyExtAudio) {
                // Strip SOX audio header to get original audio bytes.
                // extended_audio:       header(64B) + preview(480000B)              → audio at 480064
                // extended_audio_lowres: header(64B) + lowres(720000B)              → audio at 720064
                // extended_audio_both:  header(64B) + preview(480000B) + lowres(720000B) → audio at 1200064
                const audioOffset = isExtAudio ? 480_064 : isExtAudioLow ? 720_064 : 1_200_064;
                downloadBytes = raw.length > audioOffset ? raw.slice(audioOffset) : raw;
            } else if (isAnyExtVideo) {
                // Video: deliver the full SOX container (header + raw RGB24 frames).
                downloadBytes = raw;
            } else {
                downloadBytes = raw;
            }

            const detectImgExt = (b: Uint8Array) => {
                if (b[0] === 0x42 && b[1] === 0x4D) return "bmp";
                if (b[0] === 0xFF && b[1] === 0xD8) return "jpg";
                if (b[0] === 0x89 && b[1] === 0x50) return "png";
                if (b[0] === 0x47 && b[1] === 0x49) return "gif";
                if (b[0] === 0x52 && b[4] === 0x57) return "webp";
                return null;
            };
            const detectAudioExt = (b: Uint8Array) => {
                if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3";
                if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return "mp3";
                if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "wav";
                if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return "flac";
                if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "m4a";
                return null;
            };
            const detectedImgExt   = isAnyExtImg   ? detectImgExt(downloadBytes)   : null;
            const detectedAudioExt = isAnyExtAudio ? detectAudioExt(downloadBytes) : null;
            const fallbackName =
                isAnyExtImg   ? (detectedImgExt   ? `image.${detectedImgExt}`   : "image.png") :
                isAnyExtAudio ? (detectedAudioExt ? `audio.${detectedAudioExt}` : "audio.bin") :
                isAnyExtVideo ? "video_container.bin" :
                "decrypted_file";
            downloadName = file_name || fallbackName;
        } catch {
            showToast("Fehler bei der Entschlüsselung.", "error");
            return;
        }

        // --- Confirmation ---
        const confirmed = success
            ? confirm("Die Datei scheint korrekt zu sein. Entschlüsselte Datei herunterladen?")
            : confirm("Die Datei scheint NICHT korrekt zu sein. Trotzdem herunterladen?");
        if (!confirmed) return;

        // --- Download (async, separate from decryption error handling) ---
        try {
            if (isAnyExtAudio || isAnyExtVideo) {
                // Audio/video: download directly in their container format
                downloadFile(downloadBytes, downloadName);
            } else if (isAnyExtImg && downloadBytes[0] === 0x42 && downloadBytes[1] === 0x4D) {
                // Canonical 24-bit bottom-up BMP — decode manually (Safari has no BMP support)
                const bmp = new Uint8Array(downloadBytes.length);
                for (let i = 0; i < downloadBytes.length; i++) bmp[i] = downloadBytes[i];

                const u32le = (off: number) =>
                    (bmp[off] | (bmp[off+1] << 8) | (bmp[off+2] << 16) | (bmp[off+3] << 24)) >>> 0;
                const i32le = (off: number) =>
                    bmp[off] | (bmp[off+1] << 8) | (bmp[off+2] << 16) | (bmp[off+3] << 24);

                const pixelOffset = u32le(10);
                const bmpW = i32le(18);
                const bmpH = i32le(22);
                if (bmpW <= 0 || bmpH === 0 || pixelOffset >= bmp.length)
                    throw new Error(`Invalid BMP header (w=${bmpW} h=${bmpH} off=${pixelOffset})`);

                const absH = Math.abs(bmpH);
                const bottomUp = bmpH > 0;
                const rowStride = (bmpW * 3 + 3) & ~3;
                const rgba = new Uint8ClampedArray(bmpW * absH * 4);
                for (let row = 0; row < absH; row++) {
                    const srcRow = bottomUp ? (absH - 1 - row) : row;
                    const srcOff = pixelOffset + srcRow * rowStride;
                    const dstOff = row * bmpW * 4;
                    for (let col = 0; col < bmpW; col++) {
                        rgba[dstOff + col * 4 + 0] = bmp[srcOff + col * 3 + 2]; // R
                        rgba[dstOff + col * 4 + 1] = bmp[srcOff + col * 3 + 1]; // G
                        rgba[dstOff + col * 4 + 2] = bmp[srcOff + col * 3 + 0]; // B
                        rgba[dstOff + col * 4 + 3] = 255;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = bmpW;
                canvas.height = absH;
                canvas.getContext("2d")!.putImageData(new ImageData(rgba, bmpW, absH), 0, 0);

                const ext = downloadName.split(".").pop()?.toLowerCase() ?? "";
                const mimeMap: Record<string, string> = {
                    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                    webp: "image/webp", gif: "image/gif", bmp: "image/png",
                };
                const mime = mimeMap[ext] ?? "image/png";
                const outputName = ext === "bmp" ? downloadName.replace(/\.bmp$/i, ".png") : downloadName;
                await new Promise<void>((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = outputName; a.click();
                        URL.revokeObjectURL(url);
                        resolve();
                    }, mime);
                });
            } else {
                // Already in original format (JPEG/PNG/etc.) or non-image — download directly
                downloadFile(downloadBytes, downloadName);
            }
        } catch (e: any) {
            showToast(`Download fehlgeschlagen: ${e.message}`, "error");
        }
    };

    const clickDownloadCiphertext = async () => {
        try {
            const response = await fetch(`/api/files/${id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(
                    errorPayload?.error ||
                        `Impossible de télécharger le fichier (HTTP ${response.status})`
                );
            }
            const fileData = await response.json();
            if (!fileData?.file) {
                throw new Error("Fichier chiffré introuvable (réponse vide).");
            }
            const ctBytes = hex_to_bytes(fileData.file);
            downloadFile(ctBytes, `contract_${id}_ciphertext.enc`);
        } catch (error: any) {
            const errorMessage = error?.message || error?.toString() || "Erreur inconnue";
            showToast(`Fehler beim Herunterladen der verschlüsselten Datei: ${errorMessage}`, "error");
        }
    };

    const clickCompleteTransaction = async () => {
        await init();
        try {
            await endOptimisticTimeout(optimistic_smart_contract!, publicKey);
            showToast("Transaktion erfolgreich abgeschlossen.", "success");
            onClose();
            window.dispatchEvent(new Event("reloadData"));
        } catch (error: any) {
            showToast(`Fehler: ${error.message || error}`, "error");
        }
    };

    const clickBuyerPostArgument = async () => {
        await init();

        let file;
        let ct: Uint8Array | undefined = undefined;
        if (confirm("Möchtest du eine Datei auswählen?")) {
            file = await openFile();
        }
        if (file) ct = await fileToBytes(file);

        if (!ct) {
            ct = hex_to_bytes(
                (
                    await (
                        await fetch(`/api/files/${id}`, {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                            },
                        })
                    ).json()
                ).file
            );
        }

        const argument = make_argument(ct, item_description, opening_value);

        await fetch(`/api/arguments/buyer/${id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                argument: bytes_to_hex(argument),
            }),
        });
        onClose();
        showToast("Argument eingereicht!", "success");
    };

    const clickVendorPostArgument = async () => {
        await init();

        let file;
        let ct: Uint8Array | undefined = undefined;
        // if (confirm("Do you want to select a file ?")) {
        //     file = await openFile();
        // }
        // if (file) ct = await fileToBytes(file);

        if (!ct) {
            ct = hex_to_bytes(
                (
                    await (
                        await fetch(`/api/files/${id}`, {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                            },
                        })
                    ).json()
                ).file
            );
        }

        const argument = make_argument(ct, item_description, opening_value);

        await fetch(`/api/arguments/vendor/${id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                argument: bytes_to_hex(argument),
            }),
        });
        onClose();
        showToast("Argument eingereicht!", "success");
    };

    /*
        enum DisputeState {
            ChallengeBuyer,
            WaitVendorOpinion,
            WaitVendorData,
            WaitVendorDataLeft,
            WaitVendorDataRight,
            Complete,
            Cancel,
            End
        }
    */
    const displayDisputeButtons = () => {
        const activeBuyer = currentBuyer || pk_buyer;
        const activeVendor = currentVendor || pk_vendor;
        const isActiveBuyer = publicKey.toLowerCase() === activeBuyer.toLowerCase();
        const isActiveVendor = publicKey.toLowerCase() === activeVendor.toLowerCase();
        
        switch (state) {
            case 0:
                if (isActiveBuyer) {
                    getChallenge(dispute_smart_contract!).then((c) =>
                        setChallengeLabel(`Respond to challenge ${c}`)
                    );
                    return (
                        <>
                            <Button
                                label={challengeBtnLabel}
                                onClick={clickRespondChallenge}
                            />
                        </>
                    );
                }
                break;
            case 1:
                if (isActiveVendor) {
                    return (
                        <>
                            <Button
                                label="Give opinion"
                                onClick={clickGiveOpinion}
                            />
                        </>
                    );
                }
                break;
            case 2:
            case 3:
            case 4:
                if (isActiveVendor) {
                    return (
                        <Button label="Send proofs" onClick={clickSendProofs} />
                    );
                }
                break;
            case 5:
            case 6:
                return (
                    <Button
                        label="Finish dispute"
                        onClick={clickFinishDispute}
                    />
                );
        }

        return <Button label="Close" onClick={onClose} />;
    };

    const clickRespondChallenge = async () => {
        await init();

        const challenge = await getChallenge(dispute_smart_contract!);
        const evaluated_circuit = await getEvaluatedCircuit();

        const response = hpre_v2(evaluated_circuit, num_blocks, Number(challenge));

        await respondChallenge(
            publicKey,
            dispute_smart_contract!,
            bytes_to_hex(response)
        );
        onClose();
        showToast(`Antwort für Challenge ${challenge} gesendet.`, "success");
    };

    const clickGiveOpinion = async () => {
        await init();

        const challenge = await getChallenge(dispute_smart_contract!);
        const evaluated_circuit = await getEvaluatedCircuit();

        const computedResponse = hpre_v2(
            evaluated_circuit,
            num_blocks,
            Number(challenge)
        );
        const latestResponse = await getLatestChallengeResponse(
            dispute_smart_contract!
        );
        const opinion = bytes_to_hex(computedResponse) == latestResponse;

        await giveOpinion(publicKey, dispute_smart_contract!, opinion);
        if (opinion) {
            showToast("Zugestimmt.", "success");
        } else {
            showToast("Nicht zugestimmt.", "info");
        }
        onClose();
    };

    const clickSendProofs = async () => {
        console.log("🚀 clickSendProofs appelé");
        try {
            console.log("✅ Dans le try block");
            // Récupérer l'état actuel du contrat pour s'assurer qu'on a la bonne valeur
            console.log("📡 Récupération de l'état du contrat...");
            const currentState = await getDisputeState(dispute_smart_contract!);
            const actualState = currentState !== undefined ? Number(currentState) : state;
            
            console.log(`📊 État actuel du contrat: ${actualState} (état local: ${state})`);
            
            console.log("🔧 Initialisation WASM...");
            await init();
            console.log("✅ WASM initialisé");
            
            console.log("📦 Récupération des données (getLargeData)...");
            const { ct, circuit, evaluated_circuit } = await getLargeData();
            console.log("✅ Données récupérées");
            
            console.log("🔹 Récupération du challenge...");
            const challenge = await getChallenge(dispute_smart_contract!);
            console.log(`🔹 Challenge: ${challenge}`);

            if (actualState == 2) {
                console.log("📤 Envoi des preuves (état 2: WaitVendorData)");
                const {
                    gate_bytes,
                    values,
                    curr_acc,
                    proof1,
                    proof2,
                    proof3,
                    proof_ext,
                } = compute_proofs_v2(
                    circuit,
                    evaluated_circuit,
                    ct,
                    Number(challenge)
                );
                if (gate_bytes.length !== 64) {
                    throw new Error(
                        `InvalidGateBytes: gate_bytes.length=${gate_bytes.length}, attendu 64`
                    );
                }

                // Ensure opening_value is in the correct format (hex string with 0x prefix)
                let openingValueHex = opening_value;
                if (!openingValueHex.startsWith('0x')) {
                    openingValueHex = '0x' + openingValueHex;
                }
                console.log(`📊 Opening value formaté: ${openingValueHex.slice(0, 20)}...`);

                const userOpHash = await submitCommitment(
                    openingValueHex,
                    challenge,
                    gate_bytes, // V2 format: 64-byte gate bytes
                    values,
                    curr_acc,
                    proof1,
                    proof2,
                    proof3,
                    proof_ext,
                    publicKey,
                    dispute_smart_contract!
                );

                showToast(`Beweise gesendet und bestätigt!\nHash: ${userOpHash.slice(0, 20)}…`, "success");
            } else if (actualState == 3) {
                console.log("📤 Envoi des preuves left (état 3: WaitVendorDataLeft)");
                const { gate_bytes, values, curr_acc, proof1, proof2, proof_ext } =
                    compute_proofs_left_v2(
                        circuit,
                        evaluated_circuit,
                        ct,
                        Number(challenge)
                    );
                if (gate_bytes.length !== 64) {
                    throw new Error(
                        `InvalidGateBytes: gate_bytes.length=${gate_bytes.length}, attendu 64`
                    );
                }

                // Ensure opening_value is in the correct format (hex string with 0x prefix)
                let openingValueHex = opening_value;
                if (!openingValueHex.startsWith('0x')) {
                    openingValueHex = '0x' + openingValueHex;
                }
                console.log(`📊 Opening value formaté: ${openingValueHex.slice(0, 20)}...`);
                console.log(`📊 Opening value length: ${openingValueHex.length} chars (should be 2 + 64*2 = 130 for 32 bytes)`);
                console.log(`📊 Gate bytes length: ${gate_bytes.length} bytes (should be 64)`);
                console.log(`📊 Values count: ${values.length}`);
                console.log(`📊 curr_acc length: ${curr_acc.length} bytes (should be 32)`);
                console.log(`📊 proof1 layers: ${proof1.length}`);
                console.log(`📊 proof2 layers: ${proof2.length}`);
                console.log(`📊 proof_ext layers: ${proof_ext.length}`);

                // Vérifier le commitment du contrat
                try {
                    const { getBasicInfo } = await import("@/app/lib/blockchain/optimistic");
                    const basicInfo = await getBasicInfo(optimistic_smart_contract, true);
                    if (basicInfo && basicInfo.commitment) {
                        console.log(`📊 Commitment du contrat: ${basicInfo.commitment}`);
                        // Note: On ne peut pas vérifier directement si opening_value correspond
                        // car cela nécessite d'appeler openCommitment sur le contrat
                    }
                } catch (error) {
                    console.warn("⚠️ Impossible de vérifier le commitment:", error);
                }

                // TEST: Envoi direct (sans UserOperation)
                const txHash = await submitCommitmentLeftDirect(
                    openingValueHex,
                    challenge,
                    gate_bytes,
                    values,
                    curr_acc,
                    proof1,
                    proof2,
                    proof_ext,
                    publicKey,
                    dispute_smart_contract!
                );
                showToast(`Direkte Transaktion gesendet!\nHash: ${txHash.slice(0, 20)}…`, "success");
            } else if (actualState == 4) {
                console.log("📤 Envoi des preuves right (état 4: WaitVendorDataRight)");
                console.log(`📊 Paramètres: num_blocks=${num_blocks}, num_gates=${num_gates}`);
                
                try {
                    // Vérifier le format de evaluated_circuit
                    if (!evaluated_circuit || evaluated_circuit.length === 0) {
                        throw new Error("evaluated_circuit est vide ou invalide");
                    }
                    
                    console.log(`📊 evaluated_circuit length: ${evaluated_circuit.length} bytes`);
                    console.log(`📊 evaluated_circuit type: ${typeof evaluated_circuit}`);
                    console.log(`📊 evaluated_circuit constructor: ${evaluated_circuit?.constructor?.name}`);
                    
                    // Vérifier les paramètres
                    if (typeof num_blocks !== 'number' || isNaN(num_blocks)) {
                        throw new Error(`num_blocks invalide: ${num_blocks} (type: ${typeof num_blocks})`);
                    }
                    if (typeof num_gates !== 'number' || isNaN(num_gates)) {
                        throw new Error(`num_gates invalide: ${num_gates} (type: ${typeof num_gates})`);
                    }
                    
                    console.log(`📊 Paramètres validés: num_blocks=${num_blocks}, num_gates=${num_gates}`);
                    
                    // Convertir evaluated_circuit en Uint8Array si nécessaire
                    let evaluated_circuit_bytes: Uint8Array;
                    if (evaluated_circuit instanceof Uint8Array) {
                        evaluated_circuit_bytes = evaluated_circuit;
                    } else if (Array.isArray(evaluated_circuit)) {
                        evaluated_circuit_bytes = new Uint8Array(evaluated_circuit);
                    } else {
                        throw new Error(`Format invalide pour evaluated_circuit: ${typeof evaluated_circuit}`);
                    }
                    
                    console.log(`📊 evaluated_circuit_bytes length: ${evaluated_circuit_bytes.length} bytes`);
                    
                    console.log("🔧 Calcul de la preuve avec compute_proof_right_v2...");
                    let proof;
                    try {
                        proof = compute_proof_right_v2(
                            evaluated_circuit_bytes,
                            num_blocks,
                            num_gates
                        );
                        console.log("✅ Preuve calculée");
                    } catch (proofError: any) {
                        console.error("❌ Erreur lors du calcul de la preuve:", proofError);
                        console.error("Erreur details:", {
                            message: proofError?.message,
                            name: proofError?.name,
                            stack: proofError?.stack,
                        });
                        throw new Error(`Erreur lors du calcul de la preuve: ${proofError?.message || proofError?.toString() || String(proofError)}`);
                    }
                    
                    console.log(`📊 Preuve générée: ${proof.length} couches`);
                    if (proof.length > 0 && proof[0]) {
                        console.log(`   Première couche: ${proof[0].length} éléments`);
                    }

                    console.log("📤 Appel de submitCommitmentRight...");
                    const userOpHash = await submitCommitmentRight(
                        proof,
                        publicKey,
                        dispute_smart_contract!
                    );
                    console.log("✅ submitCommitmentRight réussi");
                    showToast(`Beweise gesendet und bestätigt!\nHash: ${userOpHash.slice(0, 20)}…`, "success");
                } catch (err: any) {
                    console.error("❌ Erreur dans état 4:", err);
                    console.error("Type:", typeof err, "Constructor:", err?.constructor?.name);
                    console.error("Stack:", err?.stack);
                    const errorMsg = err?.message || err?.reason || (typeof err?.toString === 'function' ? err.toString() : String(err));
                    throw new Error(`Erreur lors de l'envoi des preuves (état 4): ${errorMsg}`);
                }
            } else if (actualState === 5) {
                showToast("Streitfall abgeschlossen (Complete). Der Verkäufer hat gewonnen.", "info");
            } else if (actualState === 6) {
                showToast("Streitfall abgeschlossen (Cancel). Der Käufer hat gewonnen.", "info");
            } else if (actualState === 7) {
                showToast("Streitfall abgeschlossen (End).", "info");
            } else {
                showToast(`Unerwarteter Zustand: ${actualState}. Erwartet: 2, 3 oder 4.`, "warning");
                console.error(`Unerwarteter Zustand: ${actualState}. Lokaler Zustand: ${state}`);
            }
            
            // Rafraîchir l'état après l'envoi
            await refreshContractData();
            onClose();
        } catch (error: any) {
            console.error("Error sending proofs:", error);
            console.error("Error type:", typeof error);
            console.error("Error constructor:", error?.constructor?.name);
            console.error("Error details:", {
                message: error?.message,
                reason: error?.reason,
                code: error?.code,
                data: error?.data,
                stack: error?.stack,
                toString: typeof error?.toString === 'function' ? error.toString() : 'N/A',
            });
            
            // Essayer de sérialiser l'erreur complète pour le debug
            let errorString = "Erreur inconnue";
            try {
                errorString = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
            } catch (e) {
                // Si la sérialisation échoue, essayer toString
                try {
                    errorString = String(error);
                } catch (e2) {
                    errorString = "Erreur non sérialisable";
                }
            }
            
            // Extraire le message d'erreur le plus informatif possible
            let errorMessage = "Erreur inconnue";
            if (error?.message && error.message !== "Error" && error.message.trim() !== "") {
                errorMessage = error.message;
            } else if (error?.reason) {
                errorMessage = error.reason;
            } else if (error?.data?.message) {
                errorMessage = error.data.message;
            } else if (error?.shortMessage) {
                errorMessage = error.shortMessage;
            } else if (typeof error?.toString === 'function') {
                const errorStr = error.toString();
                if (errorStr !== '[object Object]' && errorStr !== 'Error' && errorStr.trim() !== "") {
                    errorMessage = errorStr;
                }
            }
            
            // Si le message est toujours générique, utiliser la sérialisation complète
            if (errorMessage === "Erreur inconnue" || errorMessage === "Error") {
                // Essayer d'utiliser la stack trace si disponible
                if (error?.stack) {
                    errorMessage = `Erreur (voir stack trace):\n${error.stack.split('\n').slice(0, 5).join('\n')}`;
                } else if (errorString && errorString !== "{}" && errorString !== '{"stack":""}') {
                    errorMessage = errorString.length > 500 ? errorString.substring(0, 500) + "..." : errorString;
                } else {
                    errorMessage = `Erreur inconnue. Type: ${typeof error}, Constructor: ${error?.constructor?.name || 'N/A'}`;
                }
            }
            
            showToast(`Fehler beim Senden der Beweise:\n${errorMessage}`, "error", 8000);
        }
    };

    const clickFinishDispute = async () => {
        await finishDispute(state, publicKey, dispute_smart_contract!);
        showToast("Streitfall abgeschlossen.", "success");
        onClose();
    };

    const showCurrentState = () => {
        if (contract.dispute_smart_contract) {
            return DISPUTE_STATES[Number(state)];
        } else {
            return state != -1
                ? OPTIMISTIC_STATES[Number(state)]
                : "Loading...";
        }
    };

    const getEvaluatedCircuit = async () => {
        let ct_file;

        if (confirm("Möchtest du die verschlüsselte Datei (Ciphertext) auswählen?")) {
            ct_file = await openFile();
        }

        let ct;
        
        if (ct_file) {
            ct = await fileToBytes(ct_file);
        } else {
            // Fallback: utiliser le ciphertext depuis l'API
            ct = hex_to_bytes(
                (
                    await (
                        await fetch(`/api/files/${id}`, {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                            },
                        })
                    ).json()
                ).file
            );
        }

        // Toujours compiler le circuit depuis le ciphertext (pas de sélection de circuit)
        const _db1 = hex_to_bytes(item_description);
        const circuit = (() => {
            if (algorithm_suite === "extended_image"        && _db1.length === 76)  return compile_circuit_extended_image_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_image_crop"   && _db1.length === 76)  return compile_circuit_extended_image_crop_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_image_dual"   && _db1.length === 108) return compile_circuit_extended_image_dual_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_audio"        && _db1.length === 76)  return compile_circuit_extended_audio_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_audio_lowres" && _db1.length === 76)  return compile_circuit_extended_audio_lowres_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_audio_both"   && _db1.length === 112) return compile_circuit_extended_audio_both_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_video"        && _db1.length === 88)  return compile_circuit_extended_video_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_video_clip"   && _db1.length === 92)  return compile_circuit_extended_video_clip_v2_wasm(ct!, _db1);
            if (algorithm_suite === "extended_video_both"   && _db1.length === 124) return compile_circuit_extended_video_both_v2_wasm(ct!, _db1);
            return compile_circuit_v2_wasm(ct!, item_description);
        })();

        const evaluated_circuit = evaluate_circuit_v2_wasm(
            circuit,
            ct!,
            key
        ).to_bytes();
        // if (confirm("Save evaluated circuit ?"))
        //     await downloadFile(evaluated_circuit, "evaluated_circuit.bin");

        return evaluated_circuit;
    };

    // Prompt user to get encrypted file (ciphertext)
    // Le circuit et l'evaluated_circuit seront calculés automatiquement
    const getLargeData = async () => {
        let ct_file: File | null = null;
        let ct: Uint8Array;

        if (confirm("Möchtest du die verschlüsselte Datei (Ciphertext) auswählen?")) {
            ct_file = await openFile();
        }

        if (ct_file) {
            ct = await fileToBytes(ct_file);
        } else {
            // Fallback: récupérer depuis l'API (correspond au commitment initial)
            ct = hex_to_bytes(
                (
                    await (
                        await fetch(`/api/files/${id}`, {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                            },
                        })
                    ).json()
                ).file
            );
        }

        // Compiler le circuit automatiquement
        const _db2 = hex_to_bytes(item_description);
        const circuit = (() => {
            if (algorithm_suite === "extended_image"        && _db2.length === 76)  return compile_circuit_extended_image_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_image_crop"   && _db2.length === 76)  return compile_circuit_extended_image_crop_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_image_dual"   && _db2.length === 108) return compile_circuit_extended_image_dual_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_audio"        && _db2.length === 76)  return compile_circuit_extended_audio_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_audio_lowres" && _db2.length === 76)  return compile_circuit_extended_audio_lowres_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_audio_both"   && _db2.length === 112) return compile_circuit_extended_audio_both_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_video"        && _db2.length === 88)  return compile_circuit_extended_video_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_video_clip"   && _db2.length === 92)  return compile_circuit_extended_video_clip_v2_wasm(ct, _db2);
            if (algorithm_suite === "extended_video_both"   && _db2.length === 124) return compile_circuit_extended_video_both_v2_wasm(ct, _db2);
            return compile_circuit_v2_wasm(ct, item_description);
        })();

        // Évaluer le circuit automatiquement avec la clé
        const evaluated_circuit = evaluate_circuit_v2_wasm(
            circuit,
            ct,
            key
        ).to_bytes();

        return { ct, circuit, evaluated_circuit };
    };

    return (
        <Modal title={`Contract ${id} details`} onClose={onClose}>
            <div className="space-y-4 grid grid-cols-2 gap-4">
                <div>
                    <strong>Smart contract address: </strong>
                    {optimistic_smart_contract}
                </div>
                <div>
                    <strong>Current state:</strong> {showCurrentState()}
                </div>
                {!!dispute_smart_contract && step9Count !== null && (
                    <>
                        <div>
                            <strong>Step 9 Count:</strong> {step9Count}
                        </div>
                        <div>
                            <strong>Last Losing Party:</strong>{" "}
                            {lastLosingPartyWasVendor !== null
                                ? lastLosingPartyWasVendor
                                    ? "Vendor"
                                    : "Buyer"
                                : "N/A"}
                        </div>
                        {step9Count > 0 && (
                            <div className="col-span-2 p-3 bg-blue-50 border border-blue-200 rounded">
                                <strong>ℹ️ Step 9 Information:</strong>
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                    <li>Step 9 has been reached {step9Count} time(s)</li>
                                    <li>
                                        Last losing party:{" "}
                                        {lastLosingPartyWasVendor ? "Vendor" : "Buyer"}
                                    </li>
                                    {currentBuyer && currentBuyer.toLowerCase() !== pk_buyer.toLowerCase() && (
                                        <li className="text-orange-600 font-semibold">
                                            ⚠️ Buyer replaced by sponsor: {currentBuyer.slice(0, 10)}...
                                        </li>
                                    )}
                                    {currentVendor && currentVendor.toLowerCase() !== pk_vendor.toLowerCase() && (
                                        <li className="text-orange-600 font-semibold">
                                            ⚠️ Vendor replaced by sponsor: {currentVendor.slice(0, 10)}...
                                        </li>
                                    )}
                                    {((currentBuyer && publicKey.toLowerCase() === currentBuyer.toLowerCase()) ||
                                      (currentVendor && publicKey.toLowerCase() === currentVendor.toLowerCase())) && (
                                        <li className="text-green-600 font-semibold">
                                            ✅ You (sponsor) are now the active party!
                                        </li>
                                    )}
                                    {step9Count === 1 && (
                                        <li className="text-green-600">
                                            ✓ Sponsor can take over if party loses again
                                        </li>
                                    )}
                                    {step9Count === 2 && (
                                        <li className="text-yellow-600">
                                            ⚠ Last chance for sponsor takeover
                                        </li>
                                    )}
                                    {step9Count >= 3 && (
                                        <li className="text-red-600">
                                            ✗ Step 9 reached maximum - dispute will terminate
                                        </li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </>
                )}
                <div>
                    <strong>Buyer:</strong> {currentBuyer || buyer}
                    {currentBuyer && currentBuyer.toLowerCase() !== pk_buyer.toLowerCase() && (
                        <span className="ml-2 text-orange-600 text-sm">
                            (Sponsor took over - originally: {pk_buyer.slice(0, 10)}...)
                        </span>
                    )}
                </div>
                <div>
                    <strong>Vendor:</strong> {currentVendor || vendor}
                    {currentVendor && currentVendor.toLowerCase() !== pk_vendor.toLowerCase() && (
                        <span className="ml-2 text-orange-600 text-sm">
                            (Sponsor took over - originally: {pk_vendor.slice(0, 10)}...)
                        </span>
                    )}
                </div>
                <div>
                    <strong>Key:</strong> {key}
                </div>
                <div>
                    <strong>Timeout of current step:</strong> {nextTimeout}
                </div>
                {detailsShown && (
                    <>
                        <div>
                            <strong>Sponsor:</strong> {sponsor}
                        </div>
                        <div>
                            <strong>Buyer dispute sponsor:</strong> {bSponsor}
                        </div>
                        <div>
                            <strong>Vendor dispute sponsor:</strong> {vSponsor}
                        </div>
                        <div>
                            <strong>Item description: </strong>{" "}
                            {item_description}
                        </div>
                        <div>
                            <strong>Item price:</strong> {Number(price)} ETH
                        </div>
                        <div>
                            <strong>Completion tip:</strong> {formatWei(completionTip)} ETH
                        </div>
                        <div>
                            <strong>Dispute tip:</strong> {formatWei(disputeTip)} ETH
                        </div>
                        <div>
                            <strong>Sponsor deposit:</strong> {formatWei(sponsorDeposit)} ETH
                        </div>
                        <div>
                            <strong>Buyer deposit:</strong> {formatWei(buyerDeposit)} ETH
                        </div>
                        <div>
                            <strong>Buyer dispute sponsor deposit:</strong>{" "}
                            {formatWei(bSponsorDeposit)} ETH
                        </div>
                        <div>
                            <strong>Vendor dispute sponsor deposit:</strong>{" "}
                            {formatWei(vSponsorDeposit)} ETH
                        </div>
                        {!!dispute_smart_contract && (
                            <>
                                <div>
                                    <strong>Dispute smart contract: </strong>{" "}
                                    {dispute_smart_contract}
                                </div>
                                {step9Count !== null && (
                                    <>
                                        <div>
                                            <strong>Step 9 Count: </strong> {step9Count}
                                        </div>
                                        <div>
                                            <strong>Last Losing Party: </strong>{" "}
                                            {lastLosingPartyWasVendor !== null
                                                ? lastLosingPartyWasVendor
                                                    ? "Vendor"
                                                    : "Buyer"
                                                : "N/A"}
                                        </div>
                                        <div>
                                            <strong>Current Buyer (from contract): </strong> {currentBuyer || "N/A"}
                                        </div>
                                        <div>
                                            <strong>Current Vendor (from contract): </strong> {currentVendor || "N/A"}
                                        </div>
                                    </>
                                )}
                                <div>
                                    <strong>Buyer dispute sponsor: </strong>{" "}
                                    {pk_sb}
                                </div>
                                <div>
                                    <strong>Vendor dispute sponsor: </strong>{" "}
                                    {pk_sv}
                                </div>
                            </>
                        )}
                    </>
                )}

                {!detailsShown && (
                    <div className="col-span-2">
                        <Button
                            label="Show details"
                            onClick={handleShowdetails}
                        />
                    </div>
                )}

                <div className="col-span-2 gap-8">{displayButtons()}</div>
            </div>
        </Modal>
    );
}
