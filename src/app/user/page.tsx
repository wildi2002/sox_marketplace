"use client";

import Button from "../components/common/Button";
import { useRouter } from "next/navigation";
import OngoingContractsListView from "../components/user/OngoingContractsListView";
import { useEffect, useState } from "react";
import NewContractModal from "../components/user/NewContractModal";
import UnsponsoredContractsListView from "../components/user/UnsponsoredContractsListView";
import NonAcceptedPrecontractsListView from "../components/user/NonAcceptedPrecontractsListView";
import MyRequestsView from "../components/user/MyRequestsView";
import { useUser } from "../lib/UserContext";

export default function UserDashboard() {
    const router = useRouter();
    const { user } = useUser();

    const [modalNewContractShown, showModalNewContract] = useState(false);

    useEffect(() => {
        if (!user) router.replace("/");
    }, [user]);

    if (!user) return null;

    const publicKey = user.publicKey;

    return (
        <main className="p-4 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">My Dashboard</h1>
                <div className="flex gap-3">
                    <Button
                        label="+ New Contract (direct)"
                        onClick={() => showModalNewContract(true)}
                        width="auto"
                    />
                    <Button
                        label="Refresh"
                        onClick={() => window.dispatchEvent(new Event("reloadData"))}
                        width="auto"
                    />
                </div>
            </div>

            <div className="flex gap-8 mb-8">
                <NonAcceptedPrecontractsListView publicKey={publicKey} />
                <UnsponsoredContractsListView publicKey={publicKey} />
            </div>

            <div className="mb-8">
                <MyRequestsView publicKey={publicKey} />
            </div>

            <div className="flex gap-8">
                <OngoingContractsListView publicKey={publicKey} />
            </div>

            {modalNewContractShown && (
                <NewContractModal
                    title="New Contract"
                    vendorPk={publicKey}
                    onClose={() => showModalNewContract(false)}
                />
            )}
        </main>
    );
}
