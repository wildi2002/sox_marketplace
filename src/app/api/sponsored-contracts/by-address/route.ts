import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { optimistic_smart_contract } = body;

        if (!optimistic_smart_contract) {
            return NextResponse.json(
                { error: "Missing optimistic_smart_contract" },
                { status: 400 }
            );
        }

        const stmt = db.prepare(
            `SELECT id FROM contracts WHERE optimistic_smart_contract = ?`
        );
        const result = stmt.get(optimistic_smart_contract) as { id: number } | undefined;

        if (!result) {
            return NextResponse.json(
                { error: "Contract not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({ contract_id: result.id });
    } catch (error: any) {
        console.error("Error finding contract by address:", error);
        return NextResponse.json(
            { error: error.message || "Failed to find contract" },
            { status: 500 }
        );
    }
}










