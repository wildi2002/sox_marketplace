// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

library CommitmentOpener {
    /**
     * Opens a commitment by verifying the opening value.
     */
    function open(
        bytes32 _commitment,
        bytes calldata _openingValue
    ) external pure returns (bytes memory) {
        bytes32 hashed = keccak256(_openingValue);
        require(
            hashed == _commitment,
            "Commitment and opening value do not match"
        );

        return _openingValue[:(_openingValue.length - 16)];
    }
}
