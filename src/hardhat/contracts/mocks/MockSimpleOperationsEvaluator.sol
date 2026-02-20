// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library MockSimpleOperationsEvaluator {
    function binAdd(bytes[] memory) external pure returns (bytes memory) {
        return hex"03";
    }

    function binMult(bytes[] memory) external pure returns (bytes memory) {
        return hex"04";
    }

    function equal(bytes[] memory) external pure returns (bytes memory) {
        return hex"05";
    }

    function concat(bytes[] memory) external pure returns (bytes memory) {
        return hex"06";
    }
}
