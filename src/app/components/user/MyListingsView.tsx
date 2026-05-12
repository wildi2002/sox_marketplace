"use client";

import { useEffect, useState } from "react";
import Button from "../common/Button";
import NewContractModal from "./NewContractModal";
import ChfNote from "../common/ChfNote";

type Listing = {
    id: number;
    title: string;
    description: string;
    price: number;
    tip_completion: number;
    tip_dispute: number;
    timeout_delay: number;
    algorithm_suite: string;
    pk_vendor: string;
    pending_requests: number;
    listing_type?: string;
    preview_image?: string | null;
    preview_hash?: string | null;
    brisque_value?: number | null;
    created_at?: string | null;
    zk_proof?: string | null;
    zk_proof_full?: string | null;
    zk_h_pt?: string | null;
    zk_thumbnail_hash?: string | null;
    zk_brisque?: number | null;
    zk_vk_hash?: string | null;
    ext_img_thumb_hash?: string | null;
    ext_img_width?: number | null;
    ext_img_height?: number | null;
    ext_img_size?: number | null;
    preview_audio?: string | null;
    ext_audio_preview_hash?: string | null;
    ext_audio_duration?: number | null;
    ext_audio_bitrate?: number | null;
    ext_audio_size?: number | null;
    preview_crop_image?: string | null;
    ext_img_crop_hash?: string | null;
    ext_img_crop_x?: number | null;
    ext_img_crop_y?: number | null;
    preview_audio_lowres?: string | null;
    ext_audio_lowres_hash?: string | null;
    ext_audio_preview_sr?: number | null;
    ext_audio_lowres_sr?: number | null;
    preview_video_thumb?: string | null;
    ext_video_thumb_hash?: string | null;
    preview_video_clip?: string | null;
    ext_video_clip_hash?: string | null;
    ext_video_width?: number | null;
    ext_video_height?: number | null;
    ext_video_duration?: number | null;
    ext_video_bitrate?: number | null;
    ext_video_size?: number | null;
    ext_video_fps?: number | null;
    ext_video_clip_frames?: number | null;
};

type PurchaseRequest = {
    id: number;
    listing_id: number;
    pk_buyer: string;
    status: string;
    contract_id: number | null;
    created_at: string;
};

type FulfillTarget = {
    buyerPk: string;
    requestId: number;
    listing: Listing;
};

interface MyListingsViewProps {
    publicKey: string;
}

export default function MyListingsView({ publicKey }: MyListingsViewProps) {
    const [listings, setListings] = useState<Listing[]>([]);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [requests, setRequests] = useState<Record<number, PurchaseRequest[]>>({});
    const [fulfillTarget, setFulfillTarget] = useState<FulfillTarget | null>(null);

    const fetchListings = async () => {
        // include_pending=1 so vendor sees ZK listings still generating their proof
        const res = await fetch("/api/listings?include_pending=1");
        const data = await res.json();
        setListings(
            (data as Listing[]).filter(
                (l) => l.pk_vendor.toLowerCase() === publicKey.toLowerCase()
            )
        );
    };

    const fetchRequests = async (listingId: number) => {
        const res = await fetch(`/api/listings/${listingId}/requests?pk=${publicKey}`);
        const data = await res.json();
        setRequests((prev) => ({ ...prev, [listingId]: data }));
    };

    const toggleListing = async (id: number) => {
        if (expandedId === id) {
            setExpandedId(null);
        } else {
            setExpandedId(id);
            await fetchRequests(id);
        }
    };

    const deleteListing = async (id: number) => {
        if (!confirm("Remove this listing from the marketplace?")) return;
        await fetch(`/api/listings/${id}?pk=${publicKey}`, { method: "DELETE" });
        window.dispatchEvent(new Event("reloadData"));
    };

    const rejectRequest = async (reqId: number, listingId: number) => {
        await fetch(`/api/purchase-requests/${reqId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "rejected" }),
        });
        await fetchRequests(listingId);
    };

    useEffect(() => {
        const handler = () => fetchListings();
        handler();
        window.addEventListener("reloadData", handler);
        // Poll every 30s so ZK-pending listings update automatically when proof finishes
        const interval = setInterval(handler, 30_000);
        return () => {
            window.removeEventListener("reloadData", handler);
            clearInterval(interval);
        };
    }, [publicKey]);

    return (
        <div className="bg-gray-300 p-4 rounded w-full overflow-auto">
            <h2 className="text-lg font-semibold mb-4">My Listings</h2>

            {listings.length === 0 && (
                <p className="text-gray-500 text-sm">No listings yet. Post one to start selling.</p>
            )}

            <div className="space-y-2">
                {listings.map((listing) => (
                    <div key={listing.id} className="bg-gray-100 rounded p-3">
                        <div className="flex justify-between items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <span className="font-medium">{listing.title}</span>
                                <span className="ml-3 text-sm text-gray-600">{listing.price} ETH<ChfNote value={listing.price} /></span>
                                {listing.algorithm_suite === "zk" ? (
                                    listing.zk_proof ? (
                                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">ZK Proof (SP1) ✓</span>
                                    ) : (
                                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-medium">
                                            ZK Proof: Generating…{listing.created_at ? ` (${Math.round((Date.now() - new Date(listing.created_at).getTime()) / 60000)} min)` : ""}
                                        </span>
                                    )
                                ) : listing.listing_type === "image" && listing.algorithm_suite === "extended_image" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Thumb (256×256)</span>
                                ) : listing.listing_type === "image" && listing.algorithm_suite === "extended_image_crop" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Crop (native-res)</span>
                                ) : listing.listing_type === "image" && listing.algorithm_suite === "extended_image_dual" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Thumb + Crop</span>
                                ) : listing.listing_type === "image" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">Hash Commitment</span>
                                ) : listing.listing_type === "audio" && listing.algorithm_suite === "extended_audio" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">
                                        Audio preview{listing.ext_audio_duration != null ? ` · ${listing.ext_audio_duration}s` : ""}
                                    </span>
                                ) : listing.listing_type === "audio" && listing.algorithm_suite === "extended_audio_lowres" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">
                                        Audio low-res{listing.ext_audio_duration != null ? ` · ${listing.ext_audio_duration}s` : ""}
                                    </span>
                                ) : listing.listing_type === "audio" && listing.algorithm_suite === "extended_audio_both" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">
                                        Audio preview+lowres{listing.ext_audio_duration != null ? ` · ${listing.ext_audio_duration}s` : ""}
                                    </span>
                                ) : listing.listing_type === "audio" ? (
                                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">Audio</span>
                                ) : null}
                                {listing.pending_requests > 0 && (
                                    <span className="ml-2 bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">
                                        {listing.pending_requests} pending
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Button
                                    label={expandedId === listing.id ? "Hide" : "Requests"}
                                    onClick={() => toggleListing(listing.id)}
                                    width="auto"
                                />
                                <Button
                                    label="Remove"
                                    onClick={() => deleteListing(listing.id)}
                                    width="auto"
                                />
                            </div>
                        </div>

                        {expandedId === listing.id && (
                            <div className="mt-3 border-t border-gray-300 pt-3">
                                {!requests[listing.id] ? (
                                    <p className="text-sm text-gray-500">Loading...</p>
                                ) : requests[listing.id].length === 0 ? (
                                    <p className="text-sm text-gray-500">No purchase requests yet.</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-300 text-left">
                                                <th className="p-1">Buyer</th>
                                                <th className="p-1">Status</th>
                                                <th className="p-1">Date</th>
                                                <th className="p-1"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {requests[listing.id].map((req) => (
                                                <tr key={req.id} className="border-b border-gray-200">
                                                    <td className="p-1 font-mono text-xs">
                                                        {req.pk_buyer.slice(0, 10)}…{req.pk_buyer.slice(-6)}
                                                    </td>
                                                    <td className="p-1">
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
                                                        </span>
                                                    </td>
                                                    <td className="p-1 text-xs text-gray-500">
                                                        {new Date(req.created_at).toLocaleDateString()}
                                                    </td>
                                                    <td className="p-1">
                                                        {req.status === "pending" && (
                                                            <div className="flex gap-1">
                                                                <Button
                                                                    label="Fulfill"
                                                                    onClick={() =>
                                                                        setFulfillTarget({
                                                                            buyerPk: req.pk_buyer,
                                                                            requestId: req.id,
                                                                            listing,
                                                                        })
                                                                    }
                                                                    width="auto"
                                                                />
                                                                <Button
                                                                    label="Reject"
                                                                    onClick={() =>
                                                                        rejectRequest(req.id, listing.id)
                                                                    }
                                                                    width="auto"
                                                                />
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {fulfillTarget && (
                <NewContractModal
                    title={`Fulfill: ${fulfillTarget.listing.title}`}
                    vendorPk={publicKey}
                    prefillBuyerPk={fulfillTarget.buyerPk}
                    requestId={fulfillTarget.requestId}
                    prefillPrice={fulfillTarget.listing.price.toString()}
                    prefillTipCompletion={fulfillTarget.listing.tip_completion.toString()}
                    prefillTipDispute={fulfillTarget.listing.tip_dispute.toString()}
                    prefillTimeoutDelay={fulfillTarget.listing.timeout_delay.toString()}
                    listingType={fulfillTarget.listing.listing_type}
                    listingPreviewHash={fulfillTarget.listing.preview_hash}
                    listingBrisqueValue={fulfillTarget.listing.brisque_value}
                    listingPreviewImage={fulfillTarget.listing.preview_image}
                    listingAlgorithmSuite={fulfillTarget.listing.algorithm_suite}
                    listingZkProof={fulfillTarget.listing.zk_proof}
                    listingZkProofFull={fulfillTarget.listing.zk_proof_full}
                    listingZkHPt={fulfillTarget.listing.zk_h_pt}
                    listingZkThumbnailHash={fulfillTarget.listing.zk_thumbnail_hash}
                    listingZkBrisque={fulfillTarget.listing.zk_brisque}
                    listingZkVkHash={fulfillTarget.listing.zk_vk_hash}
                    listingExtImgThumbHash={fulfillTarget.listing.ext_img_thumb_hash}
                    listingExtImgWidth={fulfillTarget.listing.ext_img_width}
                    listingExtImgHeight={fulfillTarget.listing.ext_img_height}
                    listingExtImgSize={fulfillTarget.listing.ext_img_size}
                    listingPreviewAudio={fulfillTarget.listing.preview_audio}
                    listingExtAudioPreviewHash={fulfillTarget.listing.ext_audio_preview_hash}
                    listingExtAudioDuration={fulfillTarget.listing.ext_audio_duration}
                    listingExtAudioBitrate={fulfillTarget.listing.ext_audio_bitrate}
                    listingExtAudioSize={fulfillTarget.listing.ext_audio_size}
                    listingPreviewCropImage={fulfillTarget.listing.preview_crop_image}
                    listingExtImgCropHash={fulfillTarget.listing.ext_img_crop_hash}
                    listingExtImgCropX={fulfillTarget.listing.ext_img_crop_x}
                    listingExtImgCropY={fulfillTarget.listing.ext_img_crop_y}
                    listingPreviewAudioLowres={fulfillTarget.listing.preview_audio_lowres}
                    listingExtAudioLowresHash={fulfillTarget.listing.ext_audio_lowres_hash}
                    listingExtAudioPreviewSr={fulfillTarget.listing.ext_audio_preview_sr}
                    listingExtAudioLowresSr={fulfillTarget.listing.ext_audio_lowres_sr}
                    listingPreviewVideoThumb={fulfillTarget.listing.preview_video_thumb}
                    listingExtVideoThumbHash={fulfillTarget.listing.ext_video_thumb_hash}
                    listingPreviewVideoClip={fulfillTarget.listing.preview_video_clip}
                    listingExtVideoClipHash={fulfillTarget.listing.ext_video_clip_hash}
                    listingExtVideoWidth={fulfillTarget.listing.ext_video_width}
                    listingExtVideoHeight={fulfillTarget.listing.ext_video_height}
                    listingExtVideoDuration={fulfillTarget.listing.ext_video_duration}
                    listingExtVideoBitrate={fulfillTarget.listing.ext_video_bitrate}
                    listingExtVideoSize={fulfillTarget.listing.ext_video_size}
                    listingExtVideoFps={fulfillTarget.listing.ext_video_fps}
                    listingExtVideoClipFrames={fulfillTarget.listing.ext_video_clip_frames}
                    onClose={() => {
                        setFulfillTarget(null);
                        if (expandedId !== null) fetchRequests(expandedId);
                    }}
                />
            )}
        </div>
    );
}
