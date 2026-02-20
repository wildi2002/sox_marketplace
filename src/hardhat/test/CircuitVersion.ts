import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";

const { ethers } = hre;

describe("CircuitVersion", function () {
    it("rejects non-V2 circuit versions in DisputeSOX", async function () {
        const [buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();

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

        const DisputeDeployerFactory = await ethers.getContractFactory(
            "DisputeDeployer",
            {
                libraries: {
                    AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                    CommitmentOpener: await commitmentOpener.getAddress(),
                    DisputeSOXHelpers: await disputeHelpers.getAddress(),
                },
            }
        );
        const disputeDeployer = await DisputeDeployerFactory.deploy();
        await disputeDeployer.waitForDeployment();

        const MockOptimisticSOXFactory = await ethers.getContractFactory(
            "MockOptimisticSOX",
            {
                libraries: {
                    DisputeDeployer: await disputeDeployer.getAddress(),
                },
            }
        );

        const agreedPrice = 1n;
        const optimistic = await MockOptimisticSOXFactory.deploy(
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            60n,
            agreedPrice
        );
        await optimistic.waitForDeployment();

        const DisputeSOXFactory = await ethers.getContractFactory(
            "DisputeSOX",
            {
                libraries: {
                    AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                    CommitmentOpener: await commitmentOpener.getAddress(),
                    DisputeSOXHelpers: await disputeHelpers.getAddress(),
                },
            }
        );

        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment"));

        await expect(
            DisputeSOXFactory.deploy(
                await optimistic.getAddress(),
                4,
                9,
                commitment,
                2,
                { value: agreedPrice }
            )
        ).to.be.reverted;
    });
});
