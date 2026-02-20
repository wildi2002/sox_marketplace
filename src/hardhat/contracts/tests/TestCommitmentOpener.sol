// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {CommitmentOpener} from "../CommitmentSOX.sol";

contract TestCommitmentOpener {
    function open(
        bytes32 commitment,
        bytes calldata openingValue
    ) external pure returns (bytes memory) {
        return CommitmentOpener.open(commitment, openingValue);
    }
}
