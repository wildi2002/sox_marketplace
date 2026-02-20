import { expect } from "chai";
import { ethers } from "hardhat";
import { TestSimpleOperationsEvaluator } from "../typechain-types";

describe("TestSimpleOperationsEvaluator", function () {
    let testEval: TestSimpleOperationsEvaluator;

    before(async () => {
        // Deploy the library
        const LibFactory = await ethers.getContractFactory(
            "SimpleOperationsEvaluator"
        );
        const lib = await LibFactory.deploy();
        await lib.waitForDeployment();

        // Link and deploy the wrapper
        const WrapperFactory = await ethers.getContractFactory(
            "TestSimpleOperationsEvaluator",
            {
                libraries: {
                    SimpleOperationsEvaluator: await lib.getAddress(),
                },
            }
        );

        testEval = await WrapperFactory.deploy();
        await testEval.waitForDeployment();
    });

    describe("equal", () => {
        it("returns 0x01 for identical inputs", async () => {
            const arr = [
                ethers.encodeBytes32String("abc"),
                ethers.encodeBytes32String("abc"),
            ];
            const result = await testEval.testEqual(arr);
            expect(result).to.equal("0x01");
        });

        it("returns 0x for different content", async () => {
            const arr = [
                ethers.encodeBytes32String("abc"),
                ethers.encodeBytes32String("abd"),
            ];
            const result = await testEval.testEqual(arr);
            expect(result).to.equal("0x00");
        });

        it("returns 0x for different lengths", async () => {
            const a = ethers.encodeBytes32String("abc").slice(0, 34); // 16 bytes
            const b = ethers.encodeBytes32String("abc").slice(0, 36); // 17 bytes
            const result = await testEval.testEqual([a, b]);
            expect(result).to.equal("0x00");
        });

        it("reverts with one input", async () => {
            const single = [ethers.encodeBytes32String("only")];
            await expect(testEval.testEqual(single)).to.be.revertedWith(
                "Equality requires at least 2 operators"
            );
        });
    });

    describe("binAdd", () => {
        it("adds two small numbers", async () => {
            const a = ethers.zeroPadValue("0x01", 16);
            const b = ethers.zeroPadValue("0x02", 16);
            const result = await testEval.testBinAdd([a, b]);
            expect(result).to.equal(ethers.zeroPadValue("0x03", 16));
        });

        it("wraps on overflow", async () => {
            const max = "0xffffffffffffffffffffffffffffffff";
            const one = ethers.zeroPadValue("0x01", 16);
            const result = await testEval.testBinAdd([max, one]);
            expect(result).to.equal(ethers.zeroPadValue("0x00", 16));
        });

        it("reverts on >2 inputs", async () => {
            const val = ethers.zeroPadValue("0x01", 16);
            await expect(
                testEval.testBinAdd([val, val, val])
            ).to.be.revertedWith("Addition requires exactly 2 operators");
        });

        it("reverts on too long input", async () => {
            const tooLong = ethers.zeroPadValue("0x01", 17);
            await expect(
                testEval.testBinAdd([tooLong, tooLong])
            ).to.be.revertedWith(
                "Addition operators must be at most 16 bytes long"
            );
        });
    });

    describe("binMult", () => {
        it("multiplies two numbers", async () => {
            const a = ethers.zeroPadValue("0x02", 16);
            const b = ethers.zeroPadValue("0x03", 16);
            const result = await testEval.testBinMult([a, b]);
            expect(result).to.equal(ethers.zeroPadValue("0x06", 16));
        });

        it("wraps on overflow", async () => {
            const max = "0xffffffffffffffffffffffffffffffff";
            const two = ethers.zeroPadValue("0x02", 16);
            const result = await testEval.testBinMult([max, two]);
            const expected = "0xfffffffffffffffffffffffffffffffe"; // max * 2 == max << 1 and keep 16 bytes
            expect(result).to.equal(expected);
        });

        it("reverts on too many inputs", async () => {
            const a = ethers.zeroPadValue("0x01", 16);
            await expect(testEval.testBinMult([a, a, a])).to.be.revertedWith(
                "Multiplication requires exactly 2 operators"
            );
        });

        it("reverts on operand too long", async () => {
            const long = ethers.zeroPadValue("0x01", 17);
            await expect(testEval.testBinMult([long, long])).to.be.revertedWith(
                "Multiplication operators must be at most 16 bytes long"
            );
        });
    });

    describe("concat", () => {
        it("concatenates multiple arrays", async () => {
            const a = ethers.toUtf8Bytes("foo");
            const b = ethers.toUtf8Bytes("bar");
            const result = await testEval.testConcat([a, b]);
            expect(ethers.toUtf8String(result)).to.equal("foobar");
        });

        it("returns same for single element", async () => {
            const a = ethers.toUtf8Bytes("solo");
            const result = await testEval.testConcat([a]);
            expect(ethers.toUtf8String(result)).to.equal("solo");
        });

        it("reverts on empty input", async () => {
            await expect(testEval.testConcat([])).to.be.revertedWith(
                "Concatenation requires at least one element"
            );
        });

        it("handles embedded empty arrays", async () => {
            const a = ethers.toUtf8Bytes("A");
            const b = new Uint8Array(0);
            const c = ethers.toUtf8Bytes("B");
            const result = await testEval.testConcat([a, b, c]);
            expect(ethers.toUtf8String(result)).to.equal("AB");
        });
    });
});
