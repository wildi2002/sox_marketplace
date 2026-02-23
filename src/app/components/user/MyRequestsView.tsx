"use client";

import { useEffect, useState } from "react";
import ChfNote from "../common/ChfNote";

type PurchaseRequest = {
    id: number;
    listing_id: number;
    pk_buyer: string;
    status: string;
    contract_id: number | null;
    created_at: string;
    title: string;
    description: string;
    price: number;
    pk_vendor: string;
};

interface MyRequestsViewProps {
    publicKey: string;
}

export default function MyRequestsView({ publicKey }: MyRequestsViewProps) {
    const [requests, setRequests] = useState<PurchaseRequest[]>([]);

    const fetchRequests = async () => {
        const res = await fetch(`/api/purchase-requests?pk=${publicKey}`);
        const data = await res.json();
        setRequests(data);
    };

    useEffect(() => {
        const handler = () => fetchRequests();
        handler();
        window.addEventListener("reloadData", handler);
        return () => window.removeEventListener("reloadData", handler);
    }, [publicKey]);

    return (
        <div className="bg-gray-300 p-4 rounded w-full overflow-auto">
            <h2 className="text-lg font-semibold mb-4">My Purchase Requests</h2>

            {requests.length === 0 ? (
                <p className="text-gray-500 text-sm">No purchase requests yet.</p>
            ) : (
                <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2">Listing</th>
                            <th className="p-2">Price</th>
                            <th className="p-2">Vendor</th>
                            <th className="p-2">Status</th>
                            <th className="p-2">Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {requests.map((req) => (
                            <tr key={req.id} className="even:bg-gray-200 border-b border-black">
                                <td className="p-2 font-medium truncate">{req.title}</td>
                                <td className="p-2">{req.price} ETH<ChfNote value={req.price} /></td>
                                <td className="p-2 font-mono text-xs">
                                    {req.pk_vendor.slice(0, 8)}…{req.pk_vendor.slice(-6)}
                                </td>
                                <td className="p-2">
                                    <span
                                        className={`px-2 py-0.5 rounded text-xs ${
                                            req.status === "pending"
                                                ? "bg-yellow-200"
                                                : req.status === "fulfilled"
                                                ? "bg-green-200"
                                                : "bg-red-200"
                                        }`}
                                    >
                                        {req.status}
                                        {req.status === "fulfilled" && req.contract_id
                                            ? ` → Contract #${req.contract_id}`
                                            : ""}
                                    </span>
                                </td>
                                <td className="p-2 text-xs text-gray-500">
                                    {new Date(req.created_at).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
