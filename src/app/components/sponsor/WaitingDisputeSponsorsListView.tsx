"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";
import { sendSbFee, sendSvFee } from "@/app/lib/blockchain/optimistic";
import ChfNote from "../common/ChfNote";
import { useUser } from "@/app/lib/UserContext";
import { useToast } from "@/app/lib/ToastContext";

type WaitingContract = {
    id: number;
    optimistic_smart_contract: string;
    pk_buyer: string;
    pk_vendor: string;
    tip_dispute: number;
    state: number;
    stateName: "WaitSB" | "WaitSV";
    pk_buyer_sponsor?: string;
    pk_vendor_sponsor?: string;
};

export default function WaitingDisputeSponsorsListView() {
    const { user } = useUser();
    const { showToast } = useToast();
    const [contracts, setContracts] = useState<WaitingContract[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchContracts = () => {
        fetch("/api/sponsored-contracts/waiting-dispute-sponsors")
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data)) {
                    setContracts(data);
                } else {
                    console.error("Expected array but got:", data);
                    setContracts([]);
                }
            })
            .catch((error) => {
                console.error("Error fetching contracts:", error);
                setContracts([]);
            });
    };

    useEffect(() => {
        fetchContracts();

        const handleReloadData = () => {
            fetchContracts();
        };

        window.addEventListener("reloadData", handleReloadData);

        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, []);

    const handleSendFee = async (contract: WaitingContract) => {
        const publicKey = user?.publicKey;
        if (!publicKey) {
            showToast("Not logged in.", "error");
            return;
        }
        try {
            setIsLoading(true);

            if (contract.stateName === "WaitSB") {
                await sendSbFee(publicKey, contract.optimistic_smart_contract);
                showToast(`Buyer sponsor fee for contract ${contract.id} sent!`, "success");
            } else if (contract.stateName === "WaitSV") {
                const disputeContract = await sendSvFee(
                    publicKey,
                    contract.optimistic_smart_contract
                );
                showToast(
                    `Vendor sponsor fee for contract ${contract.id} sent!\nDispute contract deployed: ${disputeContract}`,
                    "success"
                );
            }

            window.dispatchEvent(new Event("reloadData"));
        } catch (e: any) {
            showToast(`Error: ${e?.message || "Fee could not be sent"}`, "error");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-gray-300 p-4 rounded w-1/2 overflow-auto">
            <h2 className="text-lg font-semibold mb-4">
                Contracts awaiting dispute sponsor
            </h2>

            {contracts.length === 0 ? (
                <p className="text-gray-600 text-center py-4">
                    No contracts awaiting a dispute sponsor.
                </p>
            ) : (
                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2 w-1/6">ID</th>
                            <th className="p-2 w-1/6">Contract</th>
                            <th className="p-2 w-1/6">Status</th>
                            <th className="p-2 w-1/6">Dispute Tip</th>
                            <th className="p-2 w-1/6">Required Sponsor</th>
                            <th className="p-2 w-1/6">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map((c) => (
                            <tr
                                key={c.id}
                                className="even:bg-gray-200 border-b border-black h-15"
                            >
                                <td className="p-2 w-1/6">{c.id}</td>
                                <td className="p-2 w-1/6 text-xs break-all">
                                    {c.optimistic_smart_contract.slice(0, 10)}...
                                </td>
                                <td className="p-2 w-1/6">
                                    <span
                                        className={`px-2 py-1 rounded text-xs ${
                                            c.stateName === "WaitSB"
                                                ? "bg-blue-100 text-blue-800"
                                                : "bg-yellow-100 text-yellow-800"
                                        }`}
                                    >
                                        {c.stateName === "WaitSB"
                                            ? "Waiting for buyer sponsor"
                                            : "Waiting for vendor sponsor"}
                                    </span>
                                </td>
                                <td className="p-2 w-1/6">{c.tip_dispute} ETH<ChfNote value={c.tip_dispute} /></td>
                                <td className="p-2 w-1/6 text-xs">
                                    {c.stateName === "WaitSB"
                                        ? c.pk_buyer_sponsor
                                            ? `✓ ${c.pk_buyer_sponsor.slice(0, 10)}...`
                                            : "Not set"
                                        : c.pk_vendor_sponsor
                                        ? `✓ ${c.pk_vendor_sponsor.slice(0, 10)}...`
                                        : "Not set"}
                                </td>
                                <td className="p-2 w-1/6 text-center">
                                    <Button
                                        label={
                                            c.stateName === "WaitSB"
                                                ? "Sponsor buyer"
                                                : "Sponsor vendor"
                                        }
                                        onClick={() => handleSendFee(c)}
                                        width="full"
                                        isDisabled={isLoading}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
