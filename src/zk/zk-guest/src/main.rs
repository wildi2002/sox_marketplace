#![no_main]
sp1_zkvm::entrypoint!(main);

use zk_common::{
    sha256_utils::sha256,
    thumbnail::thumbnail_hash,
    brisque::compute_brisque,
};

pub fn main() {
    // Private inputs
    let image: Vec<u8> = sp1_zkvm::io::read();

    // Hash of plaintext — used as on-chain binding (d = SHA256(pt))
    let h_pt = sha256(&image);

    // Advertising properties
    let ap1 = thumbnail_hash(&image).expect("thumbnail_hash failed");
    let ap2: f32 = compute_brisque(&image).expect("brisque failed");

    // Public outputs: h_pt (32) + ap1 (32) + ap2 (4) = 68 bytes total
    sp1_zkvm::io::commit_slice(&h_pt);
    sp1_zkvm::io::commit_slice(&ap1);
    sp1_zkvm::io::commit_slice(&ap2.to_le_bytes());
}
