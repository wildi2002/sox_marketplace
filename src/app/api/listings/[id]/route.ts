import db from "../../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const pk = req.nextUrl.searchParams.get("pk");

        if (!pk) {
            return NextResponse.json({ error: "pk required" }, { status: 400 });
        }

        const result = db.prepare(
            "UPDATE listings SET active = 0 WHERE id = ? AND pk_vendor = ?"
        ).run(id, pk);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Listing not found or not yours" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
