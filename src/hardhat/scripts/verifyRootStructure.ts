import { ethers } from "hardhat";
import {
    initSync,
    bytes_to_hex,
    compute_precontract_vareades_v2,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour verify si le root hCt increadt l'IV ou non
 */
async function main() {
    console.log("🔍 VERIFICATION: Root hCt structure");
    console.log("=".repeat(80));
    console.log("📁 File: test_65bytes.bin\n");

    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialized\n");

    // Read test file
    const testFilePath = join(__dirname, "../../../test_65bytes.bin");
    const fileData = readFileSync(testFilePath);
    
    // Generate a test key (16 bytes)
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        key[i] = i + 1;
    }

    // Compute precontract
    const precontract = compute_precontract_vareades_v2(fileData, key);
    const ct = new Uint8Array(precontract.ct);
    const commitment = precontract.commitment;
    const h_ct = precontract.h_ct;
    
    console.log("📊 ROOT hCt depuis compute_precontract_vareades_v2:");
    console.log(`   ${ethers.hexlify(h_ct)}\n`);

    // Calculate blocks manually
    const numBlocks = Math.ceil((ct.length - 16) / 64);
    const ctBlocksWithIV: Uint8Array[] = [];
    ctBlocksWithIV.push(new Uint8Array(ct.slice(0, 16))); // IV
    let start = 16;
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocksWithIV.push(block);
        start = end;
    }

    const ctBlocksWithoutIV: Uint8Array[] = [];
    start = 16;
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocksWithoutIV.push(block);
        start = end;
    }

    console.log("📊 BLOCKS:");
    console.log(`   With IV: ${ctBlocksWithIV.length} blocks`);
    for (let i = 0; i < ctBlocksWithIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithIV[i]));
        console.log(`     [${i}]: ${blockKeccak.slice(0, 20)}...`);
    }
    console.log(`   Without IV: ${ctBlocksWithoutIV.length} blocks`);
    for (let i = 0; i < ctBlocksWithoutIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithoutIV[i]));
        console.log(`     [${i}]: ${blockKeccak.slice(0, 20)}...`);
    }
    console.log();

    // Deploy AccumulatorVerifier to calculate roots
    const [deployer] = await ethers.getSigners();
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    // Calculate root with IV
    const allIndicesWithIV = Array.from({ length: ctBlocksWithIV.length }, (_, i) => BigInt(i));
    const allKeccaksWithIV = ctBlocksWithIV.map(block => ethers.keccak256(ethers.hexlify(block)));
    
    // Calculate root without IV
    const allIndicesWithoutIV = Array.from({ length: ctBlocksWithoutIV.length }, (_, i) => BigInt(i));
    const allKeccaksWithoutIV = ctBlocksWithoutIV.map(block => ethers.keccak256(ethers.hexlify(block)));

    console.log("📊 ROOT COMPARISON:");
    console.log(`   Expected root (h_ct): ${ethers.hexlify(h_ct)}`);
    console.log();
    console.log("   To verify which root matches, we can use computeRoot:");
    console.log(`   (But computeRoot is not exposed, so we cannot test it directly)`);
    console.log();
    console.log("💡 CONCLUSION:");
    console.log(`   If the root includes IV, then:`);
    console.log(`     - ctBlocksWithIV[0] = IV`);
    console.log(`     - ctBlocksWithIV[1] = first data block`);
    console.log(`     - Indices in nonConstantSons must be offset by +1`);
    console.log();
    console.log(`   If the root does NOT include IV, then:`);
    console.log(`     - ctBlocksWithoutIV[0] = first data block`);
    console.log(`     - Indices in nonConstantSons are correct (ctIdx - 1)`);
    console.log();
    console.log("   Rust code shows that acc_ct uses split_ct_blocks which INCLUDES IV,");
    console.log("   so the root MUST include IV. But compute_proofs_v2 works,");
    console.log("   so there must be an offset somewhere.");

    console.log("=".repeat(80));
    console.log("✅ VERIFICATION COMPLETED");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


