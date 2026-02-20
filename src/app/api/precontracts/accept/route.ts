import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";


export async function POST(req: Request) {
    const data = await req.json();
    const stmt = db.prepare(`UPDATE contracts SET accepted = 1 WHERE id = ?`);
    const result = stmt.run(data.id);
    return NextResponse.json(result);
}
