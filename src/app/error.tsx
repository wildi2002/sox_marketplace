"use client";

import { useEffect } from "react";
import { NextResponse } from "next/server";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log l'erreur pour le débogage
        console.error("Erreur capturée par error.tsx:", error);
    }, [error]);

    // Ne pas afficher de page HTML pour les routes API
    // Ce composant est principalement pour les pages
    return null;
}





