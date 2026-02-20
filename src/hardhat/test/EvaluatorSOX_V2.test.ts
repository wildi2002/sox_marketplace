import { expect } from "chai";
import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    bytes_to_hex,
    hex_to_bytes,
    initSync,
    sha256_compress_js,
    decrypt_block_js,
} from "../../app/lib/crypto_lib";
import { TestEvaluatorSOX_V2 } from "../typechain-types";
import crypto from "crypto";

before(async () => {
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
});

describe("EvaluatorSOX_V2", function () {
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
        
        // Opcode (1 byte)
        gate[0] = opcode;
        
        // Sons (each 6 bytes, big-endian signed i64)
        for (let i = 0; i < sons.length; i++) {
            const offset = 1 + i * 6;
            const sonBytes = encodeI64To6Bytes(sons[i]);
            gate.set(sonBytes, offset);
        }
        
        // Params
        const paramsStart = 1 + sons.length * 6;
        for (let i = 0; i < params.length && i < (64 - paramsStart); i++) {
            gate[paramsStart + i] = params[i];
        }
        
        return gate;
    }

    before(async () => {
        // Deploy SHA256Evaluator
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();

        // Deploy AES128CtrEvaluator
        const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
        aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();

        // Deploy TestEvaluatorSOX_V2
        const TestEvaluatorFactory = await ethers.getContractFactory("TestEvaluatorSOX_V2", {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        });
        testEvaluator = await TestEvaluatorFactory.deploy();
        await testEvaluator.waitForDeployment();
    });

    describe("decodeSon", function () {
        it("should decode positive son index correctly", async function () {
            // Test encoding/decoding of son index 1
            const params = new Uint8Array(32);
            params.fill(0x01);
            const gateBytes = encodeGateV2(0x03, [1], params);
            const decoded = await testEvaluator.decodeGate(gateBytes);
            expect(decoded.sons[0]).to.equal(1n);
        });

        it("should decode negative son index correctly", async function () {
            // Test encoding/decoding of son index -1 (dummy gate)
            const params = new Uint8Array(32);
            params.fill(0x01);
            const gateBytes = encodeGateV2(0x03, [-1], params);
            const decoded = await testEvaluator.decodeGate(gateBytes);
            expect(decoded.sons[0]).to.equal(-1n);
        });
    });

    describe("decodeGate", function () {
        it("should decode CONST gate correctly", async function () {
            const params = new Uint8Array(32);
            params.fill(0xAB);
            const gateBytes = encodeGateV2(0x03, [], params);
            const decoded = await testEvaluator.decodeGate(gateBytes);
            
            expect(decoded.opcode).to.equal(0x03);
            expect(decoded.sons.length).to.equal(0);
            expect(ethers.hexlify(decoded.params)).to.equal(ethers.hexlify(params));
        });

        it("should decode gate with sons correctly", async function () {
            const gateBytes = encodeGateV2(0x04, [1, 2], new Uint8Array(0));
            const decoded = await testEvaluator.decodeGate(gateBytes);
            
            expect(decoded.opcode).to.equal(0x04);
            expect(decoded.sons.length).to.equal(2);
            expect(decoded.sons[0]).to.equal(1n);
            expect(decoded.sons[1]).to.equal(2n);
        });
    });

    describe("evaluateGateFromSons - CONST (0x03)", function () {
        it("should evaluate CONST gate with 0 sons", async function () {
            const params = new Uint8Array(32);
            params.fill(0x42);
            const gateBytes = encodeGateV2(0x03, [], params);
            const sonValues: string[] = [];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // First 32 bytes should be params
            expect(ethers.hexlify(resultBytes.slice(0, 32))).to.equal(ethers.hexlify(params));
            // Last 32 bytes should be zeros
            expect(ethers.hexlify(resultBytes.slice(32))).to.equal("0x" + "00".repeat(32));
        });

        it("should evaluate CONST gate with 1 son", async function () {
            const params = new Uint8Array(32);
            params.fill(0xAA);
            const gateBytes = encodeGateV2(0x03, [1], params);
            const sonValues: string[] = [ethers.hexlify(new Uint8Array(64).fill(0x11))];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // First 32 bytes should be params (son is ignored when arity is 0 or 1)
            expect(ethers.hexlify(resultBytes.slice(0, 32))).to.equal(ethers.hexlify(params));
        });

        it("should evaluate CONST gate with 1 son", async function () {
            const params = new Uint8Array(32);
            params.fill(0xBB);
            const gateBytes = encodeGateV2(0x03, [1], params);
            const son0 = new Uint8Array(64);
            son0.fill(0x11);
            const sonValues: string[] = [
                ethers.hexlify(son0),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // First 32 bytes should be from son0
            expect(ethers.hexlify(resultBytes.slice(0, 32))).to.equal(ethers.hexlify(son0.slice(0, 32)));
            // Last 32 bytes should be params
            expect(ethers.hexlify(resultBytes.slice(32))).to.equal(ethers.hexlify(params));
        });
    });

    describe("evaluateGateFromSons - XOR (0x04)", function () {
        it("should evaluate XOR gate correctly", async function () {
            const gateBytes = encodeGateV2(0x04, [1, 2], new Uint8Array(0));
            const son0 = new Uint8Array(64);
            son0.fill(0xAA);
            const son1 = new Uint8Array(64);
            son1.fill(0x55);
            const sonValues: string[] = [
                ethers.hexlify(son0),
                ethers.hexlify(son1),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // XOR of 0xAA and 0x55 should be 0xFF
            for (let i = 0; i < 64; i++) {
                expect(resultBytes[i]).to.equal(0xAA ^ 0x55);
            }
        });

        it("should handle XOR with different length inputs", async function () {
            const gateBytes = encodeGateV2(0x04, [1, 2], new Uint8Array(0));
            const son0 = new Uint8Array(32);
            son0.fill(0x11);
            const son1 = new Uint8Array(64);
            son1.fill(0x22);
            const sonValues: string[] = [
                ethers.hexlify(son0),
                ethers.hexlify(son1),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            // Result should be max length (64 bytes)
            expect(resultBytes.length).to.equal(64);
            // First 32 bytes should be XOR
            for (let i = 0; i < 32; i++) {
                expect(resultBytes[i]).to.equal(0x11 ^ 0x22);
            }
            // Remaining bytes should be from longer input (son1)
            for (let i = 32; i < 64; i++) {
                expect(resultBytes[i]).to.equal(0x22);
            }
        });
    });

    describe("evaluateGateFromSons - COMP (0x05)", function () {
        it("should return 1 when inputs are equal", async function () {
            const gateBytes = encodeGateV2(0x05, [1, 2], new Uint8Array(0));
            const value = new Uint8Array(64);
            value.fill(0x42);
            const sonValues: string[] = [
                ethers.hexlify(value),
                ethers.hexlify(value),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            expect(resultBytes[0]).to.equal(0x01); // Should return 1
            // Rest should be zeros
            for (let i = 1; i < 64; i++) {
                expect(resultBytes[i]).to.equal(0x00);
            }
        });

        it("should return 0 when inputs are different", async function () {
            const gateBytes = encodeGateV2(0x05, [1, 2], new Uint8Array(0));
            const son0 = new Uint8Array(64);
            son0.fill(0x11);
            const son1 = new Uint8Array(64);
            son1.fill(0x22);
            const sonValues: string[] = [
                ethers.hexlify(son0),
                ethers.hexlify(son1),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // Should return 0 (all zeros)
            for (let i = 0; i < 64; i++) {
                expect(resultBytes[i]).to.equal(0x00);
            }
        });
    });

    describe("evaluateGateFromSons - SHA2 (0x02)", function () {
        it("should evaluate SHA2 gate with 1 son (single block)", async function () {
            const gateBytes = encodeGateV2(0x02, [1], new Uint8Array(0));
            const block = new Uint8Array(64);
            block.fill(0x41);
            const sonValues: string[] = [ethers.hexlify(block)];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            // Compare with WASM implementation
            const expected = sha256_compress_js([block]);
            
            expect(resultBytes.length).to.equal(32);
            expect(ethers.hexlify(resultBytes)).to.equal(bytes_to_hex(expected));
        });

        it("should evaluate SHA2 gate with 2 sons (compression with previous hash)", async function () {
            const gateBytes = encodeGateV2(0x02, [1, 2], new Uint8Array(0));
            const prevHash = new Uint8Array(32);
            prevHash.fill(0x11);
            const block = new Uint8Array(64);
            block.fill(0x42);
            const sonValues: string[] = [
                ethers.hexlify(prevHash),
                ethers.hexlify(block),
            ];
            
            const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash);
            const resultBytes = ethers.getBytes(result);
            
            // Compare with WASM implementation
            const expected = sha256_compress_js([prevHash, block]);
            
            expect(resultBytes.length).to.equal(32);
            expect(ethers.hexlify(resultBytes)).to.equal(bytes_to_hex(expected));
        });
    });

    describe("evaluateGateFromSons - AES-CTR (0x01)", function () {
        it("should decrypt a block correctly", async function () {
            // Use a known test vector
            const key = new Uint8Array(16);
            key.fill(0x00);
            key[15] = 0x01; // 0x000...0001
            
            const counter = new Uint8Array(16);
            counter.fill(0x00);
            
            const plaintext = new Uint8Array(64);
            plaintext.fill(0x42);
            
            // Encrypt using WASM (or we can use a known ciphertext)
            // For simplicity, we'll use decrypt_block_js to get the keystream
            // Actually, let's create a simple test: encrypt with CTR mode
            const keystream = decrypt_block_js(key, counter);
            
            // Create ciphertext by XORing plaintext with keystream
            const ciphertext = new Uint8Array(64);
            for (let i = 0; i < 64; i++) {
                ciphertext[i] = plaintext[i] ^ keystream[i];
            }
            
            // Prepare gate params: counter (16 bytes) + length in bits (2 bytes, big-endian)
            const params = new Uint8Array(18);
            params.set(counter, 0);
            params[16] = 0x02; // length in bits: 512 = 0x0200
            params[17] = 0x00;
            
            const gateBytes = encodeGateV2(0x01, [1], params);
            const sonValues: string[] = [ethers.hexlify(ciphertext)];
            
            const result = await testEvaluator.evaluateGateFromSons(
                gateBytes,
                sonValues,
                ethers.hexlify(key) as `0x${string}`
            );
            const resultBytes = ethers.getBytes(result);
            
            expect(resultBytes.length).to.equal(64);
            // Should decrypt to plaintext
            expect(ethers.hexlify(resultBytes.slice(0, 64))).to.equal(ethers.hexlify(plaintext));
        });
    });

    describe("Error handling", function () {
        it("should revert with invalid opcode", async function () {
            const gateBytes = encodeGateV2(0xFF, [], new Uint8Array(0));
            const sonValues: string[] = [];
            
            await expect(
                testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash)
            ).to.be.revertedWith("Invalid opcode");
        });

        it("should revert when sons count mismatch", async function () {
            const gateBytes = encodeGateV2(0x04, [1, 2], new Uint8Array(0));
            const sonValues: string[] = [ethers.hexlify(new Uint8Array(64))];
            
            await expect(
                testEvaluator.evaluateGateFromSons(gateBytes, sonValues, ethers.ZeroHash)
            ).to.be.revertedWith("Non-zero padding");
        });
    });
});
