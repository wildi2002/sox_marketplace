// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {EvaluatorSOX_V2} from "../EvaluatorSOX_V2.sol";

contract TestEvaluatorSOX_V2 {
    /**
     * Evaluates a V2 gate from son values.
     * @param sonValues Array of evaluated son values
     * @param aesKey The AES-128 key (16 bytes)
     * @return The result of the gate evaluation
     */
    function evaluateGateFromSons(
        bytes calldata gateBytes,
        bytes[] calldata sonValues,
        bytes16 aesKey
    ) external pure returns (bytes memory) {
        return EvaluatorSOX_V2.evaluateGateFromSons(gateBytes, sonValues, aesKey);
    }

    /**
     * Decodes a gate from 64 bytes.
     */
    function decodeGate(bytes calldata gateBytes)
        external
        pure
        returns (uint8 opcode, int64[] memory sons, bytes memory params)
    {
        return EvaluatorSOX_V2.decodeGate(gateBytes);
    }

    /**
     * Decodes a son index from 6 bytes.
     */
    function decodeSon(bytes6 data) external pure returns (int64) {
        return EvaluatorSOX_V2.decodeSon(data);
    }
}




