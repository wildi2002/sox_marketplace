import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_left_v2,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour investiguer pourquoi verifyCommitmentLeft retourne false
 * Teste chaque STEP individuellement pour identifier le problème
 */
async function main() {
    console.log("🔍 INVESTIGATION: Why verifyCommitmentLeft returns false");
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
    console.log(`✅ File read: ${fileData.length} bytes\n`);

    // Generate a test key (16 bytes)
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        key[i] = i + 1;
    }
    const keyHex = bytes_to_hex(key);
    console.log(`📊 AES Key: ${keyHex}\n`);

    console.log("🔢 Computing precontract...");
    const precontract = compute_precontract_values_v2(fileData, key);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const ct = new Uint8Array(precontract.ct);
    const commitment = precontract.commitment;
    const openingValue = precontract.commitment.o;
    
    console.log(`✅ Precontract calculated:`);
    console.log(`   - Commitment: ${bytes_to_hex(commitment.c)}`);
    console.log(`   - Opening value: ${bytes_to_hex(openingValue)}\n`);

    console.log("🔢 Evaluating circuit...");
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, keyHex);
    const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();
    console.log(`✅ Circuit evaluated (${evaluatedCircuitBytes.length} bytes)\n`);

    const gateNum = 1;
    console.log(`📐 Calculating proofs for gate ${gateNum} (1-indexed) with WASM...\n`);

    const proofs = compute_proofs_left_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        gateNum
    );
    console.log(`✅ Proofs calculated by WASM:`);
    console.log(`   - gate_bytes: ${proofs.gate_bytes.length} bytes`);
    console.log(`   - values: ${proofs.values.length} elements`);
    console.log(`   - curr_acc: ${ethers.hexlify(new Uint8Array(proofs.curr_acc))}`);
    console.log(`   - proof1: ${proofs.proof1.length} layers`);
    console.log(`   - proof2: ${proofs.proof2.length} layers`);
    console.log(`   - proof_ext: ${proofs.proof_ext.length} layers\n`);

    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray = new Uint8Array(proofs.curr_acc);
    const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    const openingValueBytes = new Uint8Array(openingValue);
    const openingValueHex = ethers.hexlify(openingValueBytes);

    console.log("📦 Deploying test contracts...\n");
    
    const [deployer] = await ethers.getSigners();
    
    // Deploy EntryPoint
    const EntryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        deployer
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    
    // Deploy libraries
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });
    const optimisticAccount = await OptimisticSOXAccountFactory.deploy(
        await entryPoint.getAddress(),
        deployer.address, // vendor
        deployer.address, // buyer
        ethers.parseEther("1.0"), // agreedPrice
        ethers.parseEther("0.1"), // completionTip
        ethers.parseEther("0.12"), // disputeTip
        3600n, // timeoutIncrement
        commitment.c, // commitment
        2, // numBlocks
        3, // numGates
        deployer.address, // sbSponsor
        { value: 5n }
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddr = await optimisticAccount.getAddress();
    console.log(`✅ OptimisticSOXAccount: ${optimisticAddr}`);

    await optimisticAccount.sendPayment({ value: ethers.parseEther("1.1") });
    console.log(`✅ Payment sent`);

    const keyBytes16 = ethers.hexlify(key);
    await optimisticAccount.sendKey(keyBytes16);
    console.log(`✅ Key sent to contract\n`);

    const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    
    const entryPointAddr = await entryPoint.getAddress();
    const disputeAccount = await DisputeSOXAccountFactory.deploy(
        entryPointAddr,
        optimisticAddr,
        2,
        3,
        commitment.c,
        1,
        deployer.address,
        deployer.address,
        deployer.address,
        deployer.address,
        deployer.address,
        { value: 0 }
    );
    await disputeAccount.waitForDeployment();
    console.log(`✅ DisputeSOXAccount: ${await disputeAccount.getAddress()}\n`);

    const contractCommitment = await disputeAccount.commitment();
    const computedCommitment = ethers.keccak256(openingValueBytes);
    console.log("🔍 STEP 1: Verifying commitment");
    console.log(`   - Calculated: ${computedCommitment}`);
    console.log(`   - Contract: ${contractCommitment}`);
    if (computedCommitment.toLowerCase() === contractCommitment.toLowerCase()) {
        console.log(`   ✅ Commitments match!\n`);
    } else {
        console.log(`   ❌ Commitments do not match!\n`);
        return;
    }

    console.log("🔍 STEP 2: Testing openCommitment");
    try {
        const hCircuitCt = await disputeAccount.openCommitment.staticCall(openingValueHex);
        console.log(`   ✅ openCommitment succeeds`);
        console.log(`   - hCircuitCt[0] (hCircuit): ${ethers.hexlify(hCircuitCt[0])}`);
        console.log(`   - hCircuitCt[1] (hCt): ${ethers.hexlify(hCircuitCt[1])}\n`);
    } catch (error: any) {
        console.log(`   ❌ openCommitment fails: ${error.message}\n`);
        return;
    }

    console.log("🔍 STEP 3: Verifying gate bytes");
    console.log(`   - gate_bytes.length: ${gateBytesArray.length} bytes`);
    if (gateBytesArray.length === 64) {
        console.log(`   ✅ gate_bytes.length is correct (64 bytes)\n`);
    } else {
        console.log(`   ❌ gate_bytes.length is incorrect (should be 64)\n`);
        return;
    }

    console.log("🔍 STEP 4: Testing evaluateGateFromSons");
    try {
        const contractKey = await optimisticAccount.key();
        console.log(`   - Contract key: ${ethers.hexlify(contractKey)}`);
        console.log(`   - Key used: ${keyHex}`);
        
        if (ethers.hexlify(contractKey).toLowerCase() === keyHex.toLowerCase()) {
            console.log(`   ✅ Key matches\n`);
        } else {
            console.log(`   ⚠️  Key does not match (but this might be normal if format is different)\n`);
        }
    } catch (error: any) {
        console.log(`   ⚠️  Error verifying key: ${error.message}\n`);
    }

    console.log("🔍 STEP 5: Testing verifyCommitmentLeft (complete)");
    try {
        const result = await disputeAccount.testVerifyCommitmentLeft(
            openingValueHex,
            gateNum,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        
        if (result) {
            console.log(`   ✅ verifyCommitmentLeft returns: ${result}\n`);
        } else {
            console.log(`   ❌ verifyCommitmentLeft returns: ${result}\n`);
            console.log(`   📋 This means one of the verifications failed:\n`);
            console.log(`      1. AccumulatorVerifier.verify for proof1`);
            console.log(`      2. AccumulatorVerifier.verify for proof2`);
            console.log(`      3. AccumulatorVerifier.verifyExt for proofExt\n`);
        }
    } catch (error: any) {
        console.log(`   ❌ Error during call: ${error.message}\n`);
    }

    console.log("🔍 STEP 6: Testing individual verifications");
    
    const hCircuitCt = await disputeAccount.openCommitment.staticCall(openingValueHex);
    
    const gateNumArray = [gateNum - 1];
    const gateKeccak = [ethers.keccak256(gateBytesArray)];
    
    console.log(`   Test 1: AccumulatorVerifier.verify for proof1`);
    console.log(`      - Root: ${ethers.hexlify(hCircuitCt[0])}`);
    console.log(`      - gateNumArray: [${gateNumArray[0]}] (0-indexed, gate ${gateNum})`);
    console.log(`      - gateKeccak: ${gateKeccak[0]}`);
    console.log(`      - proof1 layers: ${proof1Array.length}`);
    try {
        const result1 = await accumulatorVerifier.verify.staticCall(
            hCircuitCt[0],
            gateNumArray,
            gateKeccak,
            proof1Array
        );
        console.log(`      ✅ proof1 verification: ${result1}\n`);
    } catch (error: any) {
        console.log(`      ❌ proof1 verification fails: ${error.message}\n`);
    }

    console.log(`   Test 2: AccumulatorVerifier.verifyExt for proofExt`);
    console.log(`      - i: 0 (0-indexed, Step 8b)`);
    console.log(`      - prevRoot: bytes32(0)`);
    console.log(`      - currRoot: ${ethers.hexlify(currAccArray)}`);
    console.log(`      - proof_ext layers: ${proofExtArray.length}`);
    
    try {
        const gateResKeccak = ethers.keccak256(ethers.hexlify(new Uint8Array(32)));
        console.log(`      - gateResKeccak (placeholder): ${gateResKeccak}`);
        
        const resultExt = await accumulatorVerifier.verifyExt.staticCall(
            0,
            ethers.ZeroHash,
            currAccArray,
            gateResKeccak,
            proofExtArray
        );
        console.log(`      ✅ proofExt verification: ${resultExt}\n`);
    } catch (error: any) {
        console.log(`      ❌ proofExt verification fails: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ INVESTIGATION COMPLETED");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

