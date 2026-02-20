// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeSOXAccount} from "./DisputeSOXAccount.sol";

library DisputeDeployer {
    /**
     * Creates a new dispute contract instance.
     */
    function deployDispute(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) public returns (address) {
        return
            address(
                new DisputeSOXAccount{value: address(this).balance}(
                    _entryPoint,
                    _optimisticContract,
                    _numBlocks,
                    _numGates,
                    _commitment,
                    1,
                    _buyerSigner,
                    _vendorSigner,
                    _buyerDisputeSponsorSigner,
                    _vendorDisputeSponsor,
                    _vendorDisputeSponsorSigner
                )
            );
    }
}