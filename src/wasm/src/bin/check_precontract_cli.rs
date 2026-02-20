use crypto_lib::check_precontract_native;
use serde::Serialize;
use std::env;
use std::fs;

#[derive(Serialize)]
struct CheckPrecontractOutput {
    success: bool,
    h_ct_hex: String,
    h_circuit_hex: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);

    let ct_path = match args.next() {
        Some(p) => p,
        None => {
            eprintln!("Usage: check_precontract_cli <ciphertext_path> <description_hex> <commitment_hex> <opening_hex>");
            std::process::exit(1);
        }
    };

    let description_hex = args
        .next()
        .ok_or("missing description_hex argument")?;
    let commitment_hex = args.next().ok_or("missing commitment_hex argument")?;
    let opening_hex = args.next().ok_or("missing opening_hex argument")?;

    let ct = fs::read(&ct_path)?;

    let res = check_precontract_native(
        &description_hex,
        &commitment_hex,
        &opening_hex,
        &ct,
    );

    let out = CheckPrecontractOutput {
        success: res.success,
        h_ct_hex: hex::encode(res.h_ct),
        h_circuit_hex: hex::encode(res.h_circuit),
    };

    let json = serde_json::to_string_pretty(&out)?;
    println!("{json}");

    Ok(())
}


