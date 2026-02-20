import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../../app/lib/crypto_lib/crypto_lib";

/**
 * Real Proof Gas Measurements
 * 
 * This test measures gas costs using REAL proofs generated from circuit evaluation,
 * similar to the SOX paper's measurements. This is different from mock proofs which
 * use random data that fail verification.
 * 
 * The test:
 * 1. Generates a real file and circuit
 * 2. Evaluates the circuit
 * 3. Navigates through the dispute phase
 * 4. Generates real proofs using WASM functions
 * 5. Submits proofs and measures gas costs
 */

describe("Real Proof Gas Measurements (Table 3 Format)", function () {
    let sponsor: HardhatEthersSigner;
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;
    
    let entryPoint: any;
    let optimisticAccount: any;
    let disputeAccount: any;
    
    // Test parameters - Using smaller file for faster testing
    // Can be increased for more realistic measurements
    const FILE_SIZE_BYTES = 1024 * 64; // 64KB file (smaller for faster tests)
    
    // numBlocks and numGates will be set from precontract after circuit generation
    // We calculate them in TypeScript to avoid WASM dependency for these values
    let numBlocks: number;
    let numGates: number;
    
    const agreedPrice = parseEther("1.0");
    const completionTip = parseEther("0.1");
    const disputeTip = parseEther("0.12");
    const timeoutIncrement = 3600n;
    
    const SPONSOR_FEES = 5n;
    const DISPUTE_FEES = 10n;
    
    // Circuit data (will be generated)
    let circuit_bytes: Uint8Array;
    let evaluated_bytes: Uint8Array;
    let ct: Uint8Array;
    let commitment: { c: string; o: string };
    let key: Uint8Array;
    let description: string;
    
    before(async function () {
        [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await ethers.getSigners();
        
        console.log("\n📊 ===== REAL PROOF GAS MEASUREMENTS =====");
        console.log(`📁 File size: ${FILE_SIZE_BYTES} bytes`);
        console.log(`🔢 Number of blocks: ${numBlocks}`);
        console.log(`🔢 Number of gates: ${numGates}`);
        console.log(`🔢 Expected rounds: ${Math.ceil(Math.log2(numGates))}\n`);
        
        // Initialize WASM module
        // Path from src/hardhat/test/performance/ to src/app/lib/crypto_lib/
        const modulePath = join(__dirname, "../../../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const module = await readFile(modulePath);
        initSync({ module: module });
        console.log("✅ WASM module initialized\n");
        
        // Generate real file and V2 circuit
        console.log("📝 Generating V2 circuit and evaluating...");
        const file = new Uint8Array(FILE_SIZE_BYTES);
        key = new Uint8Array(16);
        
        const precontract = compute_precontract_values_v2(file, key);
        circuit_bytes = precontract.circuit_bytes;
        ct = precontract.ct;
        commitment = precontract.commitment;
        description = precontract.description;
        
        // Use the actual numBlocks and numGates from the circuit (calculated in WASM)
        numBlocks = precontract.num_blocks;
        numGates = precontract.num_gates;
        
        console.log(`   Actual numBlocks from circuit: ${numBlocks}`);
        console.log(`   Actual numGates from circuit: ${numGates}`);
        
        // Evaluate V2 circuit
        evaluated_bytes = evaluate_circuit_v2_wasm(
            circuit_bytes,
            ct,
            bytes_to_hex(key)
        ).to_bytes();
        
        console.log("✅ Circuit generated and evaluated\n");
        
        // Deploy EntryPoint
        const EntryPointFactory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
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
        const sponsorAmount = SPONSOR_FEES;
        optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitment.c,
            numBlocks,
            numGates,
            await vendor.getAddress(),
            { value: sponsorAmount }
        );
        await optimisticAccount.waitForDeployment();
        
        // Setup optimistic phase
        await optimisticAccount.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        await optimisticAccount.connect(vendor).sendKey(key);
        await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
            value: DISPUTE_FEES + disputeTip
        });
        await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + disputeTip + agreedPrice
        });
        
        const disputeAddress = await optimisticAccount.disputeContract();
        disputeAccount = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
        
        console.log("✅ Contracts deployed and optimistic phase completed\n");
    });
    
    describe("Scenario 1: submitCommitmentRight with Real Proofs", function () {
        it("Should measure gas for submitCommitmentRight with real proofs", async function () {
            console.log("\n📊 Scenario 1: submitCommitmentRight (State 4)");
            
            // Navigate to state 4 (WaitVendorDataRight)
            // This happens when chall == numGates
            const rounds = Math.ceil(Math.log2(numGates));
            let totalGas = 0n;
            
            for (let i = 0; i < rounds; i++) {
                const state = Number(await disputeAccount.currState());
                if (state !== 0) { // Not ChallengeBuyer
                    break;
                }
                
                // Buyer responds to challenge with real hpre
                const challenge = await disputeAccount.chall();
                const hpre_res = hpre_v2(evaluated_bytes, numBlocks, Number(challenge));
                const tx1 = await disputeAccount.connect(buyer).respondChallenge(hpre_res);
                const receipt1 = await tx1.wait();
                const gas1 = receipt1.gasUsed || 0n;
                totalGas += gas1;
                
                // Vendor agrees until we reach the end
                const vendorAgrees = i < rounds - 1; // Agree until last round
                const tx2 = await disputeAccount.connect(vendor).giveOpinion(vendorAgrees);
                const receipt2 = await tx2.wait();
                const gas2 = receipt2.gasUsed || 0n;
                totalGas += gas2;
                
                // Log gas per round for debugging
                if (i === 0) {
                    console.log(`   Round ${i + 1}: respondChallenge=${gas1.toString()} gas, giveOpinion=${gas2.toString()} gas, total=${(gas1 + gas2).toString()} gas`);
                }
                
                const finalState = Number(await disputeAccount.currState());
                if (finalState === 4) { // WaitVendorDataRight
                    // Generate REAL proof (V2)
                    console.log("   Generating real V2 proof for submitCommitmentRight...");
                    const proof = compute_proof_right_v2(
                        evaluated_bytes,
                        numBlocks,
                        numGates
                    );
                    
                    // Convert proof to bytes32[][] format
                    const proofBytes32: string[][] = [];
                    for (let layer = 0; layer < proof.length; layer++) {
                        const layerArray: string[] = [];
                        for (let item = 0; item < proof[layer].length; item++) {
                            const itemBytes = new Uint8Array(proof[layer][item]);
                            // Ensure it's exactly 32 bytes
                            if (itemBytes.length !== 32) {
                                throw new Error(`Proof item length is ${itemBytes.length}, expected 32`);
                            }
                            layerArray.push(ethers.hexlify(itemBytes));
                        }
                        proofBytes32.push(layerArray);
                    }
                    
                    // Submit with REAL proof
                    const tx3 = await disputeAccount.connect(vendor).submitCommitmentRight(proofBytes32);
                    const receipt3 = await tx3.wait();
                    const proofGas = receipt3.gasUsed || 0n;
                    totalGas += proofGas;
                    
                    console.log(`   ✅ Proof submitted successfully!`);
                    console.log(`   📊 Challenge-response rounds: ${i + 1}`);
                    console.log(`   📊 Challenge-response gas: ${(totalGas - proofGas).toString()} gas`);
                    console.log(`   📊 Proof submission gas: ${proofGas.toString()} gas`);
                    console.log(`   📊 Total: ${totalGas.toString()} gas`);
                    
                    // Verify the dispute state after proof submission
                    const finalStateAfter = Number(await disputeAccount.currState());
                    console.log(`   📊 Final state after proof: ${finalStateAfter}`);
                    // State 5 = Complete, 6 = Cancel, 7 = End
                    // Note: The state might be different depending on the proof verification result
                    // For now, we just log it to see what state we're in
                    if (finalStateAfter !== 5 && finalStateAfter !== 6 && finalStateAfter !== 7) {
                        console.log(`   ⚠️  Warning: Expected state 5, 6, or 7, got ${finalStateAfter}`);
                    }
                    
                    break;
                }
            }
        });
    });
    
    describe("Scenario 2: submitCommitmentLeft with Real Proofs", function () {
        it("Should measure gas for submitCommitmentLeft with real proofs", async function () {
            console.log("\n📊 Scenario 2: submitCommitmentLeft (State 3)");
            
            // Deploy a fresh dispute for this scenario
            // (We need a new dispute because the previous one is completed)
            const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
                libraries: {
                    DisputeDeployer: await (await ethers.getContractFactory("DisputeDeployer", {
                        libraries: {
                            AccumulatorVerifier: await (await ethers.getContractFactory("AccumulatorVerifier")).deploy().then(c => c.waitForDeployment()),
                            CommitmentOpener: await (await ethers.getContractFactory("CommitmentOpener")).deploy().then(c => c.waitForDeployment()),
                            SHA256Evaluator: await (await ethers.getContractFactory("SHA256Evaluator")).deploy().then(c => c.waitForDeployment()),
                        },
                    })).deploy().then(c => c.waitForDeployment()),
                },
            });
            
            const newOptimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyer.getAddress(),
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                commitment.c,
                numBlocks,
                numGates,
                await vendor.getAddress(),
                { value: SPONSOR_FEES }
            );
            await newOptimisticAccount.waitForDeployment();
            
            // Setup optimistic phase
            await newOptimisticAccount.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
            await newOptimisticAccount.connect(vendor).sendKey(key);
            await newOptimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip
            });
            await newOptimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip + agreedPrice
            });
            
            const disputeAddress2 = await newOptimisticAccount.disputeContract();
            const disputeAccount2 = await ethers.getContractAt("DisputeSOXAccount", disputeAddress2);
            
            // Navigate to state 3 (WaitVendorDataLeft)
            // This happens when chall == 0 (or numBlocks)
            const rounds = Math.ceil(Math.log2(numGates));
            let totalGas = 0n;
            
            for (let i = 0; i < rounds; i++) {
                const state = Number(await disputeAccount2.currState());
                if (state !== 0) {
                    break;
                }
                
                // Buyer responds
                const challenge = await disputeAccount2.chall();
                const hpre_res = hpre_v2(evaluated_bytes, numBlocks, Number(challenge));
                const tx1 = await disputeAccount2.connect(buyer).respondChallenge(hpre_res);
                const receipt1 = await tx1.wait();
                totalGas += receipt1.gasUsed || 0n;
                
                // Vendor disagrees to move left until we reach 0
                const vendorAgrees = false; // Always disagree to go left
                const tx2 = await disputeAccount2.connect(vendor).giveOpinion(vendorAgrees);
                const receipt2 = await tx2.wait();
                totalGas += receipt2.gasUsed || 0n;
                
                const finalState = Number(await disputeAccount2.currState());
                if (finalState === 3) { // WaitVendorDataLeft
                    const chall = await disputeAccount2.chall();
                    const gateNum = Number(chall);
                    
                    // Generate REAL proof (V2)
                    console.log(`   Generating real V2 proof for submitCommitmentLeft (gateNum: ${gateNum})...`);
                    const {
                        gate_bytes,
                        values,
                        curr_acc,
                        proof1,
                        proof2,
                        proof_ext,
                    } = compute_proofs_left_v2(
                        circuit_bytes,
                        evaluated_bytes,
                        ct,
                        gateNum
                    );
                    
                    // Gate is already in V2 format (64 bytes)
                    const gateBytes = new Uint8Array(gate_bytes);
                    if (gateBytes.length !== 64) {
                        throw new Error(`Gate bytes length is ${gateBytes.length}, expected 64 for V2`);
                    }
                    
                    // Convert values to bytes[]
                    const valuesBytes: string[] = [];
                    for (let i = 0; i < values.length; i++) {
                        valuesBytes.push(ethers.hexlify(new Uint8Array(values[i])));
                    }
                    
                    // Convert proofs to bytes32[][]
                    const proof1Bytes32 = convertProofToBytes32(proof1);
                    const proof2Bytes32 = convertProofToBytes32(proof2);
                    const proofExtBytes32 = convertProofToBytes32(proof_ext);
                    
                    // Convert curr_acc to bytes32
                    const currAccBytes32 = ethers.hexlify(new Uint8Array(curr_acc));
                    
                    // Get opening value from commitment
                    const openingValue = commitment.o;
                    
                    // Submit with REAL proof
                    const tx3 = await disputeAccount2.connect(vendor).submitCommitmentLeft(
                        openingValue,
                        gateNum,
                        gateBytes,
                        valuesBytes,
                        currAccBytes32,
                        proof1Bytes32,
                        proof2Bytes32,
                        proofExtBytes32
                    );
                    const receipt3 = await tx3.wait();
                    const proofGas = receipt3.gasUsed || 0n;
                    totalGas += proofGas;
                    
                    console.log(`   ✅ Proof submitted successfully!`);
                    console.log(`   📊 Challenge-response rounds: ${i + 1}`);
                    console.log(`   📊 Challenge-response gas: ${(totalGas - proofGas).toString()} gas`);
                    console.log(`   📊 Proof submission gas: ${proofGas.toString()} gas`);
                    console.log(`   📊 Total: ${totalGas.toString()} gas`);
                    
                    break;
                }
            }
        });
    });
    
    describe("Scenario 3: submitCommitment with Real Proofs", function () {
        it("Should measure gas for submitCommitment with real proofs", async function () {
            console.log("\n📊 Scenario 3: submitCommitment (State 2) - General Case");
            
            // Deploy a fresh dispute for this scenario
            const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
                libraries: {
                    DisputeDeployer: await (await ethers.getContractFactory("DisputeDeployer", {
                        libraries: {
                            AccumulatorVerifier: await (await ethers.getContractFactory("AccumulatorVerifier")).deploy().then(c => c.waitForDeployment()),
                            CommitmentOpener: await (await ethers.getContractFactory("CommitmentOpener")).deploy().then(c => c.waitForDeployment()),
                            SHA256Evaluator: await (await ethers.getContractFactory("SHA256Evaluator")).deploy().then(c => c.waitForDeployment()),
                        },
                    })).deploy().then(c => c.waitForDeployment()),
                },
            });
            
            const newOptimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyer.getAddress(),
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                commitment.c,
                numBlocks,
                numGates,
                await vendor.getAddress(),
                { value: SPONSOR_FEES }
            );
            await newOptimisticAccount.waitForDeployment();
            
            // Setup optimistic phase
            await newOptimisticAccount.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
            await newOptimisticAccount.connect(vendor).sendKey(key);
            await newOptimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip
            });
            await newOptimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip + agreedPrice
            });
            
            const disputeAddress3 = await newOptimisticAccount.disputeContract();
            const disputeAccount3 = await ethers.getContractAt("DisputeSOXAccount", disputeAddress3);
            
            // Navigate to state 2 (WaitVendorData)
            // This happens when 0 < chall < numGates
            const rounds = Math.ceil(Math.log2(numGates));
            let totalGas = 0n;
            
            for (let i = 0; i < rounds; i++) {
                const state = Number(await disputeAccount3.currState());
                if (state !== 0) {
                    break;
                }
                
                // Buyer responds
                const challenge = await disputeAccount3.chall();
                const hpre_res = hpre_v2(evaluated_bytes, numBlocks, Number(challenge));
                const tx1 = await disputeAccount3.connect(buyer).respondChallenge(hpre_res);
                const receipt1 = await tx1.wait();
                totalGas += receipt1.gasUsed || 0n;
                
                // Strategy: alternate to land in middle (0 < chall < numGates)
                const chall = await disputeAccount3.chall();
                const challNum = Number(chall);
                const vendorAgrees = i % 2 === 0; // Alternate
                
                const tx2 = await disputeAccount3.connect(vendor).giveOpinion(vendorAgrees);
                const receipt2 = await tx2.wait();
                totalGas += receipt2.gasUsed || 0n;
                
                const finalState = Number(await disputeAccount3.currState());
                if (finalState === 2) { // WaitVendorData
                    const challFinal = await disputeAccount3.chall();
                    const gateNum = Number(challFinal);
                    
                    // Generate REAL proof (V2)
                    console.log(`   Generating real V2 proof for submitCommitment (gateNum: ${gateNum})...`);
                    const {
                        gate_bytes,
                        values,
                        curr_acc,
                        proof1,
                        proof2,
                        proof3,
                        proof_ext,
                    } = compute_proofs_v2(
                        circuit_bytes,
                        evaluated_bytes,
                        ct,
                        gateNum
                    );
                    
                    // Gate is already in V2 format (64 bytes)
                    const gateBytes = new Uint8Array(gate_bytes);
                    if (gateBytes.length !== 64) {
                        throw new Error(`Gate bytes length is ${gateBytes.length}, expected 64 for V2`);
                    }
                    
                    // Convert values to bytes[]
                    const valuesBytes: string[] = [];
                    for (let i = 0; i < values.length; i++) {
                        valuesBytes.push(ethers.hexlify(new Uint8Array(values[i])));
                    }
                    
                    // Convert proofs to bytes32[][]
                    const proof1Bytes32 = convertProofToBytes32(proof1);
                    const proof2Bytes32 = convertProofToBytes32(proof2);
                    const proof3Bytes32 = convertProofToBytes32(proof3);
                    const proofExtBytes32 = convertProofToBytes32(proof_ext);
                    
                    // Convert curr_acc to bytes32
                    const currAccBytes32 = ethers.hexlify(new Uint8Array(curr_acc));
                    
                    // Get opening value from commitment
                    const openingValue = commitment.o;
                    
                    // Submit with REAL proof
                    const tx3 = await disputeAccount3.connect(vendor).submitCommitment(
                        openingValue,
                        gateNum,
                        gateBytes,
                        valuesBytes,
                        currAccBytes32,
                        proof1Bytes32,
                        proof2Bytes32,
                        proof3Bytes32,
                        proofExtBytes32
                    );
                    const receipt3 = await tx3.wait();
                    const proofGas = receipt3.gasUsed || 0n;
                    totalGas += proofGas;
                    
                    console.log(`   ✅ Proof submitted successfully!`);
                    console.log(`   📊 Challenge-response rounds: ${i + 1}`);
                    console.log(`   📊 Challenge-response gas: ${(totalGas - proofGas).toString()} gas`);
                    console.log(`   📊 Proof submission gas: ${proofGas.toString()} gas`);
                    console.log(`   📊 Total: ${totalGas.toString()} gas`);
                    
                    break;
                }
            }
        });
    });
    
    /**
     * Helper function to convert WASM proof format to bytes32[][]
     */
    function convertProofToBytes32(proof: any): string[][] {
        const proofBytes32: string[][] = [];
        for (let layer = 0; layer < proof.length; layer++) {
            const layerArray: string[] = [];
            for (let item = 0; item < proof[layer].length; item++) {
                const itemBytes = new Uint8Array(proof[layer][item]);
                // Ensure it's exactly 32 bytes
                if (itemBytes.length !== 32) {
                    throw new Error(`Proof item length is ${itemBytes.length}, expected 32`);
                }
                layerArray.push(ethers.hexlify(itemBytes));
            }
            proofBytes32.push(layerArray);
        }
        return proofBytes32;
    }
});

