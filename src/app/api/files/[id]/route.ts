import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const UPLOADS_PATH = "src/app/uploads/";
export const WASM_PATH = "src/app/lib/crypto_lib/";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const fileName = `file_${id}.enc`;
        const fullPath = path.join(UPLOADS_PATH, fileName);

        if (!fs.existsSync(fullPath)) {
            return NextResponse.json(
                { error: `Fichier chiffré introuvable pour le contrat ${id}` },
                { status: 404 }
            );
        }

        const file = fs.readFileSync(fullPath);
        const hex = Buffer.from(file).toString("hex");

        return NextResponse.json({ file: hex });
    } catch (error: any) {
        console.error("Erreur dans GET /api/files/[id]:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const fileName = `file_${id}.enc`;
        const fullPath = path.join(UPLOADS_PATH, fileName);
        const contentType = req.headers.get("content-type") || "";

        fs.mkdirSync(UPLOADS_PATH, { recursive: true });

        if (contentType.includes("multipart/form-data")) {
            const Busboy = require("busboy");
            const body = req.body;
            if (!body) {
                return NextResponse.json(
                    { error: "Requête vide" },
                    { status: 400 }
                );
            }

            let fileWritePromise: Promise<void> | null = null;
            let gotFile = false;

            const bb = Busboy({
                headers: { "content-type": contentType },
            });

            bb.on("file", (_name: string, file: NodeJS.ReadableStream) => {
                if (gotFile) {
                    file.resume();
                    return;
                }
                gotFile = true;
                const writeStream = fs.createWriteStream(fullPath);
                file.pipe(writeStream);
                fileWritePromise = new Promise((resolve, reject) => {
                    writeStream.on("finish", resolve);
                    writeStream.on("error", reject);
                    file.on("error", reject);
                });
            });

            const parsePromise = new Promise<void>((resolve, reject) => {
                bb.on("finish", resolve);
                bb.on("error", reject);
            });

            Readable.fromWeb(body as any).pipe(bb);
            await parsePromise;
            if (fileWritePromise) {
                await fileWritePromise;
            }

            if (!gotFile) {
                return NextResponse.json(
                    { error: "Fichier manquant" },
                    { status: 400 }
                );
            }
        } else {
            if (!req.body) {
                return NextResponse.json(
                    { error: "Requête vide" },
                    { status: 400 }
                );
            }
            await new Promise<void>((resolve, reject) => {
                const writeStream = fs.createWriteStream(fullPath);
                Readable.fromWeb(req.body as any).pipe(writeStream);
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
            });
        }

        return NextResponse.json({ ok: true, file: fileName });
    } catch (error: any) {
        console.error("Erreur dans PUT /api/files/[id]:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}
