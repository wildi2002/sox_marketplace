import { expect } from "chai";
import { ethers } from "hardhat";
import { TestEvaluatorSOX_V2 } from "../typechain-types";

describe("CONST Gate Gas Measurement", function () {
    let testEvaluator: TestEvaluatorSOX_V2;
    let sha256Evaluator: any;
    let aes128CtrEvaluator: any;

    // Helper function to encode i64 to 6 bytes (big-endian)
    function encodeI64To6Bytes(value: number): Uint8Array {
        const limit = 1n << 48n;
        let v = BigInt(value);
        if (v < 0) {
            v = limit + v;
        }
        const bytes = new Uint8Array(6);
        for (let i = 5; i >= 0; i--) {
            bytes[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return bytes;
    }

    // Helper function to encode a V2 gate (64 bytes)
    function encodeGateV2(opcode: number, sons: number[], params: Uint8Array): Uint8Array {
        const gate = new Uint8Array(64);
        gate.fill(0);
        
        gate[0] = opcode;
        
        for (let i = 0; i < sons.length; i++) {
            const offset = 1 + i * 6;
            const sonBytes = encodeI64To6Bytes(sons[i]);
            gate.set(sonBytes, offset);
        }
        
        const paramsStart = 1 + sons.length * 6;
        for (let i = 0; i < params.length && i < (64 - paramsStart); i++) {
            gate[paramsStart + i] = params[i];
        }
        
        return gate;
    }

    before(async () => {
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();

        const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
        aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();

        const TestEvaluatorFactory = await ethers.getContractFactory("TestEvaluatorSOX_V2", {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        });
        testEvaluator = await TestEvaluatorFactory.deploy();
        await testEvaluator.waitForDeployment();
    });

    it("Should measure gas for CONST gate with 0 sons", async function () {
        const params = new Uint8Array(32);
        params.fill(0x42);
        const gateBytes = encodeGateV2(0x03, [], params);
        const sonValues: string[] = [];
        const aesKey = ethers.hexlify(new Uint8Array(16));
        
        // estimateGas pour une fonction view nécessite d'appeler la fonction
        // On utilise estimateGas sur un call statique
        const gasEstimate = await testEvaluator.evaluateGateFromSons.estimateGas(gateBytes, sonValues, aesKey);
        
        console.log("\n📊 CONST Gate (arity 0) Gas Cost:");
        console.log(`   Gas estimate: ${gasEstimate.toString()}`);
        console.log(`   Gas estimate (formatted): ${gasEstimate.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
        
        // Exécuter pour vérifier que ça fonctionne
        const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, aesKey);
        expect(result.length).to.be.greaterThan(0);
    });

    it("Should measure gas for CONST gate with 1 son", async function () {
        const params = new Uint8Array(32);
        params.fill(0xAA);
        const gateBytes = encodeGateV2(0x03, [1], params);
        const son0 = new Uint8Array(64);
        son0.fill(0x11);
        const sonValues: string[] = [ethers.hexlify(son0)];
        
        const aesKey = ethers.hexlify(new Uint8Array(16));
        
        const gasEstimate = await testEvaluator.evaluateGateFromSons.estimateGas(gateBytes, sonValues, aesKey);
        
        console.log("\n📊 CONST Gate (arity 1) Gas Cost:");
        console.log(`   Gas estimate: ${gasEstimate.toString()}`);
        console.log(`   Gas estimate (formatted): ${gasEstimate.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
        
        // Exécuter pour vérifier que ça fonctionne
        const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, aesKey);
        expect(result.length).to.be.greaterThan(0);
    });
});

