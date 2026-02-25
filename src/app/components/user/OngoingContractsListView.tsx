"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";
import OngoingContractModal from "./OngoingContractModal";
import { useToast } from "@/app/lib/ToastContext";
import { getNextTimeout, getState } from "@/app/lib/blockchain/common";
import { endDisputeTimeout } from "@/app/lib/blockchain/dispute";
import { endOptimisticTimeout } from "@/app/lib/blockchain/optimistic";

export type Contract = {
    id: number;
    pk_buyer: string;
    pk_vendor: string;
    price: number;
    item_description: string;
    tip_completion: number;
    tip_dispute: number;
    protocol_version: number;
    timeout_delay: number;
    algorithm_suite: string;
    sponsor: string;
    commitment: string;
    num_blocks: number;
    num_gates: number;
    optimistic_smart_contract: string;
    opening_value: string;
    session_key_private?: string;
    session_key_address?: string;
    file_name?: string;
    state?: bigint;
    dispute_smart_contract?: string;
    pk_sb?: string;
    pk_sv?: string;
    nextTimeout?: bigint;
};

/*
    WaitPayment,
    WaitKey,
    WaitSB,
    WaitSV,
    InDispute,
    End
*/
export const OPTIMISTIC_STATES = [
    "Waiting for buyer payment",
    "Waiting for vendor key",
    "Key available",
    "Waiting for vendor dispute sponsor",
    "In dispute",
    "Completed",
];

/*
    ChallengeBuyer,
    WaitVendorOpinion,
    WaitVendorData,
    WaitVendorDataLeft,
    WaitVendorDataRight,
    Complete,
    Cancel,
    End
*/
export const DISPUTE_STATES = [
    "Waiting for buyer challenge response",
    "Waiting for vendor opinion",
    "Waiting for vendor argument",
    "Waiting for vendor argument",
    "Waiting for vendor argument",
    "Transaction completed, can be ended",
    "Transaction cancelled, can be ended",
    "Completed",
];

interface OngoingContractsListViewProps {
    publicKey: string;
}

export default function OngoingContractsListView({
    publicKey,
}: OngoingContractsListViewProps) {
    const { showToast } = useToast();
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [displayedContract, setSelectedContract] = useState<Contract>();
    const [modalShown, showModal] = useState(false);

    const fetchContracts = async () => {
        const contractsRaw = await fetch(
            `/api/sponsored-contracts/ongoing?pk=${publicKey}`
        );
        const contracts = await contractsRaw.json();

        for (let i = 0; i < contracts.length; ++i) {
            contracts[i].state = await getState(contracts[i]);
            contracts[i].nextTimeout = await getNextTimeout(contracts[i]);
        }

        setContracts(contracts);
    };

    const handleShowDetails = (c: Contract) => {
        setSelectedContract(c);
        showModal(true);
    };

    const displayState = (c: Contract) => {
        if (c.dispute_smart_contract) {
            return DISPUTE_STATES[Number(c.state)];
        } else {
            return c.state != undefined
                ? OPTIMISTIC_STATES[Number(c.state)]
                : "";
        }
    };

    const reachedTimeout = (c: Contract) => {
        let currDateTime = Math.floor(Date.now() / 1000);
        if (!c.nextTimeout) return false;

        return BigInt(currDateTime) > c.nextTimeout;
    };

    const handleEndTransaction = async (c: Contract) => {
        if (c.dispute_smart_contract) {
            const isCompleted = await endDisputeTimeout(
                c.dispute_smart_contract!,
                publicKey
            );
            showToast(`Dispute ${isCompleted ? "completed" : "cancelled"}.`, isCompleted ? "success" : "info");
            window.dispatchEvent(new Event("reloadData"));
        } else {
            const isCompleted = await endOptimisticTimeout(
                c.optimistic_smart_contract,
                publicKey
            );
            showToast(`Transaction ${isCompleted ? "completed" : "cancelled"}.`, isCompleted ? "success" : "info");
            window.dispatchEvent(new Event("reloadData"));
        }
    };

    useEffect(() => {
        const handleReloadData = () => {
            fetchContracts();
        };

        handleReloadData();
        window.addEventListener("reloadData", handleReloadData);

        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, [publicKey]);

    return (
        <>
            <div className="bg-gray-300 p-4 rounded overflow-auto">
                <h2 className="text-lg font-semibold mb-4">
                    Ongoing Contracts
                </h2>

                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2 w-1/10">ID</th>
                            <th className="p-2 w-5/10">
                                Smart Contract Address
                            </th>
                            <th className="p-2 w-2/10">Status</th>
                            <th className="p-2 w-1/10"></th>
                            <th className="p-2 w-1/10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map((c, i) => {
                            if (
                                (!c.dispute_smart_contract && c.state == 5n) ||
                                (c.dispute_smart_contract && c.state == 7n)
                            ) {
                                return null;
                            }
                            return (
                                <tr
                                    key={c.id}
                                    className="even:bg-gray-200 border-b border-black h-15"
                                >
                                    <td className="p-2 w-1/10">{c.id}</td>
                                    <td className="p-2 w-5/10 text-wrap">
                                        {c.dispute_smart_contract
                                            ? c.dispute_smart_contract
                                            : c.optimistic_smart_contract}
                                    </td>
                                    <td className="p-2 w-2/10 text-wrap">
                                        {displayState(c)}
                                    </td>
                                    <td className="p-2 w-1/10 text-center">
                                        <Button
                                            label="Details"
                                            onClick={() => {
                                                handleShowDetails(c);
                                            }}
                                            width="95/100"
                                        />
                                    </td>
                                    <td className="p-2 w-1/10 text-center">
                                        <Button
                                            label="End"
                                            onClick={() => {
                                                handleEndTransaction(c);
                                            }}
                                            width="95/100"
                                            isDisabled={!reachedTimeout(c)}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {modalShown && (
                <OngoingContractModal
                    onClose={() => showModal(false)}
                    contract={displayedContract}
                    publicKey={publicKey}
                />
            )}
        </>
    );
}
