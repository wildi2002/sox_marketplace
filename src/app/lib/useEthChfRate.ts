import { useEffect, useState } from "react";

/**
 * Fetches the current ETH/CHF exchange rate from CoinGecko.
 * Returns null while loading or if the fetch fails.
 * Refreshes every 60 seconds.
 */
export function useEthChfRate(): number | null {
    const [rate, setRate] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;

        const fetchRate = async () => {
            try {
                const res = await fetch(
                    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=chf"
                );
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) setRate(data?.ethereum?.chf ?? null);
            } catch {
                // silently ignore network errors
            }
        };

        fetchRate();
        const interval = setInterval(fetchRate, 60_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return rate;
}

/**
 * Converts an ETH string input to a formatted CHF string.
 * Returns null if input is empty, invalid, or rate is unavailable.
 */
export function ethToCHF(ethValue: string, rate: number | null): string | null {
    if (rate === null) return null;
    const n = parseFloat(ethValue);
    if (!ethValue || isNaN(n) || n < 0) return null;
    return (n * rate).toLocaleString("de-CH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
