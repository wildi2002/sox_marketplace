// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library MockAES128CtrEvaluator {
    function encryptBlock(bytes[] memory) external pure returns (bytes memory) {
        return hex"01";
    }

    function decryptBlock(bytes[] memory) external pure returns (bytes memory) {
        return hex"02";
    }
}
