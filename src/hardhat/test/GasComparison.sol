// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {SHA256Evaluator} from "../contracts/SHA256Evaluator.sol";

/**
 * @title GasComparison
 * @notice Test contract to compare gas costs between keccak256 and SHA256
 */
contract GasComparison {
    /**
     * @notice Hash a 64-byte value using keccak256
     * @param data The 64-byte data to hash
     * @return The keccak256 hash
     */
    function hashKeccak256(bytes calldata data) public pure returns (bytes32) {
        return keccak256(data);
    }

    /**
     * @notice Hash a 64-byte value using SHA256 compression (like sha256GateV2)
     * @param data The 64-byte data to hash
     * @return The SHA256 hash
     */
    function hashSHA256(bytes calldata data) public pure returns (bytes32) {
        require(data.length == 64, "Data must be exactly 64 bytes");
        bytes[] memory input = new bytes[](1);
        input[0] = data;
        bytes memory hash = SHA256Evaluator.sha256CompressionInstruction(input);
        require(hash.length == 32, "SHA256 output must be 32 bytes");
        bytes32 result;
        assembly {
            result := mload(add(hash, 32))
        }
        return result;
    }

    /**
     * @notice Compare gas costs for both hashing methods
     * @param data The 64-byte data to hash
     * @return keccakGas Gas used for keccak256
     * @return sha256Gas Gas used for SHA256
     * @return keccakHash The keccak256 hash result
     * @return sha256Hash The SHA256 hash result
     */
    function compareGasCosts(bytes calldata data) 
        public 
        returns (
            uint256 keccakGas,
            uint256 sha256Gas,
            bytes32 keccakHash,
            bytes32 sha256Hash
        ) 
    {
        // Measure keccak256
        uint256 gasBeforeKeccak = gasleft();
        keccakHash = keccak256(data);
        uint256 gasAfterKeccak = gasleft();
        keccakGas = gasBeforeKeccak - gasAfterKeccak;

        // Measure SHA256
        uint256 gasBeforeSHA256 = gasleft();
        sha256Hash = hashSHA256(data);
        uint256 gasAfterSHA256 = gasleft();
        sha256Gas = gasBeforeSHA256 - gasAfterSHA256;

        return (keccakGas, sha256Gas, keccakHash, sha256Hash);
    }

    /**
     * @notice Test multiple gates to get average gas costs
     * @param gates Array of 64-byte gates
     * @return avgKeccakGas Average gas for keccak256
     * @return avgSHA256Gas Average gas for SHA256
     * @return totalKeccakGas Total gas for all keccak256 operations
     * @return totalSHA256Gas Total gas for all SHA256 operations
     */
    function compareMultipleGates(bytes[] calldata gates)
        public
        returns (
            uint256 avgKeccakGas,
            uint256 avgSHA256Gas,
            uint256 totalKeccakGas,
            uint256 totalSHA256Gas
        )
    {
        require(gates.length > 0, "Must provide at least one gate");
        
        totalKeccakGas = 0;
        totalSHA256Gas = 0;

        for (uint256 i = 0; i < gates.length; i++) {
            require(gates[i].length == 64, "Each gate must be exactly 64 bytes");
            
            // Measure keccak256
            uint256 gasBeforeKeccak = gasleft();
            keccak256(gates[i]);
            uint256 gasAfterKeccak = gasleft();
            totalKeccakGas += (gasBeforeKeccak - gasAfterKeccak);

            // Measure SHA256
            uint256 gasBeforeSHA256 = gasleft();
            hashSHA256(gates[i]);
            uint256 gasAfterSHA256 = gasleft();
            totalSHA256Gas += (gasBeforeSHA256 - gasAfterSHA256);
        }

        avgKeccakGas = totalKeccakGas / gates.length;
        avgSHA256Gas = totalSHA256Gas / gates.length;

        return (avgKeccakGas, avgSHA256Gas, totalKeccakGas, totalSHA256Gas);
    }
}



















