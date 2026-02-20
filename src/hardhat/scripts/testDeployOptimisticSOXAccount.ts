import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 OptimisticSOXAccount deployment and full flow test");
    console.log("=".repeat(80));
    console.log("");
    console.log("Signers:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer  :", await buyer.getAddress());
    console.log("  Vendor :", await vendor.getAddress());
    console.log("  SB Sponsor:", await sbSponsor.getAddress());
    console.log("  SV Sponsor:", await svSponsor.getAddress());
    console.log("");

    console.log("📚 Deploying libraries...");
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    console.log("  ✅ AccumulatorVerifier:", await accumulatorVerifier.getAddress());

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("  ✅ SHA256Evaluator:", await sha256Evaluator.getAddress());

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();
    console.log("  ✅ SimpleOperationsEvaluator:", await simpleOperationsEvaluator.getAddress());

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    console.log("  ✅ AES128CtrEvaluator:", await aes128CtrEvaluator.getAddress());

    const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
        libraries: {
            SHA256Evaluator: await sha256Evaluator.getAddress(),
            SimpleOperationsEvaluator: await simpleOperationsEvaluator.getAddress(),
            AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
        },
    });
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    console.log("  ✅ CircuitEvaluator:", await circuitEvaluator.getAddress());

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    console.log("  ✅ CommitmentOpener:", await commitmentOpener.getAddress());

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    console.log("  ✅ DisputeSOXHelpers:", await disputeHelpers.getAddress());

    console.log("");
    console.log("📦 Deploying DisputeDeployer...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            DisputeSOXHelpers: await disputeHelpers.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());

    console.log("");
    console.log("📦 Deploying EntryPoint...");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log("  ✅ EntryPoint deployed at:", entryPointAddress);

    console.log("");
    console.log("📦 Deploying OptimisticSOXAccount...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory(
        "OptimisticSOXAccount",
        {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        }
    );

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.000000000000000001"); // 1 wei
    const completionTip = parseEther("0.000000000000000001"); // 1 wei
    const disputeTip = parseEther("0.000000000000000001"); // 1 wei
    const timeoutIncrement = 3600n; // 1 hour
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = new Uint8Array(32);

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPointAddress,
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
        {
            value: sponsorAmount,
        }
    );
    await optimisticAccount.waitForDeployment();
    const contractAddress = await optimisticAccount.getAddress();
    console.log("  ✅ OptimisticSOXAccount deployed at:", contractAddress);
    console.log("");

    console.log("🔍 Verifying contract type...");
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    const contract = new ethers.Contract(contractAddress, OptimisticSOXAccountArtifact.abi, provider);
    const entryPointFromContract = await contract.entryPoint();
    const isOptimisticSOXAccount = entryPointFromContract !== ethers.ZeroAddress;
    console.log("  EntryPoint in contract:", entryPointFromContract);
    console.log("  Contract type:", isOptimisticSOXAccount ? "OptimisticSOXAccount ✅" : "OptimisticSOX ❌");
    console.log("");

    console.log("📊 Initial state:");
    const initialState = await contract.currState();
    console.log("  State:", initialState.toString(), "(0 = WaitPayment)");
    console.log("  AgreedPrice:", (await contract.agreedPrice()).toString(), "wei");
    console.log("  DisputeTip:", (await contract.disputeTip()).toString(), "wei");
    console.log("  CompletionTip:", (await contract.completionTip()).toString(), "wei");
    console.log("");

    console.log("📝 Step 1: Buyer sends payment...");
    const paymentAmount = agreedPrice + completionTip;
    console.log("  Amount:", paymentAmount.toString(), "wei (agreedPrice + completionTip)");
    
    try {
        const tx1 = await contract.connect(buyer).sendPayment({ value: paymentAmount });
        console.log("  ✅ Transaction sent:", tx1.hash);
        await tx1.wait();
        const stateAfterPayment = await contract.currState();
        console.log("  State after payment:", stateAfterPayment.toString(), "(1 = WaitKey)");
    } catch (e: any) {
        console.error("  ❌ Error:", e.message);
        throw e;
    }
    console.log("");

    console.log("📝 Step 2: Vendor sends key...");
    const keyData = ethers.toUtf8Bytes("test-secret-key-12345");
    try {
        const tx2 = await contract.connect(vendor).sendKey(keyData);
        console.log("  ✅ Transaction sent:", tx2.hash);
        await tx2.wait();
        const stateAfterKey = await contract.currState();
        console.log("  State after key:", stateAfterKey.toString(), "(2 = WaitSB)");
    } catch (e: any) {
        console.error("  ❌ Error:", e.message);
        throw e;
    }
    console.log("");

    console.log("📝 Step 3: Buyer dispute sponsor sends fees...");
    const DISPUTE_FEES = 10n;
    const sbRequiredAmount = DISPUTE_FEES + disputeTip;
    console.log("  Required amount:", sbRequiredAmount.toString(), "wei (DISPUTE_FEES + disputeTip)");
    
    try {
        const tx3 = await contract.connect(sbSponsor).sendBuyerDisputeSponsorFee({ value: sbRequiredAmount });
        console.log("  ✅ Transaction sent:", tx3.hash);
        await tx3.wait();
        const stateAfterSb = await contract.currState();
        console.log("  State after buyer sponsor fees:", stateAfterSb.toString(), "(3 = WaitSV)");
    } catch (e: any) {
        console.error("  ❌ Error:", e.message);
        throw e;
    }
    console.log("");

    console.log("📝 Step 4: Vendor dispute sponsor sends fees (NEW VERSION)...");
    const svRequiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    console.log("  Required amount:", svRequiredAmount.toString(), "wei");
    console.log("  (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");

    const contractBalance = await provider.getBalance(contractAddress);
    const svSponsorBalance = await provider.getBalance(await svSponsor.getAddress());
    const totalBalanceAfter = contractBalance + svRequiredAmount;
    console.log("");
    console.log("  📊 Verifications:");
    console.log("    Current contract balance:", contractBalance.toString(), "wei");
    console.log("    Vendor sponsor balance:", svSponsorBalance.toString(), "wei");
    console.log("    Total balance after send:", totalBalanceAfter.toString(), "wei");
    console.log("    Required AgreedPrice:", agreedPrice.toString(), "wei");
    console.log("    ✅ Total balance >= AgreedPrice:", totalBalanceAfter >= agreedPrice ? "YES" : "NO");

    console.log("");
    console.log("  🧪 Simulation...");
    try {
        await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({ value: svRequiredAmount });
        console.log("  ✅ Simulation successful");
    } catch (e: any) {
        const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
        console.error("  ❌ Simulation failed:", errorMsg);
        throw e;
    }

    console.log("");
    console.log("  🚀 Real send...");
    try {
        const tx4 = await contract.connect(svSponsor).sendVendorDisputeSponsorFee({ value: svRequiredAmount });
        console.log("  ✅ Transaction sent:", tx4.hash);
        await tx4.wait();
        const stateAfterSv = await contract.currState();
        console.log("  State after vendor sponsor fees:", stateAfterSv.toString(), "(4 = InDispute)");
        
        const disputeContractAddress = await contract.disputeContract();
        console.log("  Dispute contract deployed:", disputeContractAddress);
        
        if (disputeContractAddress !== ethers.ZeroAddress) {
            try {
                const DisputeSOXAccountArtifact = await hre.artifacts.readArtifact("DisputeSOXAccount");
                const disputeContract = new ethers.Contract(
                    disputeContractAddress,
                    DisputeSOXAccountArtifact.abi,
                    provider
                );
                const disputeEntryPoint = await disputeContract.entryPoint();
                console.log("  Dispute contract EntryPoint:", disputeEntryPoint);
                console.log("  Dispute contract type:", disputeEntryPoint !== ethers.ZeroAddress ? "DisputeSOXAccount ✅" : "DisputeSOX ❌");
            } catch (e) {
                console.log("  ⚠️  Unable to verify dispute contract type");
            }
        }
    } catch (e: any) {
        const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
        console.error("  ❌ Error:", errorMsg);
        throw e;
    }

    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Test completed successfully!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Summary:");
    console.log("  OptimisticSOXAccount contract:", contractAddress);
    console.log("  EntryPoint:", entryPointAddress);
    console.log("  Dispute contract:", await contract.disputeContract());
    console.log("");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
