use anyhow::{bail, Context, Result};
use crypto_lib::{
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
};
use hex::encode;
use rand::RngCore;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Serialize)]
struct PerformanceOutput {
    file_size_gb: f64,
    file_size_bytes: u64,
    num_blocks: u32,
    num_gates: u32,
    expected_rounds: u32,
    timings: Timings,
    throughput: Throughput,
    memory: MemoryStats,
}

#[derive(Serialize)]
struct Timings {
    encryption_ms: f64,
    circuit_compilation_ms: f64,
    precontract_total_ms: f64,
    precontract_total_s: f64,
    evaluation_ms: f64,
    evaluation_s: f64,
    hpre_single_ms: f64,
    hpre_all_rounds_ms: f64,
    hpre_all_rounds_s: f64,
    proof_generation_ms: f64,
    proof_generation_s: f64,
    total_time_ms: f64,
    total_time_s: f64,
}

#[derive(Serialize)]
struct Throughput {
    precontract_gb_per_s: f64,
    evaluation_gates_per_s: f64,
}

#[derive(Serialize)]
struct MemoryStats {
    peak_rss_mb: f64,
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        bail!("Usage: performance_test_1gb <input_file> [hex_key]");
    }

    let input_path = PathBuf::from(&args[0]);
    let file_size_bytes = fs::metadata(&input_path)
        .with_context(|| format!("reading metadata for {:?}", input_path))?
        .len();
    let file_size_gb = file_size_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

    println!("📊 ===== NATIVE RUST PERFORMANCE TEST - {:.2} GB =====", file_size_gb);
    println!("📁 File: {:?}", input_path);
    println!("💾 Size: {} bytes ({:.2} GB)\n", file_size_bytes, file_size_gb);

    // key: if provided use hex (must be 16 bytes), else random 16 bytes
    let key: Vec<u8> = if let Some(k) = args.get(1) {
        let key_bytes = hex::decode(k).context("failed to decode hex key")?;
        if key_bytes.len() != 16 {
            bail!("Key must be 16 bytes, got {}", key_bytes.len());
        }
        key_bytes
    } else {
        let mut rnd = [0u8; 16];
        rand::rng().fill_bytes(&mut rnd);
        rnd.to_vec()
    };

    // Load file fully
    println!("📖 Loading file into memory...");
    let load_start = Instant::now();
    let mut file_bytes = fs::read(&input_path)
        .with_context(|| format!("reading {:?}", input_path))?;
    let load_time = load_start.elapsed();
    println!("✅ File loaded: {:.2} ms\n", load_time.as_secs_f64() * 1000.0);

    let mut timings = Timings {
        encryption_ms: 0.0,
        circuit_compilation_ms: 0.0,
        precontract_total_ms: 0.0,
        precontract_total_s: 0.0,
        evaluation_ms: 0.0,
        evaluation_s: 0.0,
        hpre_single_ms: 0.0,
        hpre_all_rounds_ms: 0.0,
        hpre_all_rounds_s: 0.0,
        proof_generation_ms: 0.0,
        proof_generation_s: 0.0,
        total_time_ms: 0.0,
        total_time_s: 0.0,
    };

    // ===== PRECONTRACT (V2) =====
    println!("📝 Computing precontract values (V2)...");
    println!("   This includes:");
    println!("   - File encryption (AES-128-CTR)");
    println!("   - Circuit compilation (V2 format)");
    println!("   - Commitment computation");
    
    let precontract_start = Instant::now();
    let precontract = compute_precontract_values_v2(&mut file_bytes, &key);
    timings.precontract_total_ms = precontract_start.elapsed().as_secs_f64() * 1000.0;
    timings.precontract_total_s = timings.precontract_total_ms / 1000.0;
    
    let num_blocks = precontract.num_blocks;
    let num_gates = precontract.num_gates;
    
    println!("   ✅ Precontract total: {:.2} ms ({:.2} s)", timings.precontract_total_ms, timings.precontract_total_s);
    println!("      numBlocks: {}", num_blocks);
    println!("      numGates: {}", num_gates);
    println!("   📊 Throughput: {:.3} GB/s\n", file_size_gb / timings.precontract_total_s);
    
    // ===== CIRCUIT EVALUATION (V2) =====
    println!("🔍 Evaluating circuit (V2)...");
    let evaluation_start = Instant::now();
    
    let evaluated = evaluate_circuit_v2_wasm(
        &precontract.circuit_bytes,
        &precontract.ct,
        encode(&key),
    );
    let evaluated_bytes = evaluated.to_bytes();
    
    timings.evaluation_ms = evaluation_start.elapsed().as_secs_f64() * 1000.0;
    timings.evaluation_s = timings.evaluation_ms / 1000.0;
    
    println!("   ✅ Circuit evaluated: {:.2} ms ({:.2} s)", timings.evaluation_ms, timings.evaluation_s);
    println!("   📊 Throughput: {:.0} gates/sec\n", num_gates as f64 / timings.evaluation_s);
    
    // ===== HPRE (Challenge Response) =====
    let expected_rounds = (num_gates as f64).log2().ceil() as u32;
    println!("🔐 Computing hpre (challenge response)...");
    println!("   Expected rounds: {}", expected_rounds);
    
    let challenge = num_gates / 2; // Middle challenge
    let hpre_start = Instant::now();
    
    let hpre_result = hpre_v2(&evaluated_bytes, num_blocks as usize, challenge as usize);
    
    timings.hpre_single_ms = hpre_start.elapsed().as_secs_f64() * 1000.0;
    timings.hpre_all_rounds_ms = timings.hpre_single_ms * expected_rounds as f64;
    timings.hpre_all_rounds_s = timings.hpre_all_rounds_ms / 1000.0;
    
    println!("   ✅ hpre (single): {:.2} ms", timings.hpre_single_ms);
    println!("   ⏱️  Estimated time for all {} rounds: {:.2} ms ({:.2} s)\n", 
             expected_rounds, timings.hpre_all_rounds_ms, timings.hpre_all_rounds_s);
    
    // ===== PROOF GENERATION =====
    println!("🔒 Generating proof (submitCommitmentRight)...");
    println!("   Note: This is a simplified measurement");
    let proof_start = Instant::now();
    
    // For a full proof, we would need compute_proof_right_v2, but that requires more setup
    // We'll just measure a simple operation as a placeholder
    let _proof_placeholder = hpre_result; // Simplified
    
    timings.proof_generation_ms = proof_start.elapsed().as_secs_f64() * 1000.0;
    timings.proof_generation_s = timings.proof_generation_ms / 1000.0;
    
    println!("   ✅ Proof generation (simplified): {:.2} ms ({:.2} s)\n", timings.proof_generation_ms, timings.proof_generation_s);
    
    // Total time
    timings.total_time_ms = timings.precontract_total_ms + timings.evaluation_ms + timings.hpre_all_rounds_ms + timings.proof_generation_ms;
    timings.total_time_s = timings.total_time_ms / 1000.0;
    
    // Throughput
    let throughput = Throughput {
        precontract_gb_per_s: file_size_gb / timings.precontract_total_s,
        evaluation_gates_per_s: num_gates as f64 / timings.evaluation_s,
    };
    
    // Memory stats (approximate)
    let memory = MemoryStats {
        peak_rss_mb: (file_size_bytes * 3) as f64 / (1024.0 * 1024.0), // Rough estimate: file + ct + circuit
    };
    
    // ===== SUMMARY =====
    let separator = "=".repeat(80);
    println!("{}", separator);
    println!("📊 PERFORMANCE SUMMARY - {:.2} GB FILE", file_size_gb);
    println!("{}", separator);
    println!("\n⏱️  Execution Times:");
    println!("   Precontract (total):     {:>10.2} ms ({:>6.2} s)", timings.precontract_total_ms, timings.precontract_total_s);
    println!("   Circuit evaluation:      {:>10.2} ms ({:>6.2} s)", timings.evaluation_ms, timings.evaluation_s);
    println!("   hpre (1 challenge):      {:>10.2} ms", timings.hpre_single_ms);
    println!("   hpre (all {} rounds):    {:>10.2} ms ({:>6.2} s)", expected_rounds, timings.hpre_all_rounds_ms, timings.hpre_all_rounds_s);
    println!("   Proof generation:       {:>10.2} ms ({:>6.2} s)", timings.proof_generation_ms, timings.proof_generation_s);
    println!("   ─────────────────────────────────────────────");
    println!("   TOTAL (estimated):      {:>10.2} ms ({:>6.2} s)", timings.total_time_ms, timings.total_time_s);
    
    println!("\n📊 Throughput:");
    println!("   Precontract:             {:>10.3} GB/s", throughput.precontract_gb_per_s);
    println!("   Evaluation:              {:>10.0} gates/sec", throughput.evaluation_gates_per_s);
    
    println!("\n🔢 Circuit Statistics:");
    println!("   numBlocks:               {:>10}", num_blocks);
    println!("   numGates:                {:>10}", num_gates);
    println!("   Expected dispute rounds: {:>10}", expected_rounds);
    
    println!("\n💾 Memory (estimated):");
    println!("   Peak RSS:                {:>10.2} MB", memory.peak_rss_mb);
    
    println!("\n{}", separator);
    
    // Output JSON
    let output = PerformanceOutput {
        file_size_gb,
        file_size_bytes,
        num_blocks,
        num_gates,
        expected_rounds,
        timings,
        throughput,
        memory,
    };
    
    let json = serde_json::to_string_pretty(&output)?;
    println!("\n{}", json);
    
    Ok(())
}

