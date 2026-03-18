use clap::{Parser, Subcommand};
use rand::Rng;
use sp1_sdk::{HashableKey, ProverClient, SP1ProofWithPublicValues, SP1Stdin, SP1_CIRCUIT_VERSION};

/// ELF binary compiled for the RISC-V SP1 zkVM.
/// Build the guest first with:
///   cargo +succinct build --manifest-path ../zk-guest/Cargo.toml --target riscv32im-succinct-zkvm-elf --release
const ELF: &[u8] = include_bytes!("../../zk-guest/elf/riscv32im-succinct-zkvm-elf");

#[derive(Parser)]
#[command(name = "zk-host", about = "SP1 ZK proof host for image quality attestation")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Analyze an image: compute thumbnail_hash and BRISQUE without generating a proof (fast)
    Analyze {
        /// Path to the image file (JPEG or PNG)
        #[arg(short, long)]
        image: String,
    },
    /// Generate a ZK proof for an image
    Generate {
        /// Path to the image file (JPEG or PNG)
        #[arg(short, long)]
        image: String,
    },
    /// Verify a ZK proof from a JSON file
    Verify {
        /// Path to the proof JSON file
        #[arg(short, long)]
        json: String,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Analyze { image } => cmd_analyze(&image),
        Commands::Generate { image } => cmd_generate(&image),
        Commands::Verify { json } => cmd_verify(&json),
    }
}

fn cmd_analyze(image_path: &str) {
    let image_bytes = std::fs::read(image_path)
        .unwrap_or_else(|e| panic!("Failed to read image {image_path}: {e}"));

    let thumbnail_hash = zk_common::thumbnail::thumbnail_hash(&image_bytes)
        .unwrap_or_else(|e| panic!("thumbnail_hash failed: {e}"));

    let brisque = zk_common::brisque::compute_brisque(&image_bytes)
        .unwrap_or_else(|e| panic!("brisque failed: {e}"));

    let output = serde_json::json!({
        "thumbnail_hash": hex::encode(thumbnail_hash),
        "brisque": brisque,
    });
    println!("{}", serde_json::to_string(&output).unwrap());
}

fn cmd_generate(image_path: &str) {
    eprintln!("Generating proof for {}...", image_path);

    let image_bytes = std::fs::read(image_path)
        .unwrap_or_else(|e| panic!("Failed to read image {image_path}: {e}"));

    let mut rng = rand::thread_rng();
    let key: [u8; 16] = rng.gen();
    let r: [u8; 32] = rng.gen();
    let iv: [u8; 16] = rng.gen();

    let mut stdin = SP1Stdin::new();
    stdin.write(&key);
    stdin.write(&r);
    stdin.write(&iv);
    stdin.write(&image_bytes);

    let client = ProverClient::from_env();
    let (pk, vk) = client.setup(ELF);

    // Execute first to get public values quickly (no proof)
    eprintln!("Executing (dry run)...");
    let (public_values, _report) = client
        .execute(ELF, &stdin)
        .run()
        .expect("execution failed");

    let pv = public_values.as_slice();
    assert!(pv.len() >= 100, "Expected at least 100 bytes of public values, got {}", pv.len());

    let h_pt: [u8; 32] = pv[0..32].try_into().unwrap();
    let ap1: [u8; 32] = pv[32..64].try_into().unwrap();
    let ap2_bytes: [u8; 4] = pv[64..68].try_into().unwrap();
    let c_k: [u8; 32] = pv[68..100].try_into().unwrap();
    let brisque_score = f32::from_le_bytes(ap2_bytes);

    eprintln!("Execution complete. BRISQUE={:.2}, generating Groth16 proof...", brisque_score);

    let proof = client
        .prove(&pk, &stdin)
        .groth16()
        .run()
        .expect("proof generation failed");

    // Encode the on-chain proof bytes (Groth16 encoded format)
    let proof_bytes = proof.bytes();

    // Also serialize full proof with bincode for later verification
    let full_proof_bytes =
        bincode::serialize(&proof).expect("Failed to serialize proof");

    let output = serde_json::json!({
        "available": true,
        "proof": hex::encode(&proof_bytes),
        "proof_full": hex::encode(&full_proof_bytes),
        "h_pt": hex::encode(&h_pt),
        "c_k": hex::encode(&c_k),
        "brisque": brisque_score,
        "thumbnail_hash": hex::encode(&ap1),
        "key_hex": hex::encode(&key),
        "vk_hash": hex::encode(&vk.bytes32_raw()),
        "sp1_version": SP1_CIRCUIT_VERSION,
    });

    println!("{}", serde_json::to_string(&output).unwrap());
    eprintln!("Done.");
}

fn cmd_verify(json_path: &str) {
    eprintln!("Verifying proof from {}...", json_path);

    let json_str = std::fs::read_to_string(json_path)
        .unwrap_or_else(|e| panic!("Failed to read JSON {json_path}: {e}"));
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .unwrap_or_else(|e| panic!("Failed to parse JSON: {e}"));

    // Decode full bincode-serialized proof
    let full_proof_hex = data["proof_full"].as_str().expect("proof_full field missing");
    let full_proof_bytes = hex::decode(full_proof_hex).expect("Failed to decode proof_full hex");

    let sp1_proof: SP1ProofWithPublicValues =
        bincode::deserialize(&full_proof_bytes).expect("Failed to deserialize proof");

    let client = ProverClient::from_env();
    let (_pk, vk) = client.setup(ELF);

    match client.verify(&sp1_proof, &vk) {
        Ok(_) => {
            println!("{}", serde_json::json!({"valid": true}));
            eprintln!("Proof is valid.");
        }
        Err(e) => {
            println!("{}", serde_json::json!({"valid": false, "reason": e.to_string()}));
            eprintln!("Proof is invalid: {}", e);
        }
    }
}
