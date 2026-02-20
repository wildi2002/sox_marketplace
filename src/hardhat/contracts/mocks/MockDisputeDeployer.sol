// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IOptimisticSOX} from "../OptimisticSOXAccount.sol";

library MockDisputeDeployer {
    function deployDispute(
        address,
        address,
        uint32,
        uint32,
        bytes32,
        address,
        address,
        address,
        address,
        address
    ) public view returns (address) {
        return address(this);
    }

    function endDispute(address optimistic) public {
        IOptimisticSOX(optimistic).endDispute();
    }
}
