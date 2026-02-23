"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../components/common/Button";
import ChfNote from "../components/common/ChfNote";
import { useUser } from "../lib/UserContext";
import { useToast } from "../lib/ToastContext";

type Listing = {
    id: number;
    title: string;
    description: string;
    price: number;
    tip_completion: number;
    tip_dispute: number;
    pk_vendor: string;
    pending_requests: number;
    created_at: string;
};

export default function MarketplacePage() {
    const router = useRouter();
    const { user } = useUser();
    const { showToast } = useToast();
    const [listings, setListings] = useState<Listing[]>([]);
    const [requesting, setRequesting] = useState<number | null>(null);
    const [search, setSearch] = useState("");

    const fetchListings = async () => {
        const res = await fetch("/api/listings");
        const data = await res.json();
        setListings(data);
    };

    useEffect(() => {
        fetchListings();
    }, []);

    const handleRequest = async (listing: Listing) => {
        if (!user) {
            showToast("Bitte zuerst einloggen", "warning");
            return;
        }
        if (listing.pk_vendor.toLowerCase() === user.publicKey.toLowerCase()) {
            showToast("Du kannst dein eigenes Angebot nicht kaufen", "warning");
            return;
        }

        setRequesting(listing.id);
        try {
            const res = await fetch(`/api/listings/${listing.id}/requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pk_buyer: user.publicKey }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast("Kaufanfrage gesendet! Der Verkäufer wird die Datei verschlüsseln und dir den Vertrag zur Prüfung senden.", "success", 7000);
            await fetchListings();
        } catch (e: any) {
            showToast(`Fehler: ${e.message}`, "error");
        } finally {
            setRequesting(null);
        }
    };

    const filtered = listings.filter(
        (l) =>
            l.title.toLowerCase().includes(search.toLowerCase()) ||
            l.description?.toLowerCase().includes(search.toLowerCase())
    );

    const isOwnListing = (l: Listing) =>
        !!user && l.pk_vendor.toLowerCase() === user.publicKey.toLowerCase();

    return (
        <main className="p-4 min-h-screen">
            {/* Search + stats */}
            <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
                <h1 className="text-2xl font-bold">Marketplace</h1>
                <div className="flex items-center gap-3 flex-wrap">
                    <input
                        type="text"
                        placeholder="Search listings…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm w-56"
                    />
                    <span className="text-gray-500 text-sm">
                        {filtered.length} listing{filtered.length !== 1 ? "s" : ""}
                    </span>
                    <Button label="Refresh" onClick={fetchListings} width="auto" />
                </div>
            </div>

            {/* Listings grid */}
            {filtered.length === 0 ? (
                <div className="text-center py-24 text-gray-400">
                    <p className="text-xl mb-2">No listings found.</p>
                    <p className="text-sm">
                        {listings.length === 0
                            ? "Log in as a user and go to your dashboard to post a listing."
                            : "Try a different search term."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((listing) => (
                        <div
                            key={listing.id}
                            className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm flex flex-col hover:shadow-md transition-shadow"
                        >
                            <div className="flex-1">
                                <h2 className="text-lg font-semibold mb-1">{listing.title}</h2>
                                {listing.description && (
                                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                                        {listing.description}
                                    </p>
                                )}
                                <p className="text-xs text-gray-400 font-mono mb-1">
                                    Seller: {listing.pk_vendor.slice(0, 10)}…{listing.pk_vendor.slice(-6)}
                                </p>
                                {listing.tip_completion > 0 && (
                                    <p className="text-xs text-gray-400">
                                        Completion tip: {listing.tip_completion} ETH
                                    </p>
                                )}
                            </div>

                            <div className="border-t border-gray-100 pt-4 mt-4 flex justify-between items-center">
                                <div>
                                    <span className="text-2xl font-bold text-gray-800">
                                        {listing.price} ETH
                                    </span>
                                    <ChfNote value={listing.price} display="block" />
                                </div>

                                {isOwnListing(listing) ? (
                                    <span className="text-xs text-gray-400 italic bg-gray-100 px-2 py-1 rounded">
                                        Your listing
                                    </span>
                                ) : !user ? (
                                    <span className="text-xs text-gray-400">Log in to buy</span>
                                ) : (
                                    <Button
                                        label={requesting === listing.id ? "Requesting…" : "Request to Buy"}
                                        onClick={() => handleRequest(listing)}
                                        width="auto"
                                        isDisabled={requesting === listing.id}
                                    />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
