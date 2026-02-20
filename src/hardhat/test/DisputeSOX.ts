import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { network } from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroHash } from "ethers";
import {
    AccumulatorVerifier,
    CommitmentOpener,
    DisputeSOX,
    MockOptimisticSOX,
} from "../typechain-types";

const { ethers } = hre;

function randInt(a: number, b: number): number {
    return a + Math.floor(Math.random() * (b - a));
}

function encodeI64To6Bytes(value: number): Uint8Array {
    const limit = 1n << 48n;
    let v = BigInt(value);
    if (v < 0) {
        v = limit + v;
    }
    const bytes = new Uint8Array(6);
    for (let i = 5; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

function makeAesGateBytes(son: number): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = 0x01;
    gate.set(encodeI64To6Bytes(son), 1);
    const paramsStart = 1 + 6;
    gate.fill(1, paramsStart, paramsStart + 16);
    gate[paramsStart + 16] = 0xff;
    gate[paramsStart + 17] = 0xff;
    return gate;
}

function makeGateValues(count: number): Uint8Array[] {
    return Array.from({ length: count }, () => new Uint8Array(64));
}

describe("DisputeSOX", function () {
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;
    let accumulatorVerifier: AccumulatorVerifier;
    let commitmentOpener: CommitmentOpener;
    let contract: DisputeSOX;
    let optimistic: MockOptimisticSOX;
    let agreedPrice: bigint;
    let timeoutIncrement: bigint;
    let commitment: string;
    let numBlocks: bigint;
    let numGates: bigint;
    let disputeHelpersAddress: string;

    let fastForward: (state: number) => void;
    const challenges: bigint[] = [];

    async function deployContractCorrect() {
        const GWEI_MULT = 1_000_000_000n;
        agreedPrice = BigInt(randInt(5, 31)) * GWEI_MULT;
        timeoutIncrement = BigInt(randInt(60, 121));
        commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment"));
        numBlocks = BigInt(randInt(5, 121));
        numGates = numBlocks + BigInt(randInt(5, 11));

        // Deploy linked libraries
        const AccumulatorVerifierFactory = await ethers.getContractFactory(
            "MockAccumulatorVerifier"
        );
        accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();

        const DisputeSOXHelpersFactory = await ethers.getContractFactory(
            "DisputeSOXHelpers"
        );
        const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
        await disputeHelpers.waitForDeployment();
        disputeHelpersAddress = await disputeHelpers.getAddress();

        const CommitmentOpenerFactory = await ethers.getContractFactory(
            "MockCommitmentOpener"
        );
        commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();

        const disputeDeployerFac = await ethers.getContractFactory(
            "DisputeDeployer",
            {
                libraries: {
                    AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                    CommitmentOpener: await commitmentOpener.getAddress(),
                    DisputeSOXHelpers: disputeHelpersAddress,
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
        optimistic = await OptimisticSOXFactory.deploy(
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            timeoutIncrement,
            agreedPrice
        );
        await optimistic.waitForDeployment();

        // Deploy the main contract with linked libraries
        const DisputeSOXFactory = await ethers.getContractFactory(
            "DisputeSOX",
            {
                libraries: {
                    AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                    CommitmentOpener: await commitmentOpener.getAddress(),
                    DisputeSOXHelpers: disputeHelpersAddress,
                },
            }
        );

        contract = await DisputeSOXFactory.deploy(
            await optimistic.getAddress(),
            numBlocks,
            numGates,
            commitment,
            { value: agreedPrice }
        );
        await contract.waitForDeployment();
    }

    before(async function () {
        [buyer, vendor, sponsor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();

        // deploy (state ChallengeBuyer)
        await deployContractCorrect();
        let initState = await network.provider.send("evm_snapshot");

        fastForward = async (state: number) => {
            if (state < 0) return;
            await network.provider.send("evm_revert", [initState]);
            initState = await network.provider.send("evm_snapshot");
            challenges.length = 0; // clears array

            if (state < 1) return;

            // buyer responds to challenge (state WaitVendorOpinion)
            challenges.push(await contract.chall());
            await contract.connect(buyer).respondChallenge(ZeroHash);

            if (state < 2) return;

            if (state == 2) {
                // make vendor respond until it gets to state WaitVendorData
                // we make it respond once with "true" and then only "false"
                await contract.connect(vendor).giveOpinion(true);
                while ((await contract.currState()) != 2n) {
                    challenges.push(await contract.chall());
                    await contract.connect(buyer).respondChallenge(ZeroHash);
                    await contract.connect(vendor).giveOpinion(false);
                }
                return;
            } else if (state == 3) {
                // replay the buyer responding to challenge + vendor respond
                // only "false" to get to the state where they only said "left"
                // (state WaitVendorDataLeft)
                await contract.connect(vendor).giveOpinion(false);
                while ((await contract.currState()) != 3n) {
                    challenges.push(await contract.chall());
                    await contract.connect(buyer).respondChallenge(ZeroHash);
                    await contract.connect(vendor).giveOpinion(false);
                }
                const contractState = await contract.currState();
                if (contractState != 3n)
                    throw new Error(
                        `Expected state 2, got ${contractState} during fast forward`
                    );
                return;
            }

            if (state < 4) return;

            // similar idea but with "right" (state WaitVendorDataRight)
            await contract.connect(vendor).giveOpinion(true);
            while ((await contract.currState()) != 4n) {
                challenges.push(await contract.chall());
                await contract.connect(buyer).respondChallenge(ZeroHash);
                await contract.connect(vendor).giveOpinion(true);
            }

            if (state == 5) {
                // transition to state Complete
                await contract.connect(vendor).submitCommitmentRight([[]]);

                let contractState = await contract.currState();
                if (contractState != 5n)
                    throw new Error(
                        `Expected state 5, got ${contractState} during before()`
                    );
                return;
            }

            if (state < 6) return;

            // transition to state Cancel
            await contract.connect(vendor).submitCommitmentRight([]);

            let contractState = await contract.currState();
            if (contractState != 6n)
                throw new Error(
                    `Expected state 6, got ${contractState} during before()`
                );
        };
    });

    describe("Deploy", function () {
        it("Should store the correct values + challenge and start with the ChallengeBuyer state", async () => {
            await fastForward(0);

            const expectedChall = numGates / 2n;

            expect(await contract.buyer()).to.be.equal(buyer);
            expect(await contract.vendor()).to.be.equal(vendor);
            expect(await contract.buyerDisputeSponsor()).to.be.equal(
                buyerDisputeSponsor
            );
            expect(await contract.vendorDisputeSponsor()).to.be.equal(
                vendorDisputeSponsor
            );
            expect(await contract.timeoutIncrement()).to.be.equal(
                timeoutIncrement
            );
            expect(await contract.agreedPrice()).to.be.equal(agreedPrice);
            expect(await contract.numBlocks()).to.be.equal(numBlocks);
            expect(await contract.numGates()).to.be.equal(numGates);
            expect(await contract.commitment()).to.be.equal(commitment);
            expect(await contract.chall()).to.be.equal(expectedChall);
            expect(await contract.currState()).to.be.equal(0);
        });

        it("Should revert if the optimistic contract is not in WaitDisputeStart state", async () => {
            optimistic.setState(2);
            const DisputeSOXFactory = await ethers.getContractFactory(
                "DisputeSOX",
                {
                    libraries: {
                        AccumulatorVerifier:
                            await accumulatorVerifier.getAddress(),
                        CommitmentOpener: await commitmentOpener.getAddress(),
                        DisputeSOXHelpers: disputeHelpersAddress,
                    },
                }
            );

            await expect(
                DisputeSOXFactory.deploy(
                    await optimistic.getAddress(),
                    numBlocks,
                    numGates,
                    commitment,
                    { value: agreedPrice }
                )
            ).to.be.revertedWith(
                "Optimistic contract cannot start a dispute in the current state"
            );
        });

        it("Should revert if msg.value isn't at least agreedPrice", async () => {
            const DisputeSOXFactory = await ethers.getContractFactory(
                "DisputeSOX",
                {
                    libraries: {
                        AccumulatorVerifier:
                            await accumulatorVerifier.getAddress(),
                        CommitmentOpener: await commitmentOpener.getAddress(),
                        DisputeSOXHelpers: disputeHelpersAddress,
                    },
                }
            );

            await expect(
                DisputeSOXFactory.deploy(
                    await optimistic.getAddress(),
                    numBlocks,
                    numGates,
                    commitment,
                    { value: agreedPrice - 1n }
                )
            ).to.be.revertedWith(
                "Optimistic contract cannot start a dispute in the current state"
            );
        });
    });

    describe("respondChallenge", () => {
        it("Should change state and store the response when the buyer responds", async () => {
            await fastForward(0);

            challenges.push(await contract.chall());
            await expect(contract.connect(buyer).respondChallenge(ZeroHash)).to
                .not.be.reverted;
            expect(await contract.currState()).to.be.equal(1);
        });

        it("Should revert if not called by the buyer", async () => {
            await fastForward(0);

            challenges.push(await contract.chall());
            await expect(
                contract.connect(vendor).respondChallenge(ZeroHash)
            ).to.be.revertedWith("Unexpected sender");
        });

        it("Should revert if not in ChallengeBuyer state", async () => {
            const state = randInt(1, 7);
            await fastForward(state);
            await expect(
                contract.connect(buyer).respondChallenge(ZeroHash)
            ).to.be.revertedWith(
                "Cannot run this function in the current state"
            );
        });
    });

    describe("giveOpinion", () => {
        it("Should transition to state ChallengeBuyer after a single opinion", async () => {
            await fastForward(1);

            await expect(contract.connect(vendor).giveOpinion(true)).to.not.be
                .reverted;

            expect(await contract.currState()).to.equal(0); // back to ChallengeBuyer
        });

        it('Should transition to state WaitVendorData if one response "left" and then only "right"s', async () => {
            await fastForward(1);

            let a = await contract.a();
            let b = await contract.b();

            await expect(contract.connect(vendor).giveOpinion(false)).to.not.be
                .reverted;
            while (a != b) {
                await expect(contract.connect(buyer).respondChallenge(ZeroHash))
                    .to.not.be.reverted;
                await expect(contract.connect(vendor).giveOpinion(true)).to.not
                    .be.reverted;
                a = await contract.a();
                b = await contract.b();
            }

            expect(await contract.currState()).to.equal(2);
        });

        it('Should transition to state WaitVendorDataLeft if vendor only responds "left"', async () => {
            await fastForward(1);

            let a = await contract.a();
            let b = await contract.b();

            await expect(contract.connect(vendor).giveOpinion(false)).to.not.be
                .reverted;
            while (a != b) {
                await expect(contract.connect(buyer).respondChallenge(ZeroHash))
                    .to.not.be.reverted;
                await expect(contract.connect(vendor).giveOpinion(false)).to.not
                    .be.reverted;
                a = await contract.a();
                b = await contract.b();
            }

            expect(await contract.currState()).to.equal(3);
        });

        it('Should transition to state WaitVendorDataRight if vendor only responds "right"', async () => {
            await fastForward(1);

            let a = await contract.a();
            let b = await contract.b();

            await expect(contract.connect(vendor).giveOpinion(true)).to.not.be
                .reverted;
            while (a != b) {
                await expect(contract.connect(buyer).respondChallenge(ZeroHash))
                    .to.not.be.reverted;
                await expect(contract.connect(vendor).giveOpinion(true)).to.not
                    .be.reverted;
                a = await contract.a();
                b = await contract.b();
            }

            expect(await contract.currState()).to.equal(4);
        });

        it("Should revert when called by someone who's not the vendor", async () => {
            await fastForward(1);

            await expect(
                contract.connect(buyer).giveOpinion(false)
            ).to.be.revertedWith("Unexpected sender");
        });
    });

    describe("submitCommitment", () => {
        it("Should transition to Complete on successful verification", async () => {
            await fastForward(2);

            await contract
                .connect(vendor)
                .submitCommitment(
                    new Uint8Array(80),
                    await contract.chall(),
                    makeAesGateBytes(-1),
                    makeGateValues(1),
                    ethers.hexlify(ethers.randomBytes(32)),
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]]
                );
            const state = await contract.currState();
            expect(state).to.equal(5); // Complete
        });

        it("transitions to Cancel if verification fails", async () => {
            await fastForward(2);

            await contract
                .connect(vendor)
                .submitCommitment(
                    new Uint8Array(80),
                    await contract.chall(),
                    makeAesGateBytes(-1),
                    makeGateValues(1),
                    ZeroHash,
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]]
                );
            const state = await contract.currState();
            expect(state).to.equal(6); // Cancel
        });

        it("reverts if caller is not vendor", async () => {
            await fastForward(2);

            await expect(
                contract.submitCommitment(
                    new Uint8Array(80),
                    5,
                    makeAesGateBytes(-1),
                    makeGateValues(1),
                    ZeroHash,
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]],
                    [[ZeroHash]]
                )
            ).to.be.revertedWith("Unexpected sender");
        });
    });

    describe("completeDispute", () => {
        it("Should allow buyer to call when state is ChallengeBuyer", async () => {
            await fastForward(0);

            await expect(contract.connect(buyer).completeDispute()).to.not.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow buyer to call before timeout when state is Complete", async () => {
            await fastForward(5);

            console.log("may I");
            await expect(contract.connect(buyer).completeDispute()).to.not.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to call when state is Complete after the timeout", async () => {
            await fastForward(5);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.completeDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should revert if state is Complete, function is called by anyone but the buyer and the timeout hasn't passed", async () => {
            await fastForward(5);

            await expect(
                contract.connect(vendorDisputeSponsor).completeDispute()
            ).to.be.revertedWith("Timeout has not passed");
        });

        it("Should revert if state is not Complete or ChallengeBuyer, even if called by the buyer", async () => {
            await fastForward(3);

            await expect(
                contract.connect(buyer).completeDispute()
            ).to.be.revertedWith(
                "Not in a state where the dispute can be completed"
            );
        });
    });

    describe("cancelDispute", () => {
        it("Should not revert when vendor calls and state is Cancel", async () => {
            await fastForward(6);

            await expect(contract.connect(vendor).cancelDispute()).not.to.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should not revert when vendor calls and state is WaitVendorOpinion", async () => {
            await fastForward(1);

            await expect(contract.connect(vendor).cancelDispute()).not.to.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should not revert when vendor calls and state is WaitVendorData", async () => {
            await fastForward(2);

            await expect(contract.connect(vendor).cancelDispute()).not.to.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should not revert when vendor calls and state is WaitVendorDataLeft", async () => {
            await fastForward(3);

            await expect(contract.connect(vendor).cancelDispute()).not.to.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should not revert when vendor calls and state is WaitVendorDataRight", async () => {
            await fastForward(4);

            await expect(contract.connect(vendor).cancelDispute()).not.to.be
                .reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to cancel if in Cancel state and timeout has passed", async () => {
            await fastForward(6);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to cancel if in WaitVendorOpinion state and timeout has passed", async () => {
            await fastForward(1);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to cancel if in WaitVendorData state and timeout has passed", async () => {
            await fastForward(2);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to cancel if in WaitVendorDataLeft state and timeout has passed", async () => {
            await fastForward(3);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should allow anyone to cancel if in WaitVendorDataRight state and timeout has passed", async () => {
            await fastForward(4);

            await time.increase(timeoutIncrement + 5n);
            await expect(contract.cancelDispute()).not.to.be.reverted;
            expect(await contract.currState()).to.equal(7); // End
        });

        it("Should revert if in WaitVendorOpinion state, called by anyone but vendor and timeout hasn't passed", async () => {
            await fastForward(1);

            await expect(
                contract.connect(buyer).cancelDispute()
            ).to.be.revertedWith("Timeout has not passed");
        });

        it("Should revert if in WaitVendorData state, called by anyone but vendor and timeout hasn't passed", async () => {
            await fastForward(2);

            await expect(
                contract.connect(buyer).cancelDispute()
            ).to.be.revertedWith("Timeout has not passed");
        });

        it("Should revert if in WaitVendorDataLeft state, called by anyone but vendor and timeout hasn't passed", async () => {
            await fastForward(3);

            await expect(
                contract.connect(buyer).cancelDispute()
            ).to.be.revertedWith("Timeout has not passed");
        });

        it("Should revert if in WaitVendorDataRight state, called by anyone but vendor and timeout hasn't passed", async () => {
            await fastForward(4);

            await expect(
                contract.connect(buyer).cancelDispute()
            ).to.be.revertedWith("Timeout has not passed");
        });
    });
});
