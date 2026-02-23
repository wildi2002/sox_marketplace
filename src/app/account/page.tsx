"use client";

import Button from "../components/common/Button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBalance } from "../lib/blockchain/common";
import { useUser } from "../lib/UserContext";

type TxEvent = {
    ref: string;
    type: string;
    description: string;
    amount: number;
    status: string;
};

const typeColors: Record<string, string> = {
    Kauf:        "bg-red-100 text-red-700",
    Verkauf:     "bg-green-100 text-green-700",
    Sponsoring:  "bg-purple-100 text-purple-700",
    Kaufanfrage: "bg-yellow-100 text-yellow-700",
};

const statusColors: Record<string, string> = {
    Aktiv:       "text-blue-600",
    Ausstehend:  "text-gray-400",
    Erfüllt:     "text-green-600",
    Abgelehnt:   "text-red-500",
};

export default function AccountPage() {
    const router = useRouter();
    const { user, setUsername } = useUser();
    const [balance, setBalance] = useState("Loading...");
    const [usernameInput, setUsernameInput] = useState("");
    const [usernameSaved, setUsernameSaved] = useState(false);
    const [transactions, setTransactions] = useState<TxEvent[]>([]);
    const [txLoading, setTxLoading] = useState(false);

    useEffect(() => {
        if (!user) router.replace("/");
        else if (user.role !== "user") router.replace("/sponsor");
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const loadBalance = async () => setBalance(await getBalance(user.publicKey));
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

    if (!user || user.role !== "user") return null;

    const handleSaveUsername = () => {
        setUsername(usernameInput);
        setUsernameSaved(true);
        setTimeout(() => setUsernameSaved(false), 2000);
    };

    return (
        <main className="p-4 min-h-screen max-w-3xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">Account</h1>
                <Button
                    label="Aktualisieren"
                    onClick={() => window.dispatchEvent(new Event("reloadData"))}
                    width="auto"
                />
            </div>

            {/* Balance */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Guthaben</h2>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 flex items-center justify-between">
                    <span className="text-gray-500 text-sm">ETH-Guthaben</span>
                    <span className="text-3xl font-bold">{balance} ETH</span>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-2 break-all">{user.publicKey}</p>
            </section>

            {/* Transaction history */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-3">Kontobewegungen</h2>
                {txLoading ? (
                    <p className="text-sm text-gray-400">Lade Transaktionen…</p>
                ) : transactions.length === 0 ? (
                    <p className="text-sm text-gray-400">Noch keine Transaktionen vorhanden.</p>
                ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                                    <th className="px-4 py-2">Referenz</th>
                                    <th className="px-4 py-2">Typ</th>
                                    <th className="px-4 py-2">Beschreibung</th>
                                    <th className="px-4 py-2 text-right">Betrag (ETH)</th>
                                    <th className="px-4 py-2 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((tx, i) => (
                                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{tx.ref}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[tx.type] || "bg-gray-100 text-gray-600"}`}>
                                                {tx.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate" title={tx.description}>
                                            {tx.description}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-semibold ${tx.amount >= 0 ? "text-green-600" : "text-red-500"}`}>
                                            {tx.amount >= 0 ? "+" : ""}{tx.amount.toFixed(4)}
                                        </td>
                                        <td className={`px-4 py-3 text-right text-xs ${statusColors[tx.status] || "text-gray-500"}`}>
                                            {tx.status}
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
                <h2 className="text-lg font-semibold mb-3">Anzeigename</h2>
                <p className="text-sm text-gray-500 mb-3">
                    Wird im Header anstelle deiner Adresse angezeigt.
                </p>
                <div className="flex gap-2 items-center">
                    <input
                        type="text"
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        placeholder="z.B. Alice, Bob, Verkäufer1…"
                        className="border border-gray-300 rounded px-3 py-2 text-sm flex-1"
                        maxLength={32}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveUsername()}
                    />
                    <Button
                        label={usernameSaved ? "Gespeichert!" : "Speichern"}
                        onClick={handleSaveUsername}
                        width="auto"
                        isDisabled={!usernameInput.trim()}
                    />
                    {user.username && (
                        <Button
                            label="Löschen"
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
                        Aktueller Name: <b>{user.username}</b>
                    </p>
                )}
            </section>
        </main>
    );
}
