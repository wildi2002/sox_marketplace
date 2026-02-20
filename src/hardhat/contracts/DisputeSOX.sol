// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {AccumulatorVerifier} from "./AccumulatorSOX.sol";
import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";
import {CommitmentOpener} from "./CommitmentSOX.sol";
import {OptimisticState, IOptimisticSOX} from "./OptimisticSOXAccount.sol";
import {DisputeSOXHelpers} from "./DisputeSOXHelpers.sol";

contract DisputeSOX {
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


    // Checks that the expected sender calls the function and that the contract
    // is in the expected state
    modifier onlyExpected(address _sender, State _state) {
        require(msg.sender == _sender);
        require(currState == _state);
        _;
    }

    constructor(
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        uint32 _circuitVersion
    ) payable {
        require(_circuitVersion == 1, "DisputeSOX only supports V2 circuits. Use DisputeSOX_V1 for V1.");
        require(_numGates > 0, "Circuit must have at least one gate");
        
        optimisticContract = IOptimisticSOX(_optimisticContract);
        require(
            optimisticContract.currState() == OptimisticState.WaitSV,
            "Optimistic contract cannot start a dispute in the current state"
        );
        require(
            msg.value >= optimisticContract.agreedPrice(),
            "Need at least enough money to transfer the price of the item"
        );

        buyer = optimisticContract.buyer();
        vendor = optimisticContract.vendor();
        buyerDisputeSponsor = optimisticContract.buyerDisputeSponsor();
        vendorDisputeSponsor = optimisticContract.vendorDisputeSponsor();
        timeoutIncrement = optimisticContract.timeoutIncrement();
        agreedPrice = optimisticContract.agreedPrice();

        numBlocks = _numBlocks;
        numGates = _numGates;
        commitment = _commitment;

        // V2: challenge over gate indices (1-indexed, matching paper notation)
        // Paper: a = 1, b = n+1
        a = 1;
        b = _numGates + 1;
        chall = (a + b) / 2; // integer division
        nextState(State.ChallengeBuyer);
    }

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
        bytes32[] memory valuesKeccak = DisputeSOXHelpers.hashBytesArray(_values);
        bytes32[] memory gateKeccak = new bytes32[](1);
        
        require(_gateBytes.length == 64);
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
        ) = DisputeSOXHelpers.extractInAndNotInL_V2(_gateBytes, valuesKeccak, numBlocks);

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

        // V2: gate is passed as 64-byte bytes
        require(_gateBytes.length == 64, "V2 gate must be exactly 64 bytes");
        
        bytes32[] memory valuesKeccak = DisputeSOXHelpers.hashBytesArray(_values);
        bytes32[] memory gateKeccak = new bytes32[](1);
        gateKeccak[0] = keccak256(_gateBytes);
        
        bytes16 aesKey = getAesKey();
        
        // For V2, _values contains the evaluated son values (from get_evaluated_sons)
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSons(_gateBytes, _values, aesKey);
        (uint32[] memory nonConstantSons, bytes32[] memory nonConstantValuesKeccak) = DisputeSOXHelpers.extractNonConstantSons_V2(_gateBytes, valuesKeccak);

        // AccumulatorVerifier.verify expects 0-indexed indices (matching proof generation),
        // but _gateNum is now 1-indexed (matching paper notation), so convert: _gateNum - 1
        uint32[] memory gateNumArray = new uint32[](1);
        gateNumArray[0] = _gateNum - 1;

        return (_currAcc != buyerResponses[_gateNum] &&
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
        // COMP gate returns 64 bytes: [0x01, 0x00, ..., 0x00] if equal, [0x00, ..., 0x00] if not equal
        // We need to hash the full 64-byte output, not just 0x01
        bytes memory trueBytes = new bytes(64);
        trueBytes[0] = 0x01; // First byte is 1, rest are zeros
        bytes32[] memory trueKeccakArr = new bytes32[](1);
        trueKeccakArr[0] = keccak256(trueBytes);

        uint32[] memory idxArr = new uint32[](1);
        idxArr[0] = numGates - 1;

        if (
            AccumulatorVerifier.verify(
                buyerResponses[numGates],
                idxArr,
                trueKeccakArr,
                _proof
            )
        ) {
            // Vendor wins, buyer loses
            handleStep9(false); // false = buyer lost
        } else {
            // Buyer wins, vendor loses
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
        require(currState == State.ChallengeBuyer || currState == State.Complete);

        if (currState == State.Complete && msg.sender != buyer) {
            // timeout does NOT need to be checked if the contract is marked
            // as Complete or if the buyer decides to mark it as such (gave
            // up). In any other case, it needs to be checked.
            require(timeoutHasPassed());
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
        require(
            currState == State.Cancel ||
                currState == State.WaitVendorOpinion ||
                currState == State.WaitVendorData ||
                currState == State.WaitVendorDataLeft ||
                currState == State.WaitVendorDataRight
        );

        if (currState != State.Cancel && msg.sender != vendor) {
            // timeout does NOT need to be checked if the contract is marked
            // as Cancel or if the vendor decides to mark it as such (gave
            // up). In any other case, it needs to be checked.
            require(timeoutHasPassed());
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
        DisputeSOXHelpers.Step9State memory s = DisputeSOXHelpers.Step9State({
            step9Count: step9Count,
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
            buyer: buyer,
            vendor: vendor,
            buyerDisputeSponsor: buyerDisputeSponsor,
            vendorDisputeSponsor: vendorDisputeSponsor,
            numBlocks: numBlocks,
            numGates: numGates
        });

        DisputeSOXHelpers.Step9Result memory r = DisputeSOXHelpers.handleStep9Logic(_vendorLost, s);

        // Update state from result
        step9Count = r.newStep9Count;
        lastLosingPartyWasVendor = r.newLastLosingPartyWasVendor;
        buyer = r.newBuyer;
        vendor = r.newVendor;

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


    // ============================== GETTERS =================================
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
}
