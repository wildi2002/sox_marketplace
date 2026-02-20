// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {AES128CtrEvaluator} from "./AES128CtrEvaluator.sol";
import {SHA256Evaluator} from "./SHA256Evaluator.sol";

/**
 * Evaluates V2 circuit gates (64-byte format).
 * - 0x03: CONST (constant value)
 * - 0x04: XOR (bitwise XOR)
 * - 0x05: COMP (comparison, returns 1 if equal, 0 otherwise)
 */
library EvaluatorSOX_V2 {
    /**
     * @notice Decodes a son index from 6 bytes (big-endian signed i64).
     * @dev The 6 bytes represent a signed 48-bit integer in big-endian format.
     * @param data The 6-byte array containing the encoded son index.
     * @return The decoded son index as int64.
     */
    function decodeSon(bytes6 data) internal pure returns (int64) {
        // Convert bytes6 to uint48
        uint48 val48 = uint48(uint256(bytes32(data)) >> 208);
        // Sign extend from 48 bits to 64 bits
        if (val48 & 0x800000000000 != 0) {
            return int64(uint64(val48) | 0xFFFF000000000000);
        }
        return int64(uint64(val48));
    }

    /**
     * @notice Decodes a gate from 64 bytes.
     * @dev Extracts opcode, sons, and params from the encoded gate.
     * @param gateBytes The 64-byte encoded gate.
     * @return opcode The gate's opcode.
     * @return sons Array of son indices (can be negative for dummy gates).
     * @return params The gate's parameters.
     */
    function decodeGate(bytes calldata gateBytes)
        internal
        pure
        returns (uint8 opcode, int64[] memory sons, bytes memory params)
    {
        require(gateBytes.length == 64, "Gate must be exactly 64 bytes");

        opcode = uint8(gateBytes[0]);
        uint8 paramsLen = _paramsLength(opcode);
        uint256 arity = _inferArity(gateBytes, opcode, paramsLen);

        return _decodeGateWithArity(gateBytes, opcode, arity, paramsLen);
    }

    function decodeGate(bytes calldata gateBytes, uint256 expectedArity)
        internal
        pure
        returns (uint8 opcode, int64[] memory sons, bytes memory params)
    {
        require(gateBytes.length == 64, "Gate must be exactly 64 bytes");

        opcode = uint8(gateBytes[0]);
        uint8 paramsLen = _paramsLength(opcode);
        uint256 paramsStart = 1 + expectedArity * 6;
        require(paramsStart + paramsLen <= 64, "Params out of bounds");
        require(_paddingIsZero(gateBytes, paramsStart + paramsLen), "Non-zero padding");

        return _decodeGateWithArity(gateBytes, opcode, expectedArity, paramsLen);
    }

    function _decodeGateWithArity(
        bytes calldata gateBytes,
        uint8 opcode,
        uint256 arity,
        uint8 paramsLen
    ) private pure returns (uint8, int64[] memory sons, bytes memory params) {
        sons = new int64[](arity);
        for (uint256 i = 0; i < arity; i++) {
            bytes6 sonBytes;
            assembly {
                sonBytes := calldataload(add(gateBytes.offset, add(1, mul(i, 6))))
            }
            sons[i] = decodeSon(sonBytes);
        }

        uint256 paramsStart = 1 + arity * 6;
        params = new bytes(paramsLen);
        for (uint256 i = 0; i < paramsLen; i++) {
            params[i] = gateBytes[paramsStart + i];
        }

        return (opcode, sons, params);
    }

    function _paramsLength(uint8 opcode) private pure returns (uint8) {
        if (opcode == 0x01) {
            // AES-CTR: counter (16B) + length (2B)
            return 18;
        }
        if (opcode == 0x03) {
            // CONST: fixed 32B
            return 32;
        }
        if (opcode == 0x02 || opcode == 0x04 || opcode == 0x05) {
            // SHA2, XOR, COMP: no params
            return 0;
        }
        revert("Invalid opcode");
    }

    function _inferArity(bytes calldata gateBytes, uint8 opcode, uint8 paramsLen)
        private
        pure
        returns (uint256)
    {
        if (opcode == 0x01) {
            uint256 paramsEnd = 1 + 6 + paramsLen;
            require(paramsEnd <= 64, "Params out of bounds");
            require(_paddingIsZero(gateBytes, paramsEnd), "Non-zero padding");
            return 1;
        }

        uint256 maxArity = (64 - 1 - paramsLen) / 6;
        for (uint256 candidate = 0; candidate <= maxArity; candidate++) {
            uint256 paramsStart = 1 + candidate * 6;
            uint256 paramsEnd = paramsStart + paramsLen;
            if (!_paddingIsZero(gateBytes, paramsEnd)) {
                continue;
            }

            bool sonsOk = true;
            for (uint256 i = 0; i < candidate; i++) {
                if (!_chunkHasNonZero(gateBytes, 1 + i * 6, 6)) {
                    sonsOk = false;
                    break;
                }
            }
            if (sonsOk) {
                return candidate;
            }
        }
        revert("Unable to infer arity");
    }

    function _paddingIsZero(bytes calldata gateBytes, uint256 start)
        private
        pure
        returns (bool)
    {
        for (uint256 i = start; i < 64; i++) {
            if (gateBytes[i] != 0) {
                return false;
            }
        }
        return true;
    }

    function _chunkHasNonZero(bytes calldata gateBytes, uint256 offset, uint256 len)
        private
        pure
        returns (bool)
    {
        for (uint256 i = 0; i < len; i++) {
            if (gateBytes[offset + i] != 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Evaluates a V2 gate.
     * @dev Evaluates the gate using the provided input values and AES key.
     * @param gateBytes The 64-byte encoded gate.
     * @param inputValues Array of input values (for dummy gates and previous gates).
     * @param aesKey The AES-128 key (16 bytes) for AES-CTR gates.
     * @return The result of the gate evaluation.
     */
    function evaluateGate(
        bytes calldata gateBytes,
        bytes[] memory inputValues,
        bytes16 aesKey
    ) internal pure returns (bytes memory) {
        (uint8 opcode, int64[] memory sons, bytes memory params) = decodeGate(gateBytes);

        // Collect son values
        bytes[] memory sonValues = new bytes[](sons.length);
        for (uint256 i = 0; i < sons.length; i++) {
            int64 sonIdx = sons[i];
            if (sonIdx < 0) {
                // Dummy gate (input): g_{-1}, g_{-2}, ... -> inputValues[0], inputValues[1], ...
                // sonIdx = -1 means g_{-1} = inputValues[0]
                // sonIdx = -2 means g_{-2} = inputValues[1]
                uint256 inputIdx = uint256(uint64(-sonIdx - 1));
                require(inputIdx < inputValues.length, "Invalid dummy gate index");
                sonValues[i] = inputValues[inputIdx];
            } else {
                // Previous gate: g_1, g_2, ... (1-indexed)
                // The caller should provide inputValues structured as:
                // [inputValues[0..m-1] (dummy gates), gateValues[0..n-1] (real gates)]
                // So gate g_i (1-indexed) is at inputValues[m + i - 1]
                // For now, we assume inputValues contains all values in order
                uint256 gateIdx = uint256(uint64(sonIdx));
                require(gateIdx > 0, "Gate index must be positive");
                // Convert 1-indexed to 0-indexed: g_1 -> index 0, g_2 -> index 1, etc.
                uint256 arrayIdx = gateIdx - 1;
                require(arrayIdx < inputValues.length, "Gate index out of bounds");
                sonValues[i] = inputValues[arrayIdx];
            }
        }

        // Dispatch to opcode handler
        if (opcode == 0x01) {
            // AES-CTR
            return evalAESCTR(sonValues, params, aesKey);
        } else if (opcode == 0x02) {
            // SHA2
            return evalSHA2(sonValues);
        } else if (opcode == 0x03) {
            // CONST
            return evalCONST(sonValues, params);
        } else if (opcode == 0x04) {
            // XOR
            return evalXOR(sonValues);
        } else if (opcode == 0x05) {
            // COMP
            return evalCOMP(sonValues);
        } else {
            revert("Invalid opcode");
        }
    }

    /**
     * @notice Evaluates a V2 gate directly from son values.
     * @dev Uses pre-evaluated sons (e.g. from get_evaluated_sons).
     * @param gateBytes The 64-byte encoded gate.
     * @param sonValues Array of evaluated son values.
     * @param aesKey The AES-128 key (16 bytes) for AES-CTR gates.
     * @return The result of the gate evaluation.
     */
    function evaluateGateFromSons(
        bytes calldata gateBytes,
        bytes[] memory sonValues,
        bytes16 aesKey
    ) internal pure returns (bytes memory) {
        (uint8 opcode, , bytes memory params) = decodeGate(
            gateBytes,
            sonValues.length
        );

        if (opcode == 0x01) {
            return evalAESCTR(sonValues, params, aesKey);
        } else if (opcode == 0x02) {
            return evalSHA2(sonValues);
        } else if (opcode == 0x03) {
            return evalCONST(sonValues, params);
        } else if (opcode == 0x04) {
            return evalXOR(sonValues);
        } else if (opcode == 0x05) {
            return evalCOMP(sonValues);
        }
        revert("Invalid opcode");
    }

    /**
     * @notice Evaluates an AES-CTR gate.
     * @dev Decrypts a ciphertext block using AES-128-CTR mode.
     * @param sons Array containing the ciphertext block (will be normalized to 64 bytes).
     * @param params Counter (16 bytes) + length in bits (2 bytes, big-endian).
     * @param aesKey The AES-128 key.
     * @return The decrypted plaintext block (64 bytes).
     */
    function evalAESCTR(
        bytes[] memory sons,
        bytes memory params,
        bytes16 aesKey
    ) internal pure returns (bytes memory) {
        require(sons.length == 1, "AES-CTR requires 1 son");
        require(sons[0].length >= 32, "AES-CTR son must have at least 32 bytes");
        require(params.length >= 18, "AES-CTR params must be at least 18 bytes");
        require(aesKey.length == 16, "AES key must be 16 bytes");
        
        // Normalize to 64 bytes
        bytes memory ciphertext = new bytes(64);
        uint256 copyLen = sons[0].length < 64 ? sons[0].length : 64;
        for (uint256 i = 0; i < copyLen; i++) {
            ciphertext[i] = sons[0][i];
        }
        // Remaining bytes are already zero

        bytes16 counter;
        assembly {
            counter := mload(add(params, 32))
        }
        uint16 lengthBits = uint16(uint8(params[16])) << 8 | uint16(uint8(params[17]));

        // AES-CTR decrypts by encrypting the counter and XORing with ciphertext
        bytes memory plaintext = new bytes(64);

        // Process in 16-byte blocks
        uint256 numBlocks = (lengthBits + 127) / 128; // Ceiling division
        if (numBlocks == 0) numBlocks = 1;

        bytes16 currentCounter = counter;
        for (uint256 i = 0; i < numBlocks && i * 16 < 64; i++) {
            bytes16 keystream = AES128CtrEvaluator.encryptBlockInternal(
                currentCounter,
                aesKey
            );

            for (uint256 j = 0; j < 16 && i * 16 + j < 64; j++) {
                plaintext[i * 16 + j] = bytes1(
                    uint8(ciphertext[i * 16 + j]) ^ uint8(keystream[j])
                );
            }

            currentCounter = AES128CtrEvaluator.incrementCounter(currentCounter);
        }

        if (lengthBits < 512) {
            uint256 fullBytes = lengthBits / 8;
            uint256 remBits = lengthBits % 8;
            if (fullBytes < 64) {
                // Zero bytes beyond the valid length to match Rust evaluator behavior.
                if (remBits > 0) {
                    uint8 mask = uint8(uint256(0xFF) << (8 - remBits));
                    plaintext[fullBytes] = bytes1(
                        uint8(plaintext[fullBytes]) & mask
                    );
                    for (uint256 i = fullBytes + 1; i < 64; i++) {
                        plaintext[i] = 0x00;
                    }
                } else {
                    for (uint256 i = fullBytes; i < 64; i++) {
                        plaintext[i] = 0x00;
                    }
                }
            }
        }

        return plaintext;
    }

    /**
     * @notice Evaluates a SHA2 gate.
     * @dev Performs SHA-256 compression.
     * @param sons Array containing previous hash (32 bytes, optional) and block (64 bytes).
     * @return The SHA-256 hash (32 bytes).
     */
    function evalSHA2(bytes[] memory sons) internal pure returns (bytes memory) {
        require(sons.length >= 1 && sons.length <= 2, "SHA2 requires 1 or 2 sons");
        require(sons[sons.length - 1].length == 64, "SHA2 block must be 64 bytes");

        if (sons.length == 2) {
            require(sons[0].length == 32, "SHA2 previous hash must be 32 bytes");
            bytes[] memory shaInput = new bytes[](2);
            shaInput[0] = sons[0];
            shaInput[1] = sons[1];
            return SHA256Evaluator.sha256CompressionInstruction(shaInput);
        } else {
            bytes[] memory shaInput = new bytes[](1);
            shaInput[0] = sons[0];
            return SHA256Evaluator.sha256CompressionInstruction(shaInput);
        }
    }

    /**
     * @notice Evaluates a CONST gate.
     * @dev Returns a constant value (32 bytes) padded to 64 bytes.
     *      If 1 son is provided, output is sons[0][0..32] || params[0..32].
     * @param sons Array (0 or 1 sons).
     * @param params The constant value (32 bytes).
     * @return The constant value padded to 64 bytes.
     */
    function evalCONST(
        bytes[] memory sons,
        bytes memory params
    ) internal pure returns (bytes memory) {
        require(params.length == 32, "CONST params must be 32 bytes");

        bytes memory result = new bytes(64);
        if (sons.length == 0) {
            // CONST arity 0: params (32B) || zeros (32B)
            for (uint256 i = 0; i < 32; i++) {
                result[i] = params[i];
            }
            return result;
        }
        if (sons.length == 1) {
            // CONST arity 1: sons[0][0..32] || params (32B)
            require(sons[0].length >= 32, "CONST son 0 must be at least 32 bytes");
            for (uint256 i = 0; i < 32; i++) {
                result[i] = sons[0][i];
                result[32 + i] = params[i];
            }
            return result;
        }
        revert("CONST expects 0 or 1 sons");
    }

    /**
     * @notice Evaluates an XOR gate.
     * @dev Performs bitwise XOR on two inputs, returns the maximum size.
     *      XORs up to the minimum length, then copies remaining bytes from the longer input.
     * @param sons Array containing two inputs (must have at least 32 bytes each).
     * @return The XOR result (maximum size of the two inputs).
     */
    function evalXOR(bytes[] memory sons) internal pure returns (bytes memory) {
        require(sons.length == 2, "XOR requires 2 sons");
        require(sons[0].length >= 32, "XOR son 0 must have at least 32 bytes");
        require(sons[1].length >= 32, "XOR son 1 must have at least 32 bytes");

        // Return the maximum size of both inputs
        uint256 maxLen = sons[0].length > sons[1].length ? sons[0].length : sons[1].length;
        uint256 minLen = sons[0].length < sons[1].length ? sons[0].length : sons[1].length;
        
        bytes memory result = new bytes(maxLen);
        
        // XOR up to the minimum length
        for (uint256 i = 0; i < minLen; i++) {
            result[i] = bytes1(uint8(sons[0][i]) ^ uint8(sons[1][i]));
        }
        
        // Copy remaining bytes from the longer input
        if (sons[0].length > sons[1].length) {
            for (uint256 i = minLen; i < maxLen; i++) {
                result[i] = sons[0][i];
            }
        } else if (sons[1].length > sons[0].length) {
            for (uint256 i = minLen; i < maxLen; i++) {
                result[i] = sons[1][i];
            }
        }
        
        return result;
    }

    /**
     * @notice Evaluates a COMP gate.
     * @dev Compares the first 32 bytes of two inputs, returns 1 if equal, 0 otherwise.
     *      This is safe because SHA2 outputs are 32 bytes and CONST outputs have 32 bytes of data.
     * @param sons Array containing two inputs (must have at least 32 bytes each).
     * @return 1 (as 64 bytes) if equal, 0 (as 64 bytes) otherwise.
     */
    function evalCOMP(bytes[] memory sons) internal pure returns (bytes memory) {
        require(sons.length == 2, "COMP requires 2 sons");
        require(sons[0].length >= 32, "COMP son 0 must have at least 32 bytes");
        require(sons[1].length >= 32, "COMP son 1 must have at least 32 bytes");

        bool equal = true;
        // Compare only the first 32 bytes (the actual data)
        for (uint256 i = 0; i < 32; i++) {
            if (sons[0][i] != sons[1][i]) {
                equal = false;
                break;
            }
        }

        bytes memory result = new bytes(64);
        if (equal) {
            result[0] = bytes1(0x01); // Return 1 if equal
        }
        // Otherwise result is all zeros (0)
        return result;
    }
}
