import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ZK_HOST_PATH = path.join(process.cwd(), "src", "zk", "target", "release", "zk-host");

// Hash-based commitment fallback:
// proof = SHA256(c_k_bytes || brisque_float32_LE), c_k must equal preview_hash
function verifyHashCommitment(
    proof: string,
    c_k: string,
    brisque: number,
    preview_hash: string
): { valid: boolean; reason?: string } {
    const ckNorm = c_k.replace("0x", "").toLowerCase();
    const phNorm = preview_hash.replace("0x", "").toLowerCase();
    if (ckNorm !== phNorm) {
        return { valid: false, reason: "c_k does not match preview_hash" };
    }
    const ckBytes = Buffer.from(ckNorm, "hex");
    const brisqueBuf = Buffer.alloc(4);
    brisqueBuf.writeFloatLE(brisque, 0);
    const expected = createHash("sha256").update(Buffer.concat([ckBytes, brisqueBuf])).digest("hex");
    const proofNorm = proof.replace("0x", "").toLowerCase();
    if (proofNorm !== expected) {
        return { valid: false, reason: "Proof does not match SHA256(c_k || BRISQUE_LE)" };
    }
    return { valid: true };
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { proof, proof_full, preview_hash, brisque, c_k, h_ct, thumbnail_hash } = body;

        if (!proof || !c_k || brisque == null) {
            return NextResponse.json(
                { valid: false, reason: "Missing required fields: proof, c_k, brisque" },
                { status: 400 }
            );
        }

        // If proof_full exists → this is a full SP1 Groth16 proof
        if (proof_full && fs.existsSync(ZK_HOST_PATH)) {
            const tmpDir = path.join(process.cwd(), "tmp");
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const tmpJson = path.join(tmpDir, `zk_verify_${Date.now()}.json`);
            try {
                const payload = { proof, proof_full, h_ct: h_ct ?? null, thumbnail_hash: thumbnail_hash ?? null, brisque, c_k };
                fs.writeFileSync(tmpJson, JSON.stringify(payload));
                const env = { ...process.env, SP1_PROVER: process.env.SP1_PROVER ?? "cpu" };
                const { stdout } = await execFileAsync(
                    ZK_HOST_PATH,
                    ["verify", "--json", tmpJson],
                    { timeout: 120000, env }
                );
                const result = JSON.parse(stdout.trim());
                return NextResponse.json(result);
            } finally {
                if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
            }
        }

        // Fallback: hash-based commitment verification
        if (!preview_hash) {
            return NextResponse.json(
                { valid: false, reason: "preview_hash required for hash-commitment verification" },
                { status: 400 }
            );
        }
        const result = verifyHashCommitment(proof, c_k, Number(brisque), preview_hash);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Error in POST /api/zk/verify:", error);
        return NextResponse.json({ valid: false, reason: error.message }, { status: 500 });
    }
}
