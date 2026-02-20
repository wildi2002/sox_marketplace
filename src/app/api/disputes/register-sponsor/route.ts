import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { initSync } from "@/app/lib/crypto_lib";
import { WASM_PATH } from "../../files/[id]/route";

interface RequestBody {
    contract_id: string;
    pk_sponsor: string;
}

export async function POST(req: Request) {
    const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
    initSync({ module: module });

    const body = await req.json();
    if (!body.contract_id) {
        return NextResponse.json({
            success: false,
            error_msg: "Missing contract id",
        });
    }

    if (!body.pk_sponsor) {
        return NextResponse.json({
            success: false,
            error_msg: "Missing sponsor's public key",
        });
    }

    const stmt = db.prepare(
        "SELECT pk_buyer_sponsor, pk_vendor_sponsor FROM disputes WHERE contract_id = ?"
    );
    const resp = stmt.all(body.contract_id);

    if (!resp) {
        return NextResponse.json({
            success: false,
            error_msg: "Contract doesn't exist",
        });
    }

    const { pk_buyer_sponsor, pk_vendor_sponsor } = resp[0] as {
        pk_buyer_sponsor?: string;
        pk_vendor_sponsor?: string;
    };

    if (!pk_buyer_sponsor) return registerSB(body);
    if (!pk_vendor_sponsor) return registerSV(body);
    return NextResponse.json({
        success: false,
        error_msg: "Both sponsors already registered",
    });
}

async function registerSB(body: RequestBody) {
    let stmt = db.prepare(
        `SELECT contract_id FROM disputes WHERE contract_id = ?`
    );
    let dispute = stmt.all(body.contract_id);
    if (dispute.length == 0) {
        stmt = db.prepare(
            `INSERT INTO disputes (contract_id, pk_buyer_sponsor) VALUES (?, ?)`
        );
        stmt.run(body.contract_id, body.pk_sponsor);
    } else {
        stmt = db.prepare(
            `UPDATE disputes SET pk_buyer_sponsor = ? WHERE contract_id = ?`
        );
        stmt.run(body.pk_sponsor, body.contract_id);
    }

    return NextResponse.json({ success: true });
}

async function registerSV(body: RequestBody) {
    let stmt = db.prepare(
        `SELECT contract_id FROM disputes WHERE contract_id = ?`
    );
    let dispute = stmt.all(body.contract_id);

    if (dispute.length == 0) {
        stmt = db.prepare(
            `INSERT INTO disputes (contract_id, pk_vendor_sponsor) VALUES (?, ?)`
        );
        stmt.run(body.contract_id, body.pk_sponsor);
    } else {
        stmt = db.prepare(
            `UPDATE disputes SET pk_vendor_sponsor = ? WHERE contract_id = ?`
        );
        stmt.run(body.pk_sponsor, body.contract_id);
    }

    return NextResponse.json({ success: true });
}
