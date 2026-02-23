"use client";

import { UserProvider } from "@/app/lib/UserContext";
import { ToastProvider } from "@/app/lib/ToastContext";
import AppHeader from "./common/AppHeader";
import { ReactNode } from "react";

export default function ClientLayout({ children }: { children: ReactNode }) {
    return (
        <UserProvider>
            <ToastProvider>
                <AppHeader />
                {children}
            </ToastProvider>
        </UserProvider>
    );
}
