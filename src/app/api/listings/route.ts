import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
    try {
        const listings = db.prepare(`
            SELECT l.*,
                   COUNT(CASE WHEN pr.status = 'pending' THEN 1 END) as pending_requests
            FROM listings l
            LEFT JOIN purchase_requests pr ON pr.listing_id = l.id
            WHERE l.active = 1
            GROUP BY l.id
            ORDER BY l.created_at DESC
        `).all();
        return NextResponse.json(listings);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { title, description, price, tip_completion, tip_dispute, timeout_delay, algorithm_suite, pk_vendor } = body;

        if (!title || !price || !pk_vendor) {
            return NextResponse.json({ error: "Missing required fields: title, price, pk_vendor" }, { status: 400 });
        }

        const result = db.prepare(`
            INSERT INTO listings (title, description, price, tip_completion, tip_dispute, timeout_delay, algorithm_suite, pk_vendor)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            title,
            description || "",
            price,
            tip_completion ?? 0,
            tip_dispute ?? 0,
            timeout_delay ?? 3600,
            algorithm_suite ?? "default",
            pk_vendor
        );

        return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
