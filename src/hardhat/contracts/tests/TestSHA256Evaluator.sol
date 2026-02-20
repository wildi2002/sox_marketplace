// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../SHA256Evaluator.sol";

contract TestSHA256Evaluator {
    function compress(
        bytes[] memory data
    ) external pure returns (bytes memory) {
        return SHA256Evaluator.sha256CompressionInstruction(data);
    }

    function compressFinal(
        bytes[] memory data
    ) external pure returns (bytes memory) {
        return SHA256Evaluator.sha256FinalCompressionInstruction(data);
    }
}
