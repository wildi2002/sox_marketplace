import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ZK_HOST_PATH = path.join(process.cwd(), "src", "zk", "target", "release", "zk-host");

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { proof, h_ct, preview_hash, brisque, c_k } = body;

        if (!fs.existsSync(ZK_HOST_PATH)) {
            return NextResponse.json({ valid: false, reason: "ZK binary not available" });
        }

        const tmpDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        const tmpJsonPath = path.join(tmpDir, `zk_verify_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);

        try {
            const payload = { proof, h_ct, preview_hash, brisque: brisque ?? null, c_k };
            fs.writeFileSync(tmpJsonPath, JSON.stringify(payload));

            const { stdout } = await execFileAsync(ZK_HOST_PATH, ["--verify", tmpJsonPath], { timeout: 600000 });
            const result = JSON.parse(stdout.toString());

            return NextResponse.json(result);
        } finally {
            if (fs.existsSync(tmpJsonPath)) {
                fs.unlinkSync(tmpJsonPath);
            }
        }
    } catch (error: any) {
        console.error("Error in POST /api/zk/verify:", error);
        return NextResponse.json({ valid: false, reason: error.message }, { status: 500 });
    }
}
