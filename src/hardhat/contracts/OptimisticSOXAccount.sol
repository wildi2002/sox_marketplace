// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeDeployer} from "./DisputeDeployer.sol";

enum OptimisticState {
    WaitPayment,
    WaitKey,
    WaitSB,
    WaitSV,
    InDispute,
    End
}

interface IOptimisticSOX {
    function buyer() external view returns (address);
    function vendor() external view returns (address);
    function sponsor() external view returns (address);
    function buyerDisputeSponsor() external view returns (address);
    function vendorDisputeSponsor() external view returns (address);
    function key() external view returns (bytes16);
    function agreedPrice() external view returns (uint256);
    function timeoutIncrement() external view returns (uint256);
    function currState() external view returns (OptimisticState);
    function endDispute() external;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits; // verificationGasLimit (high 128) + callGasLimit (low 128)
    uint256 preVerificationGas;
    bytes32 gasFees; // maxPriorityFeePerGas (high 128) + maxFeePerGas (low 128)
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
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

contract OptimisticSOXAccount is IOptimisticSOX {
    using ECDSA for bytes32;

    // =============== ERC-4337 FIELDS ===============
    IEntryPoint public immutable entryPoint;
    address public vendorSigner;
    uint256 public nonce;
    address private lastValidatedSigner;
    uint256 private lastValidatedNonce;

    // =============== OPTIMISTIC PHASE FIELDS (from OptimisticSOX) ===============
    uint32 public constant circuitVersion = 1;
    
    uint256 constant SPONSOR_FEES = 5 wei; // dummy value
    uint256 constant DISPUTE_FEES = 10 wei; // dummy value

    // Addresses
    address public buyer;
    address public vendor;
    address public sponsor;
    address public buyerDisputeSponsor;
    address public vendorDisputeSponsor;
    address public disputeContract;

    OptimisticState public currState;
    bytes16 public key;
    uint256 public agreedPrice;
    uint256 public completionTip;
    uint256 public disputeTip;
    uint256 public timeoutIncrement;
    bytes32 public commitment;
    uint32 public numGates;
    uint32 public numBlocks;

    // Money states
    uint256 public sponsorDeposit;
    uint256 public buyerDeposit;
    uint256 public sbDeposit;
    uint256 public svDeposit;
    uint256 public sponsorTip;
    uint256 public sbTip;
    uint256 public svTip;
    uint256 public nextTimeoutTime;

    // =============== EVENTS ===============
    event VendorSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event EntryPointDeposit(address indexed from, uint256 amount);
    event EntryPointWithdrawal(address indexed to, uint256 amount);

    // =============== MODIFIERS ===============
    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "Not from EntryPoint");
        _;
    }

    modifier onlyVendor() {
        require(msg.sender == vendor, "Only vendor");
        _;
    }

    modifier onlyEntryPointOrVendor() {
        require(
            msg.sender == address(entryPoint) || msg.sender == vendorSigner,
            "Not authorized executor"
        );
        _;
    }

    modifier onlyExpected(address _sender, OptimisticState _state) {
        require(currState == _state, "Wrong state");
        
        // Accepter si appel direct depuis le sender attendu
        if (msg.sender == _sender) {
            _;
            return;
        }
        
        // Accepter si appel via execute (msg.sender == address(this)) et contexte UserOp valide
        if (msg.sender == address(this)) {
            bool isValid = _isValidUserOpContext(_sender);
            require(isValid, "Invalid UserOp context");
            _;
            return;
        }
        
        revert("Unexpected sender");
    }

    function _isValidUserOpContext(address expected) internal view returns (bool) {
        if (nonce == 0) {
            return false;
        }
        if (lastValidatedNonce != nonce - 1) {
            return false;
        }
        if (expected == vendor) {
            return lastValidatedSigner == vendorSigner || lastValidatedSigner == vendor;
        }
        if (expected == buyer) {
            return lastValidatedSigner == buyer;
        }
        return false;
    }

    function _stateToString(OptimisticState _state) internal pure returns (string memory) {
        if (_state == OptimisticState.WaitPayment) return "WaitPayment";
        if (_state == OptimisticState.WaitKey) return "WaitKey";
        if (_state == OptimisticState.WaitSB) return "WaitSB";
        if (_state == OptimisticState.WaitSV) return "WaitSV";
        if (_state == OptimisticState.InDispute) return "InDispute";
        if (_state == OptimisticState.End) return "End";
        return "Unknown";
    }

    function _addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint(uint8(value[i + 12] >> 4))];
            str[3+i*2] = alphabet[uint(uint8(value[i + 12] & 0x0f))];
        }
        return string(str);
    }

    function _uint256ToString(uint256 _value) internal pure returns (string memory) {
        if (_value == 0) {
            return "0";
        }
        uint256 temp = _value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (_value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_value % 10)));
            _value /= 10;
        }
        return string(buffer);
    }

    // =============== CONSTRUCTOR ===============
    constructor(
        address _entryPoint,
        address _vendor,
        address _buyer,
        uint256 _agreedPrice,
        uint256 _completionTip,
        uint256 _disputeTip,
        uint256 _timeoutIncrement,
        bytes32 _commitment,
        uint32 _numBlocks,
        uint32 _numGates,
        address _vendorSigner
    ) payable {
        require(msg.value >= SPONSOR_FEES, "Not enough money to cover fees");
        require(_entryPoint != address(0), "EntryPoint required");
        
        entryPoint = IEntryPoint(_entryPoint);
        vendorSigner = _vendorSigner == address(0) ? _vendor : _vendorSigner;
        
        sponsorDeposit = msg.value;
        sponsor = msg.sender;
        buyer = _buyer;
        vendor = _vendor;
        agreedPrice = _agreedPrice;
        completionTip = _completionTip;
        disputeTip = _disputeTip;
        timeoutIncrement = _timeoutIncrement;
        commitment = _commitment;
        numBlocks = _numBlocks;
        numGates = _numGates;
        
        nextState(OptimisticState.WaitPayment);
    }

    // =============== ERC-4337 FUNCTIONS ===============
    function setVendorSigner(address _newSigner) external onlyVendor {
        require(_newSigner != address(0), "Signer cannot be zero");
        emit VendorSignerUpdated(vendorSigner, _newSigner);
        vendorSigner = _newSigner;
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function depositToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit EntryPointDeposit(msg.sender, msg.value);
    }

    function withdrawFromEntryPoint(address payable _to, uint256 _amount) external onlyVendor {
        entryPoint.withdrawTo(_to, _amount);
        emit EntryPointWithdrawal(_to, _amount);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable onlyEntryPoint returns (uint256 validationData) {
        require(userOp.nonce == nonce, "Bad nonce");
        address signer = _validateSignature(userOpHash, userOp.signature);
        lastValidatedSigner = signer;
        lastValidatedNonce = userOp.nonce;

        nonce++;

        if (missingAccountFunds > 0) {
            entryPoint.depositTo{value: missingAccountFunds}(address(this));
            emit EntryPointDeposit(msg.sender, missingAccountFunds);
        }

        return 0;
    }

    function execute(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyEntryPointOrVendor {
        _call(_target, _value, _data);
        _clearUserOpContext();
    }

    function _clearUserOpContext() internal {
        // Nettoyer le contexte après l'exécution pour éviter la réutilisation
        // Le nonce a déjà été incrémenté dans validateUserOp
        lastValidatedSigner = address(0);
        lastValidatedNonce = 0;
    }

    function executeBatch(
        address[] calldata _targets,
        uint256[] calldata _values,
        bytes[] calldata _calldata
    ) external onlyEntryPointOrVendor {
        require(
            _targets.length == _values.length && _targets.length == _calldata.length,
            "Mismatched batch lengths"
        );

        for (uint256 i = 0; i < _targets.length; i++) {
            _call(_targets[i], _values[i], _calldata[i]);
        }
    }

    function supportsERC4337() external pure returns (bool) {
        return true;
    }

    receive() external payable {}

    // =============== OPTIMISTIC PHASE FUNCTIONS (from OptimisticSOX) ===============
    function sendPayment()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitPayment)
    {
        require(
            msg.value >= agreedPrice + completionTip,
            "Agreed price and completion tip is higher than deposit"
        );

        buyerDeposit = msg.value;
        sponsorTip = buyerDeposit - agreedPrice;

        nextState(OptimisticState.WaitKey);
    }

    function sendKey(
        bytes16 _key
    ) public onlyExpected(vendor, OptimisticState.WaitKey) {
        key = _key;
        nextState(OptimisticState.WaitSB);
    }

    function sendBuyerDisputeSponsorFee() public payable {
        require(
            currState == OptimisticState.WaitSB,
            "Cannot run this function in the current state"
        );

        require(
            msg.value >= DISPUTE_FEES + disputeTip,
            "Not enough money deposited to cover dispute fees + tip"
        );

        buyerDisputeSponsor = msg.sender;
        sbDeposit = msg.value;
        sbTip = msg.value - DISPUTE_FEES;
        nextState(OptimisticState.WaitSV);
    }

    function sendVendorDisputeSponsorFee() public payable {
        require(
            currState == OptimisticState.WaitSV,
            "Cannot run this function in the current state"
        );

        require(
            msg.value >= DISPUTE_FEES + disputeTip + agreedPrice,
            "Not enough money deposited to cover dispute fees + tip + agreedPrice"
        );

        // Définir vendorDisputeSponsor AVANT de déployer, et passer le sponsor
        // explicitement au constructeur pour éviter toute ambiguïté sur le storage.
        vendorDisputeSponsor = msg.sender;
        svDeposit = msg.value;
        svTip = msg.value - DISPUTE_FEES - agreedPrice;

        // Use DisputeDeployer library to deploy DisputeSOXAccount
        // This avoids including DisputeSOXAccount bytecode in OptimisticSOXAccount
        disputeContract = DisputeDeployer.deployDispute(
            address(entryPoint),  // _entryPoint (ERC-4337)
            address(this), // _optimisticContract
            numBlocks,
            numGates,
            commitment,
            buyer,  // _buyerSigner
            vendor,  // _vendorSigner
            buyerDisputeSponsor,  // _buyerDisputeSponsorSigner
            msg.sender,  // _vendorDisputeSponsor (sponsor explicite)
            msg.sender  // _vendorDisputeSponsorSigner (utiliser msg.sender directement au lieu de vendorDisputeSponsor)
        );

        nextState(OptimisticState.InDispute);
    }

    function endDispute()
        public
        onlyExpected(disputeContract, OptimisticState.InDispute)
    {
        nextState(OptimisticState.End);
    }

    function completeTransaction() public onlyExpected(buyer, OptimisticState.WaitSB) {
        payable(vendor).transfer(agreedPrice);
        
        // Withdraw any remaining EntryPoint deposit to the sponsor before transferring balance
        uint256 entryPointDeposit = entryPoint.balanceOf(address(this));
        if (entryPointDeposit > 0) {
            entryPoint.withdrawTo(payable(sponsor), entryPointDeposit);
        }
        
        payable(sponsor).transfer(address(this).balance);
        nextState(OptimisticState.End);
    }

    function cancelTransaction() public {
        require(timeoutHasPassed(), "Timeout has not passed");

        if (currState == OptimisticState.WaitPayment) {
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        } else if (currState == OptimisticState.WaitKey) {
            payable(buyer).transfer(agreedPrice);
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        } else if (currState == OptimisticState.WaitSV) {
            payable(buyerDisputeSponsor).transfer(sbDeposit + sbTip);
            payable(buyer).transfer(agreedPrice);
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        }

        revert("Not in a state in which the transaction can be cancelled");
    }

    function timeoutHasPassed() public view returns (bool) {
        return block.timestamp >= nextTimeoutTime;
    }

    // =============== INTERNAL FUNCTIONS ===============
    function nextState(OptimisticState _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }

    function _call(address _target, uint256 _value, bytes calldata _data) internal {
        (bool success, bytes memory result) = _target.call{value: _value}(_data);
        require(success, _getRevertMsg(result));
    }

    function _validateSignature(bytes32 userOpHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = ECDSA.recover(digest, signature);
        // Accepter vendorSigner, vendor (si différent), ou buyer comme signataires valides
        require(
            recovered == vendorSigner || recovered == vendor || recovered == buyer,
            "Invalid signature"
        );
        return recovered;
    }

    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "Call failed";
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }
}
