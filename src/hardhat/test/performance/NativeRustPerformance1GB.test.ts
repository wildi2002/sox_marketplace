import { expect } from "chai";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { performance } from "perf_hooks";
import {
    initSync,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    compute_proof_right_v2,
} from "../../../app/lib/crypto_lib";

/**
 * Performance Test for Native Rust/WASM - 1GB File
 * 
 * Measures execution time for:
 * - compute_precontract_values_v2 (circuit compilation + encryption)
 * - evaluate_circuit_v2_wasm (circuit evaluation)
 * - hpre_v2 (challenge response computation)
 * - compute_proof_right_v2 (proof generation)
 */

describe("Native Rust/WASM Performance - 1GB File", function () {
    // Test parameters
    const FILE_SIZE_GB = 1;
    const FILE_SIZE_BYTES = FILE_SIZE_GB * 1024 * 1024 * 1024; // 1 GB
    
    let file: Uint8Array;
    let key: Uint8Array;
    let precontract: any;
    let evaluated_bytes: Uint8Array;
    let numBlocks: number;
    let numGates: number;
    
    // Performance metrics
    const metrics = {
        wasmInitTime: 0,
        precontractTime: 0,
        evaluateTime: 0,
        hpreTime: 0,
        proofTime: 0,
        totalTime: 0,
    };

    before(async function () {
        console.log("\n📊 ===== NATIVE RUST/WASM PERFORMANCE TEST - 1GB =====");
        console.log(`📁 File size: ${FILE_SIZE_GB} GB (${FILE_SIZE_BYTES.toLocaleString()} bytes)`);
        console.log(`💾 Memory: ${(FILE_SIZE_BYTES / (1024 * 1024)).toFixed(2)} MB\n`);
        
        // Initialize WASM module
        const wasmStart = performance.now();
        const modulePath = join(__dirname, "../../../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const module = await readFile(modulePath);
        initSync({ module: module });
        const wasmEnd = performance.now();
        metrics.wasmInitTime = wasmEnd - wasmStart;
        console.log(`✅ WASM module initialized: ${metrics.wasmInitTime.toFixed(2)} ms\n`);
        
        // Generate test file and key
        file = new Uint8Array(FILE_SIZE_BYTES);
        key = new Uint8Array(16);
        // Fill with some data (not all zeros for realistic test)
        for (let i = 0; i < file.length; i++) {
            file[i] = (i % 256);
        }
        for (let i = 0; i < key.length; i++) {
            key[i] = i;
        }
    });

    it("Should measure compute_precontract_values_v2 time", async function () {
        console.log("📝 Computing precontract values (V2)...");
        console.log("   This includes:");
        console.log("   - File encryption (AES-128-CTR)");
        console.log("   - Circuit compilation (V2 format)");
        console.log("   - Commitment computation");
        console.log("   - numBlocks and numGates calculation");
        
        const start = performance.now();
        const memBefore = process.memoryUsage();
        
        precontract = compute_precontract_values_v2(file, key);
        
        const end = performance.now();
        const memAfter = process.memoryUsage();
        
        metrics.precontractTime = end - start;
        numBlocks = precontract.num_blocks;
        numGates = precontract.num_gates;
        
        const memUsedMB = ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2);
        const memPeakMB = (memAfter.heapUsed / (1024 * 1024)).toFixed(2);
        
        console.log(`\n✅ Precontract computed:`);
        console.log(`   ⏱️  Time: ${(metrics.precontractTime / 1000).toFixed(2)} s (${metrics.precontractTime.toFixed(2)} ms)`);
        console.log(`   📊 Throughput: ${(FILE_SIZE_GB / (metrics.precontractTime / 1000)).toFixed(3)} GB/s`);
        console.log(`   🔢 numBlocks: ${numBlocks.toLocaleString()}`);
        console.log(`   🔢 numGates: ${numGates.toLocaleString()}`);
        console.log(`   📈 Gates/sec: ${(numGates / (metrics.precontractTime / 1000)).toFixed(0).toLocaleString()}`);
        console.log(`   💾 Memory used: ${memUsedMB} MB (peak: ${memPeakMB} MB)`);
        console.log(`   📦 Circuit size: ${(precontract.circuit_bytes.length / 1024).toFixed(2)} KB\n`);
        
        expect(precontract.num_blocks).to.be.greaterThan(0);
        expect(precontract.num_gates).to.be.greaterThan(0);
        expect(precontract.circuit_bytes.length).to.be.greaterThan(0);
    });

    it("Should measure evaluate_circuit_v2_wasm time", async function () {
        console.log("🔍 Evaluating circuit (V2)...");
        console.log("   This evaluates all gates in the circuit");
        
        const start = performance.now();
        const memBefore = process.memoryUsage();
        
        const evaluated = evaluate_circuit_v2_wasm(
            precontract.circuit_bytes,
            precontract.ct,
            bytes_to_hex(key)
        );
        evaluated_bytes = evaluated.to_bytes();
        
        const end = performance.now();
        const memAfter = process.memoryUsage();
        
        metrics.evaluateTime = end - start;
        
        const memUsedMB = ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2);
        
        console.log(`\n✅ Circuit evaluated:`);
        console.log(`   ⏱️  Time: ${(metrics.evaluateTime / 1000).toFixed(2)} s (${metrics.evaluateTime.toFixed(2)} ms)`);
        console.log(`   📊 Throughput: ${(numGates / (metrics.evaluateTime / 1000)).toFixed(0).toLocaleString()} gates/sec`);
        console.log(`   💾 Memory used: ${memUsedMB} MB`);
        console.log(`   📦 Evaluated size: ${(evaluated_bytes.length / 1024).toFixed(2)} KB\n`);
        
        expect(evaluated_bytes.length).to.be.greaterThan(0);
    });

    it("Should measure hpre_v2 time (challenge response)", async function () {
        console.log("🔐 Computing hpre (challenge response)...");
        console.log("   This computes the response to a challenge");
        
        const rounds = Math.ceil(Math.log2(numGates));
        const challenge = Math.floor(numGates / 2); // Middle challenge
        
        const start = performance.now();
        
        const hpreResult = hpre_v2(evaluated_bytes, numBlocks, challenge);
        
        const end = performance.now();
        
        metrics.hpreTime = end - start;
        
        console.log(`\n✅ hpre computed:`);
        console.log(`   ⏱️  Time: ${metrics.hpreTime.toFixed(2)} ms`);
        console.log(`   🔢 Challenge: ${challenge.toLocaleString()}`);
        console.log(`   📊 Expected rounds: ${rounds}`);
        console.log(`   ⏱️  Estimated time for all rounds: ${(metrics.hpreTime * rounds).toFixed(2)} ms (${((metrics.hpreTime * rounds) / 1000).toFixed(2)} s)\n`);
        
        expect(hpreResult.length).to.equal(32); // SHA256 hash = 32 bytes
    });

    it("Should measure compute_proof_right_v2 time (proof generation)", async function () {
        console.log("🔒 Generating proof (submitCommitmentRight)...");
        console.log("   This generates accumulator proofs for the right boundary case");
        
        const start = performance.now();
        const memBefore = process.memoryUsage();
        
        const proof = compute_proof_right_v2(
            precontract.circuit_bytes,
            evaluated_bytes,
            numBlocks,
            numGates
        );
        
        const end = performance.now();
        const memAfter = process.memoryUsage();
        
        metrics.proofTime = end - start;
        
        const memUsedMB = ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2);
        
        console.log(`\n✅ Proof generated:`);
        console.log(`   ⏱️  Time: ${(metrics.proofTime / 1000).toFixed(2)} s (${metrics.proofTime.toFixed(2)} ms)`);
        console.log(`   💾 Memory used: ${memUsedMB} MB`);
        console.log(`   📦 Proof size: ${(JSON.stringify(proof).length / 1024).toFixed(2)} KB\n`);
        
        expect(proof).to.be.an('array');
        expect(proof.length).to.be.greaterThan(0);
    });

    it("Should display performance summary", async function () {
        metrics.totalTime = metrics.wasmInitTime + metrics.precontractTime + metrics.evaluateTime + metrics.hpreTime + metrics.proofTime;
        
        console.log("\n" + "=".repeat(80));
        console.log("📊 PERFORMANCE SUMMARY - 1GB FILE");
        console.log("=".repeat(80));
        console.log("\n⏱️  Execution Times:");
        console.log(`   WASM initialization:     ${metrics.wasmInitTime.toFixed(2).padStart(10)} ms`);
        console.log(`   Precontract (V2):        ${metrics.precontractTime.toFixed(2).padStart(10)} ms (${(metrics.precontractTime / 1000).toFixed(2)} s)`);
        console.log(`   Circuit evaluation:      ${metrics.evaluateTime.toFixed(2).padStart(10)} ms (${(metrics.evaluateTime / 1000).toFixed(2)} s)`);
        console.log(`   hpre (1 challenge):      ${metrics.hpreTime.toFixed(2).padStart(10)} ms`);
        console.log(`   Proof generation:         ${metrics.proofTime.toFixed(2).padStart(10)} ms (${(metrics.proofTime / 1000).toFixed(2)} s)`);
        console.log(`   ─────────────────────────────────────────────`);
        console.log(`   TOTAL:                   ${metrics.totalTime.toFixed(2).padStart(10)} ms (${(metrics.totalTime / 1000).toFixed(2)} s)`);
        
        console.log("\n📊 Throughput:");
        const precontractThroughput = FILE_SIZE_GB / (metrics.precontractTime / 1000);
        const evaluateThroughput = numGates / (metrics.evaluateTime / 1000);
        console.log(`   Precontract:             ${precontractThroughput.toFixed(3).padStart(10)} GB/s`);
        console.log(`   Evaluation:              ${evaluateThroughput.toFixed(0).toLocaleString().padStart(10)} gates/sec`);
        
        console.log("\n🔢 Circuit Statistics:");
        console.log(`   numBlocks:               ${numBlocks.toLocaleString().padStart(10)}`);
        console.log(`   numGates:                 ${numGates.toLocaleString().padStart(10)}`);
        console.log(`   Expected dispute rounds: ${Math.ceil(Math.log2(numGates)).toString().padStart(10)}`);
        
        console.log("\n⏱️  Estimated Dispute Times:");
        const rounds = Math.ceil(Math.log2(numGates));
        const totalHpreTime = metrics.hpreTime * rounds;
        console.log(`   hpre (all ${rounds} rounds):  ${(totalHpreTime / 1000).toFixed(2).padStart(10)} s`);
        console.log(`   Total (precontract + eval + hpre + proof): ${((metrics.precontractTime + metrics.evaluateTime + totalHpreTime + metrics.proofTime) / 1000).toFixed(2).padStart(10)} s`);
        
        console.log("\n" + "=".repeat(80) + "\n");
    });
});







