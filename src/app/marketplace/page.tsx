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
    listing_type?: string;
    preview_image?: string;
    brisque_value?: number | null;
    zk_proof?: string | null;
    zk_proof_full?: string | null;
    zk_h_ct?: string | null;
    zk_c_k?: string | null;
    zk_thumbnail_hash?: string | null;
    preview_hash?: string | null;
};

function BrisqueBadge({ value }: { value: number | null | undefined }) {
    if (value === null || value === undefined) return null;
    const color =
        value < 30
            ? "bg-green-100 text-green-800"
            : value < 60
            ? "bg-yellow-100 text-yellow-800"
            : "bg-red-100 text-red-800";
    const label = value < 30 ? "Good quality" : value < 60 ? "Avg quality" : "Low quality";
    return (
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>
            BRISQUE {value.toFixed(1)} · {label}
        </span>
    );
}

export default function MarketplacePage() {
    const router = useRouter();
    const { user } = useUser();
    const { showToast } = useToast();
    const [listings, setListings] = useState<Listing[]>([]);
    const [requesting, setRequesting] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [verifying, setVerifying] = useState<number | null>(null);

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
            showToast("Please log in first", "warning");
            return;
        }
        if (listing.pk_vendor.toLowerCase() === user.publicKey.toLowerCase()) {
            showToast("You can't buy your own listing", "warning");
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
            showToast("Purchase request sent! The vendor will encrypt the file and send you the contract for review.", "success", 7000);
            await fetchListings();
        } catch (e: any) {
            showToast(`Error: ${e.message}`, "error");
        } finally {
            setRequesting(null);
        }
    };

    const handleVerifyZk = async (listing: Listing) => {
        if (!listing.zk_proof) return;
        setVerifying(listing.id);
        try {
            const res = await fetch("/api/zk/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    proof: listing.zk_proof,
                    proof_full: listing.zk_proof_full ?? null,
                    h_ct: listing.zk_h_ct,
                    preview_hash: listing.preview_hash,
                    brisque: listing.brisque_value ?? null,
                    c_k: listing.zk_c_k,
                    thumbnail_hash: listing.zk_thumbnail_hash ?? null,
                }),
            });
            const data = await res.json();
            if (data.valid) {
                showToast("ZK proof verified successfully.", "success");
            } else {
                showToast(`ZK proof invalid: ${data.reason || "unknown reason"}`, "error");
            }
        } catch (e: any) {
            showToast(`ZK verification error: ${e.message}`, "error");
        } finally {
            setVerifying(null);
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

            {filtered.length === 0 ? (
                <div className="text-center py-24 text-gray-400">
                    <p className="text-xl mb-2">No listings found.</p>
                    <p className="text-sm">
                        {listings.length === 0
                            ? "Log in and go to your dashboard to create a listing."
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
                            {listing.listing_type === "image" && listing.preview_image && (
                                <div className="mb-3 flex justify-center">
                                    <img
                                        src={listing.preview_image}
                                        alt={listing.title}
                                        className="max-h-40 max-w-full object-contain rounded border border-gray-100"
                                    />
                                </div>
                            )}

                            <div className="flex-1">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <h2 className="text-lg font-semibold">{listing.title}</h2>
                                    <div className="flex gap-1 shrink-0">
                                        {listing.listing_type === "image" && (
                                            <>
                                                <BrisqueBadge value={listing.brisque_value} />
                                                {listing.zk_proof ? (
                                                    <button
                                                        onClick={() => handleVerifyZk(listing)}
                                                        disabled={verifying === listing.id}
                                                        className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium hover:bg-blue-200 transition-colors disabled:opacity-50"
                                                        title="Click to verify ZK proof"
                                                    >
                                                        {verifying === listing.id ? "Verifying…" : "ZK ✓"}
                                                    </button>
                                                ) : (
                                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
                                                        ZK —
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                                {listing.description && (
                                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                                        {listing.description}
                                    </p>
                                )}
                                <p className="text-xs text-gray-400 font-mono mb-1">
                                    Vendor: {listing.pk_vendor.slice(0, 10)}…{listing.pk_vendor.slice(-6)}
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
                                        label={requesting === listing.id ? "Sending request…" : "Send request"}
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
