import { expect } from "chai";
import { ethers } from "hardhat";
import { TestSHA256Evaluator } from "../typechain-types";
import crypto, { randomBytes } from "crypto";
import {
    bytes_to_hex,
    initSync,
    sha256_compress_final_js,
    sha256_compress_js,
} from "../../app/lib/crypto_lib";
import { readFile } from "node:fs/promises";

before(async () => {
    const module = await readFile(
        "../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    initSync({ module: module });
});

describe("SHA256Evaluator", function () {
    let evaluator: TestSHA256Evaluator;

    before(async () => {
        const libFactory = await ethers.getContractFactory("SHA256Evaluator");
        const lib = await libFactory.deploy();
        await lib.waitForDeployment();

        const wrapperFactory = await ethers.getContractFactory(
            "TestSHA256Evaluator",
            {
                libraries: {
                    SHA256Evaluator: await lib.getAddress(),
                },
            }
        );

        evaluator = (await wrapperFactory.deploy()) as TestSHA256Evaluator;
        await evaluator.waitForDeployment();
    });

    it("matches wasm implementation without previous digest", async () => {
        const block = randomBytes(64);
        const input = [block];
        const onchain = await evaluator.compress(input);
        const expected = sha256_compress_js(input);
        expect(onchain).to.equal(bytes_to_hex(expected));
    });

    it("matches wasm implementation with previous digest", async () => {
        const prevDigest = crypto.createHash("sha256").update("seed").digest();
        const block = randomBytes(64);
        const input = [new Uint8Array(prevDigest), block];
        const onchain = await evaluator.compress(input);
        const expected = sha256_compress_js(input);
        expect(onchain).to.equal(bytes_to_hex(expected));
    });

    it("matches wasm implementation for final compression without previous digest", async () => {
        const block = randomBytes(64);
        const totalLength = block.length;
        const lengthBytes = new Uint8Array(8);
        new DataView(lengthBytes.buffer).setBigUint64(
            0,
            BigInt(totalLength),
            false
        );
        const input = [block, lengthBytes];
        const onchain = await evaluator.compressFinal(input);
        const expected = sha256_compress_final_js(input);
        expect(onchain).to.equal(bytes_to_hex(expected));
    });

    it("matches wasm implementation for final compression with previous digest", async () => {
        const prevDigest = crypto.createHash("sha256").update("init").digest();
        const block = randomBytes(64);
        const totalLength = block.length;
        const lengthBytes = new Uint8Array(8);
        new DataView(lengthBytes.buffer).setBigUint64(
            0,
            BigInt(totalLength),
            false
        );
        const input = [new Uint8Array(prevDigest), block, lengthBytes];
        const onchain = await evaluator.compressFinal(input);
        const expected = sha256_compress_final_js(input);
        expect(onchain).to.equal(bytes_to_hex(expected));
    });

    it("matches node's sha256 implementation when chaining blocks", async () => {
        // 1 block to hash around sensitive values (when we get from 1 to 2 bc of padding)
        for (let i = 0; i < 10; ++i) {
            const length = 54 + i;
            const msg = new Uint8Array(randomBytes(length));
            const expected = crypto.createHash("sha256").update(msg).digest();
            const lengthBytes = new Uint8Array(8);
            new DataView(lengthBytes.buffer).setBigUint64(
                0,
                BigInt(length),
                false
            );

            let digest = await evaluator.compressFinal([msg, lengthBytes]);

            expect(digest).to.equal(
                bytes_to_hex(expected),
                `1 block failed with ${bytes_to_hex(msg)}, length ${length}`
            );
        }

        // multiple blocks with random number of bytes
        for (let i = 0; i < 5; ++i) {
            const length = Math.floor(Math.random() * 1000) + 65;
            const msg = new Uint8Array(randomBytes(length));
            const expected = crypto.createHash("sha256").update(msg).digest();
            const lengthBytes = new Uint8Array(8);
            new DataView(lengthBytes.buffer).setBigUint64(
                0,
                BigInt(length),
                false
            );

            let digest = await evaluator.compress([msg.slice(0, 64)]);
            let i = 64;
            for (; i < msg.length - 64; i += 64) {
                digest = await evaluator.compress([
                    digest,
                    msg.slice(i, i + 64),
                ]);
            }

            digest = await evaluator.compressFinal([
                digest,
                msg.slice(i),
                lengthBytes,
            ]);
        }
    });

    it("reverts if empty data is passed", async () => {
        await expect(evaluator.compress([])).to.be.revertedWith(
            "Data is empty"
        );
        await expect(evaluator.compressFinal([])).to.be.revertedWith(
            "Data is empty"
        );
    });

    it("reverts with invalid lengths", async () => {
        const invalidDigest = new Uint8Array(31);
        const validBlock = new Uint8Array(64);
        const invalidLength = new Uint8Array(7);

        await expect(
            evaluator.compress([invalidDigest, validBlock])
        ).to.be.revertedWith("Previous digest must be 32 bytes long");

        await expect(
            evaluator.compressFinal([validBlock, invalidLength])
        ).to.be.revertedWith("Hashed message length must be 8 bytes long");

        await expect(evaluator.compressFinal([validBlock])).to.be.revertedWith(
            "Incorrect number of inputs"
        );

        await expect(
            evaluator.compressFinal([
                validBlock,
                validBlock,
                validBlock,
                validBlock,
            ])
        ).to.be.revertedWith("Incorrect number of inputs");
    });
});
