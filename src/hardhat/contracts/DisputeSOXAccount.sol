// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {AccumulatorVerifier} from "./AccumulatorSOX.sol";
import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";
import {CommitmentOpener} from "./CommitmentSOX.sol";
import {OptimisticState, IOptimisticSOX} from "./OptimisticSOXAccount.sol";


struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;  // Packed: verificationGasLimit (high 128) + callGasLimit (low 128)
    uint256 preVerificationGas;
    bytes32 gasFees;  // Packed: maxPriorityFeePerGas (high 128) + maxFeePerGas (low 128)
    bytes paymasterAndData;
    bytes signature;
}

/**
 * @dev Minimal EntryPoint surface needed by this contract.
 */
interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @dev Lightweight ECDSA helper (adapted from OpenZeppelin) to validate signatures.
 */
library ECDSA {
    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (v != 27 && v != 28) revert InvalidSignatureV();
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) revert InvalidSignatureS();

        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();

        return signer;
    }
}

// Custom errors (more gas efficient than require with strings)
error EntryPointRequired();
error UnsupportedCircuitVersion();
error InvalidNumGates();
error InvalidOptimisticState();
error InsufficientFunds();
error InvalidSignatureLength();
error InvalidSignatureV();
error InvalidSignatureS();
error InvalidSignature();
error NotFromEntryPoint();
error NotAuthorizedRole();
error NotAuthorizedExecutor();
error UnexpectedSender();
error InvalidState();
error SignerCannotBeZero();
error OnlyBuyer();
error OnlyVendor();
error OnlyBuyerDisputeSponsor();
error OnlyVendorDisputeSponsor();
error InvalidRole();
error BadNonce();
error MismatchedBatchLengths();
error InvalidGateBytes();
error InvalidV2SonIndex();
error TransactionReverted();

contract DisputeSOXAccount {
    using ECDSA for bytes32;

    // =============== ERC-4337 FIELDS ===============
    IEntryPoint public immutable entryPoint;
    
    // Mapping of authorized signers for each role
    address public buyerSigner;
    address public vendorSigner;
    address public buyerDisputeSponsorSigner;
    address public vendorDisputeSponsorSigner;
    
    enum Role {
        None,
        Buyer,
        Vendor,
        BuyerDisputeSponsor,
        VendorDisputeSponsor
    }

    Role private lastValidatedRole;
    uint256 private lastValidatedNonce;

    uint256 public nonce;

    // =============== DISPUTE FIELDS (from DisputeSOX) ===============
    /**
     * @dev Optimistic smart contract corresponding to this exchange
     */
    IOptimisticSOX public optimisticContract;

    /**
     * @dev Enum representing the different states of the dispute resolution process
     */
    enum State {
        ChallengeBuyer,
        WaitVendorOpinion,
        WaitVendorData,
        WaitVendorDataLeft,
        WaitVendorDataRight,
        Complete,
        Cancel,
        End
    }

    /**
     * @dev The current state of the dispute resolution process
     */
    State public currState;

    /**
     * @dev The address of the buyer
     */
    address public buyer;

    /**
     * @dev The address of the vendor
     */
    address public vendor;

    /**
     * @dev The address of the buyer's dispute sponsor
     */
    address public buyerDisputeSponsor;

    /**
     * @dev The address of the vendor's dispute sponsor
     */
    address public vendorDisputeSponsor;

    /**
     * @dev The number of blocks of the ciphertext (m in the paper)
     */
    uint32 public numBlocks;

    /**
     * @dev The number of gates in the circuit (n in the paper)
     */
    uint32 public numGates;

    /**
     * @dev The commitment value
     */
    bytes32 public commitment;

    /**
     * @dev The circuit version (always V2 = 1 for this contract)
     */
    uint32 public constant circuitVersion = 1;

    /**
     * @dev The first value used for the challenge
     */
    uint32 public a;

    /**
     * @dev The second value used for the challenge
     */
    uint32 public b;

    /**
     * @dev The challenge index (i in the paper)
     */
    uint32 public chall;

    /**
     * @dev Mapping of buyer responses
     */
    mapping(uint32 => bytes32) public buyerResponses;

    /**
     * @dev The next timeout value for the dispute resolution process
     */
    uint256 public nextTimeoutTime;

    /**
     * @dev The value after which an operation is considered as timed out
     */
    uint256 public timeoutIncrement;

    /**
     * @dev The price agreed by the vendor and the buyer for the asset
     */
    uint256 public agreedPrice;

    /**
     * @dev Number of times Step 9 has been reached (for optimization)
     */
    uint256 public step9Count;

    /**
     * @dev The losing party from the last Step 9 (true = vendor lost, false = buyer lost)
     */
    bool public lastLosingPartyWasVendor;

    // =============== HELPER STRUCTS (from DisputeSOXHelpers) ===============
    struct Step9State {
        uint256 step9Count;
        bool lastLosingPartyWasVendor;
        address buyer;
        address vendor;
        address buyerDisputeSponsor;
        address vendorDisputeSponsor;
        uint32 numBlocks;
        uint32 numGates;
    }

    struct Step9Result {
        uint256 newStep9Count;
        bool newLastLosingPartyWasVendor;
        address newBuyer;
        address newVendor;
        bool shouldContinue;
        bool vendorLost; // true = Cancel, false = Complete
        uint32 a;
        uint32 b;
        uint32 chall;
    }

    // =============== EVENTS ===============
    event SignerUpdated(string indexed role, address indexed previousSigner, address indexed newSigner);
    event EntryPointDeposit(address indexed from, uint256 amount);
    event EntryPointWithdrawal(address indexed to, uint256 amount);

    // =============== MODIFIERS ===============
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert NotFromEntryPoint();
        _;
    }

    modifier onlyAuthorizedRole() {
        if (msg.sender != buyer && msg.sender != vendor && msg.sender != buyerDisputeSponsor && msg.sender != vendorDisputeSponsor) {
            revert NotAuthorizedRole();
        }
        _;
    }

    modifier onlyEntryPointOrAuthorized() {
        if (msg.sender != address(entryPoint) && msg.sender != buyerSigner && msg.sender != vendorSigner && msg.sender != buyerDisputeSponsorSigner && msg.sender != vendorDisputeSponsorSigner) {
            revert NotAuthorizedExecutor();
        }
        _;
    }

    modifier onlyExpected(address _sender, State _state) {
        if (!_isExpectedSender(_sender)) revert UnexpectedSender();
        if (currState != _state) revert InvalidState();
        _;
    }

    function _activeUserOpRole() internal view returns (Role) {
        if (nonce == 0 || lastValidatedNonce != nonce - 1) return Role.None;
        return lastValidatedRole;
    }

    function _roleForExpected(address expected) internal view returns (Role) {
        if (expected == buyer) return Role.Buyer;
        if (expected == vendor) return Role.Vendor;
        if (expected == buyerDisputeSponsor) return Role.BuyerDisputeSponsor;
        if (expected == vendorDisputeSponsor) return Role.VendorDisputeSponsor;
        return Role.None;
    }

    function _isExpectedSender(address expected) internal view returns (bool) {
        if (msg.sender == expected) return true;
        if (msg.sender != address(this)) return false;
        Role role = _roleForExpected(expected);
        return role != Role.None && _activeUserOpRole() == role;
    }

    function _isBuyer() internal view returns (bool) {
        return _isExpectedSender(buyer);
    }

    function _isVendor() internal view returns (bool) {
        return _isExpectedSender(vendor);
    }

    // =============== CONSTRUCTOR ===============
    constructor(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        uint32 _circuitVersion,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) payable {
        if (_entryPoint == address(0)) revert EntryPointRequired();
        if (_circuitVersion != 1) revert UnsupportedCircuitVersion();
        if (_numGates == 0) revert InvalidNumGates();
        
        entryPoint = IEntryPoint(_entryPoint);
        
        optimisticContract = IOptimisticSOX(_optimisticContract);
        if (optimisticContract.currState() != OptimisticState.WaitSV) revert InvalidOptimisticState();
        if (msg.value < optimisticContract.agreedPrice()) revert InsufficientFunds();

        buyer = optimisticContract.buyer();
        vendor = optimisticContract.vendor();
        buyerDisputeSponsor = optimisticContract.buyerDisputeSponsor();
        timeoutIncrement = optimisticContract.timeoutIncrement();
        agreedPrice = optimisticContract.agreedPrice();

        if (buyerDisputeSponsor == address(0)) {
            revert InvalidOptimisticState();
        }
        
        if (_vendorDisputeSponsor != address(0)) {
            vendorDisputeSponsor = _vendorDisputeSponsor;
        } else if (_vendorDisputeSponsorSigner != address(0)) {
            vendorDisputeSponsor = _vendorDisputeSponsorSigner;
        } else {
            vendorDisputeSponsor = optimisticContract.vendorDisputeSponsor();
        }

        if (vendorDisputeSponsor == address(0)) {
            revert InvalidOptimisticState(); // vendorDisputeSponsor must be set or passed as parameter
        }

        numBlocks = _numBlocks;
        numGates = _numGates;
        commitment = _commitment;

        // V2: challenge over gate indices (1-indexed, matching paper notation)
        // Paper: a = 1, b = n+1
        a = 1;
        b = _numGates + 1;
        chall = (a + b) / 2; // integer division
        
        // Initialize signers (default to role addresses if signer not specified)
        buyerSigner = _buyerSigner != address(0) ? _buyerSigner : buyer;
        vendorSigner = _vendorSigner != address(0) ? _vendorSigner : vendor;
        buyerDisputeSponsorSigner = _buyerDisputeSponsorSigner != address(0) ? _buyerDisputeSponsorSigner : buyerDisputeSponsor;
        vendorDisputeSponsorSigner = _vendorDisputeSponsorSigner != address(0) ? _vendorDisputeSponsorSigner : vendorDisputeSponsor;
        
        nextState(State.ChallengeBuyer);
    }

    // =============== ERC-4337 FUNCTIONS ===============
    /**
     * @notice Update the signing key for a specific role.
     */
    function setSigner(string memory role, address _newSigner) external {
        if (_newSigner == address(0)) revert SignerCannotBeZero();
        
        if (keccak256(bytes(role)) == keccak256(bytes("buyer"))) {
            if (msg.sender != buyer) revert OnlyBuyer();
            emit SignerUpdated(role, buyerSigner, _newSigner);
            buyerSigner = _newSigner;
        } else if (keccak256(bytes(role)) == keccak256(bytes("vendor"))) {
            if (msg.sender != vendor) revert OnlyVendor();
            emit SignerUpdated(role, vendorSigner, _newSigner);
            vendorSigner = _newSigner;
        } else if (keccak256(bytes(role)) == keccak256(bytes("buyerDisputeSponsor"))) {
            if (msg.sender != buyerDisputeSponsor) revert OnlyBuyerDisputeSponsor();
            emit SignerUpdated(role, buyerDisputeSponsorSigner, _newSigner);
            buyerDisputeSponsorSigner = _newSigner;
        } else if (keccak256(bytes(role)) == keccak256(bytes("vendorDisputeSponsor"))) {
            if (msg.sender != vendorDisputeSponsor) revert OnlyVendorDisputeSponsor();
            emit SignerUpdated(role, vendorDisputeSponsorSigner, _newSigner);
            vendorDisputeSponsorSigner = _newSigner;
        } else {
            revert InvalidRole();
        }
    }

    /**
     * @notice Returns the current EntryPoint deposit used to pay gas for sponsored operations.
     */
    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * @notice Adds funds to the EntryPoint deposit so the account can pay for UserOps.
     * Can be called by any sponsor or the buyer/vendor.
     */
    function depositToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit EntryPointDeposit(msg.sender, msg.value);
    }

    /**
     * @notice Authorized roles can withdraw unused deposit from the EntryPoint.
     */
    function withdrawFromEntryPoint(address payable _to, uint256 _amount) external onlyAuthorizedRole {
        entryPoint.withdrawTo(_to, _amount);
        emit EntryPointWithdrawal(_to, _amount);
    }

    /**
     * @notice ERC-4337 entry point callback to validate a user operation.
     * @dev Verifies the signature based on the role, bumps the nonce, and tops up the EntryPoint if required.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable onlyEntryPoint returns (uint256 validationData) {
        if (userOp.nonce != nonce) revert BadNonce();
        Role role = _validateSignature(userOpHash, userOp.signature);
        lastValidatedRole = role;
        lastValidatedNonce = userOp.nonce;

        nonce++;

        if (missingAccountFunds > 0) {
            entryPoint.depositTo{value: missingAccountFunds}(address(this));
            emit EntryPointDeposit(msg.sender, missingAccountFunds);
        }

        // 0 signals signature validity and no time-range restriction
        return 0;
    }

    /**
     * @notice Execute a single call with gas sponsored by this smart account.
     */
    function execute(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyEntryPointOrAuthorized {
        _call(_target, _value, _data);
        _clearUserOpContext();
    }

    /**
     * @notice Convenience batch executor for multiple calls in a single user operation.
     */
    function executeBatch(
        address[] calldata _targets,
        uint256[] calldata _values,
        bytes[] calldata _calldata
    ) external onlyEntryPointOrAuthorized {
        if (_targets.length != _values.length || _targets.length != _calldata.length) {
            revert MismatchedBatchLengths();
        }

        for (uint256 i = 0; i < _targets.length; i++) {
            _call(_targets[i], _values[i], _calldata[i]);
        }
        _clearUserOpContext();
    }

    /**
     * @notice Signal that the contract supports ERC-4337 style account abstraction flows.
     */
    function supportsERC4337() external pure returns (bool) {
        return true;
    }

    /**
     * @dev Accept plain ETH transfers (e.g. refunds, deposits).
     */
    receive() external payable {}

    // =============== DISPUTE FUNCTIONS (from DisputeSOX) ===============
    /**
     * @notice Send a response to the challenge
     * @dev Allows the buyer to respond to the challenge
     * @param _response The buyer's response to the challenge
     */
    function respondChallenge(
        bytes32 _response
    ) public onlyExpected(buyer, State.ChallengeBuyer) {
        buyerResponses[chall] = _response;
        nextState(State.WaitVendorOpinion);
    }

    /**
     * @notice Provide an opinion on the buyer's latest response which can be
     *      retrieved with `getLatestBuyerResponse()`
     * @dev This function allows the vendor to agree or disagree with the
     *      buyer's response
     * @param _vendorAgrees True if the vendor agrees with the buyer's latest
     *      response
     */
    function giveOpinion(
        bool _vendorAgrees
    ) public onlyExpected(vendor, State.WaitVendorOpinion) {
        if (_vendorAgrees) {
            a = chall + 1;
        } else {
            b = chall;
        }

        if (a != b) {
            chall = (a + b) / 2;
            return nextState(State.ChallengeBuyer);
        }

        chall = a;
        if (chall == 1) {
            return nextState(State.WaitVendorDataLeft); // Step 8b in paper (i = 1)
        } else if (chall == numGates + 1) {
            return nextState(State.WaitVendorDataRight); // Step 8c in paper (i = n+1)
        } else if (chall <= numGates) {
            return nextState(State.WaitVendorData); // Step 8a in paper (1 < i <= n)
        }

        revert();
    }

    /**
     * @notice Submit the data necessary for verification in the case where
     *      m < i < n (8a)
     * @dev This function allows the vendor to submit a commitment along with
     *      necessary data for evaluation and proof verification (V2 only)
     * @param _openingValue The opening value related to the contract's commitment
     * @param _gateNum The number of the gate being evaluated
     * @param _gateBytes The gate encoded as 64 bytes (V2 format: opcode + sons + params)
     * @param _values The gate's sons' values. E.g _values[i] = evaluate(s_i)
     * @param _currAcc The current accumulator value (w_i)
     * @param _proof1 The proof pi_1
     * @param _proof2 The proof pi_2
     * @param _proof3 The proof pi_3
     * @param _proofExt The proof rho
     */
    function submitCommitment(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes, // V2 format: 64-byte encoded gate
        bytes[] calldata _values, // == [v_1, ..., v_a]
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proof3,
        bytes32[][] memory _proofExt
    ) public onlyExpected(vendor, State.WaitVendorData) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);

        // compute the hashes that will be used as leaves for the merkle trees
        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        bytes32[] memory gateKeccak = new bytes32[](1);
        
        if (_gateBytes.length != 64) revert InvalidGateBytes();
        gateKeccak[0] = keccak256(_gateBytes);
        bytes16 aesKey = getAesKey();
        
        // For V2, _values contains the evaluated son values (from get_evaluated_sons)
        // We use evaluateGateFromSons which takes son values directly
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSons(_gateBytes, _values, aesKey);

        // separate the gate's sons list and values according to the set L of
        // indices as defined in the paper
        (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        ) = _extractInAndNotInL_V2(_gateBytes, valuesKeccak, numBlocks);

        // can't just use [_gateNum], need to create a separate array for this...
        // AccumulatorVerifier.verify expects 0-indexed indices (matching proof generation),
        // but _gateNum is now 1-indexed (matching paper notation), so convert: _gateNum - 1
        uint32[] memory gateNumArray = new uint32[](1);
        gateNumArray[0] = _gateNum - 1;

        if (
            buyerResponses[_gateNum] != _currAcc && // w_i != w'_i
            AccumulatorVerifier.verify(
                hCircuitCt[0], // hCircuit
                gateNumArray,
                gateKeccak,
                _proof1
            ) &&
            AccumulatorVerifier.verify(
                hCircuitCt[1], // hCt
                sInL,
                vInL,
                _proof2
            ) &&
            AccumulatorVerifier.verify(
                buyerResponses[_gateNum - 1],
                sNotInLMinusM,
                vNotInL,
                _proof3
            ) &&
            AccumulatorVerifier.verifyExt(
                _gateNum - 1, // Convert 1-indexed to 0-indexed for AccumulatorVerifier
                buyerResponses[_gateNum - 1],
                _currAcc,
                keccak256(gateRes),
                _proofExt
            )
        ) {
            // Vendor wins, buyer loses
            handleStep9(false); // false = buyer lost
        } else {
            // Buyer wins, vendor loses
            handleStep9(true); // true = vendor lost
        }
    }

    /**
     * @notice Submit the data necessary for verification in the case where
     *      i == m (8b)
     * @dev This function allows the vendor to submit a commitment along with
     *      necessary data for evaluation and proof verification (V2 only)
     * @param _openingValue The opening value related to the contract's commitment
     * @param _gateNum The number of the gate being evaluated
     * @param _gateBytes The gate encoded as 64 bytes (V2 format: opcode + sons + params)
     * @param _values The gate's sons' values. E.g _values[i] = evaluate(s_i)
     * @param _currAcc The current accumulator value (w_i)
     * @param _proof1 The proof pi_1
     * @param _proof2 The proof pi_2
     * @param _proofExt The proof rho
     */
    function submitCommitmentLeft(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes, // V2 format: 64-byte encoded gate
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt
    ) public onlyExpected(vendor, State.WaitVendorDataLeft) {
        bool verified = verifyCommitmentLeft(
            _openingValue,
            _gateNum,
            _gateBytes,
            _values,
            _currAcc,
            _proof1,
            _proof2,
            _proofExt
        );

        if (verified) {
            // Vendor wins, buyer loses
            handleStep9(false); // false = buyer lost
        } else {
            // Buyer wins, vendor loses
            handleStep9(true); // true = vendor lost
        }
    }

    // helper function for submitCommitmentLeft because EVM is trash and doesn't
    // accept too many variables on the stack
    function verifyCommitmentLeft(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes, // V2 format: 64-byte encoded gate
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt
    ) internal view returns (bool) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);

        if (_gateBytes.length != 64) revert InvalidGateBytes();
        
        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        bytes32[] memory gateKeccak = new bytes32[](1);
        gateKeccak[0] = keccak256(_gateBytes);
        
        bytes16 aesKey = getAesKey();
        
        // For V2, _values contains the evaluated son values (from get_evaluated_sons)
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSons(_gateBytes, _values, aesKey);
        (uint32[] memory nonConstantSons, bytes32[] memory nonConstantValuesKeccak) = _extractNonConstantSons_V2(_gateBytes, valuesKeccak, numBlocks);

        // AccumulatorVerifier.verify expects 0-indexed indices (matching proof generation),
        // but _gateNum is now 1-indexed (matching paper notation), so convert: _gateNum - 1
        uint32[] memory gateNumArray = new uint32[](1);
        gateNumArray[0] = _gateNum - 1;

        // Verify proofs: if they pass, vendor wins (files are identical, vendor did not lie)
        return (
            AccumulatorVerifier.verify(
                hCircuitCt[0],
                gateNumArray,
                gateKeccak,
                _proof1
            ) &&
            AccumulatorVerifier.verify(
                hCircuitCt[1],
                nonConstantSons,
                nonConstantValuesKeccak,
                _proof2
            ) &&
            AccumulatorVerifier.verifyExt(
                0, // For Step 8b (i=1), there is no w_{i-1}, so use 0
                bytes32(0),
                _currAcc,
                keccak256(gateRes),
                _proofExt
            ));
    }

    /**
     * @notice Submit the data necessary for verification in the case where
     *      i == n (8c)
     * @dev This function allows the vendor to submit a commitment along with
     *      necessary data for evaluation and proof verification
     * @param _proof The proof pi used in the verification
     */
    function submitCommitmentRight(
        bytes32[][] memory _proof
    ) public onlyExpected(vendor, State.WaitVendorDataRight) {
        // Step 8c: Verify that the final gate (gate numGates, 0-indexed: numGates - 1)
        // returns 0x01, which means the files are identical (COMP gate returned true)
        // 
        // When chall == numGates + 1 (Step 8c), the buyer responded to challenge numGates + 1,
        // storing hpre(numGates + 1) in buyerResponses[chall] (where chall = numGates + 1).
        // Note: hpre(numGates + 1) = hpre(numGates) = Acc(val(1), ..., val(numGates))
        // (accumulates all gates from 1 to numGates).
        // We verify that this accumulator contains keccak256(0x01) at index numGates - 1
        // (the final COMP gate output, 0-indexed in the gate_outputs array).
        //
        // If verification succeeds: files are identical → vendor wins (Complete)
        // If verification fails: files are different → buyer wins (Cancel)
        // COMP gate returns 64 bytes: [0x01, 0x00, ..., 0x00] if equal, [0x00, ..., 0x00] if not equal
        // We need to hash the full 64-byte output, not just 0x01
        bytes memory trueBytes = new bytes(64);
        trueBytes[0] = 0x01; // First byte is 1, rest are zeros
        bytes32 expectedValue = keccak256(trueBytes);
        bytes32[] memory trueKeccakArr = new bytes32[](1);
        trueKeccakArr[0] = expectedValue;

        uint32[] memory idxArr = new uint32[](1);
        idxArr[0] = numGates - 1; // 0-indexed index of final gate in gate_outputs array

        // When chall == numGates + 1 (Step 8c), we need hpre(numGates + 1) = hpre(numGates).
        // The buyer has responded to challenges during the binary search. When giveOpinion
        // transitions to WaitVendorDataRight, chall = numGates + 1. The buyer responded to
        // challenge numGates (the last challenge before the transition), storing hpre(numGates)
        // in buyerResponses[numGates]. Since hpre(numGates + 1) = hpre(numGates), we use
        // buyerResponses[numGates] which equals hpre(numGates) = hpre(numGates + 1).
        bytes32 root = buyerResponses[numGates];
        
        // Check if buyerResponses[numGates] is set (non-zero)
        // This should always be set when we reach WaitVendorDataRight, as the buyer must have
        // responded to challenge numGates (the last challenge before the transition)
        if (root == bytes32(0)) {
            revert("buyerResponses[numGates] is not set. Buyer must respond to challenge numGates first.");
        }

        bool verified = AccumulatorVerifier.verify(
            root,                      // hpre(numGates) - accumulator of all gates
            idxArr,                    // Index of final gate (numGates - 1)
            trueKeccakArr,             // Expected value: keccak256(0x01)
            _proof                     // Proof that final gate output is 0x01
        );

        if (verified) {
            // Verification succeeded: final gate returned 0x01 (files are identical)
            // Vendor wins, buyer loses → Complete (pay vendor)
            handleStep9(false); // false = buyer lost
        } else {
            // Verification failed: final gate did not return 0x01 (files are different)
            // Buyer wins, vendor loses → Cancel (refund buyer)
            handleStep9(true); // true = vendor lost
        }
    }

    // =============== TIMEOUT MANAGEMENT ===============
    /**
     * @notice Send a completion request. It will be accepted in any case if
     *      the buyer does this request or if the contract is complete. In the
     *      case where the contract is waiting for the buyer to respond and the
     *      timeout has passed, this request will also be accepted. Otherwise,
     *      it will be refused and the transaction reverted.
     * @dev This function allows anyone to send a completion request
     */
    function completeDispute() public {
        if (currState != State.ChallengeBuyer && currState != State.Complete) revert InvalidState();

        if (currState == State.Complete && !_isBuyer()) {
            if (!timeoutHasPassed()) revert InvalidState();
        }

        // Complete: from the B-payment, pay $y to V (according to SOX protocol Step 40)
        payable(vendor).transfer(agreedPrice);

        // Return the leftover dispute deposit to SV (vendor dispute sponsor)
        // According to SOX protocol: "return the leftover dispute deposit to SV"
        // Note: The tip₀ to S (sponsor) and leftover S-deposit are handled by OptimisticSOX
        payable(vendorDisputeSponsor).transfer(address(this).balance);

        optimisticContract.endDispute();
        nextState(State.End);
    }

    /**
     * @notice Send a cancellation request. It will be accepted in any case if
     *      the vendor does this request or if the contract's state is Cancel.
     *      In the case where the contract is waiting for the vendor's opinion
     *      and the timeout has passed, this request will also be accepted.
     *      Otherwise, it will be refused and the transaction reverted.
     * @dev This function allows anyone to send a cancellation request
     */
    function cancelDispute() public {
        if (currState != State.Cancel && currState != State.WaitVendorOpinion && currState != State.WaitVendorData && currState != State.WaitVendorDataLeft && currState != State.WaitVendorDataRight) {
            revert InvalidState();
        }

        if (currState != State.Cancel && !_isVendor()) {
            if (!timeoutHasPassed()) revert InvalidState();
        }

        // Cancel: return the B-payment to B (according to SOX protocol Step 39)
        // The B-payment is the agreedPrice that was deposited by the buyer
        payable(buyer).transfer(agreedPrice);

        // Return the leftover dispute deposit to SB (buyer dispute sponsor)
        // According to SOX protocol: "return the leftover dispute deposit to SB"
        payable(buyerDisputeSponsor).transfer(address(this).balance);

        optimisticContract.endDispute();
        nextState(State.End);
    }

    /**
     * @notice Tells whether the timeout has passed and if a cancellation
     *      or completion can be requested
     * @dev Returns true if the current time is greater or equal to the next
     *      timeout time
     * @return hasPassed Whether the timeout time has passed
     */
    function timeoutHasPassed() public view returns (bool) {
        return block.timestamp >= nextTimeoutTime;
    }

    // =============== INTERNAL FUNCTIONS ===============
    /**
     * @notice Handle Step 9 optimization: if losing party Q ≠ SQ, set Q ← SQ and go to Step 7
     * @dev Implements the Step 9 optimization from the SOX protocol using external library
     * @param _vendorLost True if vendor lost (Cancel), false if buyer lost (Complete)
     */
    function handleStep9(bool _vendorLost) internal {
        Step9State memory s = Step9State({
            step9Count: step9Count,
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
            buyer: buyer,
            vendor: vendor,
            buyerDisputeSponsor: buyerDisputeSponsor,
            vendorDisputeSponsor: vendorDisputeSponsor,
            numBlocks: numBlocks,
            numGates: numGates
        });

        Step9Result memory r = _handleStep9Logic(_vendorLost, s);

        // Update state from result
        step9Count = r.newStep9Count;
        lastLosingPartyWasVendor = r.newLastLosingPartyWasVendor;
        buyer = r.newBuyer;
        vendor = r.newVendor;
        
        // Update signers when sponsor takes over (necessary for ERC-4337 user operations)
        if (r.newBuyer == buyerDisputeSponsor && buyerSigner != buyerDisputeSponsorSigner) {
            buyerSigner = buyerDisputeSponsorSigner;
        }
        if (r.newVendor == vendorDisputeSponsor && vendorSigner != vendorDisputeSponsorSigner) {
            vendorSigner = vendorDisputeSponsorSigner;
        }

        if (r.shouldContinue) {
            a = r.a;
            b = r.b;
            chall = r.chall;
            nextState(State.ChallengeBuyer);
        } else {
            if (r.vendorLost) {
                nextState(State.Cancel);
            } else {
                nextState(State.Complete);
            }
        }
    }

    // Transitions to the next state
    function nextState(State _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }

    function getAesKey() internal view returns (bytes16) {
        return optimisticContract.key();
    }

    // Opens the commitment with the provided opening value and parses the result
    function openCommitment(
        bytes calldata _openingValue
    ) internal view returns (bytes32[2] memory hCircuitCt) {
        // open commitment
        bytes memory opened = CommitmentOpener.open(commitment, _openingValue);

        // the only way split the result without loops is to use inline assembly
        assembly {
            mstore(hCircuitCt, mload(add(opened, 32)))
            mstore(add(hCircuitCt, 32), mload(add(opened, 64)))
        }
    }

    // =============== GETTERS ===============
    /**
     * @notice Get the buyer's response for a specific challenge number
     * @dev This function returns the buyer's response stored at the specified index
     * @param _challNum The challenge number
     * @return response The buyer's response at the provided challenge number
     */
    function getBuyerResponse(uint32 _challNum) public view returns (bytes32) {
        return buyerResponses[_challNum];
    }

    /**
     * @notice Get the buyer's response to the latest challenge
     * @dev This function returns the buyer's response stored at the index
     *      returned by `getChall()`
     * @return response The buyer's latest response
     */
    function getLatestBuyerResponse() public view returns (bytes32) {
        return getBuyerResponse(chall);
    }

    // =============== PRIVATE HELPER FUNCTIONS ===============
    function _call(address _target, uint256 _value, bytes calldata _data) internal {
        (bool success, bytes memory result) = _target.call{value: _value}(_data);
        if (!success) {
            if (result.length > 0) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            revert TransactionReverted();
        }
    }

    function _clearUserOpContext() internal {
        lastValidatedRole = Role.None;
        lastValidatedNonce = 0;
    }

    function _validateSignature(bytes32 userOpHash, bytes calldata signature) internal view returns (Role) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = ECDSA.recover(digest, signature);

        if (recovered == buyerSigner) return Role.Buyer;
        if (recovered == vendorSigner) return Role.Vendor;
        if (recovered == buyerDisputeSponsorSigner) return Role.BuyerDisputeSponsor;
        if (recovered == vendorDisputeSponsorSigner) return Role.VendorDisputeSponsor;

        revert InvalidSignature();
    }

    // =============== INTERNAL HELPER FUNCTIONS (from DisputeSOXHelpers) ===============
    /**
     * @dev Handle Step 9 optimization logic
     */
    function _handleStep9Logic(
        bool _vendorLost,
        Step9State memory s
    ) internal pure returns (Step9Result memory r) {
        r.newStep9Count = s.step9Count + 1;
        r.newLastLosingPartyWasVendor = _vendorLost;
        r.newBuyer = s.buyer;
        r.newVendor = s.vendor;
        r.vendorLost = _vendorLost;
        r.shouldContinue = false;

        if (r.newStep9Count == 1) {
            if (_vendorLost) {
                if (s.vendor != s.vendorDisputeSponsor) {
                    r.newVendor = s.vendorDisputeSponsor;
                    r.shouldContinue = true;
                }
            } else {
                if (s.buyer != s.buyerDisputeSponsor) {
                    r.newBuyer = s.buyerDisputeSponsor;
                    r.shouldContinue = true;
                }
            }
        } else if (r.newStep9Count == 2 && s.lastLosingPartyWasVendor != _vendorLost) {
            if (_vendorLost) {
                if (s.vendor != s.vendorDisputeSponsor) {
                    r.newVendor = s.vendorDisputeSponsor;
                    r.shouldContinue = true;
                }
            } else {
                if (s.buyer != s.buyerDisputeSponsor) {
                    r.newBuyer = s.buyerDisputeSponsor;
                    r.shouldContinue = true;
                }
            }
        }

        if (r.shouldContinue) {
            r.a = 1;
            r.b = s.numGates + 1;
            r.chall = (r.a + r.b) / 2;
        }
    }

    /**
     * @dev Extract sons in L and not in L from gate bytes (V2 format)
     */
    function _extractInAndNotInL_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _valuesKeccak,
        uint32 _numBlocks
    )
        internal
        pure
        returns (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        )
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(
            _gateBytes,
            _valuesKeccak.length
        );

        // First pass: count valid indices only (matching Rust behavior which ignores invalid indices)
        uint countInL = 0;
        uint countNotInL = 0;

        for (uint i = 0; i < sons.length; ++i) {
            int64 sonIdx = sons[i];
            if (sonIdx == 0) revert InvalidV2SonIndex();
            if (sonIdx < 0) {
                uint32 ctIdx = uint32(uint64(-sonIdx));
                // Only count if valid (matching Rust: if ct_idx >= 1 && ct_idx <= num_blocks)
                if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                    ++countInL;
                }
            } else {
                ++countNotInL;
            }
        }

        sInL = new uint32[](countInL);
        vInL = new bytes32[](countInL);
        sNotInLMinusM = new uint32[](countNotInL);
        vNotInL = new bytes32[](countNotInL);

        uint iterInL = 0;
        uint iterNotInL = 0;
        uint valueIdx = 0;

        for (uint i = 0; i < sons.length; ++i) {
            int64 sonIdx = sons[i];
            if (sonIdx < 0) {
                uint32 ctIdx = uint32(uint64(-sonIdx));
                // Match Rust behavior: only include if valid (ct_idx >= 1 && ct_idx <= num_blocks)
                // Invalid indices are silently ignored (not added to sInL)
                if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                    // Convert to 0-indexed and add 1 to account for IV at index 0 in the root
                    // The root hCt is calculated with [IV, block1, block2, ...] (via acc_ct which uses split_ct_blocks)
                    // But Rust's compute_proofs_v2 and compute_proofs_left_v2 generate proof2 with [block1, block2, ...] (without IV)
                    // So we need to shift indices by +1 to match the root structure
                    sInL[iterInL] = ctIdx; // ctIdx (1-indexed) = index in root (0-indexed with IV)
                    vInL[iterInL] = _valuesKeccak[valueIdx];
                    ++iterInL;
                }
                // Note: valueIdx is incremented even if index is invalid, matching Rust behavior
                // where all sons are processed in order
                ++valueIdx;
            } else {
                uint32 gateIdx = uint32(uint64(sonIdx - 1));
                sNotInLMinusM[iterNotInL] = gateIdx;
                vNotInL[iterNotInL] = _valuesKeccak[valueIdx];
                ++iterNotInL;
                ++valueIdx;
            }
        }
    }

    /**
     * @dev Extract non-constant sons from gate bytes (V2 format)
     */
    function _extractNonConstantSons_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _valuesKeccak,
        uint32 _numBlocks
    )
        internal
        pure
        returns (
            uint32[] memory nonConstantSons,
            bytes32[] memory nonConstantValuesKeccak
        )
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(
            _gateBytes,
            _valuesKeccak.length
        );

        // First pass: count only valid non-constant sons (matching Rust behavior)
        uint countNonConstant = 0;
        for (uint i = 0; i < sons.length; ++i) {
            if (sons[i] < 0) {
                uint32 ctIdx = uint32(uint64(-sons[i]));
                // Only count if valid (matching Rust: if ct_idx >= 1 && ct_idx <= num_blocks)
                if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                    ++countNonConstant;
                }
            }
        }

        nonConstantSons = new uint32[](countNonConstant);
        nonConstantValuesKeccak = new bytes32[](countNonConstant);

        uint j = 0;
        uint valueIdx = 0;
        for (uint i = 0; i < sons.length; ++i) {
            if (sons[i] >= 0) {
                ++valueIdx;
                continue;
            }
            uint32 ctIdx = uint32(uint64(-sons[i]));
            // Match Rust behavior: only include if valid (ct_idx >= 1 && ct_idx <= num_blocks)
            // Invalid indices are silently ignored (not added to nonConstantSons)
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                // Convert to 0-indexed and add 1 to account for IV at index 0 in the root
                // The root hCt is calculated with [IV, block1, block2, ...] (via acc_ct which uses split_ct_blocks)
                // But Rust's compute_proofs_v2 and compute_proofs_left_v2 generate proof2 with [block1, block2, ...] (without IV)
                // So we need to shift indices by +1 to match the root structure
                nonConstantSons[j] = ctIdx; // ctIdx (1-indexed) = index in root (0-indexed with IV)
                nonConstantValuesKeccak[j] = _valuesKeccak[valueIdx];
                ++j;
            }
            // Note: valueIdx is incremented even if index is invalid, matching Rust behavior
            ++valueIdx;
        }
    }

    /**
     * @dev Hash an array of bytes
     */
    function _hashBytesArray(
        bytes[] calldata _arr
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_arr.length);
        for (uint32 i = 0; i < _arr.length; ++i) {
            hashes[i] = keccak256(_arr[i]);
        }
        return hashes;
    }

}
