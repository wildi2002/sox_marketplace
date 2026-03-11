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
        const { image_hex, key_hex } = body;

        if (!image_hex) {
            return NextResponse.json({ error: "image_hex is required" }, { status: 400 });
        }

        if (!fs.existsSync(ZK_HOST_PATH)) {
            return NextResponse.json({ available: false, brisque: null, proof: null, h_ct: null, c_k: null });
        }

        const tmpDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        const tmpImagePath = path.join(tmpDir, `zk_image_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);

        try {
            const imageBytes = Buffer.from(image_hex.startsWith("0x") ? image_hex.slice(2) : image_hex, "hex");
            fs.writeFileSync(tmpImagePath, imageBytes);

            const args = ["--generate", tmpImagePath];
            if (key_hex) {
                args.push("--key", key_hex.startsWith("0x") ? key_hex.slice(2) : key_hex);
            }

            const { stdout } = await execFileAsync(ZK_HOST_PATH, args, { timeout: 600000 });
            const result = JSON.parse(stdout.toString());

            return NextResponse.json({
                available: true,
                brisque: result.brisque ?? null,
                proof: result.proof ?? null,
                h_ct: result.h_ct ?? null,
                c_k: result.c_k ?? null,
            });
        } finally {
            if (fs.existsSync(tmpImagePath)) {
                fs.unlinkSync(tmpImagePath);
            }
        }
    } catch (error: any) {
        console.error("Error in POST /api/zk/generate:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
