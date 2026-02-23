"use client";

import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormTextField from "../common/FormTextField";
import FormSelect from "../common/FormSelect";
import FormFileInput from "../common/FormFileInput";
import { isAddress } from "ethers";
import initWasm, { compute_precontract_values, bytes_to_hex } from "@/app/lib/crypto_lib";
import { useEthChfRate, ethToCHF } from "@/app/lib/useEthChfRate";

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
}: NewContractModalProps) {
    const [buyerPk, setBuyerPk] = useState(prefillBuyerPk ?? "");
    const [price, setPrice] = useState(prefillPrice ?? "");
    const [tipCompletion, setTipCompletion] = useState(prefillTipCompletion ?? "");
    const [tipDispute, setTipDispute] = useState(prefillTipDispute ?? "");
    const [version, setVersion] = useState("0");
    const [timeoutDelay, setTimeoutDelay] = useState(prefillTimeoutDelay ?? "");
    const [algorithms, setAlgorithms] = useState("default");
    const [file, setFile] = useState<FileList | null>();
    const [isComputing, setIsComputing] = useState(false);
    const ethChfRate = useEthChfRate();

    // Spécifique mode Electron : on veut une seule fenêtre de sélection
    const [isElectron, setIsElectron] = useState(false);
    const [preOutElectron, setPreOutElectron] = useState<any | null>(null);

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
                alert("Mode Electron non détecté.");
                return null;
            }

            // Ouvre UNE SEULE fois la fenêtre native et lance precontract_cli
            const preOut = await anyWindow.electronAPI.precompute();

            if (preOut.cancelled) {
                return null;
            }
            if (preOut.error) {
                console.error("Erreur precompute natif via Electron:", preOut.error);
                alert(`Erreur précompute natif: ${preOut.error}`);
                return null;
            }

            setPreOutElectron(preOut);
            return preOut;
        } catch (e: any) {
            console.error("Erreur lors de la sélection du fichier en mode Electron:", e);
            alert(`Erreur: ${e.message || e.toString()}`);
            return null;
        }
    };

    const handleSubmit = async () => {
        try {
            // Valider les adresses (optionnel mais utile)
            if (!buyerPk || !isAddress(buyerPk)) {
                alert("Adresse buyer invalide");
                return;
            }
            if (!vendorPk || !isAddress(vendorPk)) {
                alert("Adresse vendor invalide");
                return;
            }

            // Si on est dans l'app desktop Electron, utiliser le résultat déjà pré-calculé
            const anyWindow: any = typeof window !== "undefined" ? window : {};
            if (anyWindow.electronAPI && typeof anyWindow.electronAPI.precompute === "function") {
                // Si l'utilisateur n'a pas encore cliqué sur "Choisir le fichier",
                // on lance automatiquement le flux de sélection + calcul ici.
                let preOut = preOutElectron;
                if (!preOut) {
                    preOut = await handleElectronChooseFile();
                }
                if (!preOut) {
                    // L'utilisateur a peut-être annulé la sélection ou il y a eu une erreur.
                    return;
                }

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

                alert(
                    `Added new contract with ID ${id}. The encryption key is: ${key}`
                );
                localStorage.setItem(`h_circuit_${id}`, h_circuit);
                localStorage.setItem(`h_ct_${id}`, h_ct);
                localStorage.setItem(`key_${id}`, key);

                window.dispatchEvent(new Event("reloadData"));
                onClose();
                return;
            }

            // Web mode: encrypt in the browser using WASM, send only ciphertext to server
            if (!file || file.length === 0) {
                alert("Veuillez sélectionner un fichier");
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

            alert(`Added new contract with ID ${id}.`);
            window.dispatchEvent(new Event("reloadData"));
            onClose();
        } catch (e: any) {
            setIsComputing(false);
            console.error("Erreur lors de la création du contrat:", e);
            alert(`Erreur: ${e.message || e.toString()}`);
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
                    <FormFileInput id="sold-file" onChange={setFile}>
                        File
                    </FormFileInput>
                )}

                {isElectron && (
                    <div className="flex flex-col gap-2">
                        <Button
                            label="Choisir le fichier (calcul local rapide)"
                            onClick={handleElectronChooseFile}
                            width="full"
                        />
                        <p className="text-sm text-gray-600">
                            {preOutElectron && preOutElectron.inputPath
                                ? `Fichier sélectionné : ${preOutElectron.inputPath}`
                                : "Aucun fichier sélectionné pour l'instant."}
                        </p>
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
