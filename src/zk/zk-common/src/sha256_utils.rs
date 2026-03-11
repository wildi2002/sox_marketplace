use sha2::{Sha256, Digest};

/// Standard SHA-256.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}

/// SHA256(key || r)
pub fn sha256_commit(key: &[u8; 16], r: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(key);
    h.update(r);
    h.finalize().into()
}
