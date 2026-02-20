// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {TestGateHash} from "../contracts/TestGateHash.sol";
import {Test} from "forge-std/Test.sol";

contract TestGateHashTest is Test {
    TestGateHash public testContract;

    function setUp() public {
        testContract = new TestGateHash();
    }

    function testGate1Hash() public {
        // Gate 1: AES-CTR (opcode 0x01), son g_{-1} = -1, params = counter (16B zeros) + length (0x0040)
        // Encoded: 01ffffffffffff000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000
        bytes memory gate1 = hex"01ffffffffffff000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000";
        bytes32 hash1 = testContract.sha256GateV2(gate1);
        
        // Hash attendu depuis Rust: cce128d36e00bb7af7c5178f90b4a2cdf53d73a9b1ec3b9f14c9b0d28f5ef461
        bytes32 expectedHash1 = 0xcce128d36e00bb7af7c5178f90b4a2cdf53d73a9b1ec3b9f14c9b0d28f5ef461;
        
        console.log("Gate 1 Hash (Solidity):", vm.toString(hash1));
        console.log("Gate 1 Hash (Rust):     ", vm.toString(expectedHash1));
        
        assertEq(hash1, expectedHash1, "Gate 1 hash mismatch!");
    }

    function testGate2Hash() public {
        // Gate 2: SHA2 (opcode 0x02), son g_1 = 1
        // Encoded: 02000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
        bytes memory gate2 = hex"02000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        bytes32 hash2 = testContract.sha256GateV2(gate2);
        
        // Hash attendu depuis Rust: f33d5479d7846de0011754e9a28b8f8c9bea04b65a74a600c5b3daadcff27c53
        bytes32 expectedHash2 = 0xf33d5479d7846de0011754e9a28b8f8c9bea04b65a74a600c5b3daadcff27c53;
        
        console.log("Gate 2 Hash (Solidity):", vm.toString(hash2));
        console.log("Gate 2 Hash (Rust):     ", vm.toString(expectedHash2));
        
        assertEq(hash2, expectedHash2, "Gate 2 hash mismatch!");
    }

    function testGate3Hash() public {
        // Gate 3: CONST (opcode 0x03), params = 0x80...
        // Encoded: 03800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
        bytes memory gate3 = hex"03800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        bytes32 hash3 = testContract.sha256GateV2(gate3);
        
        // Hash attendu depuis Rust: 67171a1e9c85caf3f8cc3ee8bf09b1775e1f1fbe9d7cf36cdaada71241bc8ff6
        bytes32 expectedHash3 = 0x67171a1e9c85caf3f8cc3ee8bf09b1775e1f1fbe9d7cf36cdaada71241bc8ff6;
        
        console.log("Gate 3 Hash (Solidity):", vm.toString(hash3));
        console.log("Gate 3 Hash (Rust):     ", vm.toString(expectedHash3));
        
        assertEq(hash3, expectedHash3, "Gate 3 hash mismatch!");
    }

    function testAllGates() public {
        testGate1Hash();
        testGate2Hash();
        testGate3Hash();
        console.log("\n✅ Tous les hash correspondent entre Rust et Solidity!");
    }
}

