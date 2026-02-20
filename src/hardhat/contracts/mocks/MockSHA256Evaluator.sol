// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library MockSHA256Evaluator {
    function sha256CompressionInstruction(
        bytes[] memory
    ) external pure returns (bytes memory) {
        return hex"00";
    }

    function sha256FinalCompressionInstruction(
        bytes[] memory
    ) external pure returns (bytes memory) {
        return hex"07";
    }
}
