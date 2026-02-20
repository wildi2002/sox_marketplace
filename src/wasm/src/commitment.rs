use rand::RngCore;
use sha3::{Digest, Keccak256};
use wasm_bindgen::prelude::wasm_bindgen;

/// Represents a commitment with its commitment value and opening value
#[wasm_bindgen]
#[derive(Clone)]
pub struct Commitment {
    /// The commitment value
    #[wasm_bindgen(getter_with_clone)]
    pub c: Vec<u8>,

    /// The opening value
    #[wasm_bindgen(getter_with_clone)]
    pub o: Vec<u8>,
}

/// Creates a commitment for the given data by appending random bytes and hashing
///
/// # Arguments
/// * `data` - Data to commit to
///
/// # Returns
/// A `Commitment` containing the commitment hash and opening value
#[wasm_bindgen]
pub fn commit(data: &[u8]) -> Commitment {
    let mut rng = rand::rng();
    let mut r = [0u8; 16];
    rng.fill_bytes(&mut r);
    let opening_value = [data, &r].concat();

    let mut hasher = Keccak256::new();
    hasher.update(&opening_value);

    Commitment {
        c: hasher.finalize().to_vec(),
        o: opening_value,
    }
}

/// Creates a commitment for a pair of circuit and ciphertext accumulator hashes
///
/// # Arguments
/// * `h_circuit` - Hash of the circuit
/// * `h_ct` - Hash of the ciphertext
///
/// # Returns
/// A `Commitment` containing the combined commitment hash and opening value
pub fn commit_hashes(h_circuit: &[u8], h_ct: &[u8]) -> Commitment {
    commit(&[h_circuit, h_ct].concat())
}

/// Verifies and opens a commitment using its opening value
///
/// # Arguments
/// * `commitment` - The commitment hash to verify
/// * `opening_value` - The opening value (preimage)
///
/// # Returns
/// * `Ok(Vec<u8>)` - The original committed data if verification succeeds
/// * `Err(&str)` - Error message if verification fails
pub fn open_commitment_internal(
    commitment: &Vec<u8>,
    opening_value: &Vec<u8>,
) -> Result<Vec<u8>, &'static str> {
    let mut hasher = Keccak256::new();
    hasher.update(&opening_value);
    if !commitment.eq(&hasher.finalize().to_vec()) {
        return Err("The commitments do not match");
    }

    Ok(opening_value[..(opening_value.len() - 16)].to_vec())
}
