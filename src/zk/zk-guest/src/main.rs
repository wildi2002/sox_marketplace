#![no_main]
sp1_zkvm::entrypoint!(main);

use zk_common::{
    aes_ctr::aes_ctr_encrypt,
    sha256_utils::{sha256, sha256_commit},
    thumbnail::thumbnail_hash,
    brisque::compute_brisque,
};

pub fn main() {
    // Private inputs
    let key: [u8; 16] = sp1_zkvm::io::read();
    let r: [u8; 32] = sp1_zkvm::io::read();
    let iv: [u8; 16] = sp1_zkvm::io::read();
    let image: Vec<u8> = sp1_zkvm::io::read();

    // Compute ciphertext (IV prepended)
    let ct = aes_ctr_encrypt(&image, &key, &iv);
    let h_ct = sha256(&ct);

    // Advertising properties
    let ap1 = thumbnail_hash(&image).expect("thumbnail_hash failed");
    let ap2: f32 = compute_brisque(&image).expect("brisque failed");

    // Key commitment
    let c_k = sha256_commit(&key, &r);

    // Public outputs
    sp1_zkvm::io::commit_slice(&h_ct);
    sp1_zkvm::io::commit_slice(&ap1);
    sp1_zkvm::io::commit_slice(&ap2.to_le_bytes());
    sp1_zkvm::io::commit_slice(&c_k);
}
