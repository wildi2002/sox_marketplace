"use client";

import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../lib/UserContext";
import SponsorContractsListView from "../components/sponsor/SponsorContractsListView";
import DisputeListView from "../components/sponsor/DisputeListView";
import Button from "../components/common/Button";

function SponsorDashboardContent() {
    const { user } = useUser();
    const router = useRouter();

    useEffect(() => {
        if (!user) router.replace("/");
    }, [user]);

    if (!user) return null;

    return (
        <main className="p-6 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">Sponsor Dashboard</h1>
                <Button
                    label="Refresh"
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

export default function SponsorDashboard() {
    return (
        <Suspense>
            <SponsorDashboardContent />
        </Suspense>
    );
}
