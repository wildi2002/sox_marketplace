import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const { ethers } = hre;

function randInt(a: number, b: number): number {
    return a + Math.floor(Math.random() * (b - a));
}

export async function deployRealContracts(
    sponsor: HardhatEthersSigner,
    buyer: HardhatEthersSigner,
    vendor: HardhatEthersSigner,
    numBlocks?: number,
    numGates?: number,
    commitment?: Uint8Array,
    withRandomValues?: boolean
) {
    const GWEI_MULT = 1_000_000_000n;

    const AccumulatorVerifierFactory = await ethers.getContractFactory(
        "AccumulatorVerifier"
    );
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory(
        "SHA256Evaluator"
    );
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory(
        "SimpleOperationsEvaluator"
    );
    const simpleOperationsEvaluator =
        await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory(
        "AES128CtrEvaluator"
    );
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();

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

    const CommitmentOpenerFactory = await ethers.getContractFactory(
        "CommitmentOpener"
    );
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const libFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CircuitEvaluator: await circuitEvaluator.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
        },
    });
    const disputeDeployer = await libFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();

    let sponsorAmount = 500n * GWEI_MULT;
    let agreedPrice = 30n * GWEI_MULT;
    let completionTip = 80n * GWEI_MULT;
    let disputeTip = 120n * GWEI_MULT;
    let timeoutIncrement = 3600n; // 1 hour
    numBlocks = numBlocks ? numBlocks : 1024;
    numGates = numGates ? numGates : 4 * numBlocks + 1;
    commitment = commitment ? commitment : new Uint8Array(32);

    if (withRandomValues) {
        sponsorAmount = BigInt(randInt(250, 1001)) * GWEI_MULT;
        agreedPrice = BigInt(randInt(1, 101)) * GWEI_MULT;
        completionTip = BigInt(randInt(1, 111)) * GWEI_MULT;
        disputeTip = BigInt(randInt(20, 201)) * GWEI_MULT;
    }

    const factory = await ethers.getContractFactory("OptimisticSOX", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const contract = await factory
        .connect(sponsor)
        .deploy(
            await buyer.getAddress(),
            await vendor.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitment,
            numBlocks,
            numGates,
            {
                value: sponsorAmount,
            }
        );
    await contract.waitForDeployment();

    return {
        contract,
        sponsorAmount,
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        disputeDeployer,
        accumulatorVerifier,
        circuitEvaluator,
        commitmentOpener,
    };
}

export async function deployDisputeWithMockOptimistic(
    numBlocks: bigint,
    numGates: bigint,
    commitment: Uint8Array,
    buyer: HardhatEthersSigner,
    vendor: HardhatEthersSigner,
    buyerDisputeSponsor: HardhatEthersSigner,
    vendorDisputeSponsor: HardhatEthersSigner,
    withRandomValues?: boolean
) {
    const GWEI_MULT = 1_000_000_000n;
    let agreedPrice = 30n * GWEI_MULT;
    let timeoutIncrement = 3600n;

    if (withRandomValues) {
        agreedPrice = BigInt(randInt(1, 101)) * GWEI_MULT;
        timeoutIncrement = BigInt(randInt(1800, 18001)) * GWEI_MULT;
    }

    // Deploy linked libraries
    const AccumulatorVerifierFactory = await ethers.getContractFactory(
        "AccumulatorVerifier"
    );
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory(
        "SHA256Evaluator"
    );
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory(
        "SimpleOperationsEvaluator"
    );
    const simpleOperationsEvaluator =
        await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory(
        "AES128CtrEvaluator"
    );
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();

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

    const CommitmentOpenerFactory = await ethers.getContractFactory(
        "CommitmentOpener"
    );
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const disputeDeployerFac = await ethers.getContractFactory(
        "DisputeDeployer",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CircuitEvaluator: await circuitEvaluator.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
            },
        }
    );
    const disputeDeployer = await disputeDeployerFac.deploy();
    await disputeDeployer.waitForDeployment();

    const OptimisticSOXFactory = await ethers.getContractFactory(
        "MockOptimisticSOX",
        {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        }
    );
    const optimistic = await OptimisticSOXFactory.deploy(
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
        timeoutIncrement,
        agreedPrice
    );
    await optimistic.waitForDeployment();

    // Deploy the main contract with linked libraries
    const DisputeSOXFactory = await ethers.getContractFactory("DisputeSOX", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CircuitEvaluator: await circuitEvaluator.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
        },
    });

    const contract = await DisputeSOXFactory.deploy(
        await optimistic.getAddress(),
        numBlocks,
        numGates,
        commitment,
        { value: agreedPrice }
    );
    await contract.waitForDeployment();

    return {
        contract,
        agreedPrice,
        timeoutIncrement,
        accumulatorVerifier,
        circuitEvaluator,
        commitmentOpener,
        optimistic,
    };
}
