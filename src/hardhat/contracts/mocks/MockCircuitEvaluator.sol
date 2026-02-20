// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

struct Instruction {
    function(bytes[] memory) internal pure returns (bytes memory) f;
}

library MockCircuitEvaluator {
    function evaluateGate(
        uint32[] calldata,
        bytes[] memory,
        uint32 _version
    ) public pure returns (bytes memory) {
        return new bytes(_version);
    }
}
