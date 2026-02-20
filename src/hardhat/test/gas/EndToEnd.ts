import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployRealContracts } from "../deployers";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values,
    compute_proofs,
    evaluate_circuit,
    hpre,
    initSync,
} from "../../../app/lib/crypto_lib";

const { ethers } = hre;

const NB_RUNS = 1;

/*
··························································································································
|  Solidity and Network Configuration                                                                                    │
·····································|·················|················|················|································
|  Solidity: 0.8.28                  ·  Optim: true    ·  Runs: 1000    ·  viaIR: true   ·     Block: 30,000,000 gas     │
·····································|·················|················|················|································
|  Network: ETHEREUM                 ·  L1: 6 gwei                      ·                ·        2620.35 usd/eth        │
·····································|·················|················|················|················|···············
|  Contracts / Methods               ·  Min            ·  Max           ·  Avg           ·  # calls       ·  usd (avg)   │
·····································|·················|················|················|················|···············
|  DisputeSOX                        ·                                                                                   │
·····································|·················|················|················|················|···············
|      giveOpinion                   ·         48,606  ·        53,132  ·        48,923  ·          1700  ·        0.77  │
·····································|·················|················|················|················|···············
|      respondChallenge              ·         60,680  ·        60,692  ·        60,690  ·          1700  ·        0.95  │
·····································|·················|················|················|················|···············
|      submitCommitment              ·              -  ·             -  ·       159,691  ·           100  ·        2.51  │
·····································|·················|················|················|················|···············
|  OptimisticSOX                     ·                                                                                   │
·····································|·················|················|················|················|···············
|      registerBuyerDisputeSponsor   ·              -  ·             -  ·        82,563  ·           100  ·        1.30  │
·····································|·················|················|················|················|···············
|      registerVendorDisputeSponsor  ·              -  ·             -  ·        83,135  ·           100  ·        1.31  │
·····································|·················|················|················|················|···············
|      sendBuyerDisputeSponsorFee    ·              -  ·             -  ·        58,434  ·           100  ·        0.92  │
·····································|·················|················|················|················|···············
|      sendKey                       ·              -  ·             -  ·        58,977  ·           100  ·        0.93  │
·····································|·················|················|················|················|···············
|      sendPayment                   ·              -  ·             -  ·       101,564  ·           100  ·        1.60  │
·····································|·················|················|················|················|···············
|      sendVendorDisputeSponsorFee   ·              -  ·             -  ·        58,390  ·           100  ·        0.92  │
·····································|·················|················|················|················|···············
|      startDispute                  ·              -  ·             -  ·     2,093,945  ·           100  ·       32.92  │
·····································|·················|················|················|················|···············
|  Deployments                                         ·                                 ·  % of limit    ·              │
·····································|·················|················|················|················|···············
|  AccumulatorVerifier               ·              -  ·             -  ·       540,226  ·         1.8 %  ·        8.49  │
·····································|·················|················|················|················|···············
|  CircuitEvaluator                  ·              -  ·             -  ·     1,489,876  ·           5 %  ·       23.42  │
·····································|·················|················|················|················|···············
|  CommitmentOpener                  ·              -  ·             -  ·       176,168  ·         0.6 %  ·        2.77  │
·····································|·················|················|················|················|···············
|  DisputeDeployer                   ·      2,256,542  ·     2,256,650  ·     2,256,641  ·         7.5 %  ·       35.48  │
·····································|·················|················|················|················|···············
|  OptimisticSOX                     ·      1,483,971  ·     1,483,983  ·     1,483,982  ·         4.9 %  ·       23.33  │
·····································|·················|················|················|················|···············
|  Key                                                                                                                   │
··························································································································
|  ◯  Execution gas for this method does not include intrinsic gas overhead                                              │
··························································································································
|  △  Cost was non-zero but below the precision setting for the currency display (see options)                           │
··························································································································
|  Toolchain:  hardhat                                                                                                   │
··························································································································
*/

let buyer: HardhatEthersSigner;
let vendor: HardhatEthersSigner;
let sponsor: HardhatEthersSigner;
let buyerDisputeSponsor: HardhatEthersSigner;
let vendorDisputeSponsor: HardhatEthersSigner;

before(async function () {
    [buyer, vendor, sponsor, buyerDisputeSponsor, vendorDisputeSponsor] =
        await ethers.getSigners();
});

describe("End-to-end", function () {
    it("End-to-end with 2^16 ct blocks", async function () {
        const modulePath = "../../../app/lib/crypto_lib/crypto_lib_bg.wasm";
        const module = await readFile(modulePath);
        initSync({ module: module });

        const fileBlocks = 1 << 16;
        const file = new Uint8Array(fileBlocks * 64);
        const key = new Uint8Array(16);

        const {
            ct,
            circuit_bytes,
            description,
            h_ct,
            h_circuit,
            commitment,
            num_blocks,
            num_gates,
        } = compute_precontract_values(file, key);

        const evaluated_bytes = evaluate_circuit(
            circuit_bytes,
            ct,
            [bytes_to_hex(key)],
            bytes_to_hex(description)
        ).to_bytes();

        for (let i = 0; i < NB_RUNS; ++i) {
            console.log(i);
            const {
                contract: optimisticContract,
                sponsorAmount,
                agreedPrice,
                completionTip,
                disputeTip,
                timeoutIncrement,
                disputeDeployer,
                accumulatorVerifier,
                circuitEvaluator,
                commitmentOpener,
            } = await deployRealContracts(
                sponsor,
                buyer,
                vendor,
                num_blocks,
                num_gates,
                commitment.c
            );

            // buyer sends payment
            await optimisticContract
                .connect(buyer)
                .sendPayment({ value: agreedPrice + completionTip });

            // vendor sends key
            await optimisticContract.connect(vendor).sendKey(key);

            // sb deposits dispute fees
            await optimisticContract
                .connect(buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFee({ value: 10n + disputeTip });

            // sv deposits dispute fees and starts the dispute
            await optimisticContract
                .connect(vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({ value: 10n + disputeTip });

            const disputeContractAddr =
                await optimisticContract.disputeContract();
            const disputeContract = await ethers.getContractAt(
                "DisputeSOX",
                disputeContractAddr
            );

            // do challenge-response until we get to state WaitVendorData
            // buyer responds to challenge
            let challenge = await disputeContract.chall();
            let hpre_res = hpre(evaluated_bytes, num_blocks, Number(challenge));
            await disputeContract.connect(buyer).respondChallenge(hpre_res);

            // vendor disagrees once
            await disputeContract.connect(vendor).giveOpinion(false);

            // continue doing the same but now vendor agrees
            let state = await disputeContract.currState();
            while (state == 0n) {
                // buyer responds to challenge
                challenge = await disputeContract.chall();
                hpre_res = hpre(evaluated_bytes, num_blocks, Number(challenge));
                await disputeContract.connect(buyer).respondChallenge(hpre_res);

                // vendor decides randomly if they agree or not
                await disputeContract.connect(vendor).giveOpinion(true);
                state = await disputeContract.currState();
            }

            // challenge-response is over, should be in state WaitVendorData
            if (state != 2n) throw new Error("unexpected state, should be 2");

            // vendor submits its commitment and the proofs
            const gateNum = await disputeContract.a();

            const {
                gate,
                values,
                curr_acc,
                proof1,
                proof2,
                proof3,
                proof_ext,
            } = compute_proofs(
                circuit_bytes,
                evaluated_bytes,
                ct,
                Number(gateNum)
            );

            await disputeContract
                .connect(vendor)
                .submitCommitment(
                    commitment.o,
                    gateNum,
                    gate,
                    values,
                    curr_acc,
                    proof1,
                    proof2,
                    proof3,
                    proof_ext
                );
        }
    });
});
