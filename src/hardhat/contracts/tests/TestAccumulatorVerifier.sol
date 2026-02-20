// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {AccumulatorVerifier} from "../AccumulatorSOX.sol";

contract TestAccumulatorVerifier {
    function verify(
        bytes32 root,
        uint32[] memory indices,
        bytes32[] memory valuesKeccak,
        bytes32[][] memory proof
    ) external pure returns (bool) {
        return AccumulatorVerifier.verify(root, indices, valuesKeccak, proof);
    }

    function verifyExt(
        uint32 i,
        bytes32 prevRoot,
        bytes32 currRoot,
        bytes32 addedValKeccak,
        bytes32[][] calldata proof
    ) external pure returns (bool) {
        return
            AccumulatorVerifier.verifyExt(
                i,
                prevRoot,
                currRoot,
                addedValKeccak,
                proof
            );
    }
}
