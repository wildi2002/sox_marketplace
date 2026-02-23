import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

// GET: buyer gets all their purchase requests (with listing info)
export async function GET(req: NextRequest) {
    try {
        const pk = req.nextUrl.searchParams.get("pk");
        if (!pk) {
            return NextResponse.json({ error: "pk required" }, { status: 400 });
        }

        const requests = db.prepare(`
            SELECT pr.*, l.title, l.description, l.price, l.pk_vendor
            FROM purchase_requests pr
            JOIN listings l ON pr.listing_id = l.id
            WHERE pr.pk_buyer = ?
            ORDER BY pr.created_at DESC
        `).all(pk);

        return NextResponse.json(requests);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
