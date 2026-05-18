import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { UPLOADS_PATH, WASM_PATH } from "../files/[id]/route";


let hex_to_bytes: any;
let initSync: any;
let bytes_to_hex: any;

try {
    const cryptoLib = require("@/app/lib/crypto_lib");
    hex_to_bytes = cryptoLib.hex_to_bytes;
    initSync = cryptoLib.initSync;
    bytes_to_hex = cryptoLib.bytes_to_hex;
} catch (wasmImportError: any) {
    console.warn("⚠️ Unable to import crypto_lib module:", wasmImportError.message);
    // Functions will be undefined, we'll handle this in the code
}

const execFileAsync = promisify(execFile);

const PRECONTRACT_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "precontract_cli"
);

async function parseMultipartRequest(
    req: Request,
    contentType: string
): Promise<{ fields: Record<string, string>; tempFilePath: string }> {
    const Busboy = require("busboy");
    const body = req.body;
    if (!body) {
        throw new Error("Request body is empty");
    }

    const fields: Record<string, string> = {};
    let tempFilePath: string | null = null;
    let fileWritePromise: Promise<void> | null = null;
    let fileCount = 0;

    const tempDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const bb = Busboy({
        headers: { "content-type": contentType },
    });

    bb.on("field", (name: string, value: string) => {
        fields[name] = value;
    });

    bb.on(
        "file",
        (
            _name: string,
            file: NodeJS.ReadableStream,
            infoOrFilename: { filename?: string } | string
        ) => {
            fileCount += 1;
            if (fileCount > 1) {
                file.resume();
                return;
            }
            const filename =
                typeof infoOrFilename === "string"
                    ? infoOrFilename
                    : infoOrFilename?.filename || "upload.bin";
            const safeName = path.basename(filename || "upload.bin");
            tempFilePath = path.join(tempDir, `temp_${Date.now()}_${safeName}`);

            const writeStream = fs.createWriteStream(tempFilePath);
            file.pipe(writeStream);

            fileWritePromise = new Promise((resolve, reject) => {
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
                file.on("error", reject);
            });
        }
    );

    const parsePromise = new Promise<void>((resolve, reject) => {
        bb.on("finish", resolve);
        bb.on("error", reject);
    });

    Readable.fromWeb(body as any).pipe(bb);
    await parsePromise;
    if (fileWritePromise) {
        await fileWritePromise;
    }

    if (!tempFilePath) {
        throw new Error("Missing file");
    }

    return { fields, tempFilePath };
}

export async function GET(req: NextRequest) {
    try {
        const pk = await req.nextUrl.searchParams.get("pk");
        const rows = db.prepare(`SELECT * FROM contracts
            WHERE pk_buyer = ? AND accepted = 0`).all(pk) as any[];

        // For extended_image / extended_audio contracts where the preview is null on the contract,
        // fall back to the listing's preview fields via the purchase_requests join.
        const contracts = rows.map((c) => {
            if (c.algorithm_suite === "extended_image" && !c.preview_image) {
                const listing = db.prepare(`
                    SELECT l.preview_image
                    FROM purchase_requests pr
                    JOIN listings l ON l.id = pr.listing_id
                    WHERE pr.contract_id = ? LIMIT 1
                `).get(c.id) as { preview_image: string | null } | undefined;
                if (listing?.preview_image) return { ...c, preview_image: listing.preview_image };
            }
            if ((c.algorithm_suite === "extended_audio" || c.algorithm_suite === "extended_audio_lowres" || c.algorithm_suite === "extended_audio_both") && !c.preview_audio) {
                const listing = db.prepare(`
                    SELECT l.preview_audio, l.preview_audio_lowres, l.ext_audio_lowres_hash
                    FROM purchase_requests pr
                    JOIN listings l ON l.id = pr.listing_id
                    WHERE pr.contract_id = ? LIMIT 1
                `).get(c.id) as { preview_audio: string | null; preview_audio_lowres: string | null; ext_audio_lowres_hash: string | null } | undefined;
                if (listing) return { ...c, preview_audio: listing.preview_audio, preview_audio_lowres: listing.preview_audio_lowres, ext_audio_lowres_hash: listing.ext_audio_lowres_hash };
            }
            if ((c.algorithm_suite === "extended_image_crop" || c.algorithm_suite === "extended_image_dual") && !c.preview_crop_image) {
                const listing = db.prepare(`
                    SELECT l.preview_image, l.preview_crop_image, l.ext_img_crop_hash, l.ext_img_crop_x, l.ext_img_crop_y
                    FROM purchase_requests pr
                    JOIN listings l ON l.id = pr.listing_id
                    WHERE pr.contract_id = ? LIMIT 1
                `).get(c.id) as { preview_image: string | null; preview_crop_image: string | null; ext_img_crop_hash: string | null; ext_img_crop_x: number | null; ext_img_crop_y: number | null } | undefined;
                if (listing) return { ...c, preview_image: listing.preview_image, preview_crop_image: listing.preview_crop_image, ext_img_crop_hash: listing.ext_img_crop_hash, ext_img_crop_x: listing.ext_img_crop_x, ext_img_crop_y: listing.ext_img_crop_y };
            }
            if ((c.algorithm_suite === "extended_video" || c.algorithm_suite === "extended_video_clip" || c.algorithm_suite === "extended_video_both") && !c.preview_video_thumb) {
                const listing = db.prepare(`
                    SELECT l.preview_video_thumb, l.ext_video_thumb_hash, l.ext_video_width, l.ext_video_height,
                           l.ext_video_duration, l.ext_video_bitrate, l.ext_video_size, l.ext_video_fps,
                           l.ext_video_clip_frames, l.preview_video_clip, l.ext_video_clip_hash
                    FROM purchase_requests pr
                    JOIN listings l ON l.id = pr.listing_id
                    WHERE pr.contract_id = ? LIMIT 1
                `).get(c.id) as any | undefined;
                if (listing) return { ...c, ...listing };
            }
            if (!c.desc_d) {
                const listing = db.prepare(`
                    SELECT l.desc_d, l.desc_dim, l.desc_thumb, l.desc_quality
                    FROM purchase_requests pr
                    JOIN listings l ON l.id = pr.listing_id
                    WHERE pr.contract_id = ? LIMIT 1
                `).get(c.id) as { desc_d: string | null; desc_dim: string | null; desc_thumb: string | null; desc_quality: string | null } | undefined;
                if (listing?.desc_d) return { ...c, desc_d: listing.desc_d, desc_dim: listing.desc_dim, desc_thumb: listing.desc_thumb, desc_quality: listing.desc_quality };
                if (listing?.desc_quality) return { ...c, desc_quality: listing.desc_quality };
            }
            return c;
        });

        return NextResponse.json(contracts);
    } catch (error: any) {
        console.error("❌ Error in GET /api/precontracts:", error);
        return NextResponse.json(
            { 
                error: error instanceof Error ? error.message : String(error),
                ...(process.env.NODE_ENV === "development" && { stack: error?.stack })
            },
            { 
                status: 500,
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                }
            }
        );
    }
}

export async function PUT(req: Request) {
    try {
        console.log("📥 PUT /api/precontracts appelé");
        
        // Vérifier que la base de données est accessible
        try {
            db.prepare("SELECT 1").get();
        } catch (dbTestError: any) {
            console.error("❌ Database is not accessible:", dbTestError);
            throw new Error(`Database inaccessible: ${dbTestError.message || dbTestError}`);
        }
        
        // Détecter si c'est FormData ou JSON
        const contentType = req.headers.get("content-type") || "";
        console.log("📋 Content-Type:", contentType);
        
        let data: any;
        let filePath: string | null = null;
        let preOut: any = null;

        if (contentType.includes("multipart/form-data")) {
            // Web mode: streaming multipart to avoid loading file into RAM
            let tempFilePath: string | null = null;
            try {
                const parsed = await parseMultipartRequest(req, contentType);
                tempFilePath = parsed.tempFilePath;
                data = {
                    pk_buyer: parsed.fields.pk_buyer,
                    pk_vendor: parsed.fields.pk_vendor,
                    price: parsed.fields.price,
                    tip_completion: parsed.fields.tip_completion,
                    tip_dispute: parsed.fields.tip_dispute,
                    protocol_version: parsed.fields.protocol_version,
                    timeout_delay: parsed.fields.timeout_delay,
                    algorithm_suite: parsed.fields.algorithm_suite,
                    file_name: parsed.fields.file_name,
                };

                const { stdout } = await execFileAsync(PRECONTRACT_CLI_PATH, [tempFilePath]);
                preOut = JSON.parse(stdout.toString());
            } catch (error: any) {
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
                console.error("Error executing precontract_cli:", error);
                return NextResponse.json(
                    { error: `Error calculating precontract: ${error.message || error.toString()}` },
                    { status: 500 }
                );
            } finally {
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            }

            // Move encrypted file to uploads directory
            if (preOut?.ciphertext_path && fs.existsSync(preOut.ciphertext_path)) {
                filePath = preOut.ciphertext_path;
            }
        } else {
            // Electron mode: JSON with preOut
            try {
                data = await req.json();
                preOut = data.preOut;
            } catch (error: any) {
                console.error("Error parsing JSON request:", error);
                return NextResponse.json(
                    { error: `Error parsing JSON request: ${error.message || error.toString()}` },
                    { status: 400 }
                );
            }
        }

        // If data comes with preOut (Electron format or server-side calculated), extract it
        let contractData: any;
        if (preOut) {
            // Electron format or server-side calculated: preOut contains calculation results
            console.log("🔍 Debug preOut:", JSON.stringify(preOut, null, 2));
            console.log("🔍 PreOut keys:", Object.keys(preOut || {}));
            let commitment = preOut.commitment_c_hex || preOut.commitment || "";
            console.log("🔍 Commitment trouvé:", commitment ? `${commitment.substring(0, 20)}...` : "VIDE");
            
            // If commitment doesn't have 0x prefix, add it
            if (commitment && !commitment.startsWith("0x")) {
                commitment = "0x" + commitment;
            }
            
            // Verify that commitment is not empty and has correct length (32 bytes = 64 hex chars)
            if (!commitment || commitment === "0x") {
                console.error("❌ Commitment manquant dans preOut:", JSON.stringify(preOut, null, 2));
                return NextResponse.json(
                    { error: `Commitment missing in preOut data. Available fields: ${Object.keys(preOut).join(", ")}. Verify that commitment_c_hex is present in binary output.` },
                    { status: 400 }
                );
            }
            
            // Verify length (32 bytes = 64 hex chars after 0x)
            if (commitment.length !== 66) { // 0x + 64 hex chars
                console.error("❌ Invalid commitment length:", commitment, "length:", commitment.length);
                return NextResponse.json(
                    { error: `Invalid commitment length: ${commitment.length} characters (expected 66 with 0x). Verify that commitment_c_hex contains 32 bytes encoded in hex.` },
                    { status: 400 }
                );
            }
            
            contractData = {
                item_description: preOut.desc_hex || preOut.description_hex || data.item_description || "",
                opening_value: preOut.commitment_o_hex || preOut.opening_value || "",
                pk_buyer: data.pk_buyer,
                pk_vendor: data.pk_vendor,
                price: data.price,
                num_blocks: preOut.num_blocks || 0,
                num_gates: preOut.num_gates || 0,
                commitment: commitment,
                tip_completion: data.tip_completion || 0,
                tip_dispute: data.tip_dispute || 0,
                protocol_version: data.protocol_version || "1",
                timeout_delay: data.timeout_delay || 3600,
                algorithm_suite: data.algorithm_suite || "AES-128-CTR",
                file: preOut.file || preOut.ciphertext || "",
                file_path: filePath || "",
                file_name: preOut.file_name || data.file_name || "",
                listing_type: data.listing_type || null,
                preview_image: data.preview_image || null,
                preview_hash: data.preview_hash || null,
                brisque_value: data.brisque_value ?? null,
                zk_proof: data.zk_proof || null,
                zk_proof_full: data.zk_proof_full || null,
                zk_h_ct: data.zk_h_ct || null,
                zk_c_k: data.zk_c_k || null,
                zk_thumbnail_hash: data.zk_thumbnail_hash || null,
                zk_brisque: data.zk_brisque ?? null,
                zk_h_pt: data.zk_h_pt || null,
                zk_vk_hash: data.zk_vk_hash || null,
                ext_img_thumb_hash: data.ext_img_thumb_hash || null,
                ext_img_width: data.ext_img_width ?? null,
                ext_img_height: data.ext_img_height ?? null,
                ext_img_size: data.ext_img_size ?? null,
                preview_audio: data.preview_audio || null,
                ext_audio_preview_hash: data.ext_audio_preview_hash || null,
                ext_audio_duration: data.ext_audio_duration ?? null,
                ext_audio_bitrate: data.ext_audio_bitrate ?? null,
                ext_audio_size: data.ext_audio_size ?? null,
                preview_crop_image: data.preview_crop_image || null,
                ext_img_crop_hash: data.ext_img_crop_hash || null,
                ext_img_crop_x: data.ext_img_crop_x ?? null,
                ext_img_crop_y: data.ext_img_crop_y ?? null,
                preview_audio_lowres: data.preview_audio_lowres || null,
                ext_audio_lowres_hash: data.ext_audio_lowres_hash || null,
                ext_audio_preview_sr: data.ext_audio_preview_sr ?? null,
                ext_audio_lowres_sr: data.ext_audio_lowres_sr ?? null,
                preview_video_thumb: data.preview_video_thumb || null,
                ext_video_thumb_hash: data.ext_video_thumb_hash || null,
                ext_video_width: data.ext_video_width ?? null,
                ext_video_height: data.ext_video_height ?? null,
                ext_video_duration: data.ext_video_duration ?? null,
                ext_video_bitrate: data.ext_video_bitrate ?? null,
                ext_video_size: data.ext_video_size ?? null,
                ext_video_fps: data.ext_video_fps ?? null,
                ext_video_clip_frames: data.ext_video_clip_frames ?? null,
                preview_video_clip: data.preview_video_clip || null,
                ext_video_clip_hash: data.ext_video_clip_hash || null,
                desc_d: data.desc_d || preOut.desc_hex || null,
                desc_dim: data.desc_dim || preOut.dim_hex || null,
                desc_thumb: data.desc_thumb || null,
                desc_quality: data.desc_quality || null,
            };
        } else {
            // Standard format (should no longer be used)
            contractData = data;
        }
        
        console.log("🔍 Contract data to insert:", JSON.stringify(contractData, null, 2));
        
        let stmt;
        let result;
        try {
            stmt = db.prepare(`INSERT INTO contracts (
                item_description, opening_value,
                pk_buyer, pk_vendor, price, num_blocks,
                num_gates, commitment, tip_completion, tip_dispute,
                protocol_version, timeout_delay, algorithm_suite,
                accepted, file_name,
                listing_type, preview_image, preview_hash, brisque_value,
                zk_proof, zk_proof_full, zk_h_ct, zk_c_k, zk_thumbnail_hash, zk_brisque,
                zk_h_pt, zk_vk_hash,
                ext_img_thumb_hash, ext_img_width, ext_img_height, ext_img_size,
                preview_audio, ext_audio_preview_hash, ext_audio_duration, ext_audio_bitrate, ext_audio_size,
                preview_crop_image, ext_img_crop_hash, ext_img_crop_x, ext_img_crop_y,
                preview_audio_lowres, ext_audio_lowres_hash,
                ext_audio_preview_sr, ext_audio_lowres_sr,
                preview_video_thumb, ext_video_thumb_hash, ext_video_width, ext_video_height,
                ext_video_duration, ext_video_bitrate, ext_video_size, ext_video_fps,
                ext_video_clip_frames, preview_video_clip, ext_video_clip_hash,
                desc_d, desc_dim, desc_thumb, desc_quality
            ) VALUES (
                ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                0, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?
            );`);
            result = stmt.run(
                contractData.item_description,
                contractData.opening_value,
                contractData.pk_buyer,
                contractData.pk_vendor,
                contractData.price,
                contractData.num_blocks,
                contractData.num_gates,
                contractData.commitment,
                contractData.tip_completion,
                contractData.tip_dispute,
                contractData.protocol_version,
                contractData.timeout_delay,
                contractData.algorithm_suite,
                contractData.file_name,
                contractData.listing_type,
                contractData.preview_image,
                contractData.preview_hash,
                contractData.brisque_value,
                contractData.zk_proof,
                contractData.zk_proof_full,
                contractData.zk_h_ct,
                contractData.zk_c_k,
                contractData.zk_thumbnail_hash,
                contractData.zk_brisque,
                contractData.zk_h_pt,
                contractData.zk_vk_hash,
                contractData.ext_img_thumb_hash,
                contractData.ext_img_width,
                contractData.ext_img_height,
                contractData.ext_img_size,
                contractData.preview_audio,
                contractData.ext_audio_preview_hash,
                contractData.ext_audio_duration,
                contractData.ext_audio_bitrate,
                contractData.ext_audio_size,
                contractData.preview_crop_image,
                contractData.ext_img_crop_hash,
                contractData.ext_img_crop_x,
                contractData.ext_img_crop_y,
                contractData.preview_audio_lowres,
                contractData.ext_audio_lowres_hash,
                contractData.ext_audio_preview_sr,
                contractData.ext_audio_lowres_sr,
                contractData.preview_video_thumb,
                contractData.ext_video_thumb_hash,
                contractData.ext_video_width,
                contractData.ext_video_height,
                contractData.ext_video_duration,
                contractData.ext_video_bitrate,
                contractData.ext_video_size,
                contractData.ext_video_fps,
                contractData.ext_video_clip_frames,
                contractData.preview_video_clip,
                contractData.ext_video_clip_hash,
                contractData.desc_d,
                contractData.desc_dim,
                contractData.desc_thumb,
                contractData.desc_quality,
            );
        } catch (dbError: any) {
            console.error("❌ Error inserting into database:", dbError);
            console.error("❌ Stack:", dbError?.stack);
            console.error("❌ Data that caused the error:", JSON.stringify(contractData, null, 2));
            throw new Error(`Database error: ${dbError.message || dbError}`);
        }
        const id = result.lastInsertRowid;
        console.log("✅ Contract inserted with ID:", id);

        // If a file is provided, save it
        if (contractData.file_path) {
            if (!fs.existsSync(contractData.file_path)) {
                return NextResponse.json(
                    { error: `Encrypted file not found: ${contractData.file_path}` },
                    { status: 400 }
                );
            }
            const fileName = `file_${id}.enc`;
            const destPath = path.join(UPLOADS_PATH, fileName);
            fs.copyFileSync(contractData.file_path, destPath);
            
            // Clean up temporary file after copy
            if (contractData.file_path.startsWith(path.join(process.cwd(), "tmp"))) {
                try {
                    fs.unlinkSync(contractData.file_path);
                } catch (e) {
                    console.warn("Unable to delete temporary file:", contractData.file_path);
                }
            }
        } else if (contractData.file) {
            try {
                fs.mkdirSync(UPLOADS_PATH, { recursive: true });
                const fileName = `file_${id}.enc`;
                // Decode hex ciphertext with Node.js Buffer — strip 0x prefix first because
                // Buffer.from("0x...", "hex") stops at the invalid 'x' and produces 0 bytes.
                const fileHex = contractData.file.replace(/^0x/i, "");
                fs.writeFileSync(path.join(UPLOADS_PATH, fileName), Buffer.from(fileHex, "hex"));
            } catch (fileError: any) {
                console.error("❌ Error saving ciphertext file:", fileError);
                throw new Error(`Error saving file: ${fileError.message || fileError}`);
            }
        }
        
        // Extract key from preOut
        // Rust binary should return key_hex in JSON output
        let key: string | null = null;
        if (preOut) {
            // Essayer différentes variantes du nom de champ
            const rawKey = preOut.key_hex || preOut.key || null;
            
            if (rawKey) {
                // Format key with 0x prefix if necessary
                if (typeof rawKey === "string") {
                    key = rawKey.startsWith("0x") ? rawKey : "0x" + rawKey;
                } else if (Array.isArray(rawKey)) {
                    // If key is a byte array, convert to hex
                    key = "0x" + Buffer.from(rawKey).toString("hex");
                }
            }
        }
        
        // Return data needed by frontend
        return NextResponse.json({ 
            id,
            key: key || null,
            h_circuit: preOut?.h_circuit_hex || preOut?.h_circuit || contractData.commitment || null,
            h_ct: preOut?.h_ct_hex || preOut?.h_ct || null
        });
    } catch (error: any) {
        console.error("❌ ERROR in PUT /api/precontracts:");
        console.error("   Message:", error?.message);
        console.error("   Name:", error?.name);
        console.error("   Code:", error?.code);
        console.error("   Stack:", error?.stack);
        
        // Ensure we always return JSON, even on error
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isDev = process.env.NODE_ENV === "development";
        
        const responseBody: any = { 
            error: errorMessage || "Error creating precontract"
        };
        
        if (isDev) {
            responseBody.details = {
                message: errorMessage,
                stack: error?.stack,
                name: error?.name,
                code: error?.code,
                toString: error?.toString()
            };
        }
        
        console.log("📤 JSON error response:", JSON.stringify(responseBody, null, 2));
        
        return NextResponse.json(
            responseBody,
            { 
                status: 500,
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                }
            }
        );
    }
}
