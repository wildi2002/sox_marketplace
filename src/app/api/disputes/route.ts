import db from "../../lib/sqlite";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const stmt = db.prepare(
            `SELECT 
                disputes.contract_id, 
                contracts.tip_dispute, 
                disputes.pk_buyer_sponsor, 
                disputes.pk_vendor_sponsor, 
                disputes.dispute_smart_contract,
                contracts.optimistic_smart_contract,
                contracts.pk_buyer,
                contracts.pk_vendor,
                contracts.num_blocks,
                contracts.num_gates
            FROM disputes 
            JOIN contracts 
            ON disputes.contract_id = contracts.id
            WHERE disputes.pk_buyer_sponsor IS NULL OR disputes.pk_vendor_sponsor IS NULL;`
        );
        const contracts = stmt.all();

        return NextResponse.json(contracts || []);
    } catch (error: any) {
        console.error("Error fetching disputes:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch disputes" },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const stmt = db.prepare(`INSERT INTO disputes VALUES (?, ?, ?, ?);`);
        const result = stmt.run(
            body.contract_id,
            body.pk_buyer_sponsor,
            body.pk_vendor_sponsor,
            body.proof_path
        );
        return NextResponse.json({ id: result.lastInsertRowid });
    } catch (error: any) {
        console.error("Error creating dispute:", error);
        return NextResponse.json(
            { error: error.message || "Failed to create dispute" },
            { status: 500 }
        );
    }
}
