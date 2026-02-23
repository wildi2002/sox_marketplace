import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const pk = req.nextUrl.searchParams.get("pk");
    if (!pk) return NextResponse.json({ error: "pk required" }, { status: 400 });
    const pkLower = pk.toLowerCase();

    // All contracts involving this PK
    const contracts = db.prepare(`
        SELECT
            c.id,
            c.pk_buyer,
            c.pk_vendor,
            c.price,
            c.tip_completion,
            c.item_description,
            c.file_name,
            c.sponsor,
            c.optimistic_smart_contract
        FROM contracts c
        WHERE LOWER(c.pk_buyer) = ?
           OR LOWER(c.pk_vendor) = ?
           OR LOWER(c.sponsor) = ?
        ORDER BY c.id DESC
    `).all(pkLower, pkLower, pkLower) as any[];

    // Purchase requests as buyer (before a contract was created)
    const requests = db.prepare(`
        SELECT
            pr.id,
            pr.listing_id,
            pr.pk_buyer,
            pr.status,
            pr.contract_id,
            pr.created_at,
            l.title,
            l.price,
            l.pk_vendor
        FROM purchase_requests pr
        LEFT JOIN listings l ON pr.listing_id = l.id
        WHERE LOWER(pr.pk_buyer) = ?
        ORDER BY pr.id DESC
    `).all(pkLower) as any[];

    const events: {
        ref: string;
        type: string;
        description: string;
        amount: number;
        status: string;
    }[] = [];

    for (const c of contracts) {
        const isBuyer = c.pk_buyer?.toLowerCase() === pkLower;
        const isVendor = c.pk_vendor?.toLowerCase() === pkLower;
        const isSponsor = c.sponsor?.toLowerCase() === pkLower;
        const label = c.file_name || c.item_description || `Vertrag #${c.id}`;
        const isActive = !!c.optimistic_smart_contract;

        if (isBuyer) {
            events.push({
                ref: `Vertrag #${c.id}`,
                type: "Kauf",
                description: label,
                amount: -((Number(c.price) || 0) + (Number(c.tip_completion) || 0)),
                status: isActive ? "Aktiv" : "Ausstehend",
            });
        }
        if (isVendor && !isBuyer) {
            events.push({
                ref: `Vertrag #${c.id}`,
                type: "Verkauf",
                description: label,
                amount: Number(c.price) || 0,
                status: isActive ? "Aktiv" : "Ausstehend",
            });
        }
        if (isSponsor && !isBuyer && !isVendor) {
            events.push({
                ref: `Vertrag #${c.id}`,
                type: "Sponsoring",
                description: label,
                amount: -(Number(c.tip_completion) || 0),
                status: isActive ? "Aktiv" : "Ausstehend",
            });
        }
    }

    for (const r of requests) {
        let statusLabel = "Ausstehend";
        if (r.status === "fulfilled") statusLabel = "Erfüllt";
        if (r.status === "rejected") statusLabel = "Abgelehnt";

        events.push({
            ref: `Anfrage #${r.id}`,
            type: "Kaufanfrage",
            description: r.title || `Angebot #${r.listing_id}`,
            amount: -(Number(r.price) || 0),
            status: statusLabel,
        });
    }

    // Sort by ref number descending (Vertrag/Anfrage ID)
    events.sort((a, b) => {
        const numA = parseInt(a.ref.replace(/\D/g, "")) || 0;
        const numB = parseInt(b.ref.replace(/\D/g, "")) || 0;
        return numB - numA;
    });

    return NextResponse.json(events);
}
