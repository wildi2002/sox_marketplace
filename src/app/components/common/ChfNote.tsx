"use client";

import { useEthChfRate, ethToCHF } from "@/app/lib/useEthChfRate";

interface ChfNoteProps {
    value: number | string;
    /** "inline" = grey span on same line; "block" = small line below */
    display?: "inline" | "block";
}

/**
 * Displays a live CHF equivalent for an ETH amount.
 * Renders nothing if the value is zero, empty, or the rate is unavailable.
 */
export default function ChfNote({ value, display = "inline" }: ChfNoteProps) {
    const rate = useEthChfRate();
    const chf = ethToCHF(String(value), rate);
    if (!chf) return null;

    if (display === "block") {
        return <p className="text-xs text-gray-400 mt-0.5">≈ {chf} CHF</p>;
    }
    return <span className="text-xs text-gray-400 ml-1.5">≈ {chf} CHF</span>;
}
