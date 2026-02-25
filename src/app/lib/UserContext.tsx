"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface UserState {
    publicKey: string;
    username?: string;
}

interface UserContextType {
    user: UserState | null;
    login: (publicKey: string) => void;
    logout: () => void;
    setUsername: (name: string) => void;
}

const STORAGE_KEY = "sox_user";

const UserContext = createContext<UserContextType>({
    user: null,
    login: () => {},
    logout: () => {},
    setUsername: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserState | null>(() => {
        if (typeof window === "undefined") return null;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return null;
            const parsed = JSON.parse(saved) as UserState;
            const savedUsername = localStorage.getItem(`sox_username_${parsed.publicKey}`) || undefined;
            return { ...parsed, username: savedUsername };
        } catch {
            return null;
        }
    });

    const login = (publicKey: string) => {
        const savedUsername = localStorage.getItem(`sox_username_${publicKey}`) || undefined;
        const state: UserState = { publicKey, username: savedUsername };
        setUser(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
    };

    const setUsername = (name: string) => {
        if (!user) return;
        const trimmed = name.trim();
        localStorage.setItem(`sox_username_${user.publicKey}`, trimmed);
        const newState: UserState = { ...user, username: trimmed || undefined };
        setUser(newState);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    };

    return (
        <UserContext.Provider value={{ user, login, logout, setUsername }}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    return useContext(UserContext);
}
