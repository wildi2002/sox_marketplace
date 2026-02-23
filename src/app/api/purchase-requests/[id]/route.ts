import db from "../../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

// PATCH: vendor fulfills or rejects a purchase request
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await req.json();
        const { status, contract_id } = body;

        if (!status || !["fulfilled", "rejected"].includes(status)) {
            return NextResponse.json(
                { error: "status must be 'fulfilled' or 'rejected'" },
                { status: 400 }
            );
        }

        db.prepare(
            "UPDATE purchase_requests SET status = ?, contract_id = ? WHERE id = ?"
        ).run(status, contract_id ?? null, id);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
