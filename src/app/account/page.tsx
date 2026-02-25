"use client";

import Button from "../components/common/Button";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getBalance } from "../lib/blockchain/common";
import { useUser } from "../lib/UserContext";

type TxEvent = {
    ref: string;
    type: string;
    description: string;
    amount: number;
    status: string;
    gas_wei: string | null;
};

const typeColors: Record<string, string> = {
    Purchase:   "bg-red-100 text-red-700",
    Sale:       "bg-green-100 text-green-700",
    Sponsoring: "bg-purple-100 text-purple-700",
};

const statusColors: Record<string, string> = {
    Active:    "text-blue-600",
    Pending:   "text-gray-400",
    Fulfilled: "text-green-600",
    Rejected:  "text-red-500",
};

function formatEth(value: number): string {
    return value.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatWei(weiStr: string): string {
    // Format with thousand separators (apostrophe in de-CH)
    return Number(weiStr).toLocaleString("de-CH") + " Wei";
}

export default function AccountPage() {
    const router = useRouter();
    const { user, setUsername } = useUser();
    const [rawBalance, setRawBalance] = useState<string | null>(null);
    const [usernameInput, setUsernameInput] = useState("");
    const [usernameSaved, setUsernameSaved] = useState(false);
    const [transactions, setTransactions] = useState<TxEvent[]>([]);
    const [txLoading, setTxLoading] = useState(false);

    useEffect(() => {
        if (!user) router.replace("/");
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const loadBalance = async () => setRawBalance(await getBalance(user.publicKey));
        loadBalance();
        window.addEventListener("reloadData", loadBalance);
        return () => window.removeEventListener("reloadData", loadBalance);
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const loadTx = async () => {
            setTxLoading(true);
            try {
                const res = await fetch(`/api/account/transactions?pk=${user.publicKey}`);
                const data = await res.json();
                setTransactions(Array.isArray(data) ? data : []);
            } catch {
                setTransactions([]);
            } finally {
                setTxLoading(false);
            }
        };
        loadTx();
        window.addEventListener("reloadData", loadTx);
        return () => window.removeEventListener("reloadData", loadTx);
    }, [user]);

    useEffect(() => {
        if (user?.username) setUsernameInput(user.username);
    }, [user?.username]);

    /**
     * Compute saldo anchored to current on-chain balance (newest tx = current balance).
     * Going backwards: undo each tx's amount AND its gas cost.
     *   balance_before = balance_after - amount + gas_in_eth
     */
    const txWithSaldo = useMemo(() => {
        const balanceNum = rawBalance ? parseFloat(rawBalance) : null;
        if (balanceNum === null || isNaN(balanceNum)) {
            return transactions.map(tx => ({ ...tx, saldo: null as number | null }));
        }
        let running = balanceNum;
        return transactions.map((tx) => {
            const saldo = running;
            const gasEth = tx.gas_wei ? Number(tx.gas_wei) / 1e18 : 0;
            running -= tx.amount;   // undo protocol amount (signed)
            running += gasEth;      // undo gas deduction (always an outflow)
            return { ...tx, saldo };
        });
    }, [rawBalance, transactions]);

    if (!user) return null;

    const balanceNum = rawBalance ? parseFloat(rawBalance) : null;
    const balanceDisplay = balanceNum !== null && !isNaN(balanceNum)
        ? formatEth(balanceNum)
        : "Loading…";

    const handleSaveUsername = () => {
        setUsername(usernameInput);
        setUsernameSaved(true);
        setTimeout(() => setUsernameSaved(false), 2000);
    };

    return (
        <main className="p-4 min-h-screen max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">Account</h1>
                <Button
                    label="Refresh"
                    onClick={() => window.dispatchEvent(new Event("reloadData"))}
                    width="auto"
                />
            </div>

            {/* Balance */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Balance</h2>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 flex items-center justify-between">
                    <span className="text-gray-500 text-sm">ETH Balance</span>
                    <span className="text-3xl font-bold">{balanceDisplay} ETH</span>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-2 break-all">{user.publicKey}</p>
            </section>

            {/* Transaction history */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Transactions</h2>
                {txLoading ? (
                    <p className="text-sm text-gray-400">Loading transactions…</p>
                ) : txWithSaldo.length === 0 ? (
                    <p className="text-sm text-gray-400">No transactions yet.</p>
                ) : (
                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                                    <th className="px-4 py-2">Reference</th>
                                    <th className="px-4 py-2">Type</th>
                                    <th className="px-4 py-2">Description</th>
                                    <th className="px-4 py-2 text-right">Amount (ETH)</th>
                                    <th className="px-4 py-2 text-right">Gas Fee</th>
                                    <th className="px-4 py-2 text-right">Status</th>
                                    <th className="px-4 py-2 text-right">Balance (ETH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {txWithSaldo.map((tx, i) => (
                                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{tx.ref}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[tx.type] || "bg-gray-100 text-gray-600"}`}>
                                                {tx.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700 max-w-[150px] truncate" title={tx.description}>
                                            {tx.description}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-semibold ${tx.amount >= 0 ? "text-green-600" : "text-red-500"}`}>
                                            {tx.amount >= 0 ? "+" : ""}{tx.amount.toFixed(4)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-orange-600">
                                            {tx.gas_wei ? `−${formatWei(tx.gas_wei)}` : "—"}
                                        </td>
                                        <td className={`px-4 py-3 text-right text-xs ${statusColors[tx.status] || "text-gray-500"}`}>
                                            {tx.status}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-sm text-gray-800">
                                            {tx.saldo !== null ? formatEth(tx.saldo) : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* Display name */}
            <section>
                <h2 className="text-lg font-semibold mb-3">Display Name</h2>
                <p className="text-sm text-gray-500 mb-3">
                    Shown in the header instead of your address.
                </p>
                <div className="flex gap-2 items-center">
                    <input
                        type="text"
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        placeholder="e.g. Alice, Bob, Vendor1…"
                        className="border border-gray-300 rounded px-3 py-2 text-sm flex-1"
                        maxLength={32}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveUsername()}
                    />
                    <Button
                        label={usernameSaved ? "Saved!" : "Save"}
                        onClick={handleSaveUsername}
                        width="auto"
                        isDisabled={!usernameInput.trim()}
                    />
                    {user.username && (
                        <Button
                            label="Delete"
                            onClick={() => {
                                setUsernameInput("");
                                setUsername("");
                            }}
                            width="auto"
                        />
                    )}
                </div>
                {user.username && (
                    <p className="text-sm text-green-600 mt-2">
                        Current name: <b>{user.username}</b>
                    </p>
                )}
            </section>
        </main>
    );
}
