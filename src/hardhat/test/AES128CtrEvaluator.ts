import { ethers } from "hardhat";
import { expect } from "chai";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    decrypt_block_js,
    encrypt_block_js,
    hex_to_bytes,
    initSync,
} from "../../app/lib/crypto_lib";
import {
    createCipheriv,
    getCipherInfo,
    getCiphers,
    randomBytes,
} from "node:crypto";
import { TestAES128Ctr } from "../typechain-types";

before(async () => {
    const module = await readFile(
        "../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    initSync({ module: module });
});

describe("AES128 Library", function () {
    let testAes128: TestAES128Ctr;

    before(async () => {
        const AES128CtrEvaluatorFactory = await ethers.getContractFactory(
            "AES128CtrEvaluator"
        );
        const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();

        const TestAES128 = await ethers.getContractFactory("TestAES128Ctr", {
            libraries: {
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        });
        testAes128 = await TestAES128.deploy();
        await testAes128.waitForDeployment();
    });

    it("AES implementation encrypts the NIST test vector correctly", async () => {
        // NIST test vector: https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197.pdf Appendix C
        const plaintext = "0x00112233445566778899aabbccddeeff";
        const key = "0x000102030405060708090a0b0c0d0e0f";
        const expectedCiphertext = "0x69c4e0d86a7b0430d8cdb78070b4c55a";

        const result = await testAes128.encrypt(plaintext, key);

        expect(result).to.equal(expectedCiphertext);
    });

    it("AES implementation encrypts a random block in the same way as node's implementation", async () => {
        const plaintext = randomBytes(16);
        const key = randomBytes(16);

        const cipher = createCipheriv("aes-128-ecb", key, null); // use ecb mode to encrypt only one block with "pure" AES
        const expected = cipher.update(plaintext);

        const result = await testAes128.encrypt(plaintext, key);
        expect(result).to.equal(bytes_to_hex(expected));
    });

    it("AES implementation returns different ciphertext for different keys", async () => {
        const plaintext = "0x00112233445566778899aabbccddeeff";
        const key1 = "0x000102030405060708090a0b0c0d0e0f";
        const key2 = "0x0f0e0d0c0b0a09080706050403020100";

        const ct1 = await testAes128.encrypt(plaintext, key1);
        const ct2 = await testAes128.encrypt(plaintext, key2);

        expect(ct1).to.not.equal(ct2);
    });

    it("AES implementation returns different ciphertexts for different plaintexts", async () => {
        const key = "0x000102030405060708090a0b0c0d0e0f";
        const pt1 = "0x00112233445566778899aabbccddeeff";
        const pt2 = "0xffeeddccbbaa99887766554433221100";

        const ct1 = await testAes128.encrypt(pt1, key);
        const ct2 = await testAes128.encrypt(pt2, key);

        expect(ct1).to.not.equal(ct2);
    });

    it("encrypts correctly a random plaintext with respect to the wasm library", async () => {
        for (let i = 0; i < 5; ++i) {
            const key = randomBytes(16);
            const iv = randomBytes(16);

            const length = Math.floor(Math.random() * 64) + 1;
            const pt = randomBytes(length);

            const ct = await testAes128.encryptBlock([key, pt, iv]);
            const decrypted = decrypt_block_js([key, hex_to_bytes(ct), iv]);
            // buffer comparison doesn't work with just expect(...).to.equal(...)
            expect(decrypted.length).to.equal(pt.length);
            for (let i = 0; i < decrypted.length; ++i)
                expect(decrypted[i]).to.equal(pt[i]);
        }
    });

    it("decrypts correctly a random plaintext encrypted by the wasm library", async () => {
        for (let i = 0; i < 5; ++i) {
            const key = randomBytes(16);
            const iv = randomBytes(16);

            const length = Math.floor(Math.random() * 64) + 1;
            const pt = randomBytes(length);

            const ct = encrypt_block_js([key, pt, iv]);
            const decrypted = hex_to_bytes(
                await testAes128.decryptBlock([key, ct, iv])
            );

            // buffer comparison doesn't work with just expect(...).to.equal(...)
            expect(decrypted.length).to.equal(pt.length);
            for (let i = 0; i < decrypted.length; ++i)
                expect(decrypted[i]).to.equal(pt[i]);
        }
    });

    it("reverts if the length of the provided data is incorred", async () => {
        const validKeyIv = new Uint8Array(16);
        const tooLongKeyIv = new Uint8Array(17);
        const too$hortKeyIv = new Uint8Array(15);

        const validPlaintext = new Uint8Array(64);
        const tooLongPlaintext = new Uint8Array(65);

        // Case: _data has length not equal to 3
        await expect(
            testAes128.encryptBlock([validKeyIv, validPlaintext])
        ).to.be.revertedWith("Invalid _data array length");

        await expect(
            testAes128.encryptBlock([
                validKeyIv,
                validPlaintext,
                validKeyIv,
                validKeyIv,
            ])
        ).to.be.revertedWith("Invalid _data array length");

        // Case: Key not 16 bytes
        await expect(
            testAes128.encryptBlock([too$hortKeyIv, validPlaintext, validKeyIv])
        ).to.be.revertedWith("Key must be 16 bytes long");

        await expect(
            testAes128.encryptBlock([tooLongKeyIv, validPlaintext, validKeyIv])
        ).to.be.revertedWith("Key must be 16 bytes long");

        // Case: Plaintext too long
        await expect(
            testAes128.encryptBlock([validKeyIv, tooLongPlaintext, validKeyIv])
        ).to.be.revertedWith("Plaintext must be at most 64 bytes long");

        // Case: Counter not 16 bytes
        await expect(
            testAes128.encryptBlock([validKeyIv, validPlaintext, tooLongKeyIv])
        ).to.be.revertedWith("Counter must be 16 bytes long");

        await expect(
            testAes128.encryptBlock([validKeyIv, validPlaintext, too$hortKeyIv])
        ).to.be.revertedWith("Counter must be 16 bytes long");
    });

    it("returns empty ciphertext if plaintext has zero length", async () => {
        const key = new Uint8Array(16);
        const iv = new Uint8Array(16);
        const pt = new Uint8Array(0);

        const ct = await testAes128.encryptBlock([key, pt, iv]);
        expect(ct).to.equal("0x");
    });
});
