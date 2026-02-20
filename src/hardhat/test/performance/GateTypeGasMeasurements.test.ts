import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

/**
 * Gate Type Gas Measurements
 * 
 * This test measures gas costs for proof submission with different gate types,
 * similar to Table 3 in the SOX paper:
 * - SHA256 compression
 * - 16B binary addition
 * - SHA256 padding + compression
 * - AES-128 CTR encrypt/decrypt
 * - 16B binary multiplication
 * - Equality check
 * - Concatenation
 * 
 * NOTE: This test requires real proofs generated from the circuit evaluation.
 * Currently, we only have mock proofs, so these measurements are placeholders.
 * To get real measurements, we need to:
 * 1. Generate actual proofs for each gate type from the circuit
 * 2. Call submitCommitment with these real proofs
 * 3. Measure the gas cost
 */

describe("Gate Type Gas Measurements (Table 3 Format)", function () {
    let sponsor: HardhatEthersSigner;
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;
    
    let entryPoint: any;
    let optimisticAccount: any;
    let disputeAccount: any;
    
    // Test parameters - Using smaller circuit for faster testing
    const numBlocks = 1024; // Small circuit for testing
    const numGates = 4 * numBlocks + 1;
    
    const agreedPrice = parseEther("1.0");
    const completionTip = parseEther("0.1");
    const disputeTip = parseEther("0.12");
    const timeoutIncrement = 3600n;
    const commitment = ethers.ZeroHash;
    
    const SPONSOR_FEES = 5n;
    const DISPUTE_FEES = 10n;
    
    // Gas measurements for each gate type
    const gateTypeGas: Record<string, bigint> = {};
    
    before(async function () {
        [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await ethers.getSigners();
        
        console.log("\n📊 ===== GATE TYPE GAS MEASUREMENTS =====");
        console.log(`🔢 Number of blocks: ${numBlocks}`);
        console.log(`🔢 Number of gates: ${numGates}\n`);
        
        // Deploy EntryPoint
        const EntryPointFactory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
        await entryPoint.waitForDeployment();
        
        // Deploy libraries
        const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();
        
        const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();
        
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        
        const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        });
        const disputeDeployer = await DisputeDeployerFactory.deploy();
        await disputeDeployer.waitForDeployment();
        
        const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });
        const sponsorAmount = SPONSOR_FEES;
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
        
        // Setup optimistic phase
        await optimisticAccount.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        await optimisticAccount.connect(vendor).sendKey(ethers.randomBytes(16));
        await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
            value: DISPUTE_FEES + disputeTip
        });
        await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + disputeTip + agreedPrice
        });
        
        const disputeAddress = await optimisticAccount.disputeContract();
        disputeAccount = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
    });
    
    /**
     * Helper function to navigate dispute to state 2 (WaitVendorData)
     * where we can submit proofs for different gate types
     */
    async function navigateToWaitVendorData() {
        const rounds = Math.ceil(Math.log2(numGates));
        
        for (let i = 0; i < rounds; i++) {
            const state = Number(await disputeAccount.currState());
            if (state === 2) { // WaitVendorData
                return;
            }
            
            const response = ethers.randomBytes(32);
            await disputeAccount.connect(buyer).respondChallenge(response);
            
            // Strategy: alternate to land in middle (0 < chall < numGates)
            const chall = await disputeAccount.chall();
            const challNum = Number(chall);
            const vendorAgrees = i % 2 === 0; // Alternate
            
            await disputeAccount.connect(vendor).giveOpinion(vendorAgrees);
            
            const newState = Number(await disputeAccount.currState());
            if (newState === 2) {
                return;
            }
        }
    }
    
    /**
     * Measure gas for a specific gate type
     * NOTE: This is a placeholder - requires real proofs from circuit evaluation
     */
    async function measureGateTypeGas(gateType: string, gateBytes: Uint8Array, values: Uint8Array[]) {
        await navigateToWaitVendorData();
        
        const chall = await disputeAccount.chall();
        const gateNum = Number(chall);
        const openingValue = ethers.randomBytes(80);
        const currAcc = ethers.randomBytes(32);
        
        // Create minimal proofs (will fail verification but measure gas)
        // TODO: Replace with real proofs for the specific gate type
        const proof1 = [[ethers.ZeroHash]];
        const proof2 = [[ethers.ZeroHash]];
        const proof3 = [[ethers.ZeroHash]];
        const proofExt = [[ethers.ZeroHash]];
        
        try {
            const tx = await disputeAccount.connect(vendor).submitCommitment(
                openingValue,
                gateNum,
                gateBytes,
                values,
                currAcc,
                proof1,
                proof2,
                proof3,
                proofExt
            );
            const receipt = await tx.wait();
            const gas = receipt.gasUsed || 0n;
            gateTypeGas[gateType] = gas;
            console.log(`   ${gateType}: ${gas.toString()} gas`);
        } catch (e: any) {
            // Proof verification failed (expected with mock proofs)
            // Try to estimate gas from the revert
            console.log(`   ${gateType}: Failed (${e.message})`);
            console.log(`   Note: Requires real proofs from circuit evaluation`);
        }
    }
    
    describe("Gate Type Measurements", function () {
        it("Should measure SHA256 compression", async function () {
            console.log("\n📊 Measuring SHA256 compression...");
            // TODO: Generate real gateBytes and values for SHA256 compression gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(64)];
            await measureGateTypeGas("SHA256 compression", gateBytes, values);
        });
        
        it("Should measure 16B binary addition", async function () {
            console.log("\n📊 Measuring 16B binary addition...");
            // TODO: Generate real gateBytes and values for binary addition gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(16), ethers.randomBytes(16)];
            await measureGateTypeGas("16B binary addition", gateBytes, values);
        });
        
        it("Should measure SHA256 padding + compression", async function () {
            console.log("\n📊 Measuring SHA256 padding + compression...");
            // TODO: Generate real gateBytes and values for SHA256 padding + compression gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(64)];
            await measureGateTypeGas("SHA256 padding + compression", gateBytes, values);
        });
        
        it("Should measure AES-128 CTR encrypt/decrypt", async function () {
            console.log("\n📊 Measuring AES-128 CTR encrypt/decrypt...");
            // TODO: Generate real gateBytes and values for AES-128 CTR gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(16), ethers.randomBytes(16)]; // key + block
            await measureGateTypeGas("AES-128 CTR encrypt/decrypt", gateBytes, values);
        });
        
        it("Should measure 16B binary multiplication", async function () {
            console.log("\n📊 Measuring 16B binary multiplication...");
            // TODO: Generate real gateBytes and values for binary multiplication gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(16), ethers.randomBytes(16)];
            await measureGateTypeGas("16B binary multiplication", gateBytes, values);
        });
        
        it("Should measure Equality check", async function () {
            console.log("\n📊 Measuring Equality check...");
            // TODO: Generate real gateBytes and values for equality check gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(32), ethers.randomBytes(32)];
            await measureGateTypeGas("Equality check", gateBytes, values);
        });
        
        it("Should measure Concatenation", async function () {
            console.log("\n📊 Measuring Concatenation...");
            // TODO: Generate real gateBytes and values for concatenation gate
            const gateBytes = ethers.randomBytes(64);
            const values = [ethers.randomBytes(32), ethers.randomBytes(32)];
            await measureGateTypeGas("Concatenation", gateBytes, values);
        });
    });
    
    describe("Summary - Table 3 Format", function () {
        it("Should display comparison with paper's Table 3", function () {
            console.log("\n" + "=".repeat(80));
            console.log("📊 TABLE 3: PROOF SUBMISSION COSTS BY GATE TYPE");
            console.log("=".repeat(80));
            console.log("\nGate Type                          | Our Measurement | Paper (Table 3)");
            console.log("-".repeat(80));
            
            const paperValues: Record<string, string> = {
                "SHA256 compression": "319,963",
                "16B binary addition": "161,274",
                "SHA256 padding + compression": "504,390",
                "AES-128 CTR encrypt/decrypt": "5,176,313",
                "16B binary multiplication": "161,231",
                "Equality check": "174,820",
                "Concatenation": "167,596",
            };
            
            for (const [gateType, paperGas] of Object.entries(paperValues)) {
                const ourGas = gateTypeGas[gateType]?.toString() || "Not measured (requires real proofs)";
                console.log(`${gateType.padEnd(35)} | ${ourGas.toString().padStart(15)} | ${paperGas.padStart(15)} gas`);
            }
            
            console.log("\n" + "=".repeat(80));
            console.log("\n⚠️  IMPORTANT NOTES:");
            console.log("1. Our measurements use mock proofs that fail verification.");
            console.log("2. To get real measurements, we need to:");
            console.log("   - Generate actual proofs for each gate type from the circuit");
            console.log("   - Call submitCommitment with these real proofs");
            console.log("   - Measure the gas cost");
            console.log("3. The paper's measurements use real proofs with valid verification.");
            console.log("4. Our mock proof measurements are lower bounds (transaction execution only).");
            console.log("5. Real proof measurements would include verification costs.");
            console.log("\n" + "=".repeat(80) + "\n");
        });
    });
});







