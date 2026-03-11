import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

// Verify: proof = SHA256(c_k_bytes || brisque_float32_LE)
// c_k must equal preview_hash (commitment to image)
function verifyCommitment(
    proof: string,
    c_k: string,
    brisque: number,
    preview_hash: string
): { valid: boolean; reason?: string } {
    // c_k must match preview_hash
    const ckNorm = c_k.replace("0x", "").toLowerCase();
    const phNorm = preview_hash.replace("0x", "").toLowerCase();
    if (ckNorm !== phNorm) {
        return { valid: false, reason: "c_k does not match preview_hash" };
    }

    // Recompute proof = SHA256(c_k_bytes || brisque_float32_LE)
    const ckBytes = Buffer.from(ckNorm, "hex");
    const brisqueBuf = Buffer.alloc(4);
    brisqueBuf.writeFloatLE(brisque, 0);
    const combined = Buffer.concat([ckBytes, brisqueBuf]);
    const expected = createHash("sha256").update(combined).digest("hex");

    const proofNorm = proof.replace("0x", "").toLowerCase();
    if (proofNorm !== expected) {
        return { valid: false, reason: "Proof does not match SHA256(c_k || BRISQUE_LE)" };
    }

    return { valid: true };
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { proof, preview_hash, brisque, c_k } = body;

        if (!proof || !c_k || !preview_hash || brisque == null) {
            return NextResponse.json(
                { valid: false, reason: "Missing required fields: proof, c_k, preview_hash, brisque" },
                { status: 400 }
            );
        }

        const result = verifyCommitment(proof, c_k, Number(brisque), preview_hash);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Error in POST /api/zk/verify:", error);
        return NextResponse.json({ valid: false, reason: error.message }, { status: 500 });
    }
}
