use crate::utils::die;
use aes::cipher::{KeyIvInit, StreamCipher};
use rand::RngCore;

type Aes128Ctr128BE = ctr::Ctr128BE<aes::Aes128>;

/// Encrypts data using AES-128 in counter mode and prepends IV in 16 bytes big endian
/// representation. `ct = IV (16 bytes) || Enc_k(data) (variable size)`
///
/// # Arguments
/// * `data` - Mutable slice containing data to encrypt
/// * `key` - Key bytes (must be 16 bytes)
///
/// # Returns
/// Vector containing IV (16 bytes) followed by encrypted data
pub fn encrypt_and_prepend_iv(mut data: &mut [u8], key: &[u8]) -> Vec<u8> {
    encrypt_and_prepend_iv_flagged(data, key, false)
}

/// Like `encrypt_and_prepend_iv` but encodes a 1-bit flag in IV[15] bit-7.
/// flag=true  → bit 7 of IV[15] is set   (signals LZ4-compressed plaintext)
/// flag=false → bit 7 of IV[15] is clear (signals uncompressed plaintext)
/// AES encryption uses the IV *after* the flag bit is applied, so decryption
/// reads the correct flag and uses the same IV for AES.
pub fn encrypt_and_prepend_iv_flagged(mut data: &mut [u8], key: &[u8], lz4_flag: bool) -> Vec<u8> {
    let mut rng = rand::rng();
    let mut iv = vec![0u8; 16];
    rng.fill_bytes(&mut iv);

    if lz4_flag { iv[15] |= 0x80; } else { iv[15] &= 0x7F; }

    let mut cipher = match Aes128Ctr128BE::new_from_slices(key, &iv) {
        Ok(c) => c,
        Err(_) => die("Key must be 16 bytes"),
    };

    cipher.apply_keystream(&mut data);

    let mut result = Vec::with_capacity(16 + data.len());
    result.extend_from_slice(&iv);
    result.extend_from_slice(data);
    result
}

/// Decrypts AES-128 CTR mode ciphertext. The IV must be in big-endian representation.
///
/// # Arguments
/// * `ct` - Ciphertext bytes in format: IV (16 bytes) || Encrypted data
/// * `key` - Key bytes (must be 16 bytes)
///
/// # Returns
/// Decrypted plaintext bytes
pub fn decrypt(ct: &[u8], key: &[u8]) -> Vec<u8> {
    let iv = &ct[..16];
    let mut cipher = match Aes128Ctr128BE::new_from_slices(key, &iv) {
        Ok(c) => c,
        Err(_) => die("Key should be 16 bytes"),
    };

    let mut res = ct[16..].to_vec();

    cipher.apply_keystream(&mut res);

    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_random_data() {
        let mut rng = rand::rng();
        for i in 1..(1 << 16) {
            let mut data = vec![0u8; i];
            rng.fill_bytes(&mut data);
            let plaintext = data.clone();

            let mut key = vec![0u8; 16];
            rng.fill_bytes(&mut key);

            // encrypt
            let ct = encrypt_and_prepend_iv(&mut data, &key);

            // decrypt
            let dec_ct = decrypt(&ct, &key);

            assert_eq!(plaintext, dec_ct);
        }
    }
}
