"use client";

import SponsorContractsListView from "./components/sponsor/SponsorContractsListView";
import DisputeListView from "./components/sponsor/DisputeListView";
import Button from "./components/common/Button";
import { useRouter } from "next/navigation";

export default function Home() {
    const router = useRouter();
    const handleBack = () => {
        router.back();
    };

    return (
        <main className="p-4 min-h-screen">
            <div className="mb-4">
                <Button label="Retour" onClick={handleBack} width="auto" />
            </div>
            <h1 className="text-xl font-bold mb-4">Sponsored fair exchange</h1>

            <div className="flex gap-8 justify-between items-center mb-8">
                <Button
                    label="To user view"
                    onClick={() => router.push("/user")}
                />
                <Button
                    label="Reload data"
                    onClick={() =>
                        window.dispatchEvent(new Event("reloadData"))
                    }
                />
            </div>

            <div className="flex gap-8 my-8">
                <SponsorContractsListView />
                <DisputeListView />
            </div>
        </main>
    );
}
