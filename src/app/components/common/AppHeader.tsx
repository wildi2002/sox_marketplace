"use client";

import { useUser } from "@/app/lib/UserContext";
import { useRouter, usePathname } from "next/navigation";

export default function AppHeader() {
    const { user, logout } = useUser();
    const router = useRouter();
    const pathname = usePathname();

    if (!user) return null;

    const navBtn = (label: string, href: string) => {
        const active = pathname === href;
        return (
            <button
                key={href}
                onClick={() => router.push(href)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    active
                        ? "bg-blue-100 text-blue-800 font-medium"
                        : "text-gray-600 hover:bg-gray-100"
                }`}
            >
                {label}
            </button>
        );
    };

    const displayName = user.username || `${user.publicKey.slice(0, 8)}…${user.publicKey.slice(-6)}`;

    return (
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-6">
                <span
                    className="font-bold text-lg cursor-pointer select-none"
                    onClick={() => router.push("/")}
                >
                    SOX
                </span>
                <nav className="flex gap-1">
                    {user.role === "user" && (
                        <>
                            {navBtn("Marketplace", "/marketplace")}
                            {navBtn("My Dashboard", "/user")}
                            {navBtn("My Listings", "/listings")}
                            {navBtn("Account", "/account")}
                        </>
                    )}
                    {user.role === "sponsor" && navBtn("Sponsor Dashboard", "/sponsor")}
                </nav>
            </div>

            <div className="flex items-center gap-3">
                <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        user.role === "user"
                            ? "bg-green-100 text-green-700"
                            : "bg-purple-100 text-purple-700"
                    }`}
                >
                    {user.role === "user" ? "User" : "Sponsor"}
                </span>
                <span className="text-sm text-gray-700 hidden sm:block">
                    {displayName}
                </span>
                <button
                    onClick={() => { logout(); router.push("/"); }}
                    className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                    Logout
                </button>
            </div>
        </header>
    );
}
