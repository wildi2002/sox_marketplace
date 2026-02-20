// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

library MockAccumulatorVerifier {
    function verify(
        bytes32,
        uint32[] memory,
        bytes32[] memory,
        bytes32[][] memory _proof
    ) public pure returns (bool) {
        return _proof.length > 0;
    }

    function verifyExt(
        uint32,
        bytes32,
        bytes32,
        bytes32,
        bytes32[][] calldata _proof
    ) public pure returns (bool) {
        return _proof.length > 0;
    }
}
