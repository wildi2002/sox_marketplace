// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {SHA256Evaluator} from "../contracts/SHA256Evaluator.sol";

contract TestGateHash {
    /**
     * Hashes a V2 gate using SHA256 compression.
     */
    function sha256GateV2(bytes calldata gateBytes) public pure returns (bytes32) {
        require(gateBytes.length == 64, "Gate must be exactly 64 bytes");
        bytes[] memory input = new bytes[](1);
        input[0] = gateBytes;
        bytes memory hash = SHA256Evaluator.sha256CompressionInstruction(input);
        require(hash.length == 32, "SHA256 output must be 32 bytes");
        bytes32 result;
        assembly {
            result := mload(add(hash, 32))
        }
        return result;
    }
}
