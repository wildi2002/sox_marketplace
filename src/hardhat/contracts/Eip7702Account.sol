// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/**
 */
interface IEntryPointV8 {
    function depositTo(address account) external payable;
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

library ECDSA {
    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "ECDSA: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        require(v == 27 || v == 28, "ECDSA: invalid signature 'v' value");
        require(
            uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0,
            "ECDSA: invalid signature 's' value"
        );

        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "ECDSA: invalid signature");

        return signer;
    }
}

contract Eip7702Account {
    using ECDSA for bytes32;

    IEntryPointV8 public immutable entryPoint;

    event EntryPointDeposit(address indexed from, uint256 amount);

    constructor(address _entryPoint) {
        require(_entryPoint != address(0), "EntryPoint required");
        entryPoint = IEntryPointV8(_entryPoint);
    }

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "Not from EntryPoint");
        _;
    }

    modifier onlyEntryPointOrSelf() {
        require(
            msg.sender == address(entryPoint) || msg.sender == address(this),
            "Not authorized"
        );
        _;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable onlyEntryPoint returns (uint256 validationData) {
        address signer = ECDSA.recover(
            userOpHash.toEthSignedMessageHash(),
            userOp.signature
        );
        require(signer == address(this), "Invalid signature");

        if (missingAccountFunds > 0) {
            entryPoint.depositTo{value: missingAccountFunds}(address(this));
            emit EntryPointDeposit(msg.sender, missingAccountFunds);
        }

        return 0;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrSelf {
        _call(target, value, data);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyEntryPointOrSelf {
        require(
            targets.length == values.length && targets.length == datas.length,
            "Mismatched batch lengths"
        );
        for (uint256 i = 0; i < targets.length; i++) {
            _call(targets[i], values[i], datas[i]);
        }
    }

    function getNonce() external view returns (uint256) {
        return entryPoint.getNonce(address(this), 0);
    }

    receive() external payable {}

    function _call(address target, uint256 value, bytes calldata data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, _getRevertMsg(result));
    }

    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "Call failed";
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }
}
