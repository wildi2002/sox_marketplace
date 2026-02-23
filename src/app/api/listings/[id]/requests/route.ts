import db from "../../../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

// GET: vendor gets all purchase requests for their listing
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const pk = req.nextUrl.searchParams.get("pk");

        if (!pk) {
            return NextResponse.json({ error: "pk required" }, { status: 400 });
        }

        const listing = db.prepare(
            "SELECT * FROM listings WHERE id = ? AND pk_vendor = ?"
        ).get(id, pk);

        if (!listing) {
            return NextResponse.json({ error: "Listing not found or not yours" }, { status: 404 });
        }

        const requests = db.prepare(`
            SELECT * FROM purchase_requests
            WHERE listing_id = ?
            ORDER BY created_at DESC
        `).all(id);

        return NextResponse.json(requests);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: buyer creates a purchase request
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await req.json();
        const { pk_buyer } = body;

        if (!pk_buyer) {
            return NextResponse.json({ error: "pk_buyer required" }, { status: 400 });
        }

        const listing = db.prepare(
            "SELECT * FROM listings WHERE id = ? AND active = 1"
        ).get(id) as any;

        if (!listing) {
            return NextResponse.json({ error: "Listing not found or inactive" }, { status: 404 });
        }

        if (listing.pk_vendor.toLowerCase() === pk_buyer.toLowerCase()) {
            return NextResponse.json({ error: "You cannot buy your own listing" }, { status: 400 });
        }

        const existing = db.prepare(`
            SELECT * FROM purchase_requests
            WHERE listing_id = ? AND pk_buyer = ? AND status = 'pending'
        `).get(id, pk_buyer);

        if (existing) {
            return NextResponse.json({ error: "You already have a pending request for this listing" }, { status: 409 });
        }

        const result = db.prepare(
            "INSERT INTO purchase_requests (listing_id, pk_buyer) VALUES (?, ?)"
        ).run(id, pk_buyer);

        return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
