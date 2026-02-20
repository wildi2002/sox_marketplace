

use hex::encode;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize)]
struct ProofOutput {
    proof: Vec<Vec<String>>, // Each layer is Vec<String> (hex-encoded bytes32)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    
    if args.len() < 3 {
        bail!("Usage: compute_proofs_cli <state> <evaluated_circuit_file> <num_blocks> <num_gates> [circuit_file] [ct_file] [challenge]");
    }

    let state: u32 = args[0].parse().context("Invalid state")?;
    let evaluated_circuit_path = &args[1];
    let num_blocks: u32 = args[2].parse().context("Invalid num_blocks")?;
    let num_gates: u32 = args[3].parse().context("Invalid num_gates")?;

    let evaluated_circuit_bytes = fs::read(evaluated_circuit_path)
        .with_context(|| format!("reading evaluated circuit from {:?}", evaluated_circuit_path))?;

    match state {
        4 => {
            // State 4: WaitVendorDataRight - compute_proof_right
            let proof = compute_proof_right_native(&evaluated_circuit_bytes, num_blocks, num_gates);
            
            // Convert proof to hex strings (bytes32 format)
            let proof_hex: Vec<Vec<String>> = proof
                .iter()
                .map(|layer| {
                    layer
                        .iter()
                        .map(|item| {
                            // Ensure each item is exactly 32 bytes (bytes32)
                            if item.len() != 32 {
                                panic!("Proof item length is {} bytes, expected 32", item.len());
                            }
                            encode(item)
                        })
                        .collect()
                })
                .collect();

            let output = ProofOutput { proof: proof_hex };
            let json = serde_json::to_string_pretty(&output)?;
            println!("{}", json);
        }
        _ => {
            bail!("State {} not yet implemented in CLI. Only state 4 (WaitVendorDataRight) is supported.", state);
        }
    }

    Ok(())
}


use hex::encode;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize)]
struct ProofOutput {
    proof: Vec<Vec<String>>, // Each layer is Vec<String> (hex-encoded bytes32)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    
    if args.len() < 3 {
        bail!("Usage: compute_proofs_cli <state> <evaluated_circuit_file> <num_blocks> <num_gates> [circuit_file] [ct_file] [challenge]");
    }

    let state: u32 = args[0].parse().context("Invalid state")?;
    let evaluated_circuit_path = &args[1];
    let num_blocks: u32 = args[2].parse().context("Invalid num_blocks")?;
    let num_gates: u32 = args[3].parse().context("Invalid num_gates")?;

    let evaluated_circuit_bytes = fs::read(evaluated_circuit_path)
        .with_context(|| format!("reading evaluated circuit from {:?}", evaluated_circuit_path))?;

    match state {
        4 => {
            // State 4: WaitVendorDataRight - compute_proof_right
            let proof = compute_proof_right_native(&evaluated_circuit_bytes, num_blocks, num_gates);
            
            // Convert proof to hex strings (bytes32 format)
            let proof_hex: Vec<Vec<String>> = proof
                .iter()
                .map(|layer| {
                    layer
                        .iter()
                        .map(|item| {
                            // Ensure each item is exactly 32 bytes (bytes32)
                            if item.len() != 32 {
                                panic!("Proof item length is {} bytes, expected 32", item.len());
                            }
                            encode(item)
                        })
                        .collect()
                })
                .collect();

            let output = ProofOutput { proof: proof_hex };
            let json = serde_json::to_string_pretty(&output)?;
            println!("{}", json);
        }
        _ => {
            bail!("State {} not yet implemented in CLI. Only state 4 (WaitVendorDataRight) is supported.", state);
        }
    }

    Ok(())
}

