// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {AES128CtrEvaluator} from "../AES128CtrEvaluator.sol";

contract TestAES128Ctr {
    function encrypt(
        bytes16 plaintext,
        bytes16 key
    ) public pure returns (bytes16) {
        return AES128CtrEvaluator.encryptBlockInternal(plaintext, key);
    }

    function encryptBlock(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return AES128CtrEvaluator.encryptBlock(_data);
    }

    function decryptBlock(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return AES128CtrEvaluator.decryptBlock(_data);
    }
}
