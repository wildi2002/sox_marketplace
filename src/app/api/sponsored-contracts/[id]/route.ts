import { NextRequest, NextResponse } from "next/server";
import db from "../../../lib/sqlite";

interface DBSearchResult {
    optimistic_smart_contract: string;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    let stmt = db.prepare(
        `SELECT optimistic_smart_contract FROM contracts WHERE id = ?`
    );
    const res = stmt.all(id) as DBSearchResult[];
    const address = res[0]?.optimistic_smart_contract;

    if (!address) {
        return NextResponse.json(
            { error: "Contract not found or missing optimistic address" },
            { status: 404 }
        );
    }

    const withDetails = req.nextUrl.searchParams.get("withDetails");
    if (withDetails) {
    }
    return NextResponse.json(res);
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const data = await req.json();
    let stmt = db.prepare(
        `UPDATE contracts SET optimistic_smart_contract = ?, session_key_private = ?, session_key_address = ? WHERE id = ?`
    );
    const result = stmt.run(
        data.contractAddress,
        data.sessionKeyPrivateKey || null,
        data.sessionKeyAddress || null,
        id
    );

    return NextResponse.json({
        updated: result.changes,
        id,
    });
}
