import hre from "hardhat";
import { ethers } from "hardhat";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

async function main() {
    const [sponsor, buyer, vendor] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🚀 Redeploying OptimisticSOXAccount with new corrected version");
    console.log("=".repeat(80));
    console.log("");
    console.log("Signers:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer  :", await buyer.getAddress());
    console.log("  Vendor :", await vendor.getAddress());
    console.log("");

    const GWEI_MULT = 1_000_000_000n;

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

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            DisputeSOXHelpers: await disputeHelpers.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");

    console.log("📦 Deploying EntryPoint...");
    let entryPoint;
    const entryPointAddress = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
    
    const existingCode = await hre.ethers.provider.getCode(entryPointAddress);
    if (existingCode !== "0x") {
        console.log("  ✅ EntryPoint already exists at:", entryPointAddress);
        entryPoint = new hre.ethers.Contract(entryPointAddress, EntryPointArtifact.abi, hre.ethers.provider);
    } else {
        const EntryPointFactory = new hre.ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
        await entryPoint.waitForDeployment();
        const deployedAddress = await entryPoint.getAddress();
        console.log("  ✅ EntryPoint deployed at:", deployedAddress);
    }
    console.log("");

    console.log("📦 Deploying OptimisticSOXAccount...");
    console.log("  ⚠️  IMPORTANT: We deploy OptimisticSOXAccount (not OptimisticSOX) because:");
    console.log("     - Bundler communicates with OptimisticSOXAccount via EntryPoint");
    console.log("     - OptimisticSOXAccount supports ERC-4337 (UserOperations)");
    console.log("     - OptimisticSOX (base) does not have ERC-4337 support");
    console.log("");
    
    const sponsorAmount = ethers.parseEther("1");
    const agreedPrice = 1n;
    const completionTip = 1n;
    const disputeTip = 1n;
    const timeoutIncrement = 3600n;
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = ethers.ZeroHash;

    console.log("  Parameters:");
    console.log("    EntryPoint:", await entryPoint.getAddress());
    console.log("    Sponsor amount:", sponsorAmount.toString(), "wei");
    console.log("    Agreed price:", agreedPrice.toString(), "wei");
    console.log("    Completion tip:", completionTip.toString(), "wei");
    console.log("    Dispute tip:", disputeTip.toString(), "wei");
    console.log("    Timeout increment:", timeoutIncrement.toString(), "seconds");
    console.log("    Num blocks:", numBlocks);
    console.log("    Num gates:", numGates);
    console.log("    Vendor signer:", await vendor.getAddress());
    console.log("");

    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const contract = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
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
        {
            value: sponsorAmount,
        }
    );
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("  ✅ OptimisticSOXAccount deployed at:", contractAddress);
    console.log("");

    console.log("🔍 Verifying deployed contract...");
    const deployedState = await contract.currState();
    const deployedBuyer = await contract.buyer();
    const deployedVendor = await contract.vendor();
    const deployedSponsor = await contract.sponsor();
    const deployedAgreedPrice = await contract.agreedPrice();
    const deployedDisputeTip = await contract.disputeTip();
    const deployedEntryPoint = await contract.entryPoint();
    const deployedVendorSigner = await contract.vendorSigner();

    console.log("  Initial state:", deployedState.toString(), "(WaitPayment = 0)");
    console.log("  Buyer:", deployedBuyer);
    console.log("  Vendor:", deployedVendor);
    console.log("  Sponsor:", deployedSponsor);
    console.log("  EntryPoint:", deployedEntryPoint);
    console.log("  Vendor signer:", deployedVendorSigner);
    console.log("  Agreed price:", deployedAgreedPrice.toString(), "wei");
    console.log("  Dispute tip:", deployedDisputeTip.toString(), "wei");
    console.log("");

    console.log("🧪 Testing new version...");
    console.log("  New version requires DISPUTE_FEES + disputeTip + agreedPrice");
    console.log("  Required amount:", (10n + deployedDisputeTip + deployedAgreedPrice).toString(), "wei");
    console.log("  (DISPUTE_FEES: 10 + disputeTip:", deployedDisputeTip.toString(), "+ agreedPrice:", deployedAgreedPrice.toString(), ")");
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Redeployment completed successfully!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Important information:");
    console.log("  Contract address:", contractAddress);
    console.log("  EntryPoint:", deployedEntryPoint);
    console.log("  DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");
    console.log("🔗 Communication with bundler:");
    console.log("  - Bundler communicates with OptimisticSOXAccount via EntryPoint");
    console.log("  - UserOperations are sent to bundler which processes them via EntryPoint");
    console.log("  - Vendor can send sendKey() via UserOperation (sponsored fees)");
    console.log("");
    console.log("💡 To test sendVendorDisputeSponsorFee:");
    console.log("  1. Buyer must first send payment (sendPayment)");
    console.log("  2. Vendor can send key via UserOperation (sendKey via bundler)");
    console.log("  3. Buyer dispute sponsor must send fees (sendBuyerDisputeSponsorFee)");
    console.log("  4. Vendor dispute sponsor can then send fees with:");
    console.log("     Required amount:", (10n + deployedDisputeTip + deployedAgreedPrice).toString(), "wei");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
