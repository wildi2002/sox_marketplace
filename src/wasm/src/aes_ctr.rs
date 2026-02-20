use crate::accumulator::uint8_array_to_vec_u8;
use crate::utils::die;
use aes::cipher::{KeyIvInit, StreamCipher};
use js_sys::Uint8Array;
use wasm_bindgen::prelude::wasm_bindgen;

type Aes128Ctr128BE = ctr::Ctr128BE<aes::Aes128>;

/*
 * data = [
 *      key (16 bytes),
 *      blocks (<=64 bytes),
 *      IV (16 bytes)
 * ]
 */

/// Encrypts or decrypts a block using AES-128 in CTR mode
///
/// # Arguments
/// * `data` - Vector containing:
///   - key (16 bytes)
///   - blocks to encrypt (<=64 bytes)
///   - IV/counter starting value (16 bytes)
///
/// # Returns
/// Encrypted/decrypted bytes
pub fn encrypt_block(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() < 3 {
        die("AES encryption/decryption requires a key, blocks and counter starting value")
    }

    if data[0].len() != 16 {
        die("AES encryption/decryption requires a key of exactly 16 bytes")
    }

    if data[1].len() > 64 {
        die("AES encryption/decryption requires blocks of at most 64 bytes");
    }

    if data[1].len() == 0 {
        return vec![];
    }

    if data[2].len() != 16 {
        die("AES encryption/decryption requires a counter starting value of exactly 16 bytes");
    }

    let key = &data[0][..16];
    let blocks = &data[1][..];
    let ctr = &data[2][..];

    internal_encrypt(key, blocks, ctr)
}

/// Decrypts a block using AES-128 in CTR mode (same as encrypt)
///
/// # Arguments
/// * `data` - Vector containing:
///   - key (16 bytes)
///   - blocks to decrypt (<=112 bytes)
///   - IV/counter starting value (16 bytes)
///
/// # Returns  
/// Decrypted bytes
pub fn decrypt_block(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    encrypt_block(data)
}

/// JavaScript wrapper for encrypt_block
///
/// # Arguments
/// * `data` - Vector of Uint8Arrays containing:
///   - key (16 bytes)
///   - blocks to encrypt (<=112 bytes)
///   - IV/counter starting value (16 bytes)
///
/// # Returns
/// Encrypted bytes
#[wasm_bindgen]
pub fn encrypt_block_js(data: Vec<Uint8Array>) -> Vec<u8> {
    let values_vec: Vec<Vec<u8>> = data.iter().map(uint8_array_to_vec_u8).collect();
    let refs: Vec<&Vec<u8>> = values_vec.iter().collect();
    encrypt_block(&refs)
}

/// JavaScript wrapper for decrypt_block
///
/// # Arguments
/// * `data` - Vector of Uint8Arrays containing:
///   - key (16 bytes)
///   - blocks to decrypt (<=112 bytes)
///   - IV/counter starting value (16 bytes)
///
/// # Returns
/// Decrypted bytes
#[wasm_bindgen]
pub fn decrypt_block_js(data: Vec<Uint8Array>) -> Vec<u8> {
    let values_vec: Vec<Vec<u8>> = data.iter().map(uint8_array_to_vec_u8).collect();
    let refs: Vec<&Vec<u8>> = values_vec.iter().collect();
    decrypt_block(&refs)
}

/// Internal helper for AES-CTR encryption/decryption
///
/// # Arguments
/// * `key` - 16 byte key
/// * `block` - Data to encrypt/decrypt
/// * `ctr` - 16 byte counter/IV
///
/// # Returns
/// Encrypted/decrypted data
fn internal_encrypt(key: &[u8], block: &[u8], ctr: &[u8]) -> Vec<u8> {
    let mut res = vec![0u8; block.len()];
    res.clone_from_slice(block);

    let mut cipher = match Aes128Ctr128BE::new_from_slices(key, ctr) {
        Ok(c) => c,
        Err(_) => die("Key should be 16 bytes"),
    };
    cipher.apply_keystream(&mut res);

    res
}

// =================================================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn test_aes_ctr_blocks() {
        let mut rng = rand::rng();
        for i in 1..(1 << 12) {
            let mut data = vec![0u8; i];
            rng.fill_bytes(&mut data);
            let data_orig = data.clone();

            let mut key = vec![0u8; 16];
            rng.fill_bytes(&mut key);

            let mut ctr = vec![0u8; 64];
            rng.fill_bytes(&mut ctr);

            // encrypt
            let ct = encrypt_block(&vec![&key, &data, &ctr]);

            // decrypt
            let pt = decrypt_block(&vec![&key, &ct, &ctr]);

            assert_eq!(pt, data_orig)
        }
    }
}
