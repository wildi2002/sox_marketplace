"use client";

import Button from "../common/Button";
import { useEffect, useState } from "react";
import NonAcceptedPrecontractModal from "./NonAcceptedPrecontractModal";

export type Contract = {
    id: number;
    pk_buyer: string;
    pk_vendor: string;
    item_description: string;
    price: number;
    tip_completion: number;
    tip_dispute: number;
    protocol_version: number;
    timeout_delay: number;
    algorithm_suite: string;
    commitment: string;
    accepted: number;
    num_blocks: number;
    num_gates: number;
    sponsor: string;
    opening_value: string;
    optimistic_smart_contract?: string;
    // Image listing metadata
    listing_type?: string | null;
    preview_image?: string | null;
    preview_hash?: string | null;
    // Extended image description fields
    ext_img_thumb_hash?: string | null;
    ext_img_width?: number | null;
    ext_img_height?: number | null;
    ext_img_size?: number | null;
    // Extended audio description fields
    preview_audio?: string | null;
    ext_audio_preview_hash?: string | null;
    ext_audio_duration?: number | null;
    ext_audio_bitrate?: number | null;
    ext_audio_size?: number | null;
    // Extended image crop/dual fields
    preview_crop_image?: string | null;
    ext_img_crop_hash?: string | null;
    ext_img_crop_x?: number | null;
    ext_img_crop_y?: number | null;
    // Extended audio lowres/both fields
    preview_audio_lowres?: string | null;
    ext_audio_lowres_hash?: string | null;
    // Audio sample rate fields
    ext_audio_preview_sr?: number | null;
    ext_audio_lowres_sr?: number | null;
    // Video fields
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
    // desc V3 fields: d = SHA256(T‖Q‖D)
    desc_d?: string | null;
    desc_dim?: string | null;
    desc_thumb?: string | null;
    desc_quality?: string | null;
};

interface NonAcceptedPrecontractsListViewProps {
    publicKey: string;
}

export default function NonAcceptedPrecontractsListView({
    publicKey,
}: NonAcceptedPrecontractsListViewProps) {
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [displayedContract, setDisplayedContract] = useState<Contract>();
    const [modalShown, showModal] = useState(false);

    const fetchContracts = () => {
        fetch(`/api/precontracts?pk=${publicKey}`)
            .then((res) => res.json())
            .then((data) => setContracts(data));
    };

    const handleShowDetails = (c: Contract) => {
        setDisplayedContract(c);
        showModal(true);
    };

    useEffect(() => {
        const handleReloadData = () => {
            fetchContracts();
        };

        handleReloadData();
        window.addEventListener("reloadData", handleReloadData);

        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, [publicKey]);

    return (
        <>
            <div className="bg-gray-300 p-4 rounded w-1/2 overflow-auto">
                <h2 className="text-lg font-semibold mb-4">
                    Pending Precontracts
                </h2>

                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-black text-left font-medium">
                            <th className="p-2 w-1/10">ID</th>
                            <th className="p-2 w-4/10">Submitted by</th>
                            <th className="p-2 w-3/10">Proof</th>
                            <th className="p-2 w-2/10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {contracts.map((c) => (
                            <tr
                                key={c.id}
                                className="even:bg-gray-200 border-b border-black h-15"
                            >
                                <td className="p-2">{c.id}</td>
                                <td className="p-2 truncate">{c.pk_vendor}</td>
                                <td className="p-2">
                                    {c.algorithm_suite === "extended_audio" ? (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">
                                            Audio{c.ext_audio_duration != null ? ` · ${c.ext_audio_duration}s` : ""}
                                        </span>
                                    ) : c.algorithm_suite === "extended_image" ? (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Extended Desc</span>
                                    ) : null}
                                </td>
                                <td className="p-2 text-center">
                                    <Button
                                        label="View Details"
                                        onClick={() => handleShowDetails(c)}
                                        width="95/100"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {modalShown && (
                <NonAcceptedPrecontractModal
                    onClose={() => showModal(false)}
                    contract={displayedContract}
                ></NonAcceptedPrecontractModal>
            )}
        </>
    );
}
