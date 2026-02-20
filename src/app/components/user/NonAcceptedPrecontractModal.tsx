"use client";

import Modal from "../common/Modal";
import Button from "../common/Button";
import { Contract } from "./NonAcceptedPrecontractsListView";
import init from "@/app/lib/crypto_lib";
import { downloadFile, hexToBytes } from "@/app/lib/helpers";

const BLOCK_SIZE = 64;

interface NonAcceptedPrecontractModalProps {
    onClose: () => void;
    contract?: Contract;
}

export default function NonAcceptedPrecontractModal({
    onClose,
    contract,
}: NonAcceptedPrecontractModalProps) {
    if (!contract) return;
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
        accepted,
        sponsor,
        commitment,
        opening_value,
        optimistic_smart_contract,
    } = contract;

    const handleVerifyCommitment = async () => {
        try {
        await init();

            const response = await fetch("/api/precontracts/verify", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ id }),
            });

            // Vérifier le Content-Type pour s'assurer que c'est du JSON
            const contentType = response.headers.get("content-type") || "";
            const text = await response.text();

            if (!response.ok) {
                // Si ce n'est pas OK, essayer de parser le JSON pour obtenir le message d'erreur
                let errorMsg = `Erreur HTTP ${response.status}`;
                if (contentType.includes("application/json")) {
                    try {
                        const errorJson = JSON.parse(text);
                        errorMsg = errorJson.error || errorMsg;
                    } catch (e) {
                        // Si on ne peut pas parser, utiliser le texte brut
                        errorMsg = text ? text.slice(0, 200) : errorMsg;
                    }
                } else {
                    // Si ce n'est pas du JSON, utiliser le texte brut (truncated)
                    errorMsg = text ? text.slice(0, 200) : errorMsg;
                }
                console.error("Erreur /api/precontracts/verify:", text);
                throw new Error(errorMsg);
            }

            if (!text) {
                throw new Error("Réponse vide de /api/precontracts/verify");
            }

            // Maintenant parser le JSON seulement si la réponse est OK
            let parsed: any;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                console.error(
                    "Réponse non JSON de /api/precontracts/verify:",
                    text
                );
                throw new Error(
                    `Réponse invalide de /api/precontracts/verify (attendu JSON): ${text.slice(
                        0,
                        200
                    )}`
                );
            }

            const { success, h_circuit_hex, h_ct_hex } = parsed;

        if (success) {
            if (
                confirm(
                    "Commitment is correct! Do you want to save the encrypted file ?"
                )
            ) {
                    // On peut plus tard renvoyer ct ou un lien vers ct depuis le backend
                    alert(
                        "Commitment correct. Récupération du fichier chiffré à implémenter."
                    );
            }

                localStorage.setItem(
                    `h_circuit_${id}`,
                    h_circuit_hex
                );
                localStorage.setItem(`h_ct_${id}`, h_ct_hex);
        } else {
            alert("!!! Commitment doesn't match the received file !!!");
            }
        } catch (e: any) {
            console.error("Erreur lors de la vérification du commitment:", e);
            alert(`Erreur vérification commitment: ${e.message || e}`);
        }
    };

    const handleAccept = async () => {
        try {
            // Accepter le contrat
            const acceptResponse = await fetch("/api/precontracts/accept", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ id }),
            });

            if (!acceptResponse.ok) {
                throw new Error(`Erreur lors de l'acceptation du contrat: ${acceptResponse.status}`);
            }

            // Télécharger automatiquement le ciphertext
            try {
                const fileResponse = await fetch(`/api/files/${id}`, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                });

                if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    if (fileData.file) {
                        const ctBytes = hexToBytes(fileData.file);
                        downloadFile(ctBytes, `contract_${id}_ciphertext.enc`);
                        console.log(`✅ Ciphertext téléchargé pour le contrat ${id}`);
                    }
                } else {
                    console.warn(`⚠️ Impossible de télécharger le ciphertext pour le contrat ${id}`);
                }
            } catch (downloadError: any) {
                console.warn("⚠️ Erreur lors du téléchargement du ciphertext:", downloadError);
                // Ne pas bloquer l'acceptation si le téléchargement échoue
            }

            window.dispatchEvent(new Event("reloadData"));
            alert(`Accepted contract ${id}. Ciphertext downloaded.`);
            onClose();
        } catch (error: any) {
            console.error("❌ Erreur lors de l'acceptation:", error);
            alert(`Erreur lors de l'acceptation: ${error.message || error}`);
        }
    };

    const handleReject = async () => {
        await fetch("/api/precontracts/reject", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ id }),
        });
        window.dispatchEvent(new Event("reloadData"));
        alert(`Rejected contract ${id}`);
        onClose();
    };

    return (
        <Modal title="Non accepted precontract details" onClose={onClose}>
            <div className="space-y-4 grid grid-cols-2 gap-4">
                <div>
                    <strong>Contract ID:</strong> {id}
                </div>
                <div>
                    <strong>Buyer:</strong> {pk_buyer}
                </div>
                <div>
                    <strong>Vendor:</strong> {pk_vendor}
                </div>
                <div>
                    <strong>Item Description:</strong> {item_description}
                </div>
                <div>
                    <strong>Price:</strong> {price}
                </div>
                <div>
                    <strong>Tip Completion:</strong> {tip_completion}
                </div>
                <div>
                    <strong>Tip Dispute:</strong> {tip_dispute}
                </div>
                <div>
                    <strong>Protocol Version:</strong> {protocol_version}
                </div>
                <div>
                    <strong>Timeout Delay:</strong> {timeout_delay}
                </div>
                <div>
                    <strong>Algorithm Suite:</strong> {algorithm_suite}
                </div>
                <div className="col-span-2">
                    <Button
                        label="Verify commitment"
                        onClick={handleVerifyCommitment}
                    />
                </div>

                <div className="col-span-2 flex gap-8">
                    <Button label="Accept" onClick={handleAccept} width="1/2" />
                    <Button label="Reject" onClick={handleReject} width="1/2" />
                </div>
            </div>
        </Modal>
    );
}
