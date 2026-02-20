import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_v2,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour verify si compute_proofs_v2 génère proof2 avec ou sans IV
 */
async function main() {
    console.log("🔍 VERIFICATION: compute_proofs_v2 and proof2");
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
    const keyHex = bytes_to_hex(key);

    const precontract = compute_precontract_values_v2(fileData, key);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const ct = new Uint8Array(precontract.ct);
    
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, keyHex);
    const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();

    const challenge = 259;
    console.log(`🧪 TEST: compute_proofs_v2 with challenge=${challenge}\n`);
    
    const proofs = compute_proofs_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge
    );

    console.log(`📊 RESULTS:`);
    console.log(`   - proof1 layers: ${proofs.proof1.length}`);
    console.log(`   - proof2 layers: ${proofs.proof2.length}`);
    if (proofs.proof2.length > 0) {
        console.log(`   - proof2[0] length: ${proofs.proof2[0]?.length || 0} elements`);
        console.log(`   ⚠️  proof2 is generated! Need to verify if it's with or without IV.`);
    } else {
        console.log(`   ✅ proof2 is empty (no ciphertext blocks used)`);
        console.log(`   ✅ This is why compute_proofs_v2 works without offset!`);
    }
    console.log(`   - proof3 layers: ${proofs.proof3.length}`);
    console.log(`   - proof_ext layers: ${proofs.proof_ext.length}`);
    console.log();

    const challenge1 = 1;
    console.log(`🧪 TEST: compute_proofs_v2 with challenge=${challenge1}\n`);
    
    const proofs1 = compute_proofs_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge1
    );

    console.log(`📊 RESULTS:`);
    console.log(`   - proof1 layers: ${proofs1.proof1.length}`);
    console.log(`   - proof2 layers: ${proofs1.proof2.length}`);
    if (proofs1.proof2.length > 0) {
        console.log(`   - proof2[0] length: ${proofs1.proof2[0]?.length || 0} elements`);
        console.log(`   ⚠️  proof2 is generated for challenge=1!`);
        console.log(`   ⚠️  Need to verify if compute_proofs_v2 generates proof2 WITH or WITHOUT IV.`);
    } else {
        console.log(`   ✅ proof2 is empty`);
    }
    console.log(`   - proof3 layers: ${proofs1.proof3.length}`);
    console.log(`   - proof_ext layers: ${proofs1.proof_ext.length}`);
    console.log();

    console.log("=".repeat(80));
    console.log("✅ VERIFICATION COMPLETED");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


