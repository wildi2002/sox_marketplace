import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const data = await req.json();
    let stmt = db.prepare(`UPDATE contracts SET sponsor = ? WHERE id = ?`);
    stmt.run(data.pkSponsor, id);

    stmt = db.prepare(`SELECT * FROM contracts WHERE id = ?`);
    const result = stmt.all(id)[0];
    return NextResponse.json(result);
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    let stmt = db.prepare(`DELETE FROM contracts WHERE id = ?`);
    let result = stmt.run(id);

    return NextResponse.json({ success: result.changes > 0 });
}
