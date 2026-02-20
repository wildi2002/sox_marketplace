import { keccak256 } from "ethers";
import {
    bytesArraysAreEqual,
    concatBytes,
    hexToBytes,
    toBytes32,
} from "./helpers";

// Returns the keccak256 hash of `v` after extending it 32 bytes
function hash(v: Uint8Array): Uint8Array {
    return hexToBytes(keccak256(toBytes32(v)));
}

// Returns hash(left32||right32) where xxx32 is xxx extended/shrinked
// to 32 bytes
function concatAndHash(left: Uint8Array, right: Uint8Array): Uint8Array {
    return hash(concatBytes([toBytes32(left), toBytes32(right)]));
}

// Returns the Merkle tree representation of the provided values. It is stored as
// an array of the layers of the tree where the first layer (tree[0]) contains
// the leaves (hashes of the values) and the last layer contains a single element
// which is the root.
function makeTree(values: Uint8Array[]): Uint8Array[][] {
    if (values.length === 0) return [[]];
    if (values.length === 1) return [[hash(values[0])]];

    const tree: Uint8Array[][] = [];
    let currLayer = values.map(hash);

    tree.push(currLayer);

    while (currLayer.length > 1) {
        const nextLayer: Uint8Array[] = [];
        for (let i = 0; i < currLayer.length; i += 2) {
            if (i + 1 < currLayer.length) {
                nextLayer.push(concatAndHash(currLayer[i], currLayer[i + 1]));
            } else {
                nextLayer.push(currLayer[i]);
            }
        }
        tree.push(nextLayer);
        currLayer = nextLayer;
    }

    return tree;
}

// Returns the neighbor index in a Merkle tree
function getNeighborIdx(index: number): number {
    if (index % 2 == 0) return index + 1;
    else return index - 1;
}

// Creates a deep copy of the provided proof
function deepCopyProof(proof: Uint8Array[][]): Uint8Array[][] {
    const proofCopy = [];

    for (let i = 0; i < proof.length; i++) {
        const innerArray: Uint8Array[] = [];
        for (let j = 0; j < proof[i].length; j++) {
            const clonedElement = new Uint8Array(proof[i][j].length);
            clonedElement.set(proof[i][j]);
            innerArray.push(clonedElement);
        }
        proofCopy.push(innerArray);
    }

    return proofCopy;
}

// Returns true if hashing the elements of the proof together in reverse order
// results in the provided prevRoot. Used for verifyExt.
function verifyPrevious(prevRoot: Uint8Array, proof: Uint8Array[][]): boolean {
    // looks unnecessarily complex when I could just use proof.flat() but it's to
    // match exactly what the smart contract does
    let proofCopy = deepCopyProof(proof);
    let firstFound = false;
    let computedRoot: Uint8Array;
    for (let i = 0; i < proofCopy.length; ++i) {
        while (proofCopy[i].length > 0) {
            if (!firstFound) {
                computedRoot = proofCopy[i].pop()!;
                firstFound = true;
            } else {
                computedRoot = concatAndHash(
                    proofCopy[i].pop()!,
                    computedRoot!
                );
            }
        }
    }
    return bytesArraysAreEqual(computedRoot!, prevRoot);
}

/**
 * Returns the root of the Merkle tree built using `values`
 *
 * @param {Uint8Array[]} values the values that are used to build the Merkle tree
 * @returns {Uint8Array} the root of the Merkle tree
 */
export function acc(values: Uint8Array[]): Uint8Array {
    return makeTree(values).slice(-1)[0][0];
}

/**
 * Creates a Merkle multi-proof for the values at the provided indices.
 * The multi-proof uses a tree built using `values`.
 *
 * @param values list containing all the values
 * @param indices array of the values to prove within the `values` array
 * @returns A Merkle multi-proof of the values at the provided indices within
 * a Merkle tree built from `values`
 */
export function prove(values: Uint8Array[], indices: number[]): Uint8Array[][] {
    // Inspired from https://arxiv.org/pdf/2002.07648, modified to have a 2d
    // proof separating the layers' content and reverses each layer's content
    // to simplify the verification step
    if (values.length === 0) throw new Error("There is no value");
    if (indices.length === 0) throw new Error("Specify at least one index");
    if (values.length < indices.length) throw new Error("Too many indices");
    for (let i of indices)
        if (0 > i || i >= values.length)
            throw new Error(`${i} is not a valid index`);

    const treeNoRoot = makeTree(values).slice(0, -1);

    let a = indices.toSorted((a: number, b: number) => a - b);
    const proof: Uint8Array[][] = [];
    for (let l of treeNoRoot) {
        const bPruned = [];
        const diff = [];
        for (let i = 0; i < a.length; ++i) {
            const idx = a[i];
            const neighbor = getNeighborIdx(idx);
            if (idx < neighbor) bPruned.push([idx, neighbor]);
            else bPruned.push([neighbor, idx]);

            if (i < a.length - 1 && neighbor == a[i + 1]) ++i; // skip duplicate
            if (!a.includes(neighbor) && neighbor < l.length)
                diff.push(neighbor);
        }

        proof.push(diff.map((i) => l[i]).toReversed());
        a = bPruned
            .flat()
            .filter((i) => i % 2 == 0)
            .map((i) => i >>> 1);
    }

    // reversing the proof makes it easier (and cheaper) to verify on the smart
    // contract as we can use pop instead of reading + deleting the list's head
    return proof;
}

/**
 * Using the provided arguments, checks whether `proof` has been generated using
 * values for which the Merkle tree's root is the provided `root`. The proof should
 * also be for `indices` within this list of values (i.e generated using
 * `prove(values, indices)` with the same list of indices). `valuesKeccak` should
 * contain the keccak256 hashes of the values references by each index in the same
 * order (i.e for all `i` in `[0, ..., indices.length - 1]`,
 * `valuesKeccak[indices[i]] === keccak256(values[indices[i]])`)
 *
 * @param root The root of the Merkle tree that was built from all the values
 * @param indices The indices of corresponding to the provided values
 * @param valuesKeccak The keccak256 hashes of the values to verify
 * @param proof Merkle multi-proof generated from the original values and the indices
 * @returns True if the root, indices, values and proof correspond
 */
export function verify(
    root: Uint8Array,
    indices: number[],
    valuesKeccak: Uint8Array[],
    proof: Uint8Array[][]
): boolean {
    if (indices.length != valuesKeccak.length) return false;

    // copy the proof, it shouldn't be modified by this function
    const proofCopy = deepCopyProof(proof);

    for (let proofLayer of proofCopy) {
        const b: [number, number][] = [];
        for (let i = 0; i < indices.length; ++i) {
            const currIdx = indices[i];
            const neighborIdx = getNeighborIdx(currIdx);

            if (neighborIdx < currIdx) b.push([neighborIdx, currIdx]);
            else b.push([currIdx, neighborIdx]);
        }

        const nextIndices: number[] = [];
        const nextValues: Uint8Array[] = [];
        for (let i = 0; i < b.length; ++i) {
            if (i < b.length - 1 && b[i][0] == b[i + 1][0]) {
                // duplicate found
                // this means that b[i][0] and b[i][1] are elements of
                // nextIndices. Furthermore, b[i] is computed based on
                // nextIndices[i] and since we skip the duplicates,
                // it can only be that b[i][0] == nextIndices[i]
                // => the corresponding values are valuesKeccak[i]
                // and valuesKeccak[i+1]
                nextValues.push(
                    concatAndHash(valuesKeccak[i], valuesKeccak[i + 1])
                );

                i++; // skip next element (duplicate)
            } else if (proofLayer.length > 0) {
                // index needed to hash elements in the correct order
                const correspondingIdx = indices[i];
                const neighborIdx = getNeighborIdx(correspondingIdx);

                if (neighborIdx < correspondingIdx) {
                    nextValues.push(
                        concatAndHash(proofLayer.pop()!, valuesKeccak[i])
                    );
                } else {
                    nextValues.push(
                        concatAndHash(valuesKeccak[i], proofLayer.pop()!)
                    );
                }
            } else {
                // proofLayer is empty, move the element that must be combined to the next layer
                nextValues.push(valuesKeccak[i]);
            }
            nextIndices.push(indices[i] >> 1);
        }

        valuesKeccak = nextValues;
        indices = nextIndices;
    }

    return bytesArraysAreEqual(valuesKeccak[0], root);
}

/**
 * Returns an incremental proof of the last value of `values`
 *
 * @param values The list of values after the addition
 * @returns An incremental proof that the last value has been added
 */
export function proveExt(values: Uint8Array[]): Uint8Array[][] {
    return prove(values, [values.length - 1]);
}

/**
 * Checks whether `proof` is a valid proof of adding a new value after an existing
 * list of values. Before adding the new value, a Merkle tree built from the
 * original list should have a root `prevRoot` and after the addition, `currRoot`.
 *
 * @param i The index of the added value (== size of the new list - 1)
 * @param prevRoot The root of the Merkle tree before the addition
 * @param currRoot The root of the Merkle tree after the addition
 * @param addedValKeccak The added value's keccak256 hash
 * @param proof The incremental proof of the addition
 * @returns True if the proof is correct for the provided arguments
 */
export function verifyExt(
    i: number,
    prevRoot: Uint8Array,
    currRoot: Uint8Array,
    addedValKeccak: Uint8Array,
    proof: Uint8Array[][]
): boolean {
    return (
        verify(currRoot, [i], [addedValKeccak], proof) &&
        verifyPrevious(prevRoot, proof)
    );
}
