// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";

library DisputeSOXHelpers {
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

    function handleStep9Logic(
        bool _vendorLost,
        Step9State memory s
    ) public pure returns (Step9Result memory r) {
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

    function extractInAndNotInL_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _valuesKeccak,
        uint32 numBlocks
    )
        public
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

        uint countInL = 0;
        uint countNotInL = 0;

        for (uint i = 0; i < sons.length; ++i) {
            int64 sonIdx = sons[i];
            require(sonIdx != 0, "Invalid V2 son index");
            if (sonIdx < 0) {
                ++countInL;
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
                require(ctIdx >= 1 && ctIdx <= numBlocks, "CT index out of bounds");
                // Convert to 0-indexed to match Rust's proof2 generation (Merkle trees use 0-indexed arrays)
                sInL[iterInL] = ctIdx - 1;
                vInL[iterInL] = _valuesKeccak[valueIdx];
                ++iterInL;
            } else {
                uint32 gateIdx = uint32(uint64(sonIdx - 1));
                sNotInLMinusM[iterNotInL] = gateIdx;
                vNotInL[iterNotInL] = _valuesKeccak[valueIdx];
                ++iterNotInL;
            }
            ++valueIdx;
        }
    }

    function extractNonConstantSons_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _valuesKeccak
    )
        public
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

        uint countNonConstant = 0;
        for (uint i = 0; i < sons.length; ++i) {
            if (sons[i] < 0) {
                ++countNonConstant;
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
            // Convert to 0-indexed and add 1 to account for IV at index 0 in the root
            // The root hCt is calculated with [IV, block1, block2, ...] (via acc_ct which uses split_ct_blocks)
            // But Rust's compute_proofs_v2 and compute_proofs_left_v2 generate proof2 with [block1, block2, ...] (without IV)
            // So we need to shift indices by +1 to match the root structure
            nonConstantSons[j] = ctIdx; // ctIdx (1-indexed) = index in root (0-indexed with IV)
            nonConstantValuesKeccak[j] = _valuesKeccak[valueIdx];
            ++j;
            ++valueIdx;
        }
    }

    function hashBytesArray(
        bytes[] calldata _arr
    ) public pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_arr.length);
        for (uint32 i = 0; i < _arr.length; ++i) {
            hashes[i] = keccak256(_arr[i]);
        }
        return hashes;
    }
}
