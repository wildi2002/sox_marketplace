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
        // Two modes:
        // 1. Full ZK: { image_file_hex } — original JPEG/PNG bytes, uses zk-host binary
        // 2. BRISQUE fallback: { image_hex, width, height } — RGBA bytes from canvas
        const { image_file_hex, image_hex, width, height } = body;

        const tmpDir = ensureTmpDir();

        // Mode 1: Full ZK proof via zk-host binary
        if (image_file_hex && fs.existsSync(ZK_HOST_PATH)) {
            const imgBytes = Buffer.from(
                image_file_hex.startsWith("0x") ? image_file_hex.slice(2) : image_file_hex,
                "hex"
            );
            // Detect format from magic bytes to choose extension
            const ext = imgBytes[0] === 0xff && imgBytes[1] === 0xd8 ? ".jpg" : ".png";
            const tmpImg = path.join(tmpDir, `zk_img_${Date.now()}${ext}`);
            fs.writeFileSync(tmpImg, imgBytes);
            try {
                const env = { ...process.env, SP1_PROVER: process.env.SP1_PROVER ?? "cpu" };
                const { stdout } = await execFileAsync(
                    ZK_HOST_PATH,
                    ["generate", "--image", tmpImg],
                    { timeout: 1800000, env } // 30 min timeout for proof generation
                );
                const result = JSON.parse(stdout.trim());
                return NextResponse.json(result);
            } catch (zkErr: any) {
                // zk-host crashed or panicked — fall through to BRISQUE-only fallback
                console.error("zk-host generate failed, falling back to BRISQUE:", zkErr.message);
            } finally {
                if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
            }
        }

        // Mode 2: BRISQUE-only fallback (no zk-host or no image_file_hex)
        let brisque: number | null = null;
        if (image_hex && width && height) {
            brisque = await computeBrisqueFallback(image_hex, width, height);
        } else if (image_file_hex) {
            // zk-host not available but we have the file — compute BRISQUE via Python on image file
            const imgBytes = Buffer.from(
                image_file_hex.startsWith("0x") ? image_file_hex.slice(2) : image_file_hex,
                "hex"
            );
            const ext = imgBytes[0] === 0xff && imgBytes[1] === 0xd8 ? ".jpg" : ".png";
            const tmpImg = path.join(tmpDir, `brisque_img_${Date.now()}${ext}`);
            fs.writeFileSync(tmpImg, imgBytes);
            try {
                // Use Python with image file directly
                const { stdout } = await execFileAsync(
                    PYTHON3,
                    ["-c", `
import sys, json
import numpy as np
from brisque import BRISQUE
import skimage.io
img = skimage.io.imread('${tmpImg}')
if len(img.shape) == 3 and img.shape[2] == 4: img = img[:,:,:3]
bq = BRISQUE()
score = float(bq.score(img))
print(json.dumps({'brisque': score}))
`],
                    { timeout: 60000 }
                );
                const r = JSON.parse(stdout.trim());
                brisque = r.brisque ?? null;
            } catch (e: any) {
                console.error("BRISQUE from file failed:", e.message);
            } finally {
                if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
            }
        }

        return NextResponse.json({ available: false, brisque, proof: null, h_ct: null, c_k: null });
    } catch (error: any) {
        console.error("Error in POST /api/zk/generate:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
