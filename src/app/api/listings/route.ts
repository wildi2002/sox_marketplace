import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        // include_pending=1: vendor view — show all active listings including ZK-pending ones.
        // Default (marketplace): only show ZK listings that have a completed proof.
        const includePending = req.nextUrl.searchParams.get("include_pending") === "1";
        const zkFilter = includePending ? "" : "AND (l.algorithm_suite != 'zk' OR l.zk_proof IS NOT NULL)";

        const listings = db.prepare(`
            SELECT l.*,
                   COUNT(CASE WHEN pr.status = 'pending' THEN 1 END) as pending_requests
            FROM listings l
            LEFT JOIN purchase_requests pr ON pr.listing_id = l.id
            WHERE l.active = 1 ${zkFilter}
            GROUP BY l.id
            ORDER BY l.created_at DESC
        `).all();
        return NextResponse.json(listings);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            title, description, price, tip_completion, tip_dispute, timeout_delay, algorithm_suite, pk_vendor,
            listing_type, preview_image, preview_hash, brisque_value,
            zk_proof, zk_proof_full, zk_h_pt, zk_thumbnail_hash, zk_brisque, zk_vk_hash,
            ext_img_thumb_hash, ext_img_width, ext_img_height, ext_img_size,
            preview_audio, ext_audio_preview_hash, ext_audio_duration, ext_audio_bitrate, ext_audio_size,
            preview_crop_image, ext_img_crop_hash, ext_img_crop_x, ext_img_crop_y,
            preview_audio_lowres, ext_audio_lowres_hash,
            ext_audio_preview_sr, ext_audio_lowres_sr,
            preview_video_thumb, ext_video_thumb_hash, ext_video_width, ext_video_height,
            ext_video_duration, ext_video_bitrate, ext_video_size, ext_video_fps,
            ext_video_clip_frames, preview_video_clip, ext_video_clip_hash,
        } = body;

        if (!title || !price || !pk_vendor) {
            return NextResponse.json({ error: "Missing required fields: title, price, pk_vendor" }, { status: 400 });
        }

        const result = db.prepare(`
            INSERT INTO listings (title, description, price, tip_completion, tip_dispute, timeout_delay, algorithm_suite, pk_vendor,
                listing_type, preview_image, preview_hash, brisque_value,
                zk_proof, zk_proof_full, zk_h_pt, zk_thumbnail_hash, zk_brisque, zk_vk_hash,
                ext_img_thumb_hash, ext_img_width, ext_img_height, ext_img_size,
                preview_audio, ext_audio_preview_hash, ext_audio_duration, ext_audio_bitrate, ext_audio_size,
                preview_crop_image, ext_img_crop_hash, ext_img_crop_x, ext_img_crop_y,
                preview_audio_lowres, ext_audio_lowres_hash,
                ext_audio_preview_sr, ext_audio_lowres_sr,
                preview_video_thumb, ext_video_thumb_hash, ext_video_width, ext_video_height,
                ext_video_duration, ext_video_bitrate, ext_video_size, ext_video_fps,
                ext_video_clip_frames, preview_video_clip, ext_video_clip_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            title,
            description || "",
            price,
            tip_completion ?? 0,
            tip_dispute ?? 0,
            timeout_delay ?? 3600,
            algorithm_suite ?? "default",
            pk_vendor,
            listing_type ?? "general",
            preview_image ?? null,
            preview_hash ?? null,
            brisque_value ?? null,
            zk_proof ?? null,
            zk_proof_full ?? null,
            zk_h_pt ?? null,
            zk_thumbnail_hash ?? null,
            zk_brisque ?? null,
            zk_vk_hash ?? null,
            ext_img_thumb_hash ?? null,
            ext_img_width ?? null,
            ext_img_height ?? null,
            ext_img_size ?? null,
            preview_audio ?? null,
            ext_audio_preview_hash ?? null,
            ext_audio_duration ?? null,
            ext_audio_bitrate ?? null,
            ext_audio_size ?? null,
            preview_crop_image ?? null,
            ext_img_crop_hash ?? null,
            ext_img_crop_x ?? null,
            ext_img_crop_y ?? null,
            preview_audio_lowres ?? null,
            ext_audio_lowres_hash ?? null,
            ext_audio_preview_sr ?? null,
            ext_audio_lowres_sr ?? null,
            preview_video_thumb ?? null,
            ext_video_thumb_hash ?? null,
            ext_video_width ?? null,
            ext_video_height ?? null,
            ext_video_duration ?? null,
            ext_video_bitrate ?? null,
            ext_video_size ?? null,
            ext_video_fps ?? null,
            ext_video_clip_frames ?? null,
            preview_video_clip ?? null,
            ext_video_clip_hash ?? null,
        );

        return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
