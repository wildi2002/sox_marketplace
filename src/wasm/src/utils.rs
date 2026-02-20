use std::cmp::min;

// ===== Logging & helpers: wasm32 vs natif =====================================

#[cfg(target_arch = "wasm32")]
mod platform {
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
extern "C" {
    /// External JavaScript console.log function binding
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);

    /// External JavaScript console.error function binding
    #[wasm_bindgen(js_namespace = console)]
    pub fn error(s: &str);
}

/// Terminates execution with error message. It will also be displayed in the browser console.
pub fn die(s: &str) -> ! {
    error(s);
    panic!("{}", s);
}

    #[wasm_bindgen]
    pub fn hex_to_bytes(hex_str: String) -> Vec<u8> {
        // Accept both prefixed ("0x...") and raw hex strings.
        let trimmed = hex_str.trim();
        match prefix_hex::decode(trimmed) {
            Ok(bytes) => bytes,
            Err(_) => {
                let no_prefix = trimmed.strip_prefix("0x").unwrap_or(trimmed);
                hex::decode(no_prefix).expect("invalid hex")
            }
        }
    }

    #[wasm_bindgen]
    pub fn bytes_to_hex(vec: Vec<u8>) -> String {
        prefix_hex::encode(&vec)
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod platform {
    /// Simple logger for native builds
    pub fn log(s: &str) {
        eprintln!("[native-log] {s}");
    }

    /// Simple error logger for native builds
    pub fn error(s: &str) {
        eprintln!("[native-error] {s}");
    }

    /// Terminates execution with error message (no wasm-bindgen calls).
    pub fn die(s: &str) -> ! {
        error(s);
        panic!("{s}");
    }

    pub fn hex_to_bytes(hex_str: String) -> Vec<u8> {
        // Accept both prefixed ("0x...") and raw hex strings.
        let trimmed = hex_str.trim();
        match prefix_hex::decode(trimmed) {
            Ok(bytes) => bytes,
            Err(_) => {
                let no_prefix = trimmed.strip_prefix("0x").unwrap_or(trimmed);
                hex::decode(no_prefix).expect("invalid hex")
            }
        }
    }

    pub fn bytes_to_hex(vec: Vec<u8>) -> String {
        prefix_hex::encode(&vec)
    }
}

pub use platform::{bytes_to_hex, die, error, hex_to_bytes, log};
// (implémentée dans `platform::die` ci-dessus)

/// Splits ciphertext into blocks. Assumes the first block is a 16 bytes IV.
///
/// # Arguments
/// * `ct` - Ciphertext bytes to split
/// * `block_size` - Size of each block
///
/// # Returns
/// Vector of blocks where first block is IV and remaining blocks are block_size bytes each
pub fn split_ct_blocks(ct: &[u8], block_size: usize) -> Vec<Vec<u8>> {
    // Pre-allocate with estimated capacity
    let num_blocks = 1 + (ct.len().saturating_sub(16) + block_size - 1) / block_size;
    let mut res = Vec::with_capacity(num_blocks);
    res.push(ct[..16].to_vec()); // IV

    // Optimize: parallelize block extraction for large files
    if ct.len() > 1024 * 1024 { // Only parallelize for files > 1MB
        use rayon::prelude::*;
        let block_indices: Vec<usize> = (16..ct.len()).step_by(block_size).collect();
        let data_blocks: Vec<Vec<u8>> = block_indices
            .into_par_iter()
            .map(|i| {
                let end = min(i + block_size, ct.len());
                ct[i..end].to_vec()
            })
            .collect();
        res.extend(data_blocks);
    } else {
    for i in (16..ct.len()).step_by(block_size) {
        let end = min(i + block_size, ct.len());
        res.push(ct[i..end].to_vec());
        }
    }

    res
}

// hex_to_bytes / bytes_to_hex sont ré-exportées depuis `platform` pour
// être utilisables partout, en wasm comme en natif.
