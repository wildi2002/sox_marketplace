use crate::utils::die;
use crate::{split_ct_blocks, CompiledCircuit};
use crate::circuits_v2::{CompiledCircuitV2, acc_circuit_v2};
use sha3::{Digest, Keccak256};
use js_sys::{Array, Uint8Array};
use rayon::prelude::*;
use wasm_bindgen::prelude::wasm_bindgen;

/// Converts a JavaScript Uint8Array to a Rust Vec<u8>
///
/// # Arguments
/// * `array` - JavaScript Uint8Array to convert
///
/// # Returns
/// A vector containing the bytes from the input array
pub fn uint8_array_to_vec_u8(array: &Uint8Array) -> Vec<u8> {
    (0..array.length()).map(|i| array.get_index(i)).collect()
}

/// Computes the accumulator value. It is the root of the Merkle tree built with `values`.
///
/// # Arguments
/// * `values` - Vector of byte vectors to accumulate
///
/// # Returns
/// A 32-byte vector containing the accumulated hash
pub fn acc(values: &[Vec<u8>]) -> Vec<u8> {
    if values.len() == 0 {
        return vec![];
    }
    if values.len() == 1 {
        return hash(&values[0]);
    }

    let hashes: Vec<Vec<u8>> = values.iter().map(hash).collect();

    compute_merkle_root(hashes)
}

/// Computes the accumulator value for a circuit
///
/// # Arguments
/// * `circuit` - The compiled circuit to accumulate
///
/// # Returns
/// A 32-byte vector containing the accumulated hash of the circuit's components
/// Trait implemented by any compiled circuit that can expose its gate encodings
/// for accumulation. V1 uses ABI encoding; V2 uses the 64-byte gate encoding.
pub trait AccumulableCircuit {
    fn encoded_gates(&self) -> Vec<Vec<u8>>;
    
    /// Optimized accumulation that can avoid storing all encoded gates.
    /// Default implementation uses encoded_gates(), but can be overridden for better performance.
    fn acc_direct(&self) -> Option<Vec<u8>> {
        None // Default: use encoded_gates path
    }
}

impl AccumulableCircuit for CompiledCircuit {
    fn encoded_gates(&self) -> Vec<Vec<u8>> {
        self.to_abi_encoded()
    }
}

impl AccumulableCircuit for CompiledCircuitV2 {
    fn encoded_gates(&self) -> Vec<Vec<u8>> {
        // Fallback: encode all gates (used by V1 path)
        self.gates
            .iter()
            .map(|g| {
                let mut buf = [0u8; 64];
                g.encode_into(&mut buf);
                buf.to_vec()
            })
            .collect()
    }
    
    /// Optimized accumulation for V2: encode and hash in parallel without storing all gates
    fn acc_direct(&self) -> Option<Vec<u8>> {
        Some(acc_circuit_v2(&self.gates))
    }
}

/// Computes the accumulator value for a circuit (v1 or v2).
/// Selects an optimized 64-byte Merkle accumulator when all gates are 64B.
/// For V2 circuits, uses acc_direct() to avoid storing all encoded gates.
pub fn acc_circuit<C: AccumulableCircuit>(circuit: &C) -> Vec<u8> {
    // Try optimized direct path first (for V2)
    if let Some(result) = circuit.acc_direct() {
        return result;
    }
    
    // Fallback to encoded_gates path (for V1 or when acc_direct not implemented)
    let circuit_bytes_array = circuit.encoded_gates();
    let use_fixed64 = circuit_bytes_array.iter().all(|g| g.len() == 64);

    if use_fixed64 {
        // Use optimized parallel accumulator for 64-byte gates
        acc_fixed64(&circuit_bytes_array)
    } else {
        acc(&circuit_bytes_array)
    }
}

/// Computes the accumulator value for a ciphertext
///
/// # Arguments
/// * `ct` - The ciphertext bytes
/// * `block_size` - Size of each block in bytes
///
/// # Returns
/// A 32-byte vector containing the accumulated hash of the ciphertext blocks
/// Optimized to use fixed64 accumulator for better performance
pub fn acc_ct(ct: &[u8], block_size: usize) -> Vec<u8> {
    let blocks = split_ct_blocks(ct, block_size);
    
    // Use acc_fixed64 for better performance (all blocks are 64B)
    if block_size == 64 {
        acc_fixed64(&blocks)
    } else {
        acc(&blocks)
    }
}

/// Generates a proof for a subset of values in a sequence. Inspired by
/// https://arxiv.org/pdf/2002.07648
///
/// # Arguments
/// * `values` - Complete sequence of values
/// * `indices` - Indices of values to include in the proof
///
/// # Returns
/// A vector of proof components
pub fn prove(values: &[Vec<u8>], indices: &[u32]) -> Vec<Vec<Vec<u8>>> {
    if values.len() < indices.len() {
        die(&format!(
            "Number of indices ({}) is greater than number of values ({})",
            indices.len(),
            values.len()
        ));
    }
    if indices.len() == 0 || values.len() == 0 {
        return vec![];
    }
    let mut a = indices.to_vec();
    a.sort();

    let mut proof: Vec<Vec<Vec<u8>>> = vec![];

    let mut curr_layer: Vec<Vec<u8>> = values.iter().map(hash).collect();

    while curr_layer.len() > 1 {
        let mut b: Vec<(u32, u32)> = vec![];
        let mut diff: Vec<u32> = vec![];

        let mut i = 0;
        while i < a.len() {
            let idx = a[i];
            let neighbor = get_neighbor_idx(&idx);
            if idx < neighbor {
                b.push((idx, neighbor));
            } else {
                b.push((neighbor, idx));
            }

            if i < a.len() - 1 && neighbor == a[i + 1] {
                i += 1;
            }

            if !a.contains(&neighbor) && neighbor < curr_layer.len() as u32 {
                diff.push(neighbor);
            }
            i += 1;
        }

        proof.push(
            diff.iter()
                .rev()
                .map(|&i| curr_layer[i as usize].clone())
                .collect(),
        );

        curr_layer = compute_next_layer(curr_layer);
        a = b.iter().map(|p| p.0 >> 1).collect();
    }

    proof
}

/// Generates an extension proof for a sequence of values
///
/// # Arguments
/// * `values` - Sequence of values to generate the proof for
///
/// # Returns
/// A vector of proof components demonstrating correct extension
pub fn prove_ext(values: &[Vec<u8>]) -> Vec<Vec<Vec<u8>>> {
    prove(values, &vec![(values.len() - 1) as u32])
}

/// Converts a proof to a JavaScript array
///
/// # Arguments
/// * `proof` - Vector of proof components
///
/// # Returns
/// A JavaScript Array containing the proof components as Uint8Arrays
pub fn proof_to_js_array(proof: Vec<Vec<Vec<u8>>>) -> Array {
    Array::from_iter(
        proof
            .iter()
            .map(|l| Array::from_iter(l.iter().map(|v| Uint8Array::from(v.as_slice())))),
    )
}

/// JavaScript wrapper of the accumulator function
///
/// # Arguments
/// * `values` - Array of Uint8Arrays to accumulate
///
/// # Returns
/// Accumulated value as bytes
#[wasm_bindgen]
pub fn acc_js(values: Vec<Uint8Array>) -> Vec<u8> {
    let values_vec: Vec<Vec<u8>> = values.iter().map(uint8_array_to_vec_u8).collect();
    acc(&values_vec)
}

/// JavaScript wrapper of the prove function
///
/// # Arguments
/// * `values` - Array of Uint8Arrays containing all values in the tree
/// * `indices` - Array of indices for values to include in proof
///
/// # Returns
/// Array of arrays of Uint8Arrays containing the proof layers
#[wasm_bindgen]
pub fn prove_js(values: Vec<Uint8Array>, indices: Array) -> Array {
    let values_vec: Vec<Vec<u8>> = values.iter().map(uint8_array_to_vec_u8).collect();
    let indices_u32 = indices
        .iter()
        .map(|i| i.as_f64().unwrap() as u32)
        .collect::<Vec<u32>>();
    let proof = prove(&values_vec, &indices_u32);
    proof_to_js_array(proof)
}

/// JavaScript wrapper of the prove_ext function
///
/// # Arguments
/// * `values` - Array of Uint8Arrays containing the sequence of values
///
/// # Returns
/// Array of Uint8Arrays containing the extension proof components
#[wasm_bindgen]
pub fn prove_ext_js(values: Vec<Uint8Array>) -> Array {
    let values_vec: Vec<Vec<u8>> = values.iter().map(uint8_array_to_vec_u8).collect();
    let proof = prove_ext(&values_vec);
    proof_to_js_array(proof)
}

// Computes the root of a Merkle tree given the leaf hashes
fn compute_merkle_root(hashes: Vec<Vec<u8>>) -> Vec<u8> {
    let mut curr_layer = hashes;

    while curr_layer.len() > 1 {
        curr_layer = compute_next_layer(curr_layer)
    }

    curr_layer.remove(0)
}

// Computes the layer above in a Merkle tree. If the layer has odd number of nodes, the last one is
// copied as-is.
// FIXME could introduce issues when using it as proofs. E.g [1,2,3,4] and [1,2,h(3)||h(4)] lead to
// the same root !!
fn compute_next_layer(curr_layer: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    (0..curr_layer.len())
        .step_by(2)
        .collect::<Vec<_>>()
        .par_iter()
        .map(|&i| {
            if i < curr_layer.len() - 1 {
                concat_and_hash(&curr_layer[i], &curr_layer[i + 1])
            } else {
                curr_layer[i].clone()
            }
        })
        .collect()
}

// Returns the index of the neighbor node
fn get_neighbor_idx(index: &u32) -> u32 {
    if index % 2 == 0 {
        index + 1
    } else {
        index - 1
    }
}

// Concatenates two 32-byte vectors and hashes the result. Panics if one of the vectors is not 32
// bytes long
fn concat_and_hash(left: &Vec<u8>, right: &Vec<u8>) -> Vec<u8> {
    assert_eq!(left.len(), 32);
    assert_eq!(right.len(), 32);

    let mut hasher = Keccak256::new();
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().to_vec()
}

// Computes SHA256' (single compression without padding) of a 64-byte block.
// Values shorter than 64 bytes are right-padded with zeros; longer values are truncated.
fn hash(data: &Vec<u8>) -> Vec<u8> {
    hash_block64(data).to_vec()
}

// Optimized hashing for fixed 64-byte semantics, returning array to reduce reallocations.
// Accepts both Vec and slice for flexibility
pub(crate) fn hash_block64(data: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if data.len() >= 64 {
        block.copy_from_slice(&data[..64]);
    } else {
        block[..data.len()].copy_from_slice(data);
    }
    let mut hasher = Keccak256::new();
    hasher.update(&block);
    hasher.finalize().into()
}

/// Optimized accumulator when every value is treated as a 64-byte block (padded/tronqué).
/// Returns the Merkle root as 32 bytes.
/// Uses parallel processing for maximum performance.
pub fn acc_fixed64(values: &[Vec<u8>]) -> Vec<u8> {
    if values.is_empty() {
        return vec![];
    }
    if values.len() == 1 {
        return hash_block64(&values[0]).to_vec();
    }

    // Parallel hash of all leaves
    let mut layer: Vec<[u8; 32]> = values.par_iter().map(|v| hash_block64(v)).collect();

    // Parallel computation of each layer
    // CRITICAL: Use indexed parallel iteration to preserve order deterministically
    while layer.len() > 1 {
        let layer_ref = &layer; // Create reference for closure
        let indices: Vec<usize> = (0..layer_ref.len()).step_by(2).collect();
        let next: Vec<[u8; 32]> = indices
            .into_par_iter()
            .map(|i| {
                if i + 1 < layer_ref.len() {
                    // Pair exists: hash pair[i] and pair[i+1]
                    let mut hasher = Keccak256::new();
                    hasher.update(&layer_ref[i]);
                    hasher.update(&layer_ref[i + 1]);
                    hasher.finalize().into()
                } else {
                    // Odd element: copy as-is
                    layer_ref[i]
                }
            })
            .collect();
        layer = next;
    }

    layer[0].to_vec()
}

// =================================================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rand::prelude::SliceRandom;
    use rand::Rng;

    #[test]
    pub fn test_acc_simple_root() {
        //          root
        //          /  \
        //         l1  l2
        //          |   |
        //       0xdead 0xbeef
        let values = vec![vec![0xde, 0xad], vec![0xbe, 0xef]];
        let expected_root = concat_and_hash(&hash(&values[0]), &hash(&values[1]));

        let root = acc(&values);
        assert_eq!(expected_root, root);
    }

    #[test]
    pub fn test_proof_simple_tree() {
        let values = vec![vec![0xde, 0xad], vec![0xbe, 0xef]];
        let indices = vec![0];
        let expected_proof = vec![vec![hash(&values[1])]];

        let proof = prove(&values, &indices);
        assert_eq!(expected_proof, proof);
    }

    #[test]
    pub fn test_accumulator() {
        let mut rng = rand::rng();
        for i in 1..1000u32 {
            let values: Vec<Vec<u8>> = random_values(i);

            let h = acc(&values);

            // generate random number of indices
            let num_indices = rng.random_range(1..=i as usize);
            // let num_indices = 3;
            let mut indices: Vec<u32> = (0..i).collect();
            indices.shuffle(&mut rng);
            indices.truncate(num_indices);
            indices.sort(); // ensure indices are increasing

            // Get the values at the indices of the vector `indices`
            let proof_values: Vec<Vec<u8>> = indices
                .iter()
                .map(|&idx| values[idx as usize].clone())
                .collect();

            // Call `prove(&proof_values, &indices)` and store in `proof`
            let proof = prove(&values, &indices);

            // Call `verify(&h, &indices, &proof_values, &proof)` and assert that it should be true
            assert!(
                verify(&h, &indices, &proof_values, &proof),
                "Verification failed for i = {}",
                1
            );
        }
    }

    #[test]
    pub fn test_incr_accumulator() {
        for i in 2..1000u32 {
            let values: Vec<Vec<u8>> = random_values(i);

            let prev_h = acc(&values[..(i - 1) as usize]);
            let curr_h = acc(&values);
            let proof = prove_ext(&values);

            assert!(
                verify_ext(i - 1, &prev_h, &curr_h, values.last().unwrap(), &proof),
                "Verification failed for i = {}",
                i
            );
        }
    }

    fn random_values(num_bytes: u32) -> Vec<Vec<u8>> {
        let mut rng = rand::rng();

        (0..num_bytes)
            .map(|_| (0..1).map(|_| rng.random_range(0..=255)).collect())
            .collect()
    }

    /// Verifies an extension proof. Not useful at the moment apart from testing.
    ///
    /// # Arguments
    /// * `i` - Position in the sequence
    /// * `prev_h` - Previous accumulator value
    /// * `curr_h` - Current accumulator value
    /// * `value` - Value being added
    /// * `proof` - Extension proof components
    ///
    /// # Returns
    /// true if the proof is valid, false otherwise
    fn verify_ext(
        i: u32,
        prev_root: &Vec<u8>,
        curr_root: &Vec<u8>,
        added_val: &Vec<u8>,
        proof: &Vec<Vec<Vec<u8>>>,
    ) -> bool {
        verify(curr_root, &vec![i], &vec![added_val.clone()], proof)
            && verify_previous(prev_root, proof)
    }

    /// Verifies a Merkle proof for multiple values in a tree. Inspired by
    /// https://arxiv.org/pdf/2002.07648
    ///
    /// # Arguments
    /// * `root` - Expected Merkle root hash
    /// * `indices` - Vector of indices for the values being proven
    /// * `values` - Slice of values being proven
    /// * `proof` - Vector of proof layers, where each layer contains the sibling hashes needed for
    ///             verification
    ///
    /// # Returns
    /// `true` if:
    /// - The number of indices matches the number of values
    /// - The proof successfully reconstructs the Merkle root
    /// - All sibling relationships are valid
    /// `false` otherwise
    ///
    fn verify(
        root: &Vec<u8>,
        indices: &Vec<u32>,
        values: &[Vec<u8>],
        proof: &Vec<Vec<Vec<u8>>>,
    ) -> bool {
        if indices.len() != values.len() {
            return false;
        }

        let mut proof_copy = proof.clone();
        let mut current_indices = indices.clone();
        let mut layer: Vec<Vec<u8>> = values.iter().map(hash).collect();

        let mut paired: Vec<(u32, Vec<u8>)> =
            current_indices.into_iter().zip(layer.into_iter()).collect();
        paired.sort_by_key(|pair| pair.0);
        (current_indices, layer) = paired.into_iter().unzip();

        for proof_layer in &mut proof_copy {
            let mut b: Vec<(u32, u32)> = vec![];

            for i in &current_indices {
                let neighbor = get_neighbor_idx(i);

                if neighbor < *i {
                    b.push((neighbor, i.clone()))
                } else {
                    b.push((i.clone(), neighbor))
                }
            }

            let mut next_indices: Vec<u32> = vec![];
            let mut next_layer: Vec<Vec<u8>> = vec![];

            let mut i = 0;
            while i < b.len() {
                // use a while loop because we cannot manually increment in for loops
                if i < b.len() - 1 && b[i].0 == b[i + 1].0 {
                    // duplicate found
                    // this means that b[i][0] and b[i][1] are elements of
                    // nextIndices. Furthermore, b[i] is computed based on
                    // nextIndices[i] and since we skip the duplicates,
                    // it can only be that b[i][0] == nextIndices[i]
                    // => the corresponding values are valuesKeccak[i]
                    // and valuesKeccak[i+1]
                    next_layer.push(concat_and_hash(&layer[i], &layer[i + 1]));

                    i += 1;
                } else if proof_layer.len() > 0 {
                    let last_layer_val = proof_layer.pop().unwrap();

                    if current_indices[i] % 2 == 1 {
                        next_layer.push(concat_and_hash(&last_layer_val, &layer[i]));
                    } else {
                        next_layer.push(concat_and_hash(&layer[i], &last_layer_val));
                    }
                } else {
                    // proofLayer is empty, move the element that must be combined to the next layer
                    next_layer.push(layer[i].clone());
                }

                next_indices.push(current_indices[i] >> 1);
                i += 1;
            }

            layer = next_layer.clone();
            current_indices = next_indices.clone();
        }

        layer[0].eq(root)
    }

    // Verifies the previous root of the accumulator. Used only for verify_ext.
    fn verify_previous(prev_root: &Vec<u8>, proof: &Vec<Vec<Vec<u8>>>) -> bool {
        let mut proof_copy = proof.clone();
        let mut first_found = false;
        let mut computed_root: Vec<u8> = vec![];

        for i in 0..proof_copy.len() {
            while proof_copy[i].len() > 0 {
                if !first_found {
                    computed_root = proof_copy[i].pop().unwrap();
                    first_found = true;
                } else {
                    computed_root = concat_and_hash(&proof_copy[i].pop().unwrap(), &computed_root);
                }
            }
        }

        computed_root.eq(prev_root)
    }
}
