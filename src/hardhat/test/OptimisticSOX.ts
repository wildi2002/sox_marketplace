import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress, ZeroHash } from "ethers";
import { OptimisticSOX } from "../typechain-types";

const { ethers } = hre;

function randInt(a: number, b: number): number {
    return a + Math.floor(Math.random() * (b - a));
}

describe("OptimisticSOX", function () {
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;

    before(async function () {
        [buyer, vendor, sponsor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();
    });

    async function deployContractCorrect() {
        const GWEI_MULT = 1_000_000_000n;
        const libFactory = await ethers.getContractFactory(
            "MockDisputeDeployer"
        );
        const disputeDeployer = await libFactory.connect(sponsor).deploy();
        await disputeDeployer.waitForDeployment();

        const sponsorAmount = BigInt(randInt(50, 101)) * GWEI_MULT;
        const agreedPrice = BigInt(randInt(1, 101)) * GWEI_MULT;
        const completionTip = BigInt(randInt(1, 11)) * GWEI_MULT;
        const disputeTip = BigInt(randInt(20, 51)) * GWEI_MULT;
        const timeoutIncrement = BigInt(randInt(60, 121));
        const commitment = new Uint8Array(32);
        const numBlocks = BigInt(randInt(500, 1000));
        const numGates = 2n * numBlocks + BigInt(randInt(500, 1000));

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
        };
    }

    async function fastForward(
        contractInfo: {
            contract: OptimisticSOX;
            sponsorAmount: bigint;
            agreedPrice: bigint;
            completionTip: bigint;
            disputeTip: bigint;
            timeoutIncrement: bigint;
        },
        step: number
    ) {
        if (step <= 0) return;
        const {
            contract,
            sponsorAmount,
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
        } = contractInfo;
        /*
            WaitPayment,
            WaitKey,
            WaitSB,
            WaitSV,
            InDispute,
            End
        */
        if (step) {
            await contract
                .connect(buyer)
                .sendPayment({ value: agreedPrice + completionTip });
            step--;
        }

        if (step) {
            await contract.connect(vendor).sendKey(ethers.toUtf8Bytes("key"));
            step--;
        }

        if (step) {
            await contract
                .connect(buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFee({ value: 10n + disputeTip });
            step--;
        }

        if (step) {
            await contract
                .connect(vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({ value: 10n + disputeTip });
            step--;
        }

        if (step) {
            await contract
                .connect(
                    await hre.ethers.getSigner(await contract.disputeContract())
                )
                .endDispute();
            step--;
        }
    }

    describe("Deployment", function () {
        it("Should deploy without errors", async function () {
            await expect(loadFixture(deployContractCorrect)).not.to.be.reverted;
        });

        it("Should store the provided values in the corresponding fields", async function () {
            const {
                contract,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            expect(await contract.agreedPrice()).to.equal(agreedPrice);
            expect(await contract.completionTip()).to.equal(completionTip);
            expect(await contract.disputeTip()).to.equal(disputeTip);
            expect(await contract.timeoutIncrement()).to.equal(
                timeoutIncrement
            );
        });

        it("Should have the provided funds", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);
            const balance = await ethers.provider.getBalance(
                await contract.getAddress()
            );
            expect(balance).to.equal(sponsorAmount);
        });

        it("Should be in WaitPayment state", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);
            expect(await contract.currState()).to.equal(0);
        });

        it("Should not be cancellable nor completeable before timeout", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);
            await expect(contract.cancelTransaction()).to.be.reverted;
            await expect(contract.completeTransaction()).to.be.reverted;
        });

        it("Should timeout if no action is taken", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await time.increase(timeoutIncrement + 5n);
            expect(await contract.timeoutHasPassed()).to.equal(true);
        });

        it("Should be cancellable after timeout and refund the sponsor", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelTransaction()).to.not.be.reverted;

            const balance = await ethers.provider.getBalance(
                await contract.getAddress()
            );
            expect(balance).to.equal(0n);
        });
    });

    describe("sendPayment", function () {
        it("Should switch to WaitKey (1) state after a legitimate call", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await expect(
                contract
                    .connect(buyer)
                    .sendPayment({ value: agreedPrice + completionTip })
            ).to.not.be.reverted;

            const state = await contract.currState();
            expect(state).to.equal(1); // WaitKey
        });

        it("Should adjust its internal state variables for deposits and tips accordingly", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);
            const expectedDeposit = agreedPrice + completionTip;

            await contract
                .connect(buyer)
                .sendPayment({ value: expectedDeposit });

            const buyerDeposit = await contract.buyerDeposit();
            const sponsorTip = await contract.sponsorTip();

            expect(buyerDeposit).to.equal(expectedDeposit);
            expect(sponsorTip).to.equal(completionTip);
        });

        it("Should refuse any call from anyone but the buyer", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            const expectedDeposit = agreedPrice + completionTip;

            // Try to call as sponsor instead of buyer
            await expect(
                contract
                    .connect(sponsor)
                    .sendPayment({ value: expectedDeposit })
            ).to.be.reverted;
        });

        it("Should refuse the call if not enough money is deposited", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            const tooLittle = agreedPrice + completionTip - 1n;

            await expect(
                contract.connect(buyer).sendPayment({ value: tooLittle })
            ).to.be.revertedWith(
                "Agreed price and completion tip is higher than deposit"
            );
        });

        it("Should refuse the call if not in WaitPayment state", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            // Move to WaitKey state
            await contract
                .connect(buyer)
                .sendPayment({ value: agreedPrice + completionTip });

            // Try sending again
            await expect(
                contract
                    .connect(buyer)
                    .sendPayment({ value: agreedPrice + completionTip })
            ).to.be.revertedWith(
                "Cannot run this function in the current state"
            );
        });
        it("Should accept overpayment but only count exact agreed + tip values", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);
            const overpaidAmount = agreedPrice + completionTip + 10n;

            await contract
                .connect(buyer)
                .sendPayment({ value: overpaidAmount });

            const buyerDeposit = await contract.buyerDeposit();
            const sponsorTip = await contract.sponsorTip();

            expect(buyerDeposit).to.equal(overpaidAmount); // contract accepts overpayment
            expect(sponsorTip).to.equal(overpaidAmount - agreedPrice);
        });
    });

    describe("sendKey", function () {
        it("Should accept the key and switch to WaitSB state when called by vendor in WaitKey state", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                1
            );

            const keyData = ethers.toUtf8Bytes("key");
            await expect(contract.connect(vendor).sendKey(keyData)).to.not.be
                .reverted;

            expect(await contract.currState()).to.equal(2); // WaitSB enum value
            expect(await contract.key()).to.equal(ethers.hexlify(keyData));
        });

        it("Should revert if called by anyone other than vendor", async function () {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await contract.connect(buyer).sendPayment({
                value: agreedPrice + completionTip,
            });

            const keyData = ethers.toUtf8Bytes("test-key");

            await expect(contract.connect(buyer).sendKey(keyData)).to.be
                .reverted;
            await expect(contract.connect(sponsor).sendKey(keyData)).to.be
                .reverted;
        });

        it("Should revert if called when contract is not in WaitKey state", async function () {
            // TODO
            // const {
            //     contract,
            //     sponsorAmount,
            //     agreedPrice,
            //     completionTip,
            //     disputeTip,
            //     timeoutIncrement,
            // } = await loadFixture(deployContractCorrect);
            // // Attempt to call sendKey in initial WaitPayment state
            // const keyData = ethers.toUtf8Bytes("test-key");
            // await expect(contract.connect(vendor).sendKey(keyData)).to.be
            //     .reverted;
            // // Move to WaitSB state
            // const {
            //     contract,
            //     sponsorAmount,
            //     agreedPrice,
            //     completionTip,
            //     disputeTip,
            //     timeoutIncrement,
            // } = await loadFixture(deployContractCorrect);
            // await contract.connect(buyer).sendPayment({
            //     value: agreedPrice + completionTip,
            // });
            // await contract.connect(vendor).sendKey(keyData);
            // // Now in WaitSB, try sendKey again
            // await expect(contract.connect(vendor).sendKey(keyData)).to.be
            //     .reverted;
        });
    });

    describe("sendBuyerDisputeSponsorFee", () => {
        it("Should accept dispute fee + completion tip, save the sponsor's address and advance state", async () => {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                2
            );

            await expect(
                contract
                    .connect(buyerDisputeSponsor)
                    .sendBuyerDisputeSponsorFee({ value: 10n + disputeTip }) // DISPUTE_FEES dummy value
            ).not.to.be.reverted;
            expect(await contract.currState()).to.equal(3); // WaitSV

            expect(await contract.sbDeposit()).to.equal(10n + disputeTip);
            expect(await contract.buyerDisputeSponsor()).to.equal(
                buyerDisputeSponsor.address
            );
        });

        it("Should revert if deposited amount less than DISPUTE_FEES + tip", async () => {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                2
            );

            await expect(
                contract
                    .connect(buyerDisputeSponsor)
                    .sendBuyerDisputeSponsorFee({ value: 9n + disputeTip })
            ).to.be.revertedWith(
                "Not enough money deposited to cover dispute fees + tip"
            );
        });
    });

    describe("sendVendorDisputeSponsorFee", () => {
        it("Should accept vendor dispute fee + tip, save the sponsor's address, change state and deploy the dispute smart contract", async () => {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                3
            );

            await expect(
                contract
                    .connect(vendorDisputeSponsor)
                    .sendVendorDisputeSponsorFee({ value: 10n + disputeTip })
            ).not.to.be.reverted;

            expect(await contract.currState()).to.equal(4); // WaitDisputeStart

            expect(await contract.svDeposit()).to.equal(10n + disputeTip);
            expect(await contract.vendorDisputeSponsor()).to.equal(
                vendorDisputeSponsor.address
            );
            expect(await contract.disputeContract()).to.not.equal(ZeroAddress);
        });

        it("Should revert if value less than DISPUTE_FEES", async () => {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                3
            );

            await expect(
                contract
                    .connect(vendorDisputeSponsor)
                    .sendVendorDisputeSponsorFee({ value: 9n + disputeTip })
            ).to.be.revertedWith(
                "Not enough money deposited to cover dispute fees + tip"
            );
        });
    });

    describe("endDispute", () => {
        /*
        it("Should allow dispute contract to end dispute and transition to End", async () => {
            // TODO fix when dispute is properly integrated
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                disputeDeployer,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                7
            );

            // Set msg.sender = disputeContract to test onlyExpected
            await expect(
                contract
                    .connect(
                        await hre.ethers.getSigner(
                            await contract.disputeContract()
                        )
                    )
                    .endDispute()
            ).not.to.be.reverted;

            expect(await contract.currState()).to.equal(8); // InDispute
        });
        */

        it("Should revert if not called by dispute contract", async () => {
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                4
            );

            await expect(contract.connect(buyerDisputeSponsor).endDispute()).to
                .be.reverted;
        });

        /*
        it("Should revert if not in InDispute state", async () => {
            // TODO fix when dispute is properly integrated
            const {
                contract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
            } = await loadFixture(deployContractCorrect);

            await fastForward(
                {
                    contract,
                    sponsorAmount,
                    agreedPrice,
                    completionTip,
                    disputeTip,
                    timeoutIncrement,
                },
                7
            );

            // Force state to WaitPayment
            const value =
                (await contract.agreedPrice()) +
                (await contract.completionTip());
            await contract.connect(buyer).sendPayment({ value });

            await expect(
                contract
                    .connect(
                        await hre.ethers.getSigner(
                            await contract.disputeContract()
                        )
                    )
                    .endDispute()
            ).to.be.revertedWith(
                "Cannot run this function in the current state"
            );
        });
        */
    });
});
