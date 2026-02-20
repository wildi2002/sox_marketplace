"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";
import NonAcceptedPrecontractModal from "./NonAcceptedPrecontractModal";

export type Contract = {
    id: number;
    pk_buyer: string;
    pk_vendor: string;
    item_description: string;
    price: number;
    tip_completion: number;
    tip_dispute: number;
    protocol_version: number;
    timeout_delay: number;
    algorithm_suite: string;
    commitment: string;
    accepted: number;
    num_blocks: number;
    num_gates: number;
    sponsor: string;
    opening_value: string;
    optimistic_smart_contract?: string;
};

interface NonAcceptedPrecontractsListViewProps {
    publicKey: string;
}

export default function NonAcceptedPrecontractsListView({
    publicKey,
}: NonAcceptedPrecontractsListViewProps) {
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [displayedContract, setDisplayedContract] = useState<Contract>();
    const [modalShown, showModal] = useState(false);

    const fetchContracts = () => {
        fetch(`/api/precontracts?pk=${publicKey}`)
            .then((res) => res.json())
            .then((data) => setContracts(data));
    };

    const handleShowDetails = (c: Contract) => {
        setDisplayedContract(c);
        showModal(true);
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
            <div className="bg-gray-300 p-4 rounded w-1/2 overflow-auto">
                <h2 className="text-lg font-semibold mb-4">
                    Non accepted precontracts
                </h2>

                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2 w-2/10">ID</th>
                            <th className="p-2 w-6/10">Submitted by</th>
                            <th className="p-2 w-2/10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map((c) => (
                            <tr
                                key={c.id}
                                className="even:bg-gray-200 border-b border-black h-15"
                            >
                                <td className="p-2 w-1/3">{c.id}</td>
                                <td className="p-2 w-1/3">{c.pk_vendor}</td>
                                <td className="p-2 w-1/3 text-center">
                                    <Button
                                        label="Show details"
                                        onClick={() => handleShowDetails(c)}
                                        width="95/100"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {modalShown && (
                <NonAcceptedPrecontractModal
                    onClose={() => showModal(false)}
                    contract={displayedContract}
                ></NonAcceptedPrecontractModal>
            )}
        </>
    );
}
