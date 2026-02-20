"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";

type Contract = {
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
    accepted: number;
    sponsor: string;
    optimistic_smart_contract?: string;
};

interface UnsponsoredContractsListViewProps {
    publicKey: string;
}

export default function UnsponsoredContractsListView({
    publicKey,
}: UnsponsoredContractsListViewProps) {
    const [contracts, setContracts] = useState<Contract[]>([]);

    const fetchContracts = () => {
        fetch(`/api/unsponsored-contracts?pk=${publicKey}`)
            .then((res) => res.json())
            .then((data) => setContracts(data));
    };

    const deleteOffer = async (id: number) => {
        const response = await (
            await fetch(`/api/unsponsored-contracts/${id}`, {
                method: "DELETE",
            })
        ).json();

        if (response.success)
            alert(`Unsponsored contract ${id} successfully deleted`);
        else
            alert(
                "Something wrong happened when deleting the unsponsored contract"
            );

        window.dispatchEvent(new Event("reloadData"));
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
                    Unsponsored contracts
                </h2>

                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2 w-1/3">ID</th>
                            <th className="p-2 w-1/3">Tip</th>
                            <th className="p-2 w-1/3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map((c, i) => (
                            <tr
                                key={c.id}
                                className="even:bg-gray-200 border-b border-black h-15"
                            >
                                <td className="p-2 w-1/3">{c.id}</td>
                                <td className="p-2 w-1/3">
                                    {c.tip_completion}
                                </td>
                                <td className="p-2 w-1/3 text-center">
                                    <Button
                                        label="Delete"
                                        onClick={() => {
                                            deleteOffer(c.id);
                                        }}
                                        width="95/100"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
