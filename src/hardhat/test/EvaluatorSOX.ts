import { expect } from "chai";
import { ethers } from "hardhat";

describe("CircuitEvaluator", () => {
    let testEvaluator: any;

    before(async () => {
        const shaFactory = await ethers.getContractFactory(
            "MockSHA256Evaluator"
        );
        const shaLib = await shaFactory.deploy();
        await shaLib.waitForDeployment();

        const simpleFactory = await ethers.getContractFactory(
            "MockSimpleOperationsEvaluator"
        );
        const simpleLib = await simpleFactory.deploy();
        await simpleLib.waitForDeployment();

        const aesFactory = await ethers.getContractFactory(
            "MockAES128CtrEvaluator"
        );
        const aesLib = await aesFactory.deploy();
        await aesLib.waitForDeployment();

        const circuitFactory = await ethers.getContractFactory(
            "CircuitEvaluator",
            {
                libraries: {
                    SHA256Evaluator: await shaLib.getAddress(),
                    SimpleOperationsEvaluator: await simpleLib.getAddress(),
                    AES128CtrEvaluator: await aesLib.getAddress(),
                },
            }
        );
        const circuitLib = await circuitFactory.deploy();
        await circuitLib.waitForDeployment();

        const evaluatorFactory = await ethers.getContractFactory(
            "TestCircuitEvaluator",
            {
                libraries: {
                    CircuitEvaluator: await circuitLib.getAddress(),
                },
            }
        );

        testEvaluator = await evaluatorFactory.deploy();
        await testEvaluator.waitForDeployment();
    });

    it("should return correct hex output for each instruction index", async () => {
        for (let i = 0; i < 8; i++) {
            const gate = [i]; // op = i
            const data: string[] = [];
            const result: string = await testEvaluator.evaluateGate(
                gate,
                data,
                0
            );
            const expectedHex = "0x" + i.toString(16).padStart(2, "0");
            expect(result).to.equal(expectedHex);
        }
    });

    it("should fail if version is invalid", async () => {
        await expect(testEvaluator.evaluateGate([0], [], 1)).to.be.revertedWith(
            "Invalid version number"
        );
    });

    it("should fail if _data length does not match gate arity", async () => {
        await expect(
            testEvaluator.evaluateGate([0, 42], [], 0) // gate expects one input
        ).to.be.revertedWith("Values doesn't have the required length");

        await expect(
            testEvaluator.evaluateGate([0], ["0xdeadbeef"], 0) // gate expects no input
        ).to.be.revertedWith("Values doesn't have the required length");
    });
});
