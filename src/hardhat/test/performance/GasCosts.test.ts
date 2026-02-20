import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";

/**
 * Performance Test Suite for SOX Protocol
 * 
 * Measures:
 * 1. Library deployment costs
 * 2. Contract deployment costs
 * 3. Contract execution costs
 * 4. Computation times (client-side)
 */

describe("SOX Protocol - Gas Cost Measurements", function () {
    let sponsor: HardhatEthersSigner;
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;

    // Test parameters
    const agreedPrice = parseEther("0.03");
    const completionTip = parseEther("0.08");
    const disputeTip = parseEther("0.12");
    const timeoutIncrement = 3600n;
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = new Uint8Array(32); // Empty commitment for testing

    before(async function () {
        [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await ethers.getSigners();
    });

    describe("Library Deployment Costs", function () {
        it("Should measure DisputeDeployer deployment cost", async function () {
            const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer");
            const tx = await DisputeDeployerFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`\n📊 DisputeDeployer deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure AccumulatorVerifier deployment cost", async function () {
            const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
            const tx = await AccumulatorVerifierFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 AccumulatorVerifier deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure CircuitEvaluator deployment cost", async function () {
            const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator");
            const tx = await CircuitEvaluatorFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 CircuitEvaluator deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure CommitmentOpener deployment cost", async function () {
            const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
            const tx = await CommitmentOpenerFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 CommitmentOpener deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure SHA256Evaluator deployment cost", async function () {
            const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
            const tx = await SHA256EvaluatorFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 SHA256Evaluator deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure AES128CtrEvaluator deployment cost", async function () {
            const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
            const tx = await AES128CtrEvaluatorFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 AES128CtrEvaluator deployment: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure SimpleOperationsEvaluator deployment cost", async function () {
            const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
            const tx = await SimpleOperationsEvaluatorFactory.deploy();
            await tx.waitForDeployment();
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`📊 SimpleOperationsEvaluator deployment: ${receipt?.gasUsed?.toString()} gas`);
        });
    });

    describe("Contract Deployment Costs", function () {
        let disputeDeployer: any;
        let entryPoint: any;

        before(async function () {
            // Deploy libraries first
            const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer");
            disputeDeployer = await DisputeDeployerFactory.deploy();
            await disputeDeployer.waitForDeployment();

            // Deploy EntryPoint for OptimisticSOXAccount
            const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
            entryPoint = await EntryPointFactory.deploy();
            await entryPoint.waitForDeployment();
        });

        it("Should measure OptimisticSOXAccount deployment cost", async function () {
            const sponsorAmount = parseEther("1");
            
            const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
                libraries: {
                    DisputeDeployer: await disputeDeployer.getAddress(),
                },
            });

            const tx = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyer.getAddress(),
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                commitment,
                numBlocks,
                numGates,
                await vendor.getAddress(),
                { value: sponsorAmount }
            );
            
            const receipt = await tx.deploymentTransaction()?.wait();
            console.log(`\n📊 OptimisticSOXAccount deployment: ${receipt?.gasUsed?.toString()} gas`);
        });
    });

    describe("Contract Execution Costs", function () {
        let optimisticAccount: any;
        let disputeDeployer: any;
        let entryPoint: any;

        before(async function () {
            // Deploy libraries
            const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer");
            disputeDeployer = await DisputeDeployerFactory.deploy();
            await disputeDeployer.waitForDeployment();

            // Deploy EntryPoint
            const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
            entryPoint = await EntryPointFactory.deploy();
            await entryPoint.waitForDeployment();

            // Deploy OptimisticSOXAccount
            const sponsorAmount = parseEther("1");
            const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
                libraries: {
                    DisputeDeployer: await disputeDeployer.getAddress(),
                },
            });

            optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyer.getAddress(),
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                commitment,
                numBlocks,
                numGates,
                await vendor.getAddress(),
                { value: sponsorAmount }
            );
            await optimisticAccount.waitForDeployment();
        });

        it("Should measure sendPayment execution cost", async function () {
            const paymentAmount = agreedPrice;
            const tx = await optimisticAccount.connect(buyer).sendPayment({ value: paymentAmount });
            const receipt = await tx.wait();
            
            console.log(`\n📊 sendPayment execution: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure sendKey execution cost", async function () {
            const key = new Uint8Array(16); // 16-byte AES key
            const tx = await optimisticAccount.connect(vendor).sendKey(key);
            const receipt = await tx.wait();
            
            console.log(`📊 sendKey execution: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure sendBuyerDisputeSponsorFee execution cost", async function () {
            const disputeSponsorAmount = disputeTip + parseEther("0.1");
            const tx = await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
                value: disputeSponsorAmount
            });
            const receipt = await tx.wait();
            
            console.log(`📊 sendBuyerDisputeSponsorFee execution: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure sendVendorDisputeSponsorFee execution cost", async function () {
            const disputeSponsorAmount = disputeTip + agreedPrice + parseEther("0.1");
            const tx = await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: disputeSponsorAmount
            });
            const receipt = await tx.wait();
            
            console.log(`📊 sendVendorDisputeSponsorFee execution: ${receipt?.gasUsed?.toString()} gas`);
            
            // Get the deployed dispute contract address
            const disputeContractAddress = await optimisticAccount.disputeContract();
            console.log(`📊 DisputeSOXAccount deployed at: ${disputeContractAddress}`);
        });
    });

    describe("Dispute Phase Execution Costs", function () {
        let optimisticAccount: any;
        let disputeContract: any;
        let disputeDeployer: any;
        let entryPoint: any;

        before(async function () {
            // Setup: deploy everything and go to dispute phase
            const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer");
            disputeDeployer = await DisputeDeployerFactory.deploy();
            await disputeDeployer.waitForDeployment();

            const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
            entryPoint = await EntryPointFactory.deploy();
            await entryPoint.waitForDeployment();

            const sponsorAmount = parseEther("1");
            const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
                libraries: {
                    DisputeDeployer: await disputeDeployer.getAddress(),
                },
            });

            optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyer.getAddress(),
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                commitment,
                numBlocks,
                numGates,
                await vendor.getAddress(),
                { value: sponsorAmount }
            );
            await optimisticAccount.waitForDeployment();

            // Go through optimistic phase to reach dispute
            await optimisticAccount.connect(buyer).sendPayment({ value: agreedPrice });
            const key = new Uint8Array(16);
            await optimisticAccount.connect(vendor).sendKey(key);
            await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
                value: disputeTip + parseEther("0.1")
            });
            await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: disputeTip + agreedPrice + parseEther("0.1")
            });

            const disputeAddress = await optimisticAccount.disputeContract();
            const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount");
            disputeContract = DisputeSOXAccountFactory.attach(disputeAddress);
        });

        it("Should measure respondChallenge execution cost", async function () {
            const response = ethers.randomBytes(32);
            const tx = await disputeContract.connect(buyer).respondChallenge(response);
            const receipt = await tx.wait();
            
            console.log(`\n📊 respondChallenge execution: ${receipt?.gasUsed?.toString()} gas`);
        });

        it("Should measure giveOpinion execution cost", async function () {
            const tx = await disputeContract.connect(vendor).giveOpinion(true);
            const receipt = await tx.wait();
            
            console.log(`📊 giveOpinion execution: ${receipt?.gasUsed?.toString()} gas`);
        });

        // Note: submitCommitment costs depend heavily on proof size and gate type
        // These should be measured with actual proofs from the circuit evaluation
    });
});


