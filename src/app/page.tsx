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
    const [userPk, setUserPk] = useState(ALL_PUBLIC_KEYS[0]);
    const [sponsorPk, setSponsorPk] = useState(ALL_PUBLIC_KEYS[0]);

    const handleUserLogin = () => {
        login(userPk, "user");
        router.push("/user");
    };

    const handleSponsorLogin = () => {
        login(sponsorPk, "sponsor");
        router.push("/sponsor");
    };

    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-8">
            <h1 className="text-4xl font-bold mb-2 tracking-tight">SOX Marketplace</h1>
            <p className="text-gray-500 mb-14 text-center max-w-md">
                Secure fair-exchange protocol — choose how you want to participate.
            </p>

            <div className="flex gap-8 flex-wrap justify-center">
                {/* User card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-8 w-80 shadow-sm flex flex-col gap-5">
                    <div>
                        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                            User
                        </span>
                        <h2 className="text-xl font-semibold mt-3 mb-1">Continue as User</h2>
                        <p className="text-sm text-gray-500">
                            Browse the marketplace, buy and sell products, and manage your contracts.
                        </p>
                    </div>
                    <FormSelect
                        id="user-pk"
                        value={userPk}
                        onChange={setUserPk}
                        options={ALL_PUBLIC_KEYS}
                    >
                        Account
                    </FormSelect>
                    <Button label="Login as User" onClick={handleUserLogin} />
                </div>

                {/* Sponsor card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-8 w-80 shadow-sm flex flex-col gap-5">
                    <div>
                        <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                            Sponsor
                        </span>
                        <h2 className="text-xl font-semibold mt-3 mb-1">Continue as Sponsor</h2>
                        <p className="text-sm text-gray-500">
                            Sponsor contracts and disputes on a first-come, first-served basis.
                            Any account can be a sponsor.
                        </p>
                    </div>
                    <FormSelect
                        id="sponsor-pk"
                        value={sponsorPk}
                        onChange={setSponsorPk}
                        options={ALL_PUBLIC_KEYS}
                    >
                        Account
                    </FormSelect>
                    <Button label="Login as Sponsor" onClick={handleSponsorLogin} />
                </div>
            </div>
        </main>
    );
}
