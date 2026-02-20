// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "../SimpleOperationsEvaluator.sol";

contract TestSimpleOperationsEvaluator {
    using SimpleOperationsEvaluator for bytes[];

    function testEqual(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return SimpleOperationsEvaluator.equal(_data);
    }

    function testBinAdd(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return SimpleOperationsEvaluator.binAdd(_data);
    }

    function testBinMult(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return SimpleOperationsEvaluator.binMult(_data);
    }

    function testConcat(
        bytes[] memory _data
    ) public pure returns (bytes memory) {
        return SimpleOperationsEvaluator.concat(_data);
    }
}
