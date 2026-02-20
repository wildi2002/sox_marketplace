// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

library MockCommitmentOpener {
    function open(
        bytes32,
        bytes calldata _openingValue
    ) external pure returns (bytes memory) {
        return _openingValue;
    }
}
