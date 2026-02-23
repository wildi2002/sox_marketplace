"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../lib/UserContext";
import SponsorContractsListView from "../components/sponsor/SponsorContractsListView";
import DisputeListView from "../components/sponsor/DisputeListView";
import Button from "../components/common/Button";

export default function SponsorDashboard() {
    const { user } = useUser();
    const router = useRouter();

    useEffect(() => {
        if (user && user.role !== "sponsor") router.replace("/user");
        if (!user) router.replace("/");
    }, [user]);

    if (!user || user.role !== "sponsor") return null;

    return (
        <main className="p-6 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">Sponsor Dashboard</h1>
                <Button
                    label="Reload data"
                    onClick={() => window.dispatchEvent(new Event("reloadData"))}
                    width="auto"
                />
            </div>

            <div className="flex gap-8">
                <SponsorContractsListView />
                <DisputeListView />
            </div>
        </main>
    );
}
