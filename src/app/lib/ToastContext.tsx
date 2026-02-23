"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
    id: string;
    type: ToastType;
    message: string;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType = "info", duration = 4500) => {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

    const styles: Record<ToastType, string> = {
        success: "bg-green-600 border-green-700",
        error:   "bg-red-600 border-red-700",
        info:    "bg-blue-600 border-blue-700",
        warning: "bg-amber-500 border-amber-600",
    };

    const icons: Record<ToastType, string> = {
        success: "✅",
        error:   "❌",
        info:    "ℹ️",
        warning: "⚠️",
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-80 pointer-events-none">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        onClick={() => dismiss(t.id)}
                        className={`${styles[t.type]} text-white px-4 py-3 rounded-lg shadow-xl border flex items-start gap-2 pointer-events-auto cursor-pointer`}
                    >
                        <span className="text-base shrink-0 mt-0.5">{icons[t.type]}</span>
                        <span className="text-sm leading-snug whitespace-pre-line flex-1">{t.message}</span>
                        <span className="text-white/60 text-xs shrink-0 mt-0.5">✕</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}
