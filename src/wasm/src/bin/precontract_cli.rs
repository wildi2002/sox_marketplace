use anyhow::{bail, Context, Result};
use crypto_lib::compute_precontract_values_v2;
use hex::encode;
use rand::RngCore;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
struct PrecontractOutput {
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

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        bail!("Usage: precontract-cli <input_file> [hex_key]");
    }

    let input_path = PathBuf::from(&args[0]);
    let output_ct = input_path.with_extension("ct");
    let output_circuit = input_path.with_extension("circuit");

    // key: if provided use hex (must be 16 bytes), else random 16 bytes
    let key: Vec<u8> = if let Some(k) = args.get(1) {
        let key_bytes = hex::decode(k).context("failed to decode hex key")?;
        if key_bytes.len() != 16 {
            bail!("Key must be 16 bytes, got {}", key_bytes.len());
        }
        key_bytes
    } else {
        let mut rnd = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut rnd);
        rnd.to_vec()
    };

    // load file fully (matches existing wasm precontract logic)
    let mut file_bytes =
        fs::read(&input_path).with_context(|| format!("reading {:?}", input_path))?;

    // Validate file is not empty (after encryption, we need at least 1 byte of data plus the 16-byte IV)
    if file_bytes.is_empty() {
        bail!("The file is empty. Please select a file containing at least 1 byte of data.");
    }

    let pre = compute_precontract_values_v2(&mut file_bytes, &key);

    // dump ciphertext and circuit bytes to disk
    fs::write(&output_ct, &pre.ct)
        .with_context(|| format!("writing ciphertext to {:?}", output_ct))?;
    fs::write(&output_circuit, &pre.circuit_bytes)
        .with_context(|| format!("writing circuit to {:?}", output_circuit))?;

    let out = PrecontractOutput {
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

    let json = serde_json::to_string_pretty(&out)?;
    println!("{}", json);
    Ok(())
}
