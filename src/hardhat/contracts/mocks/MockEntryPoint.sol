// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "../OptimisticSOXAccount.sol";

contract MockEntryPoint is IEntryPoint {
    mapping(address => uint256) public deposits;

    function depositTo(address account) external payable override {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external override {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        withdrawAddress.transfer(amount);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return deposits[account];
    }

    function callValidateUserOp(
        address accountAddress,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable returns (uint256) {
        return
            OptimisticSOXAccount(payable(accountAddress)).validateUserOp{
                value: msg.value
            }(userOp, userOpHash, missingAccountFunds);
    }
}
