use crate::accumulator::uint8_array_to_vec_u8;
use crate::utils::die;
use js_sys::Uint8Array;
use sha2::{Digest, Sha256};
use sha2_compress::{Sha2, SHA256};
use wasm_bindgen::prelude::wasm_bindgen;

// Converts a byte array into an array of 32-bit unsigned integers
fn u8_array_to_u32_array(vec: &[u8]) -> [u32; 8] {
    if vec.len() != 32 {
        die("Input vector must have exactly 32 elements.");
    }

    let mut res: [u32; 8] = [0; 8];

    for i in 0..8 {
        res[i] = ((vec[i * 4] as u32) << 24)
            | ((vec[i * 4 + 1] as u32) << 16)
            | ((vec[i * 4 + 2] as u32) << 8)
            | (vec[i * 4 + 3] as u32);
    }

    res
}

// Converts an array of 32-bit unsigned integers into a byte vector
fn u32_array_to_u8_vec(array: &[u32; 8]) -> Vec<u8> {
    let mut res = Vec::with_capacity(32);

    for byte in array {
        res.push(((byte >> 24) & 0xFFu32) as u8);
        res.push(((byte >> 16) & 0xFFu32) as u8);
        res.push(((byte >> 8) & 0xFFu32) as u8);
        res.push((byte & 0xFFu32) as u8);
    }

    res
}

/// Performs SHA-256 compression on the input data
///
/// # Arguments
/// * `data` - Vector containing either:
///   - One element: current block to compress. In that case the SHA-256 default initial hash
///     is used.
///   - Two elements: previous hash (32 bytes) and current block
///
/// # Returns
/// A 32-byte vector containing the compressed result
pub fn sha256_compress(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() != 1 && data.len() != 2 {
        die("Input data for compression must have exactly 1 or 2 elements.");
    }
    let prev_hash = if data.len() == 1 {
        SHA256
    } else {
        u8_array_to_u32_array(data[0])
    };
    let curr_block = if data.len() == 1 { data[0] } else { data[1] };

    // Optimize: avoid bounds check by ensuring curr_block is at least 64 bytes
    if curr_block.len() < 64 {
        die("Current block must be at least 64 bytes for compression");
    }

    let h1 = u8_array_to_u32_array(&curr_block[..32]);
    let h2 = u8_array_to_u32_array(&curr_block[32..64]);
    let res = prev_hash.compress(&h1, &h2);

    u32_array_to_u8_vec(&res)
}

// Performs SHA-256 standard padding on the input data
fn sha256_padding(input: &Vec<u8>, data_len: u64) -> Vec<u8> {
    let mut padded_len = input.len() + 9;
    if padded_len < 64 {
        padded_len = 64
    } else if padded_len > 64 {
        padded_len = 128
    }

    let mut padded = vec![0u8; padded_len - 8];
    for i in 0..input.len() {
        padded[i] = input[i];
    }
    padded[input.len()] = 0x80;
    padded.extend(&(data_len * 8).to_be_bytes());

    padded
}

/// Performs SHA-256 compression with padding. Only accepts one block.
///
/// # Arguments
/// * `data` - Vector containing either:
///   - Two elements: current block and data length (8 bytes)
///   - Three elements: previous hash (32 bytes), current block, and data length (8 bytes)
///
/// # Returns
/// A 32-byte vector containing the final hash
///
/// # Panics
/// Panics if:
/// - Input doesn't have exactly 2 or 3 elements
/// - Previous hash (if present) is not 32 bytes
/// - Data length is not 8 bytes
pub fn sha256_compress_final(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() != 2 && data.len() != 3 {
        let msg = format!(
            "Input data for the final compression must have exactly 2 or 3 elements. Got {}",
            data.len()
        );
        die(&msg);
    }

    if data.len() == 3 && data[0].len() != 32 {
        die(&format!(
            "Previous hash on the final compression must be 32 bytes long. Got {}",
            data[0].len()
        ));
    }

    if data[data.len() - 1].len() != 8 {
        die(&format!(
            "Data length on the final compression must be 8 bytes long. Got {}",
            data[data.len() - 1].len()
        ));
    }

    let prev_hash = if data.len() == 2 {
        SHA256
    } else {
        u8_array_to_u32_array(data[0])
    };
    let curr_block = data[data.len() - 2];
    let data_len = u64::from_be_bytes(data[data.len() - 1].clone().try_into().unwrap());

    let padded = sha256_padding(&curr_block, data_len);
    let h1 = u8_array_to_u32_array(&padded[..32]);
    let h2 = u8_array_to_u32_array(&padded[32..64]);
    let mut res = prev_hash.compress(&h1, &h2);

    if padded.len() > 64 {
        // an extra block left due to the padding
        let h1 = u8_array_to_u32_array(&padded[64..96]);
        let h2 = u8_array_to_u32_array(&padded[96..]);
        res = res.compress(&h1, &h2);
    }

    u32_array_to_u8_vec(&res)
}

/// Computes the SHA-256 hash of input data
///
/// # Arguments
/// * `data` - Input bytes to hash
///
/// # Returns
/// A 32-byte vector containing the SHA-256 hash
pub fn sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// JavaScript-compatible wrapper for sha256_compress_final
///
/// # Arguments
/// * `data` - Vector of Uint8Arrays containing the input data
///
/// # Returns
/// A byte vector containing the final hash
#[wasm_bindgen]
pub fn sha256_compress_final_js(data: Vec<Uint8Array>) -> Vec<u8> {
    let values_vec: Vec<Vec<u8>> = data.iter().map(uint8_array_to_vec_u8).collect();
    let refs: Vec<&Vec<u8>> = values_vec.iter().collect();
    sha256_compress_final(&refs)
}

/// JavaScript-compatible wrapper for sha256_compress
///
/// # Arguments
/// * `data` - Vector of Uint8Arrays containing the input data
///
/// # Returns
/// A byte vector containing the compressed result
#[wasm_bindgen]
pub fn sha256_compress_js(data: Vec<Uint8Array>) -> Vec<u8> {
    let values_vec: Vec<Vec<u8>> = data.iter().map(uint8_array_to_vec_u8).collect();
    let refs: Vec<&Vec<u8>> = values_vec.iter().collect();
    sha256_compress(&refs)
}
