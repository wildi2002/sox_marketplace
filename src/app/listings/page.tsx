"use client";

import Button from "../components/common/Button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MyListingsView from "../components/user/MyListingsView";
import PostListingModal from "../components/user/PostListingModal";
import { useUser } from "../lib/UserContext";

export default function ListingsPage() {
    const router = useRouter();
    const { user } = useUser();
    const [modalPostListingShown, showModalPostListing] = useState(false);

    useEffect(() => {
        if (!user) router.replace("/");
    }, [user]);

    if (!user) return null;

    return (
        <main className="p-4 min-h-screen">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">My Listings</h1>
                <div className="flex gap-3">
                    <Button
                        label="+ New Listing"
                        onClick={() => showModalPostListing(true)}
                        width="auto"
                    />
                    <Button
                        label="Refresh"
                        onClick={() => window.dispatchEvent(new Event("reloadData"))}
                        width="auto"
                    />
                </div>
            </div>

            <MyListingsView publicKey={user.publicKey} />

            {modalPostListingShown && (
                <PostListingModal
                    vendorPk={user.publicKey}
                    onClose={() => showModalPostListing(false)}
                />
            )}
        </main>
    );
}
