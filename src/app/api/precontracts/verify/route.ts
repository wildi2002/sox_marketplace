import db from "../../../lib/sqlite";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { UPLOADS_PATH } from "../../files/[id]/route";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHECK_PRECONTRACT_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "check_precontract_cli"
);

export async function POST(req: Request) {
    try {
        let id: any;
        try {
            const body = await req.json();
            id = body.id;
        } catch (error: any) {
            console.error("Erreur lors du parsing JSON de la requête:", error);
            return NextResponse.json(
                { error: `Erreur lors du parsing de la requête JSON: ${error.message || error.toString()}` },
                { status: 400 }
            );
        }

        if (!id) {
            return NextResponse.json(
                { error: "Le champ 'id' est requis" },
                { status: 400 }
            );
        }

        const stmt = db.prepare(
            `SELECT item_description, commitment, opening_value FROM contracts WHERE id = ?`
        );
        const row = stmt.get(id as number);

        if (!row) {
            return NextResponse.json(
                { error: `Contrat ${id} introuvable` },
                { status: 404 }
            );
        }

        const { item_description, commitment, opening_value } = row as {
            item_description: string;
            commitment: string;
            opening_value: string;
        };

        const cipherPath = path.join(UPLOADS_PATH, `file_${id}.enc`);

        if (!fs.existsSync(cipherPath)) {
            return NextResponse.json(
                {
                    error: `Fichier chiffré introuvable pour le contrat ${id}`,
                },
                { status: 404 }
            );
        }

        const { stdout } = await execFileAsync(CHECK_PRECONTRACT_CLI_PATH, [
            cipherPath,
            item_description,
            commitment,
            opening_value,
        ]);

        let parsed: any;
        try {
            parsed = JSON.parse(stdout.toString());
        } catch (e: any) {
            console.error(
                "Erreur de parsing JSON depuis check_precontract_cli:",
                e,
                stdout.toString()
            );
            return NextResponse.json(
                {
                    error:
                        "Erreur serveur: sortie invalide du binaire de vérification natif",
                },
                { status: 500 }
            );
        }

        return NextResponse.json(parsed);
    } catch (error: any) {
        console.error("Erreur dans POST /api/precontracts/verify:", error);
        // S'assurer qu'on retourne toujours du JSON, même en cas d'erreur
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { 
                error: `Erreur serveur: ${errorMessage}`,
                details: process.env.NODE_ENV === "development" ? error.stack : undefined
            },
            { 
                status: 500,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
}

















