// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

library AccumulatorVerifier {
    struct Pair {
        uint32 key;
        bytes32 value;
    }

    /**
     * Gets the neighbor index of a given index.
     */
    function getNeighbor(uint32 index) internal pure returns (uint32) {
        if (index % 2 == 0) return index + 1;
        else return index - 1;
    }

    /**
     * Computes the hash of two bytes32 values.
     */
    function hash(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(bytes.concat(left, right));
    }

    /**
     * Verifies an accumulator proof.
     */
    function verify(
        bytes32 root,
        uint32[] memory indices,
        bytes32[] memory valuesKeccak,
        bytes32[][] memory proof
    ) public pure returns (bool) {
        // From https://arxiv.org/pdf/2002.07648, slighlty modified
        // by taking the proof in reverse order to use pop() instead of
        // dealing with the removal of the first element of the proof
        // also uses a 2d proof in order to deal with "lonely" elements
        if (indices.length != valuesKeccak.length) return false;

        // we consider that if no values are supplied, the proof is correct
        // because the proof will be empty anyways. Also covers the case of
        // step 8a for proof p_2 if the gate doesn't use any input from the
        // ciphertext directly (no sInL)
        if (indices.length == 0) return true;

        (indices, valuesKeccak) = sortAligned(indices, valuesKeccak);

        for (uint32 l = 0; l < proof.length; l++) {
            uint32[2][] memory b = new uint32[2][](indices.length);
            uint32 bPrunedLength = 0;
            for (uint32 i = 0; i < indices.length; i++) {
                uint32 currIdx = indices[i];
                uint32 neighborIdx = getNeighbor(currIdx);

                if (neighborIdx < currIdx) b[i] = [neighborIdx, currIdx];
                else b[i] = [currIdx, neighborIdx];

                if (i == 0 || b[i][0] != b[i - 1][0]) {
                    bPrunedLength++;
                }
            }

            uint32[] memory nextIndices = new uint32[](bPrunedLength);
            bytes32[] memory nextValues = new bytes32[](bPrunedLength);
            // proofs were initially reversed to use .pop() but it only works on storage
            // which uses more gas
            // we also take the +1 to avoid conversions between uint and int
            uint256 nextElementPlusOne = proof[l].length;
            uint32 indicesI = 0;
            uint32 valuesI = 0;
            for (uint32 i = 0; i < b.length; i++) {
                if (i + 1 < b.length && b[i][0] == b[i + 1][0]) {
                    // duplicate found
                    // this means that b[i][0] and b[i][1] are elements of
                    // nextIndices. Furthermore, b[i] is computed based on
                    // nextIndices[i] and since we skip the duplicates,
                    // it can only be that b[i][0] == nextIndices[i]
                    // => the corresponding values are valuesKeccak[i]
                    // and valuesKeccak[i+1]
                    nextValues[valuesI] = hash(
                        valuesKeccak[i],
                        valuesKeccak[i + 1]
                    );
                    valuesI++;

                    i++; // skip next element (duplicate)
                } else if (nextElementPlusOne > 0) {
                    // index needed to hash elements in the correct order
                    uint32 correspondingIdx = indices[i];
                    uint32 neighborIdx = getNeighbor(correspondingIdx);

                    if (neighborIdx < correspondingIdx) {
                        nextValues[valuesI] = hash(
                            proof[l][nextElementPlusOne - 1],
                            valuesKeccak[i]
                        );
                        valuesI++;
                        nextElementPlusOne--;
                    } else {
                        nextValues[valuesI] = hash(
                            valuesKeccak[i],
                            proof[l][nextElementPlusOne - 1]
                        );
                        valuesI++;
                        nextElementPlusOne--;
                    }
                } else {
                    // proof layer is empty, move the element that must be combined to the next layer
                    nextValues[valuesI] = valuesKeccak[i];
                    valuesI++;
                }

                nextIndices[indicesI] = (indices[i] >> 1);
                indicesI++;
            }
            valuesKeccak = nextValues;
            indices = nextIndices;
        }
        require(
            valuesKeccak.length == 1,
            "Something went wrong during the verification"
        );

        return valuesKeccak[0] == root;
    }

    /**
     * Verifies the previous root of an accumulator.
     */
    function verifyPrevious(
        bytes32 prevRoot,
        bytes32[][] calldata proof
    ) internal pure returns (bool) {
        // Check if proof is empty
        bool isEmpty = true;
        for (uint32 i = 0; i < proof.length; i++) {
            if (proof[i].length > 0) {
                isEmpty = false;
                break;
            }
        }
        // If proof is empty, return true only if prevRoot is zero (Step 8b case)
        if (isEmpty) {
            return prevRoot == bytes32(0);
        }
        
        bool firstFound = false;
        bytes32 computedRoot;
        for (uint32 i = 0; i < proof.length; i++) {
            uint256 nextElementPlusOne = proof[i].length;
            while (nextElementPlusOne > 0) {
                if (!firstFound) {
                    computedRoot = proof[i][nextElementPlusOne - 1];
                    nextElementPlusOne--;
                    firstFound = true;
                } else {
                    computedRoot = keccak256(
                        bytes.concat(
                            proof[i][nextElementPlusOne - 1],
                            computedRoot
                        )
                    );
                    nextElementPlusOne--;
                }
            }
        }
        return computedRoot == prevRoot;
    }

    /**
     * Verifies an extension proof.
     */
    function verifyExt(
        uint32 i,
        bytes32 prevRoot,
        bytes32 currRoot,
        bytes32 addedValKeccak,
        bytes32[][] calldata proof
    ) public pure returns (bool) {
        uint32[] memory iArr = new uint32[](1);
        iArr[0] = i;

        bytes32[] memory addedValKeccakArr = new bytes32[](1);
        addedValKeccakArr[0] = addedValKeccak;

        // For Step 8b (i=0 or i=1, prevRoot=0), there is no previous accumulator,
        // so we only verify the current root, not the previous one
        // Support both old code (i=1) and new code (i=0) for compatibility
        if ((i == 0 || i == 1) && prevRoot == bytes32(0)) {
            // For i=1 (old code), convert to 0-indexed for verify
            if (i == 1) {
                iArr[0] = 0;
            }
            return verify(currRoot, iArr, addedValKeccakArr, proof);
        }

        return
            verify(currRoot, iArr, addedValKeccakArr, proof) &&
            verifyPrevious(prevRoot, proof);
    }

    /**
     * Sorts two arrays in alignment with each other.
     */
    function sortAligned(
        uint32[] memory indices,
        bytes32[] memory values
    )
        internal
        pure
        returns (uint32[] memory sortedIndices, bytes32[] memory sortedValues)
    {
        require(indices.length == values.length, "Mismatched input lengths");

        uint256 len = indices.length;
        Pair[] memory pairs = new Pair[](len);

        for (uint256 i = 0; i < len; i++) {
            pairs[i] = Pair(indices[i], values[i]);
        }

        // Insertion sort for simplicity (gas-efficient for small arrays)
        for (uint256 i = 1; i < len; i++) {
            Pair memory current = pairs[i];
            uint256 j = i;
            while (j > 0 && pairs[j - 1].key > current.key) {
                pairs[j] = pairs[j - 1];
                j--;
            }
            pairs[j] = current;
        }

        sortedIndices = new uint32[](len);
        sortedValues = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            sortedIndices[i] = pairs[i].key;
            sortedValues[i] = pairs[i].value;
        }
    }
}
