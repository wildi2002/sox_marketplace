import hre from "hardhat";
import { ethers } from "hardhat";

type DeployResult = {
    address: string;
    gasUsed: bigint;
};

async function deployWithGas(factory: any, args: any[] = []): Promise<DeployResult> {
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction()?.wait();
    return {
        address: await contract.getAddress(),
        gasUsed: receipt?.gasUsed ?? 0n,
    };
}

async function main() {
    const [sponsor, buyer, vendor] = await ethers.getSigners();

    console.log("=== Gas usage report (Hardhat local) ===");

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const acc = await deployWithGas(AccumulatorVerifierFactory);

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha = await deployWithGas(SHA256EvaluatorFactory);

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOps = await deployWithGas(SimpleOperationsEvaluatorFactory);

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes = await deployWithGas(AES128CtrEvaluatorFactory);

    const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
        libraries: {
            SHA256Evaluator: sha.address,
            SimpleOperationsEvaluator: simpleOps.address,
            AES128CtrEvaluator: aes.address,
        },
    });
    const circuit = await deployWithGas(CircuitEvaluatorFactory);

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitment = await deployWithGas(CommitmentOpenerFactory);

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const helpers = await deployWithGas(DisputeSOXHelpersFactory);

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: acc.address,
            CommitmentOpener: commitment.address,
            DisputeSOXHelpers: helpers.address,
            SHA256Evaluator: sha.address,
        },
    });
    const disputeDeployer = await deployWithGas(DisputeDeployerFactory);

    const MockEntryPointFactory = await ethers.getContractFactory("MockEntryPoint");
    const entryPoint = await deployWithGas(MockEntryPointFactory);

    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: disputeDeployer.address,
        },
    });

    const agreedPrice = 1n;
    const completionTip = 1n;
    const disputeTip = 1n;
    const timeoutIncrement = 3600n;
    const commitmentBytes = new Uint8Array(32);
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const sponsorAmount = 1_000_000_000_000_000_000n;

    const optimistic = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPoint.address,
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitmentBytes,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        {
            value: sponsorAmount,
        }
    );
    await optimistic.waitForDeployment();
    const optimisticDeployReceipt = await optimistic.deploymentTransaction()?.wait();
    const optimisticAddress = await optimistic.getAddress();

    // Gas for optimistic flow (EOA calls)
    const sendPaymentTx = await optimistic.connect(buyer).sendPayment({
        value: agreedPrice + completionTip,
    });
    const sendPaymentReceipt = await sendPaymentTx.wait();

    const sendKeyTx = await optimistic.connect(vendor).sendKey(ethers.toUtf8Bytes("k"));
    const sendKeyReceipt = await sendKeyTx.wait();

    const completeTx = await optimistic.connect(buyer).completeTransaction();
    const completeReceipt = await completeTx.wait();

    // UserOperation validation cost (approx)
    const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("userop-hash"));
    const signature = await vendor.signMessage(ethers.getBytes(userOpHash));
    const userOp = {
        sender: optimisticAddress,
        nonce: 0,
        initCode: "0x",
        callData: "0x",
        callGasLimit: 100000,
        verificationGasLimit: 100000,
        preVerificationGas: 20000,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
        paymasterAndData: "0x",
        signature,
    };

    const validateTx = await (await ethers.getContractAt("MockEntryPoint", entryPoint.address))
        .connect(sponsor)
        .callValidateUserOp(optimisticAddress, userOp, userOpHash, 0);
    const validateReceipt = await validateTx.wait();

    const supportsData = optimistic.interface.encodeFunctionData("supportsERC4337");
    const execTx = await optimistic.connect(vendor).execute(optimisticAddress, 0, supportsData);
    const execReceipt = await execTx.wait();

    console.log("");
    console.log("== Deployments (gas) ==");
    console.log("AccumulatorVerifier:", acc.gasUsed.toString());
    console.log("SHA256Evaluator:", sha.gasUsed.toString());
    console.log("SimpleOperationsEvaluator:", simpleOps.gasUsed.toString());
    console.log("AES128CtrEvaluator:", aes.gasUsed.toString());
    console.log("CircuitEvaluator:", circuit.gasUsed.toString());
    console.log("CommitmentOpener:", commitment.gasUsed.toString());
    console.log("DisputeSOXHelpers:", helpers.gasUsed.toString());
    console.log("DisputeDeployer:", disputeDeployer.gasUsed.toString());
    console.log("MockEntryPoint:", entryPoint.gasUsed.toString());
    console.log("OptimisticSOXAccount:", (optimisticDeployReceipt?.gasUsed ?? 0n).toString());

    console.log("");
    console.log("== Optimistic flow (gas) ==");
    console.log("sendPayment:", sendPaymentReceipt?.gasUsed.toString() ?? "0");
    console.log("sendKey:", sendKeyReceipt?.gasUsed.toString() ?? "0");
    console.log("completeTransaction:", completeReceipt?.gasUsed.toString() ?? "0");

    console.log("");
    console.log("== UserOp components (gas) ==");
    console.log("validateUserOp (via MockEntryPoint):", validateReceipt?.gasUsed.toString() ?? "0");
    console.log("execute (supportsERC4337 call):", execReceipt?.gasUsed.toString() ?? "0");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
