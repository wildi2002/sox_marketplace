import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

function getAllContracts() {
    const stmt = db.prepare(
        "SELECT * FROM contracts WHERE accepted <> 0 AND sponsor IS NULL;"
    );
    const contracts = stmt.all();

    return NextResponse.json(contracts);
}

function getContractsOfUser(pk: string) {
    const stmt = db.prepare(
        `SELECT * FROM contracts 
        WHERE accepted <> 0 AND 
        sponsor IS NULL AND
            (pk_buyer = ? OR 
            pk_vendor = ?)`
    );

    const contracts = stmt.all(pk, pk);

    return NextResponse.json(contracts);
}

export async function GET(req: NextRequest) {
    const pk = req.nextUrl.searchParams.get("pk");
    if (!pk) {
        return getAllContracts();
    }

    return getContractsOfUser(pk);
}
