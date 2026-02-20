import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployRealContracts } from "../deployers";

const { ethers } = hre;

const NB_RUNS = 100;

/*
·················································································································
|  Solidity and Network Configuration                                                                           │
····························|·················|················|················|································
|  Solidity: 0.8.28         ·  Optim: true    ·  Runs: 1000    ·  viaIR: true   ·     Block: 30,000,000 gas     │
····························|·················|················|················|································
|  Network: ETHEREUM        ·  L1: 10 gwei                     ·                ·        2607.12 usd/eth        │
····························|·················|················|················|················|···············
|  Contracts / Methods      ·  Min            ·  Max           ·  Avg           ·  # calls       ·  usd (avg)   │
····························|·················|················|················|················|···············
|  OptimisticSOX            ·                                                                                   │
····························|·················|················|················|················|···············
|      completeTransaction  ·              -  ·             -  ·        58,963  ·           100  ·        1.54  │
····························|·················|················|················|················|···············
|      sendKey              ·              -  ·             -  ·        59,013  ·           100  ·        1.54  │
····························|·················|················|················|················|···············
|      sendPayment          ·              -  ·             -  ·       101,564  ·           100  ·        2.65  │
····························|·················|················|················|················|···············
|  Deployments                                ·                                 ·  % of limit    ·              │
····························|·················|················|················|················|···············
|  AccumulatorVerifier      ·              -  ·             -  ·       540,226  ·         1.8 %  ·       14.08  │
····························|·················|················|················|················|···············
|  CircuitEvaluator         ·              -  ·             -  ·     1,489,876  ·           5 %  ·       38.84  │
····························|·················|················|················|················|···············
|  CommitmentOpener         ·              -  ·             -  ·       176,168  ·         0.6 %  ·        4.59  │
····························|·················|················|················|················|···············
|  DisputeDeployer          ·      2,256,470  ·     2,256,650  ·     2,256,639  ·         7.5 %  ·       58.83  │
····························|·················|················|················|················|···············
|  OptimisticSOX            ·      1,463,675  ·     1,463,687  ·     1,463,686  ·         4.9 %  ·       38.16  │
····························|·················|················|················|················|···············
|  Key                                                                                                          │
·················································································································
|  ◯  Execution gas for this method does not include intrinsic gas overhead                                     │
·················································································································
|  △  Cost was non-zero but below the precision setting for the currency display (see options)                  │
·················································································································
|  Toolchain:  hardhat                                                                                          │
·················································································································
*/

let buyer: HardhatEthersSigner;
let vendor: HardhatEthersSigner;
let sponsor: HardhatEthersSigner;

before(async function () {
    [buyer, vendor, sponsor] = await ethers.getSigners();
});

describe("OptimisticSOX", function () {
    it("End-to-end optimistic, no dispute", async function () {
        for (let i = 0; i < NB_RUNS; ++i) {
            const { contract, agreedPrice, completionTip, timeoutIncrement } =
                await deployRealContracts(sponsor, buyer, vendor);

            // buyer sends payment
            await contract
                .connect(buyer)
                .sendPayment({ value: agreedPrice + completionTip });

            // vendor sends key
            await contract.connect(vendor).sendKey(ethers.toUtf8Bytes("key"));

            // "wait" for timeout
            await time.increase(timeoutIncrement + 5n);

            // vendor asks to complete contract
            await contract.connect(vendor).completeTransaction();
        }
    });
});
