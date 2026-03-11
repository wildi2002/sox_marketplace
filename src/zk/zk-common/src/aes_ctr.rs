use aes::Aes128;
use ctr::Ctr128BE;
use ctr::cipher::{KeyIvInit, StreamCipher};

/// AES-128-CTR encrypt. Returns iv || ciphertext.
pub fn aes_ctr_encrypt(plaintext: &[u8], key: &[u8; 16], iv: &[u8; 16]) -> Vec<u8> {
    let mut buf = plaintext.to_vec();
    let mut cipher = Ctr128BE::<Aes128>::new(key.into(), iv.into());
    cipher.apply_keystream(&mut buf);

    let mut out = Vec::with_capacity(16 + buf.len());
    out.extend_from_slice(iv);
    out.extend_from_slice(&buf);
    out
}
