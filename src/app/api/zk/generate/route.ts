import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ZK_HOST_PATH = path.join(process.cwd(), "src", "zk", "target", "release", "zk-host");
const BRISQUE_SCRIPT = path.join(process.cwd(), "src", "scripts", "brisque_score.py");

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

function ensureTmpDir(): string {
    const tmpDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

// Fallback: compute BRISQUE via Python from RGBA bytes (when zk-host unavailable)
async function computeBrisqueFallback(
    imageHex: string,
    width: number,
    height: number
): Promise<number | null> {
    const tmpDir = ensureTmpDir();
    const tmpPath = path.join(tmpDir, `brisque_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
    try {
        const raw = Buffer.from(imageHex.startsWith("0x") ? imageHex.slice(2) : imageHex, "hex");
        fs.writeFileSync(tmpPath, raw);
        const { stdout } = await execFileAsync(
            PYTHON3,
            [BRISQUE_SCRIPT, tmpPath, String(width), String(height)],
            { timeout: 60000 }
        );
        const result = JSON.parse(stdout.trim());
        if (result.error) { console.error("BRISQUE script error:", result.error); return null; }
        return typeof result.brisque === "number" ? result.brisque : null;
    } catch (e: any) {
        console.error("BRISQUE fallback failed:", e.message);
        return null;
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        // Only accepts thumbnail RGBA bytes (small, public data — NOT the original image).
        // Full ZK proof generation must happen locally at the vendor's machine (Electron).
        const { image_hex, width, height } = body;

        if (!image_hex || !width || !height) {
            return NextResponse.json(
                { error: "Missing image_hex, width, or height" },
                { status: 400 }
            );
        }

        const brisque = await computeBrisqueFallback(image_hex, width, height);
        return NextResponse.json({ brisque });
    } catch (error: any) {
        console.error("Error in POST /api/zk/generate:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
