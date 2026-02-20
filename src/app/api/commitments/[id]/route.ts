import { NextResponse } from "next/server";
import db from "../../../lib/sqlite";

interface CommitmentResponse {
    commitment: string;
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const stmt = db.prepare(`SELECT commitment FROM contracts WHERE id = ?`);
    const resp = stmt.all(id)[0] as CommitmentResponse;

    return NextResponse.json({ commitment: resp.commitment });
}
