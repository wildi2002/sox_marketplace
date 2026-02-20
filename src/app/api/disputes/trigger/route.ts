import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const body = await req.json();
    const stmt = db.prepare(`INSERT INTO disputes (contract_id) VALUES (?);`);
    const result = stmt.run(body.contract_id);
    return NextResponse.json({ message: "success" });
}
