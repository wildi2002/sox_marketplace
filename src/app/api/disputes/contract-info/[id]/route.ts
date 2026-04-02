import { UPLOADS_PATH } from "@/app/api/files/[id]/route";
import db from "@/app/lib/sqlite";
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const row = db
        .prepare("SELECT item_description, opening_value, algorithm_suite FROM contracts WHERE id = ?")
        .get(id) as { item_description: string; opening_value: string; algorithm_suite: string } | undefined;

    if (!row) {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const ctPath = `${UPLOADS_PATH}file_${id}.enc`;
    if (!existsSync(ctPath)) {
        return NextResponse.json({ error: "Ciphertext file not found" }, { status: 404 });
    }

    const ctHex = readFileSync(ctPath).toString("hex");

    return NextResponse.json({
        description: row.item_description,
        opening_value: row.opening_value,
        ct_hex: ctHex,
        algorithm_suite: row.algorithm_suite,
    });
}
