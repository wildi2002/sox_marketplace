use crate::utils::die;
use std::cmp::min;

/// Checks if all provided byte arrays are equal
///
/// # Arguments
/// * `data` - Vector of at least 2 byte array references to compare
///
/// # Returns
/// Single byte vector containing 1 if all arrays are equal, 0 if not equal
pub fn equal(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() < 2 {
        die("Need at least two elements to check for equality")
    }

    for i in 1..data.len() {
        if data[0].len() != data[i].len() {
            return vec![0u8];
        }
        for j in 0..data[i].len() {
            if data[0][j] != data[i][j] {
                return vec![0u8];
            }
        }
    }

    vec![1u8]
}

/// Internal helper to copy bytes into padded buffer
///
/// # Arguments
/// * `src` - Source byte slice to copy from
/// * `dst` - Destination byte slice to copy into, padding with leading zeros
fn copy_to_padded(src: &[u8], dst: &mut [u8]) {
    let end = min(src.len(), dst.len());
    for i in 0..end {
        dst[dst.len() - end + i] = src[i];
    }
}

/// Adds two numbers represented as byte arrays. They cannot be larger than 16 bytes.
///
/// # Arguments
/// * `data` - Vector containing exactly 2 byte array references to add
///
/// # Returns
/// 16-byte array containing sum as big-endian u128, padded with leading zeros
pub fn binary_add(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() != 2 {
        die("Binary addition only accepts 2 arrays of bytes");
    }

    if data[0].len() > 16 || data[1].len() > 16 {
        die("Binary addition only accepts arrays of at most 16 bytes");
    }

    let mut left = [0u8; 16];
    let mut right = [0u8; 16];
    copy_to_padded(&data[0], &mut left);
    copy_to_padded(&data[1], &mut right);

    (u128::from_be_bytes(left) + u128::from_be_bytes(right))
        .to_be_bytes()
        .to_vec()
}

/// Multiplies two numbers represented as byte arrays. They cannot be larger than 16 bytes.
///
/// # Arguments
/// * `data` - Vector containing exactly 2 byte array references to multiply
///
/// # Returns
/// 16-byte array containing product as big-endian u128, padded with leading zeros
pub fn binary_mult(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() != 2 {
        die("Binary multiplication only accepts 2 arrays of bytes");
    }

    if data[0].len() > 16 || data[1].len() > 16 {
        die("Binary multiplication only accepts arrays of at most 16 bytes");
    }

    let mut left = [0u8; 16];
    let mut right = [0u8; 16];
    copy_to_padded(&data[0], &mut left);
    copy_to_padded(&data[1], &mut right);

    (u128::from_be_bytes(left) * u128::from_be_bytes(right))
        .to_be_bytes()
        .to_vec()
}

/// Concatenates multiple byte arrays
///
/// # Arguments
/// * `data` - Vector of byte array references to concatenate in order
///
/// # Returns
/// Single byte array containing all input arrays concatenated
pub fn concat_bytes(data: &Vec<&Vec<u8>>) -> Vec<u8> {
    if data.len() == 0 {
        return vec![];
    }
    if data.len() == 1 {
        return data[0].clone();
    }
    let mut res = data[0].iter().map(|x| x.clone()).collect();

    for i in 1..data.len() {
        let next = data[i].iter().map(|x| x.clone()).collect();
        res = [res, next].concat();
    }

    res
}
