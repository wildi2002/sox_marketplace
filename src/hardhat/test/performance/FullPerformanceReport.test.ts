import { expect } from "chai";
import { ethers } from "hardhat";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    bytes_to_hex,
    check_precontract,
    compute_precontract_values_v2,
    initSync,
} from "../../../app/lib/crypto_lib/crypto_lib";

type DeployResult = {
    address: string;
    gasUsed: bigint;
};

function parseSizesMb(value: string | undefined, fallback: number[]): number[] {
    if (!value) return fallback;
    const parsed = value
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
    return parsed.length > 0 ? parsed : fallback;
}

async function deployWithGas(factory: any, args: any[] = []): Promise<DeployResult> {
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction()?.wait();
    return {
        address: await contract.getAddress(),
        gasUsed: receipt?.gasUsed ?? 0n,
    };
}

describe("Full performance report (gas + off-chain timings)", function () {
    this.timeout(0);

    const runGas = process.env.PERF_GAS !== "0";
    const runOffchain = process.env.PERF_OFFCHAIN !== "0";
    const sizesMb = parseSizesMb(process.env.PERF_SIZES_MB, [1, 16, 64]);

    before(async function () {
        if (!runOffchain) return;
        const modulePath = join(
            __dirname,
            "../../../app/lib/crypto_lib/crypto_lib_bg.wasm"
        );
        const module = await readFile(modulePath);
        initSync({ module });
    });

    it("gas measurements", async function () {
        if (!runGas) {
            console.log("Skipping gas measurements (PERF_GAS=0).");
            return;
        }

        const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();

        console.log("\n=== Gas usage report (Hardhat local) ===");

        const AccumulatorVerifierFactory =
            await ethers.getContractFactory("AccumulatorVerifier");
        const acc = await deployWithGas(AccumulatorVerifierFactory);

        const SHA256EvaluatorFactory =
            await ethers.getContractFactory("SHA256Evaluator");
        const sha = await deployWithGas(SHA256EvaluatorFactory);

        const SimpleOperationsEvaluatorFactory =
            await ethers.getContractFactory("SimpleOperationsEvaluator");
        const simpleOps = await deployWithGas(SimpleOperationsEvaluatorFactory);

        const AES128CtrEvaluatorFactory =
            await ethers.getContractFactory("AES128CtrEvaluator");
        const aes = await deployWithGas(AES128CtrEvaluatorFactory);

        const CircuitEvaluatorFactory = await ethers.getContractFactory(
            "CircuitEvaluator",
            {
                libraries: {
                    SHA256Evaluator: sha.address,
                    SimpleOperationsEvaluator: simpleOps.address,
                    AES128CtrEvaluator: aes.address,
                },
            }
        );
        const circuit = await deployWithGas(CircuitEvaluatorFactory);

        const CommitmentOpenerFactory =
            await ethers.getContractFactory("CommitmentOpener");
        const commitment = await deployWithGas(CommitmentOpenerFactory);

        const DisputeSOXHelpersFactory =
            await ethers.getContractFactory("DisputeSOXHelpers");
        const helpers = await deployWithGas(DisputeSOXHelpersFactory);

        const DisputeDeployerFactory = await ethers.getContractFactory(
            "DisputeDeployer",
            {
                libraries: {
                    AccumulatorVerifier: acc.address,
                    CommitmentOpener: commitment.address,
                    SHA256Evaluator: sha.address,
                },
            }
        );
        const disputeDeployer = await deployWithGas(DisputeDeployerFactory);

        const MockEntryPointFactory =
            await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await deployWithGas(MockEntryPointFactory);

        const OptimisticSOXAccountFactory =
            await ethers.getContractFactory("OptimisticSOXAccount", {
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

        const optimistic = await OptimisticSOXAccountFactory.connect(
            sponsor
        ).deploy(
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
        const optimisticDeployReceipt =
            await optimistic.deploymentTransaction()?.wait();

        const sendPaymentTx = await optimistic.connect(buyer).sendPayment({
            value: agreedPrice + completionTip,
        });
        const sendPaymentReceipt = await sendPaymentTx.wait();

        const sendKeyTx = await optimistic
            .connect(vendor)
            .sendKey(ethers.toUtf8Bytes("k"));
        const sendKeyReceipt = await sendKeyTx.wait();

        const sendBuyerFeeTx = await optimistic
            .connect(buyerDisputeSponsor)
            .sendBuyerDisputeSponsorFee({
                value: 10n + disputeTip,
            });
        const sendBuyerFeeReceipt = await sendBuyerFeeTx.wait();

        const sendVendorFeeTx = await optimistic
            .connect(vendorDisputeSponsor)
            .sendVendorDisputeSponsorFee({
                value: 10n + disputeTip + agreedPrice,
            });
        const sendVendorFeeReceipt = await sendVendorFeeTx.wait();

        const disputeAddress = await optimistic.disputeContract();
        const dispute = await ethers.getContractAt(
            "DisputeSOXAccount",
            disputeAddress
        );

        const respondTx = await dispute
            .connect(buyer)
            .respondChallenge(ethers.ZeroHash);
        const respondReceipt = await respondTx.wait();

        const opinionTx = await dispute.connect(vendor).giveOpinion(true);
        const opinionReceipt = await opinionTx.wait();

        const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("userop-hash"));
        const signature = await vendor.signMessage(ethers.getBytes(userOpHash));
        const userOp = {
            sender: await optimistic.getAddress(),
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

        const validateTx = await (
            await ethers.getContractAt("MockEntryPoint", entryPoint.address)
        )
            .connect(sponsor)
            .callValidateUserOp(await optimistic.getAddress(), userOp, userOpHash, 0);
        const validateReceipt = await validateTx.wait();

        const supportsData =
            optimistic.interface.encodeFunctionData("supportsERC4337");
        const execTx = await optimistic
            .connect(vendor)
            .execute(await optimistic.getAddress(), 0, supportsData);
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
        console.log(
            "OptimisticSOXAccount:",
            (optimisticDeployReceipt?.gasUsed ?? 0n).toString()
        );

        console.log("");
        console.log("== Optimistic flow (gas) ==");
        console.log("sendPayment:", sendPaymentReceipt?.gasUsed.toString() ?? "0");
        console.log("sendKey:", sendKeyReceipt?.gasUsed.toString() ?? "0");
        console.log(
            "sendBuyerDisputeSponsorFee:",
            sendBuyerFeeReceipt?.gasUsed.toString() ?? "0"
        );
        console.log(
            "sendVendorDisputeSponsorFee (deploy dispute):",
            sendVendorFeeReceipt?.gasUsed.toString() ?? "0"
        );

        console.log("");
        console.log("== Dispute round (gas) ==");
        console.log("respondChallenge:", respondReceipt?.gasUsed.toString() ?? "0");
        console.log("giveOpinion:", opinionReceipt?.gasUsed.toString() ?? "0");

        console.log("");
        console.log("== UserOp components (gas) ==");
        console.log(
            "validateUserOp (via MockEntryPoint):",
            validateReceipt?.gasUsed.toString() ?? "0"
        );
        console.log(
            "execute (supportsERC4337 call):",
            execReceipt?.gasUsed.toString() ?? "0"
        );
    });

    it("off-chain timings (V2 precontract)", async function () {
        if (!runOffchain) {
            console.log("Skipping off-chain timings (PERF_OFFCHAIN=0).");
            return;
        }

        console.log("\n=== Off-chain timings (V2) ===");
        console.log(`Sizes (MB): ${sizesMb.join(", ")}`);

        for (const sizeMb of sizesMb) {
            const sizeBytes = sizeMb * 1024 * 1024;
            const file = new Uint8Array(sizeBytes);
            const key = new Uint8Array(16);

            const rssBefore = process.memoryUsage().rss;
            const start = performance.now();
            const pre = compute_precontract_values_v2(file, key);
            const end = performance.now();
            const rssAfterPre = process.memoryUsage().rss;

            const descriptionHex = bytes_to_hex(pre.description);
            const commitmentHex = bytes_to_hex(pre.commitment.c);
            const openingHex = bytes_to_hex(pre.commitment.o);

            const checkStart = performance.now();
            const checkRes = check_precontract(
                descriptionHex,
                commitmentHex,
                openingHex,
                pre.ct
            );
            const checkEnd = performance.now();
            const rssAfterCheck = process.memoryUsage().rss;

            expect(checkRes.success).to.equal(true);

            const preMs = end - start;
            const checkMs = checkEnd - checkStart;
            const rssPeak = Math.max(rssBefore, rssAfterPre, rssAfterCheck);
            const rssPeakMb = (rssPeak / (1024 * 1024)).toFixed(1);

            console.log(
                `[${sizeMb} MB] precontract=${preMs.toFixed(
                    1
                )} ms, check=${checkMs.toFixed(1)} ms, numBlocks=${
                    pre.num_blocks
                }, numGates=${pre.num_gates}, rss~${rssPeakMb} MB`
            );
        }
    });
});
