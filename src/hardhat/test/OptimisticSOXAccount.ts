import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const { ethers } = hre;

describe("OptimisticSOXAccount", () => {
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let other: HardhatEthersSigner;

    before(async () => {
        [buyer, vendor, sponsor, other] = await ethers.getSigners();
    });

    async function deployAccountFixture() {
        const sponsorAmount = ethers.parseEther("1");
        const agreedPrice = ethers.parseEther("0.2");
        const completionTip = ethers.parseEther("0.05");
        const disputeTip = ethers.parseEther("0.01");
        const timeoutIncrement = 60n;
        const commitment = new Uint8Array(32);
        const numBlocks = 512n;
        const numGates = 2048n;

        const disputeDeployerFactory = await ethers.getContractFactory(
            "MockDisputeDeployer"
        );
        const disputeDeployer = await disputeDeployerFactory
            .connect(sponsor)
            .deploy();
        await disputeDeployer.waitForDeployment();

        const entryPointFactory = await ethers.getContractFactory(
            "MockEntryPoint"
        );
        const entryPoint = await entryPointFactory.connect(other).deploy();
        await entryPoint.waitForDeployment();

        const accountFactory = await ethers.getContractFactory(
            "OptimisticSOXAccount",
            {
                libraries: {
                    DisputeDeployer: await disputeDeployer.getAddress(),
                },
            }
        );

        const account = await accountFactory.connect(sponsor).deploy(
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
        await account.waitForDeployment();

        return {
            account,
            entryPoint,
            disputeDeployer,
            sponsorAmount,
            agreedPrice,
            completionTip,
            disputeTip,
        };
    }

    it("allows deposit and withdraw on EntryPoint", async () => {
        const { account, entryPoint } = await loadFixture(deployAccountFixture);
        const depositAmount = ethers.parseEther("0.1");

        await expect(
            account.connect(other).depositToEntryPoint({ value: depositAmount })
        ).to.changeEtherBalances(
            [other, entryPoint],
            [-depositAmount, depositAmount]
        );

        expect(
            await entryPoint.balanceOf(await account.getAddress())
        ).to.equal(depositAmount);

        const withdrawAmount = depositAmount / 2n;
        await account
            .connect(vendor)
            .withdrawFromEntryPoint(await vendor.getAddress(), withdrawAmount);
        expect(
            await entryPoint.balanceOf(await account.getAddress())
        ).to.equal(depositAmount - withdrawAmount);
    });

    it("validates user operations, bumps nonce, and tops up deposit", async () => {
        const { account, entryPoint } = await loadFixture(deployAccountFixture);
        const userOpHash = ethers.id("userOp");
        const signature = await vendor.signMessage(
            ethers.getBytes(userOpHash)
        );
        const missingFunds = ethers.parseEther("0.05");

        const userOp = {
            sender: await account.getAddress(),
            nonce: 0,
            initCode: "0x",
            callData: "0x",
            callGasLimit: 0,
            verificationGasLimit: 0,
            preVerificationGas: 0,
            maxFeePerGas: 0,
            maxPriorityFeePerGas: 0,
            paymasterAndData: "0x",
            signature,
        };

        const validation = await entryPoint.callValidateUserOp(
            await account.getAddress(),
            userOp,
            userOpHash,
            missingFunds,
            { value: missingFunds }
        );

        await expect(validation).to.equal(0);
        expect(await account.nonce()).to.equal(1n);
        expect(
            await entryPoint.balanceOf(await account.getAddress())
        ).to.equal(missingFunds);
    });

    it("reverts on invalid signatures", async () => {
        const { account, entryPoint } = await loadFixture(deployAccountFixture);
        const userOpHash = ethers.id("userOp");
        const badSig = await buyer.signMessage(ethers.getBytes(userOpHash));
        const userOp = {
            sender: await account.getAddress(),
            nonce: 0,
            initCode: "0x",
            callData: "0x",
            callGasLimit: 0,
            verificationGasLimit: 0,
            preVerificationGas: 0,
            maxFeePerGas: 0,
            maxPriorityFeePerGas: 0,
            paymasterAndData: "0x",
            signature: badSig,
        };

        await expect(
            entryPoint.callValidateUserOp(
                await account.getAddress(),
                userOp,
                userOpHash,
                0,
                { value: 0 }
            )
        ).to.be.revertedWith("Invalid vendor signature");
    });

    it("executes vendor-only flows through the account", async () => {
        const { account, agreedPrice, completionTip } = await loadFixture(
            deployAccountFixture
        );

        await account
            .connect(buyer)
            .sendPayment({ value: agreedPrice + completionTip });
        const data = account.interface.encodeFunctionData("sendKey", [
            ethers.toUtf8Bytes("secret"),
        ]);

        await account.connect(vendor).execute(await account.getAddress(), 0, data);

        expect(await account.currState()).to.equal(2); // WaitSB
    });
});
