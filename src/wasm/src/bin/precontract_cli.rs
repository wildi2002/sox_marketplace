use anyhow::{bail, Context, Result};
use crypto_lib::{
    compute_precontract_values_v2,
    compute_precontract_image_dual_v3,
    compute_precontract_audio_v3,
};
use hex::encode;
use rand::RngCore;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
struct PrecontractV2Output {
    description_hex: String,
    h_ct_hex: String,
    h_circuit_hex: String,
    commitment_c_hex: String,
    commitment_o_hex: String,
    num_blocks: u32,
    num_gates: u32,
    ciphertext_path: String,
    circuit_path: String,
    key_hex: String,
}

#[derive(Serialize)]
struct PrecontractV3Output {
    /// d = SHA256(T ‖ Q ‖ D) — 32 bytes hex.
    desc_hex: String,
    /// D — dimension/metadata bytes hex.
    dim_hex: String,
    /// Path to T (thumb) bytes written to disk.
    thumb_path: String,
    /// Path to Q (quality) bytes written to disk.
    quality_path: String,
    h_ct_hex: String,
    h_circuit_hex: String,
    commitment_c_hex: String,
    commitment_o_hex: String,
    num_blocks: u32,
    num_gates: u32,
    ciphertext_path: String,
    circuit_path: String,
    key_hex: String,
}

fn parse_key(args: &[String], idx: usize) -> Result<Vec<u8>> {
    if let Some(k) = args.get(idx) {
        let key_bytes = hex::decode(k).context("failed to decode hex key")?;
        if key_bytes.len() != 16 {
            bail!("Key must be 16 bytes, got {}", key_bytes.len());
        }
        Ok(key_bytes)
    } else {
        let mut rnd = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut rnd);
        Ok(rnd.to_vec())
    }
}

fn load_file(path: &PathBuf) -> Result<Vec<u8>> {
    let bytes = fs::read(path).with_context(|| format!("reading {:?}", path))?;
    if bytes.is_empty() {
        bail!("The file is empty.");
    }
    Ok(bytes)
}

fn write_v3_outputs(
    input_path: &PathBuf,
    pre_ct: &[u8],
    pre_circuit: &[u8],
    pre_d: &[u8],
    pre_thumb: &[u8],
    pre_quality: &[u8],
    pre_dim: &[u8],
    pre_h_ct: &[u8],
    pre_h_circuit: &[u8],
    commitment_c: &[u8],
    commitment_o: &[u8],
    num_blocks: u32,
    num_gates: u32,
    key: &[u8],
) -> Result<()> {
    let output_ct = input_path.with_extension("ct");
    let output_circuit = input_path.with_extension("circuit");
    let output_thumb = input_path.with_extension("thumb.bin");
    let output_quality = input_path.with_extension("quality.bin");

    fs::write(&output_ct, pre_ct)
        .with_context(|| format!("writing ciphertext to {:?}", output_ct))?;
    fs::write(&output_circuit, pre_circuit)
        .with_context(|| format!("writing circuit to {:?}", output_circuit))?;
    fs::write(&output_thumb, pre_thumb)
        .with_context(|| format!("writing thumb to {:?}", output_thumb))?;
    fs::write(&output_quality, pre_quality)
        .with_context(|| format!("writing quality to {:?}", output_quality))?;

    let out = PrecontractV3Output {
        desc_hex: encode(pre_d),
        dim_hex: encode(pre_dim),
        thumb_path: output_thumb.to_string_lossy().into_owned(),
        quality_path: output_quality.to_string_lossy().into_owned(),
        h_ct_hex: encode(pre_h_ct),
        h_circuit_hex: encode(pre_h_circuit),
        commitment_c_hex: encode(commitment_c),
        commitment_o_hex: encode(commitment_o),
        num_blocks,
        num_gates,
        ciphertext_path: output_ct.to_string_lossy().into_owned(),
        circuit_path: output_circuit.to_string_lossy().into_owned(),
        key_hex: encode(key),
    };
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();

    let usage = "Usage:\n  precontract-cli image_dual <file> <w> <h> <cx> <cy> [hex_key]\n  precontract-cli audio <file> <dur_secs> <sample_rate> <n_samples> [hex_key]\n  precontract-cli v2 <file> [hex_key]  (legacy)";

    if args.is_empty() {
        bail!("{}", usage);
    }

    match args[0].as_str() {
        "image_dual" => {
            if args.len() < 6 {
                bail!("Usage: precontract-cli image_dual <file> <w> <h> <cx> <cy> [hex_key]");
            }
            let input_path = PathBuf::from(&args[1]);
            let w: u32 = args[2].parse().context("w must be u32")?;
            let h: u32 = args[3].parse().context("h must be u32")?;
            let cx: u32 = args[4].parse().context("cx must be u32")?;
            let cy: u32 = args[5].parse().context("cy must be u32")?;
            let key = parse_key(&args, 6)?;
            let x_hat = load_file(&input_path)?;

            let pre = compute_precontract_image_dual_v3(&x_hat, &key, w, h, cx, cy);

            write_v3_outputs(
                &input_path,
                &pre.ct,
                &pre.circuit_bytes,
                &pre.d,
                &pre.thumb,
                &pre.quality,
                &pre.dim,
                &pre.h_ct,
                &pre.h_circuit,
                &pre.commitment.c,
                &pre.commitment.o,
                pre.num_blocks,
                pre.num_gates,
                &key,
            )?;
        }

        "audio" => {
            if args.len() < 5 {
                bail!("Usage: precontract-cli audio <file> <dur_secs> <sample_rate> <n_samples> [hex_key]");
            }
            let input_path = PathBuf::from(&args[1]);
            let dur: u32 = args[2].parse().context("dur must be u32")?;
            let sr: u32 = args[3].parse().context("sr must be u32")?;
            let n_samp: u32 = args[4].parse().context("n_samp must be u32")?;
            let key = parse_key(&args, 5)?;
            let x_hat = load_file(&input_path)?;

            let pre = compute_precontract_audio_v3(&x_hat, &key, dur, sr, n_samp);

            write_v3_outputs(
                &input_path,
                &pre.ct,
                &pre.circuit_bytes,
                &pre.d,
                &pre.thumb,
                &pre.quality,
                &pre.dim,
                &pre.h_ct,
                &pre.h_circuit,
                &pre.commitment.c,
                &pre.commitment.o,
                pre.num_blocks,
                pre.num_gates,
                &key,
            )?;
        }

        "v2" => {
            if args.len() < 2 {
                bail!("Usage: precontract-cli v2 <file> [hex_key]");
            }
            let input_path = PathBuf::from(&args[1]);
            let key = parse_key(&args, 2)?;
            let mut file_bytes = load_file(&input_path)?;

            let pre = compute_precontract_values_v2(&mut file_bytes, &key);
            let output_ct = input_path.with_extension("ct");
            let output_circuit = input_path.with_extension("circuit");

            fs::write(&output_ct, &pre.ct)
                .with_context(|| format!("writing ciphertext to {:?}", output_ct))?;
            fs::write(&output_circuit, &pre.circuit_bytes)
                .with_context(|| format!("writing circuit to {:?}", output_circuit))?;

            let out = PrecontractV2Output {
                description_hex: encode(pre.description),
                h_ct_hex: encode(pre.h_ct),
                h_circuit_hex: encode(pre.h_circuit),
                commitment_c_hex: encode(pre.commitment.c),
                commitment_o_hex: encode(pre.commitment.o),
                num_blocks: pre.num_blocks,
                num_gates: pre.num_gates,
                ciphertext_path: output_ct.to_string_lossy().into_owned(),
                circuit_path: output_circuit.to_string_lossy().into_owned(),
                key_hex: encode(&key),
            };
            println!("{}", serde_json::to_string_pretty(&out)?);
        }

        _ => {
            bail!("{}", usage);
        }
    }

    Ok(())
}
