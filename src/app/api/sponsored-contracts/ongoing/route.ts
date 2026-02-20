import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const pk = await req.nextUrl.searchParams.get("pk");
    let stmt = db.prepare(
        `SELECT 
            id,
            pk_buyer,
            pk_vendor,
            price,
            item_description,
            tip_completion,
            tip_dispute,
            protocol_version,
            timeout_delay,
            algorithm_suite,
            sponsor,
            commitment,
            optimistic_smart_contract,
            opening_value,
            session_key_private,
            session_key_address,
            num_blocks,
            num_gates,
            dispute_smart_contract,
            pk_buyer_sponsor AS pk_sb,
            pk_vendor_sponsor AS pk_sv
        FROM contracts LEFT JOIN disputes
        ON contracts.id = disputes.contract_id
        WHERE 
            (pk_buyer = ? OR 
                pk_vendor = ? OR 
                pk_sb = ? OR
                pk_sv = ?) AND 
            accepted <> 0 AND 
            sponsor IS NOT NULL;`
    );
    const contracts = stmt.all(pk, pk, pk, pk) as any[];
    const cleaned = contracts.map((contract) => {
        if (contract.pk_vendor?.toLowerCase() !== (pk || "").toLowerCase()) {
            delete contract.session_key_private;
            delete contract.session_key_address;
        }
        return contract;
    });

    return NextResponse.json(cleaned);
}
