import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const body = await req.json();

    let stmt = db.prepare(
        `SELECT contract_id FROM disputes WHERE contract_id = ?`
    );
    let dispute = stmt.all(body.contract_id);
    if (dispute.length == 0) {
        stmt = db.prepare(
            `INSERT INTO disputes (contract_id, dispute_smart_contract) VALUES (?);`
        );
        console.log(body);
        stmt.run(body.contract_id, body.dispute_smart_contract);
    } else {
        stmt = db.prepare(
            `UPDATE disputes SET dispute_smart_contract = ? WHERE contract_id = ?;`
        );
        stmt.run(body.dispute_smart_contract, body.contract_id);
    }

    return NextResponse.json({ message: "success" });
}
