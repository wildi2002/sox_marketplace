"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "./lib/UserContext";
import FormSelect from "./components/common/FormSelect";
import Button from "./components/common/Button";
import { ALL_PUBLIC_KEYS } from "./lib/blockchain/config";

export default function LandingPage() {
    const { login } = useUser();
    const router = useRouter();
    const [pk, setPk] = useState(ALL_PUBLIC_KEYS[0]);

    const handleLogin = () => {
        login(pk);
        router.push("/marketplace");
    };

    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-8">
            <h1 className="text-4xl font-bold mb-2 tracking-tight">SOX Marketplace</h1>
            <p className="text-gray-500 mb-14 text-center max-w-md">
                Secure fair-exchange protocol — buy, sell, and sponsor contracts.
            </p>

            <div className="bg-white border border-gray-200 rounded-2xl p-8 w-80 shadow-sm flex flex-col gap-5">
                <div>
                    <div className="flex gap-2 mb-3">
                        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">User</span>
                        <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2.5 py-1 rounded-full">Sponsor</span>
                    </div>
                    <h2 className="text-xl font-semibold mb-1">Login</h2>
                    <p className="text-sm text-gray-500">
                        Browse the marketplace, manage contracts, and sponsor others as needed.
                    </p>
                </div>
                <FormSelect
                    id="pk"
                    value={pk}
                    onChange={setPk}
                    options={ALL_PUBLIC_KEYS}
                >
                    Account
                </FormSelect>
                <Button label="Login" onClick={handleLogin} />
            </div>
        </main>
    );
}
