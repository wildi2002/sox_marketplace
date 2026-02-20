import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const stmt = db.prepare(
        `SELECT * FROM contracts WHERE id = ? AND accepted = 0`
    );
    const results = stmt.all(id);

    return NextResponse.json(results);
}
