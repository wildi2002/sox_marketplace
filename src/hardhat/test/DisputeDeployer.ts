import { expect } from "chai";
import { ethers } from "hardhat";

describe("DisputeDeployer", () => {
    it("should deploy DisputeSOX with correct constructor arguments", async () => {
        const AccumulatorVerifierFactory = await ethers.getContractFactory(
            "AccumulatorVerifier"
        );
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();

        const CommitmentOpenerFactory = await ethers.getContractFactory(
            "CommitmentOpener"
        );
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();

        const DisputeSOXHelpersFactory = await ethers.getContractFactory(
            "DisputeSOXHelpers"
        );
        const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
        await disputeHelpers.waitForDeployment();

        // Deploy the DisputeDeployer library
        const libFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                DisputeSOXHelpers: await disputeHelpers.getAddress(),
            },
        });
        const lib = await libFactory.deploy();
        await lib.waitForDeployment();

        // Deploy TestDisputeDeployer, linking the library
        const factory = await ethers.getContractFactory("MockOptimisticSOX", {
            libraries: {
                DisputeDeployer: await lib.getAddress(),
            },
        });

        const mockOptimistic = await factory.deploy(
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            1,
            1
        );
        await mockOptimistic.waitForDeployment();

        const numBlocks = 100;
        const numGates = 200;
        const commitment = ethers.keccak256(
            ethers.toUtf8Bytes("test-commitment")
        );

        const tx = await mockOptimistic.deployDispute(
            numBlocks,
            numGates,
            commitment,
            {
                value: ethers.parseEther("1.0"),
            }
        );

        const receipt = await tx.wait();
        const deployedAddr = receipt!.logs[0]!.args[0];

        const dispute = await ethers.getContractAt("DisputeSOX", deployedAddr);

        // console.log(await dispute.optimisticContract());
        // expect(await dispute.optimisticContract()).to.equal(
        //     await mockOptimistic.getAddress()
        // );
        expect(await dispute.numBlocks()).to.equal(numBlocks);
        expect(await dispute.numGates()).to.equal(numGates);
        expect(await dispute.commitment()).to.equal(commitment);
    });
});
