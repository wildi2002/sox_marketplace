import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });
        }
        const body = await req.json();
        const { zk_proof, zk_proof_full, zk_h_pt, zk_thumbnail_hash, zk_brisque, zk_vk_hash } = body;

        db.prepare(`
            UPDATE listings
            SET zk_proof = ?, zk_proof_full = ?, zk_h_pt = ?, zk_thumbnail_hash = ?, zk_brisque = ?, zk_vk_hash = ?
            WHERE id = ?
        `).run(zk_proof ?? null, zk_proof_full ?? null, zk_h_pt ?? null, zk_thumbnail_hash ?? null, zk_brisque ?? null, zk_vk_hash ?? null, id);

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
