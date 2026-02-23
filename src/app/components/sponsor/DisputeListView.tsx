"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import SponsorModal from "./SponsorModal";
import DisputeSimulationModal from "./DisputeSimulationModal";
import FormSelect from "../common/FormSelect";
import { ALL_PUBLIC_KEYS } from "@/app/lib/blockchain/config";
import init, { check_argument, hex_to_bytes } from "@/app/lib/crypto_lib";
import ChfNote from "../common/ChfNote";
import { useToast } from "@/app/lib/ToastContext";
import {
    getBasicInfo,
    sendSbFee,
    sendSvFee,
} from "@/app/lib/blockchain/optimistic";
import { downloadFile } from "@/app/lib/helpers";

type Dispute = {
    contract_id: number;
    optimistic_smart_contract: string;
    tip_dispute: number;
    pk_buyer_sponsor?: string;
    pk_vendor_sponsor?: string;
    dispute_smart_contract?: string;
    pk_buyer?: string;
    pk_vendor?: string;
    num_blocks?: number;
    num_gates?: number;
};

export default function DisputeListView() {
    const [modalProofShown, showModalProof] = useState(false);
    const [modalSponsorShown, showModalSponsor] = useState(false);
    const [modalSimulationShown, showModalSimulation] = useState(false);
    const [sponsorType, setSponsorType] = useState<"buyer" | "vendor" | null>(null);
    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [selectedDispute, setSelectedDispute] = useState<Dispute>();
    const [publicKey, setPublicKey] = useState<string>(ALL_PUBLIC_KEYS[0]);
    const { showToast } = useToast();

    const fetchDisputes = () => {
        fetch("/api/disputes")
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                const contentType = res.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    throw new Error("Response is not JSON");
                }
                return res.text().then((text) => {
                    if (!text || text.trim() === "") {
                        return [];
                    }
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        console.error("Error parsing JSON:", e, "Response text:", text);
                        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
                    }
                });
            })
            .then((data) => {
                if (Array.isArray(data)) {
                    setDisputes(data);
                } else {
                    console.error("Expected array but got:", data);
                    setDisputes([]);
                }
            })
            .catch((error) => {
                console.error("Error fetching disputes:", error);
                setDisputes([]);
            });
    };

    useEffect(() => {
        fetchDisputes();

        // Listen for the reloadData event
        const handleReloadData = () => {
            fetchDisputes();
        };

        window.addEventListener("reloadData", handleReloadData);

        // Clean up the event listener on component unmount
        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, []);

    const handleSponsorConfirmation = async (pk: string) => {
        if (!selectedDispute || !sponsorType) {
            console.error("Missing dispute or sponsor type");
            return;
        }

        // Vérifier si le sponsor est déjà enregistré
        const alreadyRegistered = sponsorType === "buyer"
            ? !!selectedDispute.pk_buyer_sponsor
            : !!selectedDispute.pk_vendor_sponsor;

        if (alreadyRegistered) {
            showToast(`Der ${sponsorType === "buyer" ? "Käufer" : "Verkäufer"}-Sponsor ist für diesen Vertrag bereits registriert.`, "warning");
            return;
        }

        const isVendor = sponsorType === "vendor";
        let disputeContractAddress: string | undefined;

        if (isVendor) {
            disputeContractAddress = await sendSvFee(
                pk,
                selectedDispute.optimistic_smart_contract
            );
        } else {
            await sendSbFee(pk, selectedDispute.optimistic_smart_contract);
        }

        showToast(
            `${sponsorType === "buyer" ? "Käufer" : "Verkäufer"}-Sponsor für Vertrag ${selectedDispute.contract_id} registriert!${
                isVendor && disputeContractAddress
                    ? `\nDisput-Vertrag deployed: ${disputeContractAddress}`
                    : ""
            }`, "success"
        );

        fetchDisputes();
    };

    const handleClickCheckArgument = async () => {
        await init();

        if (!selectedDispute) {
            showToast("Ein unerwarteter Fehler ist aufgetreten.", "error");
            showModalProof(false);
            return;
        }

        const isVendor = !!selectedDispute.pk_buyer_sponsor;
        let endpoint = "/api/arguments/buyer";
        if (isVendor) {
            endpoint = "/api/arguments/vendor";
        }

        try {
            const response = await fetch(`${endpoint}/${selectedDispute.contract_id}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Response is not JSON");
            }
            const text = await response.text();
            if (!text || text.trim() === "") {
                throw new Error("Empty response from server");
            }
            const data = JSON.parse(text);
            const { argument: argument_hex, description } = data;

            const { key, commitment } = (await getBasicInfo(
                selectedDispute.optimistic_smart_contract
            ))!;

            console.log(argument_hex);
            const argument = hex_to_bytes(argument_hex);
            console.log(argument);
            const result = check_argument(argument, commitment, description, key);

            // yandere dev core
            if (result.error) {
                showToast(`Fehler: ${result.error}`, "error");
            } else if (!result.is_valid) {
                showToast(
                    `Argument ist UNGÜLTIG!\nDer ${isVendor ? "Verkäufer" : "Käufer"} könnte gelogen haben.`,
                    "error"
                );
            } else if (result.supports_buyer) {
                showToast(
                    isVendor
                        ? "Verkäufer hat ein Argument eingereicht, das ihn NICHT unterstützt!"
                        : "Käufer hat ein Argument eingereicht, das ihn unterstützt.",
                    isVendor ? "error" : "success"
                );
            } else {
                showToast(
                    isVendor
                        ? "Verkäufer hat ein Argument eingereicht, das ihn unterstützt."
                        : "Käufer hat ein Argument eingereicht, das ihn NICHT unterstützt!",
                    isVendor ? "success" : "error"
                );
            }
        } catch (error: any) {
            console.error("Error checking argument:", error);
            showToast(`Fehler bei der Argumentprüfung: ${error?.message || "Unbekannter Fehler"}`, "error");
        } finally {
            showModalProof(false);
        }
    };

    const handleClickDownloadArgument = async (dispute: Dispute) => {
        try {
            await init();

            const isVendor = !!dispute.pk_buyer_sponsor;
            let endpoint = "/api/arguments/buyer";
            if (isVendor) {
                endpoint = "/api/arguments/vendor";
            }

            const response = await fetch(`${endpoint}/${dispute.contract_id}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Response is not JSON");
            }
            const text = await response.text();
            if (!text || text.trim() === "") {
                throw new Error("Empty response from server");
            }
            const data = JSON.parse(text);
            const { argument: argument_hex } = data;
            
            downloadFile(
                hex_to_bytes(argument_hex),
                `${dispute.contract_id}_argument_${
                    isVendor ? "vendor" : "buyer"
                }.bin`
            );
        } catch (error: any) {
            console.error("Error downloading argument:", error);
            showToast(`Fehler beim Herunterladen des Arguments: ${error?.message || "Unbekannter Fehler"}`, "error");
        }
    };

    return (
        <div className="bg-gray-300 p-4 rounded w-1/2 overflow-auto">
            <h2 className="text-lg font-semibold mb-4">Disputes</h2>
            {disputes.length === 0 ? (
                <p className="text-gray-600 text-center py-4">No disputes yet.</p>
            ) : (
            <table className="w-full table-fixed border-collapse">
                <thead>
                    <tr className="border-b border-black text-left font-medium">
                        <th className="p-2 w-12">ID</th>
                        <th className="p-2 w-28">Tip</th>
                        <th className="p-2">Buyer Sponsor</th>
                        <th className="p-2">Vendor Sponsor</th>
                        <th className="p-2 w-32">Check</th>
                        <th className="p-2 w-24">Download</th>
                        <th className="p-2 w-24">Simulate</th>
                    </tr>
                </thead>
                <tbody>
                    {disputes.map((d) => (
                        <tr
                            key={d.contract_id}
                            className="even:bg-gray-200 border-b border-black h-15"
                        >
                            <td className="p-2">{d.contract_id}</td>
                            <td className="p-2">{d.tip_dispute} ETH<ChfNote value={d.tip_dispute} /></td>
                            <td className="p-2">
                                {d.pk_buyer_sponsor ? (
                                    <span className="text-green-600 text-sm">✓ {d.pk_buyer_sponsor.slice(0, 10)}...</span>
                                ) : (
                                    <Button
                                        label="Select"
                                        onClick={() => {
                                            setSelectedDispute(d);
                                            setSponsorType("buyer");
                                            showModalSponsor(true);
                                        }}
                                        width="full"
                                    />
                                )}
                            </td>
                            <td className="p-2">
                                {d.pk_vendor_sponsor ? (
                                    <span className="text-green-600 text-sm">✓ {d.pk_vendor_sponsor.slice(0, 10)}...</span>
                                ) : (
                                    <Button
                                        label="Select"
                                        onClick={() => {
                                            setSelectedDispute(d);
                                            setSponsorType("vendor");
                                            showModalSponsor(true);
                                        }}
                                        width="full"
                                    />
                                )}
                            </td>
                            <td className="p-2 text-center">
                                <Button
                                    label="Check argument"
                                    onClick={() => {
                                        setSelectedDispute(d);
                                        showModalProof(true);
                                    }}
                                    width="full"
                                />
                            </td>
                            <td className="p-2 text-center">
                                <Button
                                    label="Download"
                                    onClick={() => handleClickDownloadArgument(d)}
                                    width="full"
                                />
                            </td>
                            <td className="p-2 text-center">
                                {d.dispute_smart_contract && d.optimistic_smart_contract && d.pk_buyer && d.pk_vendor && d.num_blocks && d.num_gates && (
                                    <Button
                                        label="Simulate"
                                        onClick={() => {
                                            setSelectedDispute(d);
                                            showModalSimulation(true);
                                        }}
                                        width="full"
                                    />
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            )}

            {modalProofShown && (
                <Modal
                    onClose={() => showModalProof(false)}
                    title="Check argument"
                >
                    <div className="flex gap-8 justify-between items-center">
                        <Button
                            label="Check here"
                            onClick={handleClickCheckArgument}
                        />
                    </div>
                    <br />
                    <div className="flex gap-8 justify-between items-center">
                        <Button
                            label="Download argument"
                            onClick={handleClickDownloadArgument}
                            width="full"
                        />
                    </div>
                </Modal>
            )}

            {modalSponsorShown && sponsorType && (
                <SponsorModal
                    title={`Sponsor for ${sponsorType === "buyer" ? "Buyer" : "Vendor"}`}
                    onClose={() => {
                        showModalSponsor(false);
                        setSponsorType(null);
                    }}
                    onConfirm={handleSponsorConfirmation}
                    id_prefix={`dispute-${sponsorType}`}
                />
            )}

            {modalSimulationShown && selectedDispute && selectedDispute.dispute_smart_contract && selectedDispute.optimistic_smart_contract && selectedDispute.pk_buyer && selectedDispute.pk_vendor && selectedDispute.num_blocks && selectedDispute.num_gates && (
                <DisputeSimulationModal
                    onClose={() => {
                        showModalSimulation(false);
                        setSelectedDispute(undefined);
                    }}
                    disputeContract={selectedDispute.dispute_smart_contract}
                    optimisticContract={selectedDispute.optimistic_smart_contract}
                    publicKey={publicKey || selectedDispute.pk_buyer_sponsor || selectedDispute.pk_vendor_sponsor || ""}
                    pkBuyer={selectedDispute.pk_buyer}
                    pkVendor={selectedDispute.pk_vendor}
                    numBlocks={selectedDispute.num_blocks}
                    numGates={selectedDispute.num_gates}
                />
            )}
        </div>
    );
}
