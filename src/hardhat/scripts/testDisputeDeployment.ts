import hre from "hardhat";
import { ethers, parseEther } from "hardhat";
import fs from "fs";
import path from "path";

const CANONICAL_ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const DISPUTE_FEES = 10n; // From OptimisticSOXAccount.sol
const SPONSOR_FEES = 5n; // From OptimisticSOXAccount.sol

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🧪 DEPLOYMENT AND DISPUTE TEST");
    console.log("=".repeat(80));
    console.log("\n📋 Accounts:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("  Buyer Dispute Sponsor:", await sbSponsor.getAddress());
    console.log("  Vendor Dispute Sponsor:", await svSponsor.getAddress());
    console.log("");

    console.log("🔐 STEP 1: Verifying EntryPoint v0.8...");
    const entryPointCode = await ethers.provider.getCode(CANONICAL_ENTRYPOINT_V8);
    if (!entryPointCode || entryPointCode === "0x") {
        console.log("  ⚠️  EntryPoint v0.8 not deployed, deploying...");
        console.log("  ⚠️  Run first: npx hardhat run scripts/deployEntryPointV8.ts --network localhost");
        console.log("  ⚠️  Or run this script after deployEntryPointV8.ts");
        process.exit(1);
    }
    console.log("  ✅ EntryPoint v0.8 found at:", CANONICAL_ENTRYPOINT_V8);
    console.log("");

    console.log("📚 STEP 2: Deploying libraries...");
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    console.log("  ✅ AccumulatorVerifier:", await accumulatorVerifier.getAddress());

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("  ✅ SHA256Evaluator:", await sha256Evaluator.getAddress());

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    console.log("  ✅ CommitmentOpener:", await commitmentOpener.getAddress());

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    console.log("  ✅ DisputeSOXHelpers:", await disputeHelpers.getAddress());
    console.log("");

    console.log("📦 STEP 3: Deploying DisputeDeployer...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");

    console.log("🚀 STEP 4: Deploying OptimisticSOXAccount...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.001");
    const completionTip = parseEther("0.0001");
    const disputeTip = parseEther("0.0001");
    const timeoutIncrement = 3600n; // 1 hour
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = ethers.ZeroHash;

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        CANONICAL_ENTRYPOINT_V8, // EntryPoint v0.8
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
        numBlocks,
        numGates,
        await vendor.getAddress(), // vendorSigner
        { value: sponsorAmount }
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddress = await optimisticAccount.getAddress();
    console.log("  ✅ OptimisticSOXAccount deployed at:", optimisticAddress);
    console.log("");

    console.log("💰 STEP 5: Optimistic flow...");
    
    console.log("  📤 Buyer sends payment...");
    await optimisticAccount.connect(buyer).sendPayment({
        value: agreedPrice + completionTip,
    });
    console.log("  ✅ Payment sent");

    console.log("  🔑 Vendor sends key...");
    const key = ethers.toUtf8Bytes("test-key-12345");
    await optimisticAccount.connect(vendor).sendKey(key);
    console.log("  ✅ Key sent");
    console.log("");

    console.log("👤 STEP 6: Buyer dispute sponsor pays...");
    const sbAmount = DISPUTE_FEES + disputeTip;
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: sbAmount,
    });
    console.log("  ✅ Buyer dispute sponsor paid");
    console.log("  ✅ buyerDisputeSponsor:", await optimisticAccount.buyerDisputeSponsor());
    console.log("");

    console.log("🧪 STEP 7: TEST - Vendor dispute sponsor pays...");
    console.log("  ⚠️  This is where the vendorDisputeSponsor fix is tested!");
    const svAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    console.log("  Amount to send:", svAmount.toString(), "wei");
    
    try {
        const tx = await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
            value: svAmount,
        });
        console.log("  📤 Transaction sent, waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("  ✅ Transaction confirmed!");
        console.log("  ✅ Hash:", receipt?.hash);

        const disputeAddress = await optimisticAccount.disputeContract();
        console.log("  ✅ Dispute contract deployed at:", disputeAddress);
        
        const vendorDisputeSponsor = await optimisticAccount.vendorDisputeSponsor();
        console.log("  ✅ vendorDisputeSponsor:", vendorDisputeSponsor);
        
        if (vendorDisputeSponsor.toLowerCase() !== (await svSponsor.getAddress()).toLowerCase()) {
            throw new Error(`vendorDisputeSponsor mismatch! Expected ${await svSponsor.getAddress()}, got ${vendorDisputeSponsor}`);
        }
        console.log("  ✅ vendorDisputeSponsor matches vendor sponsor");

        const state = await optimisticAccount.currState();
        console.log("  ✅ OptimisticSOXAccount state:", state.toString(), "(5 = InDispute)");

        const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount");
        const disputeContract = DisputeSOXAccountFactory.attach(disputeAddress);
        const disputeState = await disputeContract.currState();
        console.log("  ✅ DisputeSOXAccount state:", disputeState.toString(), "(0 = ChallengeBuyer)");

        console.log("");
        console.log("=".repeat(80));
        console.log("✅ SUCCESS! Dispute deployed correctly!");
        console.log("=".repeat(80));
        console.log("\n📊 Summary:");
        console.log("  OptimisticSOXAccount:", optimisticAddress);
        console.log("  DisputeSOXAccount:", disputeAddress);
        console.log("  EntryPoint:", CANONICAL_ENTRYPOINT_V8);
        console.log("  buyerDisputeSponsor:", await optimisticAccount.buyerDisputeSponsor());
        console.log("  vendorDisputeSponsor:", await optimisticAccount.vendorDisputeSponsor());
        console.log("");

    } catch (error: any) {
        console.log("");
        console.log("=".repeat(80));
        console.log("❌ ERROR during dispute deployment!");
        console.log("=".repeat(80));
        console.log("\nError:", error.message);
        if (error.reason) {
            console.log("Reason:", error.reason);
        }
        if (error.data) {
            console.log("Data:", error.data);
        }
        console.log("\n💡 Verifications:");
        console.log("  - EntryPoint v0.8 is deployed at", CANONICAL_ENTRYPOINT_V8);
        console.log("  - DisputeSOXAccount code has been compiled with vendorDisputeSponsor fix");
        console.log("  - DisputeDeployer has been redeployed with new bytecode");
        console.log("");
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});



