import { UPLOADS_PATH, WASM_PATH } from "@/app/api/files/[id]/route";
import { bytes_to_hex, hex_to_bytes, initSync } from "@/app/lib/crypto_lib";
import db from "@/app/lib/sqlite";
import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const fileName = `argument_buyer_${id}.bin`;
    const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
    initSync({ module: module });

    const argument = readFileSync(`${UPLOADS_PATH}${fileName}`);

    const stmt = db.prepare(
        "SELECT item_description FROM contracts WHERE id = ?"
    );
    const resp = stmt.all(id);

    if (!resp) {
        return NextResponse.json({
            error: "Not found",
        });
    }

    const { item_description } = resp[0] as { item_description: string };

    return NextResponse.json({
        argument: bytes_to_hex(argument),
        description: item_description,
    });
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
    initSync({ module: module });

    const { argument } = await req.json();
    const { id } = await params;

    const fileName = `argument_buyer_${id}.bin`;
    writeFileSync(`${UPLOADS_PATH}${fileName}`, hex_to_bytes(argument));

    // when a buyer sends an argument, create an entry in the disputes table
    // to search for a dispute sponsor
    const stmt = db.prepare(`INSERT INTO disputes (contract_id) VALUES (?)`);
    stmt.run(id);

    return NextResponse.json({ message: "success" });
}
