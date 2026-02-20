import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployRealContracts } from "../deployers";

const { ethers } = hre;

const NB_RUNS = 100;

/*
··························································································································
|  Solidity and Network Configuration                                                                                    │
·····································|·················|················|················|································
|  Solidity: 0.8.28                  ·  Optim: true    ·  Runs: 1000    ·  viaIR: true   ·     Block: 30,000,000 gas     │
·····································|·················|················|················|································
|  Network: ETHEREUM                 ·  L1: 10 gwei                     ·                ·        2606.44 usd/eth        │
·····································|·················|················|················|················|···············
|  Contracts / Methods               ·  Min            ·  Max           ·  Avg           ·  # calls       ·  usd (avg)   │
·····································|·················|················|················|················|···············
|  OptimisticSOX                     ·                                                                                   │
·····································|·················|················|················|················|···············
|      registerBuyerDisputeSponsor   ·              -  ·             -  ·        82,563  ·           100  ·        2.15  │
·····································|·················|················|················|················|···············
|      registerVendorDisputeSponsor  ·              -  ·             -  ·        83,135  ·           100  ·        2.17  │
·····································|·················|················|················|················|···············
|      sendBuyerDisputeSponsorFee    ·              -  ·             -  ·        58,434  ·           100  ·        1.52  │
·····································|·················|················|················|················|···············
|      sendKey                       ·              -  ·             -  ·        59,013  ·           100  ·        1.54  │
·····································|·················|················|················|················|···············
|      sendPayment                   ·              -  ·             -  ·       101,564  ·           100  ·        2.65  │
·····································|·················|················|················|················|···············
|      sendVendorDisputeSponsorFee   ·              -  ·             -  ·        58,390  ·           100  ·        1.52  │
·····································|·················|················|················|················|···············
|      startDispute                  ·              -  ·             -  ·     2,074,045  ·           100  ·       54.06  │
·····································|·················|················|················|················|···············
|  Deployments                                         ·                                 ·  % of limit    ·              │
·····································|·················|················|················|················|···············
|  AccumulatorVerifier               ·              -  ·             -  ·       540,226  ·         1.8 %  ·       14.08  │
·····································|·················|················|················|················|···············
|  CircuitEvaluator                  ·              -  ·             -  ·     1,489,876  ·           5 %  ·       38.83  │
·····································|·················|················|················|················|···············
|  CommitmentOpener                  ·              -  ·             -  ·       176,168  ·         0.6 %  ·        4.59  │
·····································|·················|················|················|················|···············
|  DisputeDeployer                   ·      2,256,566  ·     2,256,650  ·     2,256,643  ·         7.5 %  ·       58.82  │
·····································|·················|················|················|················|···············
|  OptimisticSOX                     ·      1,463,675  ·     1,463,687  ·     1,463,686  ·         4.9 %  ·       38.15  │
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

describe("OptimisticSOX", function () {
    it("End-to-end optimistic + dispute, only optimistic", async function () {
        for (let i = 0; i < NB_RUNS; ++i) {
            const {
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
            } = await deployRealContracts(sponsor, buyer, vendor);

            // buyer sends payment
            await contract
                .connect(buyer)
                .sendPayment({ value: agreedPrice + completionTip });

            // vendor sends key
            await contract.connect(vendor).sendKey(ethers.toUtf8Bytes("key"));

            // sb deposits dispute fees
            await contract
                .connect(buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFee({ value: 10n + disputeTip });

            // sv deposits dispute fees and starts the dispute
            await contract
                .connect(vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({ value: 10n + disputeTip });
        }
    });
});
