import hre from "hardhat";
import fs from "fs";
import path from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

function parseEntrypoints(entrypoints: unknown): string[] {
    if (!entrypoints) return [];
    if (Array.isArray(entrypoints)) {
        return entrypoints.map(String).map((value) => value.trim()).filter(Boolean);
    }
    if (typeof entrypoints === "string") {
        return entrypoints
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [];
}

async function main() {
    const { ethers } = hre;

    const [sponsor, buyer, vendor] = await ethers.getSigners();

    console.log("Deploying full SOX stack with:");
    console.log("  sponsor:", await sponsor.getAddress());
    console.log("  buyer  :", await buyer.getAddress());
    console.log("  vendor :", await vendor.getAddress());

    const GWEI_MULT = 1_000_000_000n;

    // --- Libraries ---
    const AccumulatorVerifierFactory = await ethers.getContractFactory(
        "AccumulatorVerifier"
    );
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    console.log(
        "AccumulatorVerifier:",
        await accumulatorVerifier.getAddress()
    );

    const SHA256EvaluatorFactory = await ethers.getContractFactory(
        "SHA256Evaluator"
    );
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("SHA256Evaluator:", await sha256Evaluator.getAddress());

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory(
        "SimpleOperationsEvaluator"
    );
    const simpleOperationsEvaluator =
        await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();
    console.log(
        "SimpleOperationsEvaluator:",
        await simpleOperationsEvaluator.getAddress()
    );

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory(
        "AES128CtrEvaluator"
    );
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    console.log("AES128CtrEvaluator:", await aes128CtrEvaluator.getAddress());

    const CircuitEvaluatorFactory = await ethers.getContractFactory(
        "CircuitEvaluator",
        {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                SimpleOperationsEvaluator:
                    await simpleOperationsEvaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        }
    );
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    console.log("CircuitEvaluator:", await circuitEvaluator.getAddress());

    const CommitmentOpenerFactory = await ethers.getContractFactory(
        "CommitmentOpener"
    );
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    console.log("CommitmentOpener:", await commitmentOpener.getAddress());

    const DisputeSOXHelpersFactory = await ethers.getContractFactory(
        "DisputeSOXHelpers"
    );
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    console.log("DisputeSOXHelpers:", await disputeHelpers.getAddress());

    const DisputeDeployerFactory = await ethers.getContractFactory(
        "DisputeDeployer",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        }
    );
    const disputeDeployer = await DisputeDeployerFactory.connect(
        sponsor
    ).deploy();
    await disputeDeployer.waitForDeployment();
    console.log("DisputeDeployer:", await disputeDeployer.getAddress());

    // --- EntryPoint (ERC-4337) ---
    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    let entryPointAddress =
        process.env.NEXT_PUBLIC_ENTRY_POINT || process.env.ENTRY_POINT || "";

    if (fs.existsSync(bundlerConfigPath)) {
        const bundlerConfig = JSON.parse(
            fs.readFileSync(bundlerConfigPath, "utf-8")
        );
        const entrypoints = parseEntrypoints(bundlerConfig.entrypoints);
        if (entrypoints.length > 0) {
            entryPointAddress = entrypoints[0];
        }
    }

    if (!entryPointAddress) {
        throw new Error(
            "EntryPoint address not found. Run deployEntryPointForBundler.ts first."
        );
    }

    const entryPointCode = await ethers.provider.getCode(entryPointAddress);
    if (!entryPointCode || entryPointCode === "0x") {
        throw new Error(
            `EntryPoint not deployed at ${entryPointAddress}. Run deployEntryPointForBundler.ts first.`
        );
    }

    const entryPoint = new ethers.Contract(
        entryPointAddress,
        EntryPointArtifact.abi,
        sponsor
    );
    console.log("EntryPoint:", entryPointAddress);

    // --- OptimisticSOXAccount main contract ---
    let sponsorAmount = 500n * GWEI_MULT;
    let agreedPrice = 30n * GWEI_MULT;
    let completionTip = 80n * GWEI_MULT;
    let disputeTip = 120n * GWEI_MULT;
    let timeoutIncrement = 3600n; // 1 hour
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = new Uint8Array(32);

    const OptimisticSOXFactory = await ethers.getContractFactory(
        "OptimisticSOXAccount",
        {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        }
    );

    const optimisticSOX = await OptimisticSOXFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await buyer.getAddress(),
        await vendor.getAddress(),
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
    await optimisticSOX.waitForDeployment();
    console.log("OptimisticSOXAccount:", await optimisticSOX.getAddress());

    console.log("\n✅ Full SOX stack deployed successfully.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

