import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ZK_HOST_PATH = path.join(process.cwd(), "src", "zk", "target", "release", "zk-host");
const BRISQUE_SCRIPT = path.join(process.cwd(), "src", "scripts", "brisque_score.py");

// Resolve python3 path: prefer miniconda, fall back to system python3
function findPython3(): string {
    const candidates = [
        "/Users/timo/miniconda3/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "python3",
    ];
    for (const p of candidates) {
        if (p === "python3" || fs.existsSync(p)) return p;
    }
    return "python3";
}
const PYTHON3 = findPython3();

async function computeBrisque(imageHex: string, width: number, height: number): Promise<number | null> {
    const tmpDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tmpPath = path.join(tmpDir, `brisque_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
    try {
        const raw = Buffer.from(imageHex.startsWith("0x") ? imageHex.slice(2) : imageHex, "hex");
        fs.writeFileSync(tmpPath, raw);

        const { stdout } = await execFileAsync(PYTHON3, [BRISQUE_SCRIPT, tmpPath, String(width), String(height)], {
            timeout: 60000,
        });
        const result = JSON.parse(stdout.trim());
        if (result.error) {
            console.error("BRISQUE script error:", result.error);
            return null;
        }
        return typeof result.brisque === "number" ? result.brisque : null;
    } catch (e: any) {
        console.error("BRISQUE computation failed:", e.message);
        return null;
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { image_hex, key_hex, width, height } = body;

        if (!image_hex) {
            return NextResponse.json({ error: "image_hex is required" }, { status: 400 });
        }

        // Always compute BRISQUE if width/height are provided
        let brisque: number | null = null;
        if (width && height) {
            brisque = await computeBrisque(image_hex, width, height);
        }

        // Try ZK binary if available
        if (!fs.existsSync(ZK_HOST_PATH)) {
            return NextResponse.json({
                available: false,
                brisque,
                proof: null,
                h_ct: null,
                c_k: null,
            });
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
                brisque: result.brisque ?? brisque,
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
