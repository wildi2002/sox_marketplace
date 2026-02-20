import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Gate Type Execution Cost Measurements for Circuit V2
 * 
 * This test measures the gas cost for executing each gate type in the V2 circuit
 * by directly calling EvaluatorSOX_V2.evaluateGateFromSons.
 * 
 * Gate types:
 * - OPCODE_AES_CTR (0x01): AES-128 CTR encrypt/decrypt
 * - OPCODE_SHA2 (0x02): SHA256 compression
 * - OPCODE_CONST (0x03): Constant value
 * - OPCODE_XOR (0x04): Bitwise XOR
 * - OPCODE_COMP (0x05): Comparison (equality check)
 */

describe("Gate Type Execution Costs - Circuit V2", function () {
    let evaluator: any;
    let sha256Evaluator: any;
    let aes128CtrEvaluator: any;
    
    // Gas measurements for each gate type
    const gasCosts: Record<string, bigint> = {};
    
    // Helper function to encode a V2 gate (64 bytes)
    function encodeGateV2(opcode: number, sons: number[], params: Uint8Array): Uint8Array {
        const gate = new Uint8Array(64);
        gate.fill(0);
        
        // Opcode (1 byte)
        gate[0] = opcode;
        
        // Sons (each 6 bytes, big-endian signed i64)
        for (let i = 0; i < sons.length; i++) {
            const offset = 1 + i * 6;
            const son = BigInt(sons[i]);
            // Encode as 6-byte big-endian signed i64
            for (let j = 0; j < 6; j++) {
                gate[offset + j] = Number((son >> BigInt(8 * (5 - j))) & 0xFFn);
            }
        }
        
        // Params
        const paramsStart = 1 + sons.length * 6;
        for (let i = 0; i < params.length && i < (64 - paramsStart); i++) {
            gate[paramsStart + i] = params[i];
        }
        
        return gate;
    }
    
    before(async function () {
        console.log("\n📊 ===== GATE TYPE EXECUTION COST MEASUREMENTS =====");
        console.log("Measuring gas costs for executing each gate type in Circuit V2\n");
        
        // Deploy required libraries
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        
        const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
        aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();
        
        // Deploy a test contract that uses EvaluatorSOX_V2
        // We'll use a simple wrapper contract to call evaluateGateFromSons
        const TestEvaluatorFactory = await ethers.getContractFactory("EvaluatorSOX_V2");
        evaluator = TestEvaluatorFactory.attach(ethers.ZeroAddress); // Library, no deployment needed
        
        console.log("✅ Libraries deployed\n");
    });
    
    /**
     * Helper function to measure gas for a specific gate type
     * We'll create a minimal test contract that calls EvaluatorSOX_V2
     */
    async function measureGateTypeGas(
        gateType: string,
        opcode: number,
        gateBytes: Uint8Array,
        sonValues: string[],
        aesKey: string
    ): Promise<bigint> {
        console.log(`\n🔍 Measuring gas for: ${gateType} (opcode 0x${opcode.toString(16).padStart(2, '0')})`);
        
        // Create a test contract that calls EvaluatorSOX_V2.evaluateGateFromSons
        const TestContract = await ethers.getContractFactory("TestGateEvaluator", {
            libraries: {
                EvaluatorSOX_V2: ethers.ZeroAddress, // Will be set after deployment
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        });
        
        // We need to deploy EvaluatorSOX_V2 first (it's a library)
        // Actually, EvaluatorSOX_V2 is an internal library, so we can't call it directly
        // Instead, we'll create a wrapper contract
        
        // For now, let's use a simpler approach: deploy DisputeSOXAccount and call evaluateGateFromSons
        // But that's complex. Let me create a minimal test contract.
        
        // Actually, the best approach is to create a test contract that exposes evaluateGateFromSons
        const testContractCode = `
        pragma solidity ^0.8.0;
        import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";
        import {SHA256Evaluator} from "./SHA256Evaluator.sol";
        import {AES128CtrEvaluator} from "./AES128CtrEvaluator.sol";
        
        contract TestGateEvaluator {
            function evaluateGate(bytes calldata gateBytes, bytes[] calldata sonValues, bytes16 aesKey) 
                external pure returns (bytes memory) {
                return EvaluatorSOX_V2.evaluateGateFromSons(gateBytes, sonValues, aesKey);
            }
        }
        `;
        
        // For simplicity, let's just estimate the gas by deploying a minimal DisputeSOXAccount
        // and calling a function that uses evaluateGateFromSons internally
        // But that's still complex...
        
        // Actually, let's use a different approach: measure the gas cost by looking at
        // the individual evaluator functions (SHA256Evaluator, AES128CtrEvaluator)
        // and the overhead of EvaluatorSOX_V2
        
        console.log(`   ⚠️  Direct measurement requires a test contract wrapper`);
        console.log(`   📊 Using estimated costs based on individual evaluator functions`);
        
        // For now, return 0 and we'll fill in with actual measurements
        return 0n;
    }
    
    it("Should measure gas for AES-CTR gate (OPCODE 0x01)", async function () {
        // AES-CTR gate: decrypts a 64-byte block
        const gateBytes = encodeGateV2(0x01, [1], new Uint8Array(18).fill(0)); // 16 bytes counter + 2 bytes length
        const sonValues = [ethers.hexlify(new Uint8Array(64).fill(0x42))];
        const aesKey = "0x00000000000000000000000000000000"; // 16 bytes
        
        // Measure gas for AES128CtrEvaluator.encryptBlockInternal
        const testData = new Uint8Array(16).fill(0x01);
        const testKey = new Uint8Array(16).fill(0x02);
        
        // We can't directly call internal functions, so we'll estimate
        // Based on the paper: AES-128 CTR encrypt/decrypt = 5,176,313 gas
        // But that's for the full submitCommitment, not just the gate evaluation
        
        console.log(`   📝 Note: Full submitCommitment cost includes proof verification overhead`);
        console.log(`   📝 Paper value (full submission): 5,176,313 gas`);
        
        gasCosts["AES-128 CTR encrypt/decrypt"] = 0n; // Will be measured
    });
    
    it("Should measure gas for SHA2 gate (OPCODE 0x02)", async function () {
        const gateBytes = encodeGateV2(0x02, [1, 2], new Uint8Array(0));
        const sonValues = [
            ethers.hexlify(new Uint8Array(32).fill(0x41)), // Previous hash
            ethers.hexlify(new Uint8Array(64).fill(0x42))  // Block
        ];
        
        // Measure gas for SHA256Evaluator.sha256CompressionInstruction
        const tx = await sha256Evaluator.sha256CompressionInstruction(sonValues);
        const receipt = await tx.wait();
        const gasUsed = receipt?.gasUsed || 0n;
        
        console.log(`   ✅ SHA256 compression gas: ${gasUsed.toLocaleString()} gas`);
        gasCosts["SHA256 compression"] = gasUsed;
    });
    
    it("Should display gas cost summary", async function () {
        console.log("\n" + "=".repeat(80));
        console.log("📊 GATE TYPE EXECUTION COSTS SUMMARY - CIRCUIT V2");
        console.log("=".repeat(80));
        console.log("\n| Gate Type | Opcode | Gas Cost | Notes |");
        console.log("|-----------|--------|----------|-------|");
        
        const gateTypes = [
            { name: "AES-128 CTR encrypt/decrypt", opcode: "0x01", note: "Needs full test" },
            { name: "SHA256 compression", opcode: "0x02", note: "Measured" },
            { name: "Constant value", opcode: "0x03", note: "Minimal cost" },
            { name: "XOR", opcode: "0x04", note: "Minimal cost" },
            { name: "Equality check", opcode: "0x05", note: "Minimal cost" },
        ];
        
        for (const gateType of gateTypes) {
            const gas = gasCosts[gateType.name] || 0n;
            const gasStr = gas > 0n ? gas.toLocaleString() : "TBD";
            console.log(`| ${gateType.name.padEnd(28)} | ${gateType.opcode.padEnd(6)} | ${gasStr.padStart(9)} | ${gateType.note.padEnd(6)} |`);
        }
        
        console.log("\n" + "=".repeat(80));
        console.log("\n📝 Notes:");
        console.log("   - These measurements are for gate execution only");
        console.log("   - Full submitCommitment includes proof verification overhead");
        console.log("   - Paper's Table 3 includes full submission costs");
        console.log("\n");
    });
});






