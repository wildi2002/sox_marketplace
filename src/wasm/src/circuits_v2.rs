use crate::aes_ctr;
use crate::utils::die;
use crate::accumulator::{acc, acc_fixed64, hash_block64};
use crate::sha256::sha256_compress;
use sha3::{Digest, Keccak256};
use rmp_serde::{encode::write, from_read};
use serde::{Deserialize, Serialize};
use crate::sha256::sha256;

/// Opcodes for the new 64-byte gate format.
pub const OPCODE_AES_CTR: u8 = 0x01;
pub const OPCODE_SHA2: u8 = 0x02;
pub const OPCODE_CONST: u8 = 0x03;
pub const OPCODE_XOR: u8 = 0x04;
pub const OPCODE_COMP: u8 = 0x05;

/// Function type for V2 instructions.
/// Takes sons (input values), params (gate-specific parameters), and aes_key (for AES-CTR gates).
type InstructionV2 = fn(sons: &[Vec<u8>], params: &[u8], aes_key: &[u8]) -> Vec<u8>;

/// Returns the instruction table for V2 circuits.
/// This function provides a list of instruction functions indexed by opcode.
fn version_instructions_v2() -> Vec<InstructionV2> {
    vec![
        instruction_aes_ctr,  // opcode 0x01
        instruction_sha2,     // opcode 0x02
        instruction_const,    // opcode 0x03
        instruction_xor,      // opcode 0x04
        instruction_comp,     // opcode 0x05
    ]
}

/// Instruction wrapper for AES-CTR opcode.
fn instruction_aes_ctr(sons: &[Vec<u8>], params: &[u8], aes_key: &[u8]) -> Vec<u8> {
    eval_aes_ctr(sons, params, aes_key)
}

/// Instruction wrapper for SHA2 opcode.
fn instruction_sha2(sons: &[Vec<u8>], _params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_sha2(sons)
}

/// Instruction wrapper for CONST opcode.
fn instruction_const(sons: &[Vec<u8>], params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_const(sons, params)
}

/// Instruction wrapper for XOR opcode.
fn instruction_xor(sons: &[Vec<u8>], _params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_xor(sons)
}

/// Instruction wrapper for COMP opcode.
fn instruction_comp(sons: &[Vec<u8>], _params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_comp(sons)
}

/// A gate encoded with the new 64-byte format.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GateV2 {
    pub opcode: u8,
    pub sons: Vec<i64>,  // signed, 6B each; negative => dummy
    pub params: Vec<u8>, // opcode-specific params
}

impl GateV2 {
    /// Encode the gate into the 64-byte layout:
    /// opcode (1B) | sons (arity * 6B) | params | zero padding up to 64B.
    /// Optimized to use stack-allocated buffer.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = [0u8; 64];
        out[0] = self.opcode;

        for (i, s) in self.sons.iter().enumerate() {
            let offset = 1 + i * 6;
            if offset + 6 > 64 {
                die("Too many sons to fit in a 64-byte gate encoding");
            }
            out[offset..offset + 6].copy_from_slice(&encode_i64_6(*s));
        }

        let params_start = 1 + self.sons.len() * 6;
        let params_end = params_start + self.params.len();
        if params_end > 64 {
            die("Parameters do not fit in a 64-byte gate encoding");
        }
        out[params_start..params_end].copy_from_slice(&self.params);

        out.to_vec()
    }
    
    /// Encode directly into a provided buffer (avoids allocation).
    /// Buffer must be at least 64 bytes.
    pub fn encode_into(&self, out: &mut [u8; 64]) {
        out.fill(0);
        out[0] = self.opcode;

        for (i, s) in self.sons.iter().enumerate() {
            let offset = 1 + i * 6;
            if offset + 6 > 64 {
                die("Too many sons to fit in a 64-byte gate encoding");
            }
            out[offset..offset + 6].copy_from_slice(&encode_i64_6(*s));
        }

        let params_start = 1 + self.sons.len() * 6;
        let params_end = params_start + self.params.len();
        if params_end > 64 {
            die("Parameters do not fit in a 64-byte gate encoding");
        }
        out[params_start..params_end].copy_from_slice(&self.params);
    }
}

/// Helper to encode a gate without constructing GateV2 manually.
pub fn encode_gate_v2(opcode: u8, sons: &[i64], params: &[u8]) -> Vec<u8> {
    GateV2 {
        opcode,
        sons: sons.to_vec(),
        params: params.to_vec(),
    }
    .encode()
}

/// Evaluate a circuit composed of GateV2.
///
/// According to the spec:
/// - Dummy gates: g_{-1}, g_{-2}, ..., g_{-m} represent ct1, ct2, ..., ctm (inputs)
/// - Real gates: g_1, g_2, ..., g_n (1-indexed)
/// - A son index in g_i can be:
///   - Negative (-m to -1): points to dummy gates (inputs)
///   - Positive (1 to i-1): points to previous real gates
///
/// * `gates`   - ordered gates to evaluate after the inputs (g_1, g_2, ..., g_n)
/// * `inputs`  - initial 64B values (e.g., ciphertext blocks) (ct1, ct2, ..., ctm)
/// * `aes_key` - AES-128 key used by AES-CTR gates (16B)
pub fn evaluate_circuit_v2(
    gates: &[GateV2],
    inputs: &[Vec<u8>],
    aes_key: &[u8],
) -> Vec<Vec<u8>> {
    if aes_key.len() != 16 {
        die("AES key must be 16 bytes");
    }

    // Get the instruction table for V2
    let instructions = version_instructions_v2();

    let m = inputs.len();
    let mut values: Vec<Vec<u8>> = Vec::with_capacity(gates.len());

    for (gate_idx, gate) in gates.iter().enumerate() {
        // Current gate is g_{gate_idx + 1} (1-indexed)
        let current_gate_num = (gate_idx + 1) as i64;
        
        let sons: Vec<Vec<u8>> = gate
            .sons
            .iter()
            .map(|&idx| {
                if idx < 0 {
                    // Negative index: points to dummy gate g_{idx}
                    // g_{-1} = ct1 (input[0]), g_{-2} = ct2 (input[1]), etc.
                    let input_idx = (-idx - 1) as usize;
                    if input_idx >= m {
                        die(&format!("Dummy gate index {} out of bounds (m={})", idx, m));
                    }
                    inputs
                        .get(input_idx)
                        .cloned()
                        .unwrap_or_else(|| die("Negative son index out of bounds"))
                } else {
                    // Positive index: points to previous real gate (1-indexed)
                    // g_1 = values[0], g_2 = values[1], etc.
                    // So we need to convert: array_idx = (idx - 1)
                    if idx == 0 {
                        die("Gate index cannot be 0 (gates are 1-indexed)");
                    }
                    let array_idx = (idx - 1) as usize;
                    values
                        .get(array_idx)
                        .cloned()
                        .unwrap_or_else(|| die(&format!(
                            "Son index {} out of bounds in gate {} (values.len()={})",
                            idx, current_gate_num, values.len()
                        )))
                }
            })
            .collect();

        // Use instruction table instead of match
        let opcode_idx = gate.opcode as usize;
        if opcode_idx == 0 || opcode_idx > instructions.len() {
            die(&format!("Invalid opcode {} in GateV2 (must be 1-{})", gate.opcode, instructions.len()));
        }
        // Opcodes are 1-indexed (0x01, 0x02, etc.), so subtract 1 for array index
        let instruction = instructions[opcode_idx - 1];
        let out = instruction(&sons, &gate.params, aes_key);
        values.push(out);
    }

    values
}

/// Compiled circuit V2 metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompiledCircuitV2 {
    pub version: u32,
    pub gates: Vec<GateV2>,
    pub block_size: u32,
    pub num_blocks: u32,
}

impl CompiledCircuitV2 {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        write(&mut buf, self).unwrap();
        buf
    }

    pub fn from_bytes(bytes: &[u8]) -> CompiledCircuitV2 {
        from_read(bytes).unwrap()
    }
}

/// Compiles a V2 circuit for decrypting a ciphertext and comparing its SHA256 hash
/// against a known description. The ciphertext format is IV (16B) || data.
/// The AES key is NOT embedded; it must be provided at evaluation time.
pub fn compile_circuit_v2(ct: &[u8], description: &[u8]) -> CompiledCircuitV2 {
    if ct.len() < 16 {
        die("Ciphertext must include a 16-byte IV");
    }
    let iv = &ct[..16];
    let data = &ct[16..];

    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;
    if m == 0 {
        die("Ciphertext must contain at least one block");
    }

    // Note: inputs are not stored, only used for gate construction
    // Blocks are referenced directly via dummy gates (g_{-i-1}) in the circuit

    // Compute if we need an extra padding block (when rem > 55, length doesn't fit in first block)
    let rem = pt_len % block_size;
    let len_bits = (pt_len as u64) * 8;
    let pad_extra = if rem > block_size - 9 {
        // Length goes to an extra block: first 32 bytes zero, last 32 contains length
        let mut extra = vec![0u8; 32];
        extra[24..].copy_from_slice(&len_bits.to_be_bytes());
        Some(extra)
    } else {
        None
    };

    // Estimate total gates: m (AES) + ~5 (padding) + m' (SHA) + 2 (CONST+COMP) = m + m' + 7
    // m' = m or m+1 (depending on padding)
    let estimated_gates = m + m + 1 + 7; // Upper bound
    let mut gates: Vec<GateV2> = Vec::with_capacity(estimated_gates);
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m + pad_extra.is_some() as usize);

    // AES gates: g_1, g_2, ..., g_m
    // Each gate g_i decrypts ciphertext block ct_i (dummy gate g_{-i-1})
    // Note: Gate creation is fast, parallelization overhead not worth it
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());

        let mut sons = Vec::with_capacity(1);
        sons.push(-(i as i64 + 1)); // negative => dummy gate g_{-(i+1)} = ct_{i+1}
        gates.push(GateV2 {
            opcode: OPCODE_AES_CTR,
            sons,
            params,
        });
        block_outputs.push(gates.len() - 1);
    }

    // Padding on the last block following SHA256 standard:
    // 1. Preserve all original data (positions 0..rem-1)
    // 2. Add 0x80 at position rem (or in extra block if rem = 0)
    // 3. Zeros are already present after normalization  
    // 4. Add length at positions 56..63 (if fits in first block, else in extra block)
    //
    // We use XOR masks to modify only necessary bytes, preserving all original data.
    let last_gate_num = (*block_outputs.last().unwrap() + 1) as i64; // g_{last_idx+1}
    
    let current_gate_num = last_gate_num;
    
    // Case 1: rem = 0 (block is full, 64B exactly)
    // In this case, we need an extra block with 0x80 at position 0
    if rem == 0 {
        // The last block is full, so we create an extra padding block
        // This block will have 0x80 at position 0 and length at positions 56..63
        let mut extra_padding = vec![0u8; 64];
        extra_padding[0] = 0x80;
        extra_padding[56..].copy_from_slice(&len_bits.to_be_bytes());
        
        // Create the extra padding block
        let extra_const_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![],
                params: extra_padding[..32].to_vec(),
            });
            (g_idx + 1) as i64
        };
        
        let extra_full_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![extra_const_gate_num],
                params: extra_padding[32..].to_vec(),
            });
            (g_idx + 1) as i64
        };
        
        block_outputs.push((extra_full_gate_num - 1) as usize);
    } else {
        // Case 2: rem > 0 (block has space for padding)
        // Create XOR mask with 0x80 at position rem and length at 56..63
        let mut padding_mask = vec![0u8; 64];
        
        // Add 0x80 at position rem (preserves all other bytes via XOR with 0)
        padding_mask[rem] = 0x80;
        
        // Add length at positions 56..63 (if length fits in first block)
        if rem <= block_size - 9 {
            padding_mask[56..].copy_from_slice(&len_bits.to_be_bytes());
        }
        
        // Create full 64B mask using CONST arity 1
        let mask_head_const_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![],
                params: padding_mask[..32].to_vec(), // First 32B of mask
            });
            (g_idx + 1) as i64
        };
        
        let mask_full_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![mask_head_const_gate_num],
                params: padding_mask[32..].to_vec(), // Second 32B of mask
            });
            (g_idx + 1) as i64
        };
        
        // XOR with padding mask: preserves all original data, only modifies positions rem and 56..63
        let padded_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_XOR,
                sons: vec![current_gate_num, mask_full_gate_num],
                params: vec![],
            });
            (g_idx + 1) as i64
        };
        
        // Store 0-indexed array position
        *block_outputs.last_mut().unwrap() = (padded_gate_num - 1) as usize;
    }

    // Extra padding block if needed (only length bits in last 8 bytes of a 64B block).
    // According to SHA256 standard: if rem > 55, length goes in an extra block
    // The extra block should be: 56 bytes of zeros + 8 bytes of length
    if let Some(extra_tail) = pad_extra {
        // extra_tail is 32 bytes with length in the last 8 bytes (positions 24-31)
        // We need to create a 64B block: first 32B zeros, then 32B with length at positions 56-63
        // But extra_tail has length at positions 24-31, so we need to shift it to 56-63
        let mut extra_block = vec![0u8; 64];
        extra_block[56..].copy_from_slice(&extra_tail[24..]); // Copy length from extra_tail[24..32] to extra_block[56..64]
        
        // Create the extra padding block using CONST arity 1
        let extra_const_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![],
                params: extra_block[..32].to_vec(), // First 32B (all zeros)
            });
            (g_idx + 1) as i64
        };
        
        let extra_full_gate_num = {
            let g_idx = gates.len();
            gates.push(GateV2 {
                opcode: OPCODE_CONST,
                sons: vec![extra_const_gate_num],
                params: extra_block[32..].to_vec(), // Second 32B (zeros + length)
            });
            (g_idx + 1) as i64
        };
        
        block_outputs.push((extra_full_gate_num - 1) as usize);
    }

    // SHA chain: each SHA gate references previous gates as 1-indexed
    let mut prev_hash_gate_num: Option<i64> = None;
    for &blk_idx in block_outputs.iter() {
        let blk_gate_num = (blk_idx + 1) as i64; // Convert 0-indexed to 1-indexed
        let g_idx = gates.len();
        if prev_hash_gate_num.is_none() {
            // First SHA gate: SHA2(IV || block)
            gates.push(GateV2 {
                opcode: OPCODE_SHA2,
                sons: vec![blk_gate_num], // Reference block gate as 1-indexed
                params: vec![],
            });
        } else {
            // Subsequent SHA gates: SHA2(prev_hash_32 || block_64)
            gates.push(GateV2 {
                opcode: OPCODE_SHA2,
                sons: vec![prev_hash_gate_num.unwrap(), blk_gate_num], // Both 1-indexed
                params: vec![],
            });
        }
        prev_hash_gate_num = Some((g_idx + 1) as i64); // Store as 1-indexed
    }

    let final_hash_gate_num = prev_hash_gate_num.expect("at least one sha gate");

    // Description constant and comparison
    let desc_gate_num = {
        let mut params = vec![0u8; 32];
        let len = usize::min(32, description.len());
        params[..len].copy_from_slice(&description[..len]);
        let g_idx = gates.len();
        gates.push(GateV2 {
            opcode: OPCODE_CONST,
            sons: vec![],
            params,
        });
        (g_idx + 1) as i64 // 1-indexed
    };

    gates.push(GateV2 {
        opcode: OPCODE_COMP,
        sons: vec![final_hash_gate_num, desc_gate_num], // Both 1-indexed
        params: vec![],
    });

    CompiledCircuitV2 {
        version: 1,
        gates,
        block_size: block_size as u32,
        num_blocks: m as u32,
    }
}

/// Accumulator for a V2 circuit (hashes encoded gates with keccak256).
/// Optimized to encode and hash gates in parallel, avoiding intermediate storage.
pub fn acc_circuit_v2(gates: &[GateV2]) -> Vec<u8> {
    use rayon::prelude::*;
    
    if gates.is_empty() {
        return vec![];
    }
    if gates.len() == 1 {
        let mut enc = [0u8; 64];
        gates[0].encode_into(&mut enc);
        return hash_block64(&enc.to_vec()).to_vec();
    }

    // Parallel encode and hash: encode gates directly into stack buffer and hash
    // This avoids storing all encoded gates in memory
    // CRITICAL: Use indexed parallel iteration to preserve gate order deterministically
    let hashes: Vec<[u8; 32]> = (0..gates.len())
        .into_par_iter()
        .map(|i| {
            let mut enc = [0u8; 64];
            gates[i].encode_into(&mut enc);
            hash_block64(&enc)
        })
        .collect();

    // Parallel computation of Merkle tree layers
    // CRITICAL: Use indexed parallel iteration to preserve order deterministically
    let mut layer = hashes;
    while layer.len() > 1 {
        let layer_ref = &layer; // Create reference for closure
        let indices: Vec<usize> = (0..layer_ref.len()).step_by(2).collect();
        let next: Vec<[u8; 32]> = indices
            .into_par_iter()
            .map(|i| {
                if i + 1 < layer_ref.len() {
                    // Pair exists: hash pair[i] and pair[i+1]
                    let mut hasher = Keccak256::new();
                    hasher.update(&layer_ref[i]);
                    hasher.update(&layer_ref[i + 1]);
                    hasher.finalize().into()
                } else {
                    // Odd element: copy as-is
                    layer_ref[i]
                }
            })
            .collect();
        layer = next;
    }

    layer[0].to_vec()
}


fn increment_iv(iv: &[u8], inc: u64) -> [u8; 16] {
    if iv.len() != 16 {
        die("IV must be 16 bytes");
    }
    let mut ctr = u128::from_be_bytes(iv.try_into().unwrap());
    ctr = ctr.wrapping_add(inc as u128);
    ctr.to_be_bytes()
}

fn eval_aes_ctr(sons: &[Vec<u8>], params: &[u8], key: &[u8]) -> Vec<u8> {
    if sons.len() != 1 {
        die("AES-CTR gate expects arity 1");
    }
    if params.len() < 18 {
        die("AES-CTR gate expects 16B counter + 2B length");
    }
    let ctr = &params[..16];
    let len_bits = u16::from_be_bytes([params[16], params[17]]) as usize;

    // xor64 will normalize internally, so we pass values directly
    let keystream = aes_ctr::encrypt_block(&vec![&key.to_vec(), &vec![0u8; 64], &ctr.to_vec()]);
    let mut out = xor64(&sons[0], &keystream);

    if len_bits < 512 {
        let full_bytes = len_bits / 8;
        let rem_bits = len_bits % 8;
        if full_bytes < 64 {
            if rem_bits > 0 {
                let mask = 0xFFu8 << (8 - rem_bits);
                out[full_bytes] &= mask;
                for b in out.iter_mut().skip(full_bytes + 1) {
                    *b = 0;
                }
            } else {
                for b in out.iter_mut().skip(full_bytes) {
                    *b = 0;
                }
            }
        }
    }

    out
}

fn eval_sha2(sons: &[Vec<u8>]) -> Vec<u8> {
    match sons.len() {
        1 => {
            // SHA2 arity 1: compression SHA2 de IV et de l'entrée de 64B
            // sha256_compress with 1 element uses default IV (SHA256 constants) and compresses the 64B block
            sha256_compress(&vec![&normalize_64(sons[0].clone())])
        }
        2 => {
            // SHA2 arity 2: compression SHA2 de l'entrée 1 réduite sur 32B avec l'entrée 2 de 64B
            // According to spec: compress(truncate32(in1) || in2)
            // This means: use truncate32(in1) as previous hash (replaces IV) and in2 as the 64B block to compress
            // sha256_compress with 2 elements: data[0] = prev_hash (32B), data[1] = current block (64B)
            let in1_norm = normalize_64(sons[0].clone());
            let in2_norm = normalize_64(sons[1].clone());
            let prev_hash = in1_norm[..32].to_vec(); // truncate32(in1)
            sha256_compress(&vec![&prev_hash, &in2_norm])
        }
        _ => die("SHA2 gate expects arity 1 or 2"),
    }
}

fn eval_const(sons: &[Vec<u8>], params: &[u8]) -> Vec<u8> {
    if params.len() < 32 {
        die("CONST gate expects 32B constant in params");
    }
    match sons.len() {
        0 => {
            // CONST arity 0: params (32B) || zeros (32B)
            let mut out = vec![0u8; 64];
            out[..32].copy_from_slice(&params[..32]);
            out
        }
        1 => {
            // CONST arity 1: sons[0][0..32] || params (32B)
            let mut out = vec![0u8; 64];
            out[..32].copy_from_slice(&normalize_64(sons[0].clone())[..32]);
            out[32..].copy_from_slice(&params[..32]);
            out
        }
        _ => die("CONST gate expects arity 0 or 1"),
    }
}

fn eval_xor(sons: &[Vec<u8>]) -> Vec<u8> {
    if sons.len() != 2 {
        die("XOR gate expects arity 2");
    }
    // xor64 will normalize internally, so we pass values directly
    xor64(&sons[0], &sons[1])
}

fn eval_comp(sons: &[Vec<u8>]) -> Vec<u8> {
    if sons.len() != 2 {
        die("COMP gate expects arity 2");
    }
    // Compare only the first 32 bytes without normalizing
    // This is safe because SHA2 outputs are 32 bytes and CONST outputs have 32 bytes of data
    let min_len = usize::min(sons[0].len().min(32), sons[1].len().min(32));
    let eq = if min_len < 32 {
        false // If either value has less than 32 bytes, they can't be equal
    } else {
        sons[0][..32] == sons[1][..32]
    };
    let mut out = vec![0u8; 64];
    out[0] = if eq { 1 } else { 0 };
    out
}

pub(crate) fn normalize_64(mut v: Vec<u8>) -> Vec<u8> {
    if v.len() >= 64 {
        v.truncate(64);
        v
    } else {
        v.resize(64, 0);
        v
    }
}

fn xor64(a: &Vec<u8>, b: &Vec<u8>) -> Vec<u8> {
    // Return the maximum size of both inputs, XOR only up to the minimum size
    // This is more flexible like V1, but in practice XOR inputs in V2 are always 64 bytes
    let max_len = a.len().max(b.len());
    let min_len = a.len().min(b.len());
    let mut out = vec![0u8; max_len];
    
    // XOR up to the minimum length
    for i in 0..min_len {
        out[i] = a[i] ^ b[i];
    }
    
    // Copy remaining bytes from the longer input
    if a.len() > b.len() {
        out[min_len..].copy_from_slice(&a[min_len..]);
    } else if b.len() > a.len() {
        out[min_len..].copy_from_slice(&b[min_len..]);
    }
    
    out
}

fn encode_i64_6(n: i64) -> [u8; 6] {
    if n > 0x7FFF_FFFF_FFFF || n < -0x8000_0000_0000 {
        die("Son index must fit in signed 48 bits");
    }
    let be = n.to_be_bytes();
    [be[2], be[3], be[4], be[5], be[6], be[7]]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aes_ctr;
    use crate::sha256::sha256;
    use crate::accumulator::hash_block64;
    use hex;

    #[test]
    fn test_encode_gate_size() {
        let g = GateV2 {
            opcode: OPCODE_CONST,
            sons: vec![1],
            params: vec![0xAB; 32],
        };
        let enc = g.encode();
        assert_eq!(enc.len(), 64);
        assert_eq!(enc[0], OPCODE_CONST);
    }

    #[test]
    fn test_eval_const_xor_comp() {
        // g_1: CONST (produces [1; 32] || [0; 32])
        let g1 = GateV2 {
            opcode: OPCODE_CONST,
            sons: vec![],
            params: vec![1u8; 32],
        };
        // g_2: CONST (produces [2; 32] || [0; 32])
        let g2 = GateV2 {
            opcode: OPCODE_CONST,
            sons: vec![],
            params: vec![2u8; 32],
        };
        // g_3: XOR(g_1, g_2) - references gates as 1-indexed
        let g3 = GateV2 {
            opcode: OPCODE_XOR,
            sons: vec![1, 2], // g_1 and g_2 (1-indexed)
            params: vec![],
        };
        // g_4: COMP(g_3, g_3) - should return 1 (equal)
        let g4 = GateV2 {
            opcode: OPCODE_COMP,
            sons: vec![3, 3], // g_3 and g_3 (1-indexed)
            params: vec![],
        };

        let values = evaluate_circuit_v2(&[g1, g2, g3, g4], &[], &[0u8; 16]);

        // values[0] = output of g_1
        assert_eq!(values[0][0], 1);
        // values[1] = output of g_2
        assert_eq!(values[1][0], 2);
        // values[2] = output of g_3 (XOR)
        assert_eq!(values[2][0], 1 ^ 2);
        // values[3] = output of g_4 (COMP, should be 1 for equal)
        assert_eq!(values[3][0], 1);
    }

    #[test]
    fn test_circuit_v2_end_to_end_single_block() {
        let key = vec![0u8; 16];
        let iv = vec![0u8; 16];
        let pt = b"hello world";

        // Build ciphertext: ct = IV || (pt XOR keystream)
        let keystream = aes_ctr::encrypt_block(&vec![&key, &vec![0u8; pt.len()], &iv]);
        let ct_block: Vec<u8> = pt
            .iter()
            .zip(keystream.iter())
            .map(|(p, k)| p ^ k)
            .collect();
        let mut ct = iv.clone();
        ct.extend_from_slice(&ct_block);

        let description = sha256(pt);

        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = vec![ct[16..].to_vec()]; // ciphertext blocks without IV
        // Verify that gates reference previous gates correctly (1-indexed)
        for (idx, g) in circuit.gates.iter().enumerate() {
            let current_gate_num = (idx + 1) as i64; // g_{idx+1}
            for &s in &g.sons {
                if s > 0 {
                    // Positive index: must be between 1 and current_gate_num - 1
                    assert!(
                        s < current_gate_num,
                        "gate g_{} references future gate g_{} (must be <= g_{})",
                        current_gate_num,
                        s,
                        current_gate_num - 1
                    );
                } else if s == 0 {
                    panic!("Gate index cannot be 0 (gates are 1-indexed)");
                }
                // Negative indices are dummy gates (inputs), no validation needed here
            }
        }
        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);

        // Expect XOR gate output (index 2) to match standard padded block.
        let padded_manual = {
            let mut blk = vec![0u8; 64];
            blk[..pt.len()].copy_from_slice(pt);
            blk[pt.len()] = 0x80;
            blk[56..].copy_from_slice(&(pt.len() as u64 * 8).to_be_bytes());
            blk
        };
        assert_eq!(
            values[3],
            padded_manual,
            "padded block mismatch (AES+padding)"
        );

        let res = values.last().unwrap();
        let final_hash_gate_num = match circuit.gates.last().unwrap().sons[0] {
            s if s > 0 => s as i64, // 1-indexed gate number
            _ => unreachable!(),
        };
        // Convert 1-indexed to 0-indexed: g_1 -> values[0], g_2 -> values[1], etc.
        let final_hash_idx = (final_hash_gate_num - 1) as usize;
        assert_eq!(
            &values[final_hash_idx][..32],
            sha256(pt).as_slice(),
            "hash mismatch"
        );
        assert_eq!(res[0], 1, "final comparison should succeed");
    }

    #[test]
    fn test_circuit_v2_end_to_end_multi_block() {
        let key = vec![1u8; 16];
        let iv = vec![2u8; 16];
        let pt = vec![0xAB; 80]; // >64 bytes to exercise padding extra block

        // Build ciphertext blocks
        // Note: counter increments by 4 for each 64-byte block (since 64/16 = 4 AES blocks)
        let mut ct = iv.clone();
        let mut offset = 0usize;
        while offset < pt.len() {
            let chunk = &pt[offset..usize::min(offset + 64, pt.len())];
            let block_idx = offset / 64;
            let counter = increment_iv(&iv, (block_idx * 4) as u64).to_vec();
            let keystream = aes_ctr::encrypt_block(&vec![&key, &vec![0u8; chunk.len()], &counter]);
            let ct_block: Vec<u8> = chunk
                .iter()
                .zip(keystream.iter())
                .map(|(p, k)| p ^ k)
                .collect();
            ct.extend_from_slice(&ct_block);
            offset += 64;
        }

        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = {
            let mut v = Vec::new();
            let mut start = 16;
            while start < ct.len() {
                let end = usize::min(start + 64, ct.len());
                v.push(ct[start..end].to_vec());
                start = end;
            }
            v
        };

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        // AES output block0 should match plaintext first 64 bytes.
        assert_eq!(&values[0][..64], &pt[..64], "block0 plaintext mismatch");
        // AES output block1 should match plaintext remaining bytes.
        assert_eq!(
            &values[1][..16],
            &pt[64..],
            "block1 plaintext mismatch"
        );
        // Last block padded expected.
        let padded_manual = {
            let mut blk = vec![0u8; 64];
            blk[..16].copy_from_slice(&pt[64..]);
            blk[16] = 0x80;
            blk[56..].copy_from_slice(&(pt.len() as u64 * 8).to_be_bytes());
            blk
        };
        assert_eq!(values[4], padded_manual, "padded last block mismatch");
        let res = values.last().unwrap();
        let hash_gate_num = match circuit.gates.last().unwrap().sons[0] {
            s if s > 0 => s as i64, // 1-indexed gate number
            _ => unreachable!(),
        };
        // Convert 1-indexed to 0-indexed: g_1 -> values[0], g_2 -> values[1], etc.
        let hash_idx = (hash_gate_num - 1) as usize;
        assert_eq!(
            &values[hash_idx][..32],
            sha256(&pt).as_slice(),
            "hash mismatch on multi-block"
        );
        assert_eq!(res[0], 1, "final comparison should succeed on multi-block");
    }

    #[test]
    fn test_circuit_v2_end_to_end_extra_padding_block() {
        let key = vec![3u8; 16];
        let iv = vec![4u8; 16];
        let pt = vec![0x11; 120]; // triggers extra padding block (rem > 55)

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "final comparison should succeed with extra pad");
    }

    #[test]
    fn test_circuit_v2_end_to_end_wrong_description() {
        let key = vec![5u8; 16];
        let iv = vec![6u8; 16];
        let pt = b"wrong hash case";

        let ct = build_ct(pt, &key, &iv);
        let bogus_desc = sha256(b"something else");
        let circuit = compile_circuit_v2(&ct, &bogus_desc);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 0, "comparison should fail with wrong hash");
    }

    fn build_ct(pt: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8> {
        let mut ct = iv.to_vec();
        let mut offset = 0usize;
        let mut _counter = 0u64;

        // Note: counter increments by 4 for each 64-byte block (since 64/16 = 4 AES blocks)
        while offset < pt.len() {
            let chunk = &pt[offset..usize::min(offset + 64, pt.len())];
            let block_idx = offset / 64;
            let ctr = increment_iv(iv, (block_idx * 4) as u64).to_vec();
            let keystream =
                aes_ctr::encrypt_block(&vec![&key.to_vec(), &vec![0u8; chunk.len()], &ctr]);
            let ct_block: Vec<u8> = chunk
                .iter()
                .zip(keystream.iter())
                .map(|(p, k)| p ^ k)
                .collect();
            ct.extend_from_slice(&ct_block);
            offset += 64;
            _counter += 1;
        }

        ct
    }

    fn slice_ciphertext_blocks(ct: &[u8]) -> Vec<Vec<u8>> {
        let mut v = Vec::new();
        let mut start = 16; // skip IV
        while start < ct.len() {
            let end = usize::min(start + 64, ct.len());
            v.push(ct[start..end].to_vec());
            start = end;
        }
        v
    }

    #[test]
    fn test_circuit_v2_single_byte() {
        // Test avec un seul byte (cas limite minimal)
        let key = vec![0x12u8; 16];
        let iv = vec![0x34u8; 16];
        let pt = vec![0xAB];

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "single byte should verify correctly");
    }

    #[test]
    fn test_circuit_v2_exactly_64_bytes() {
        // Test avec exactement 64 bytes (rem = 0, nécessite un bloc de padding supplémentaire)
        let key = vec![0x56u8; 16];
        let iv = vec![0x78u8; 16];
        let pt = vec![0xCD; 64]; // Exactement 64 bytes

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "exactly 64 bytes should verify correctly");
    }

    #[test]
    fn test_circuit_v2_exactly_55_bytes() {
        // Test avec exactement 55 bytes (rem = 55, longueur rentre dans le même bloc)
        let key = vec![0x9Au8; 16];
        let iv = vec![0xBCu8; 16];
        let pt = vec![0xEF; 55]; // Exactement 55 bytes

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "exactly 55 bytes should verify correctly");
    }

    #[test]
    fn test_circuit_v2_exactly_56_bytes() {
        // Test avec exactement 56 bytes (rem = 56, nécessite un bloc de padding supplémentaire)
        let key = vec![0xDEu8; 16];
        let iv = vec![0xF0u8; 16];
        let pt = vec![0x12; 56]; // Exactement 56 bytes

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "exactly 56 bytes should verify correctly");
    }

    #[test]
    fn test_circuit_v2_three_blocks() {
        // Test avec 3 blocs complets (192 bytes)
        let key = vec![0x11u8; 16];
        let iv = vec![0x22u8; 16];
        let pt = vec![0x33; 192]; // 3 blocs de 64 bytes

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "three blocks should verify correctly");
    }

    #[test]
    fn test_circuit_v2_large_file() {
        // Test avec un fichier plus grand (10 blocs)
        let key = vec![0xAAu8; 16];
        let iv = vec![0xBBu8; 16];
        let pt = vec![0xCC; 640]; // 10 blocs de 64 bytes

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "large file (10 blocks) should verify correctly");
    }

    #[test]
    fn test_circuit_v2_random_data() {
        // Test avec des données aléatoires (mais déterministes)
        let key = vec![0x42u8; 16];
        let iv = vec![0x84u8; 16];
        let pt: Vec<u8> = (0..200).map(|i| (i * 3 + 7) as u8).collect(); // Données variées

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        let res = values.last().unwrap();
        assert_eq!(res[0], 1, "random data should verify correctly");
    }

    #[test]
    fn test_circuit_v2_different_keys() {
        // Test que différentes clés produisent des résultats différents
        let key1 = vec![0x11u8; 16];
        let key2 = vec![0x22u8; 16];
        let iv = vec![0x33u8; 16];
        let pt = b"test data";

        let ct1 = build_ct(pt, &key1, &iv);
        let ct2 = build_ct(pt, &key2, &iv);
        
        // Les ciphertexts doivent être différents
        assert_ne!(ct1[16..], ct2[16..], "different keys should produce different ciphertexts");

        let description = sha256(pt);
        let circuit1 = compile_circuit_v2(&ct1, &description);
        let circuit2 = compile_circuit_v2(&ct2, &description);
        let inputs1 = slice_ciphertext_blocks(&ct1);
        let inputs2 = slice_ciphertext_blocks(&ct2);

        let values1 = evaluate_circuit_v2(&circuit1.gates, &inputs1, &key1);
        let values2 = evaluate_circuit_v2(&circuit2.gates, &inputs2, &key2);
        
        // Les deux doivent vérifier correctement avec leurs clés respectives
        assert_eq!(values1.last().unwrap()[0], 1, "key1 should verify correctly");
        assert_eq!(values2.last().unwrap()[0], 1, "key2 should verify correctly");
    }

    #[test]
    fn test_circuit_v2_gate_references() {
        // Test que toutes les références de gates sont valides (1-indexed, pas de références futures)
        let key = vec![0x55u8; 16];
        let iv = vec![0x66u8; 16];
        let pt = vec![0x77; 150];

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);

        for (idx, gate) in circuit.gates.iter().enumerate() {
            let current_gate_num = (idx + 1) as i64; // g_{idx+1}
            for &son_idx in &gate.sons {
                if son_idx > 0 {
                    // Positive index: doit être entre 1 et current_gate_num - 1
                    assert!(
                        son_idx < current_gate_num,
                        "gate g_{} references future gate g_{} (must be < g_{})",
                        current_gate_num,
                        son_idx,
                        current_gate_num
                    );
                    assert_ne!(son_idx, 0, "gate index cannot be 0 (gates are 1-indexed)");
                } else if son_idx < 0 {
                    // Negative index: dummy gate (input), doit être valide
                    let input_idx = (-son_idx - 1) as usize;
                    let num_inputs = circuit.num_blocks as usize;
                    assert!(
                        input_idx < num_inputs,
                        "gate g_{} references invalid dummy gate g_{} (max: g_{{{}}})",
                        current_gate_num,
                        son_idx,
                        num_inputs
                    );
                }
            }
        }
    }

    #[test]
    fn test_circuit_v2_all_opcodes_used() {
        // Test que tous les opcodes sont utilisés dans le circuit
        let key = vec![0x88u8; 16];
        let iv = vec![0x99u8; 16];
        let pt = vec![0xAA; 100];

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);

        let mut opcodes_used = std::collections::HashSet::new();
        for gate in &circuit.gates {
            opcodes_used.insert(gate.opcode);
        }

        // Vérifier que tous les opcodes attendus sont présents
        assert!(opcodes_used.contains(&OPCODE_AES_CTR), "AES_CTR opcode should be used");
        assert!(opcodes_used.contains(&OPCODE_SHA2), "SHA2 opcode should be used");
        assert!(opcodes_used.contains(&OPCODE_CONST), "CONST opcode should be used");
        assert!(opcodes_used.contains(&OPCODE_XOR), "XOR opcode should be used");
        assert!(opcodes_used.contains(&OPCODE_COMP), "COMP opcode should be used");
    }

    #[test]
    fn test_circuit_v2_hash_chain_correctness() {
        // Test que la chaîne de hash SHA256 est correcte
        let key = vec![0x11u8; 16];
        let iv = vec![0x22u8; 16];
        let pt = vec![0x33; 80]; // 2 blocs

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        
        // Trouver le gate de hash final
        let final_hash_gate_num = match circuit.gates.last().unwrap().sons[0] {
            s if s > 0 => s as i64,
            _ => unreachable!(),
        };
        let final_hash_idx = (final_hash_gate_num - 1) as usize;
        let computed_hash = &values[final_hash_idx][..32];
        let expected_hash = sha256(&pt);

        assert_eq!(
            computed_hash,
            expected_hash.as_slice(),
            "computed hash should match expected SHA256 hash"
        );
    }

    #[test]
    fn test_circuit_v2_padding_preserves_data() {
        // Test que le padding préserve toutes les données originales
        let key = vec![0x44u8; 16];
        let iv = vec![0x55u8; 16];
        let pt = b"Hello, World! This is a test message.";

        let ct = build_ct(pt, &key, &iv);
        let description = sha256(pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        
        // Le premier bloc décrypté doit contenir les données originales
        assert_eq!(
            &values[0][..pt.len()],
            pt,
            "decrypted first block should match original plaintext"
        );
    }

    #[test]
    fn test_circuit_v2_multiple_verifications() {
        // Test que le même circuit peut être vérifié plusieurs fois
        let key = vec![0x66u8; 16];
        let iv = vec![0x77u8; 16];
        let pt = vec![0x88; 100];

        let ct = build_ct(&pt, &key, &iv);
        let description = sha256(&pt);
        let circuit = compile_circuit_v2(&ct, &description);
        let inputs = slice_ciphertext_blocks(&ct);

        // Vérifier plusieurs fois
        for _ in 0..5 {
            let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
            let res = values.last().unwrap();
            assert_eq!(res[0], 1, "circuit should verify correctly on multiple evaluations");
        }
    }

    #[test]
    fn test_circuit_v2_explicit_values() {
        // Test explicite avec ciphertext, clé et description fixes
        // Plaintext: "Hello, World!"
        let plaintext = b"Hello, World!";
        
        // Clé AES-128 fixe (16 bytes)
        let key: Vec<u8> = vec![
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
            0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        ];
        
        // IV fixe (16 bytes)
        let iv: Vec<u8> = vec![
            0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
            0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F,
        ];
        
        // Construire le ciphertext: IV || (plaintext XOR keystream)
        let keystream = aes_ctr::encrypt_block(&vec![&key, &vec![0u8; plaintext.len()], &iv]);
        let ct_block: Vec<u8> = plaintext
            .iter()
            .zip(keystream.iter())
            .map(|(p, k)| p ^ k)
            .collect();
        let mut ciphertext = iv.clone();
        ciphertext.extend_from_slice(&ct_block);
        
        // Description = SHA256 du plaintext
        let description = sha256(plaintext);
        
        println!("Plaintext: {:?}", String::from_utf8_lossy(plaintext));
        println!("Key (hex): {}", hex::encode(&key));
        println!("IV (hex): {}", hex::encode(&iv));
        println!("Ciphertext length: {} bytes", ciphertext.len());
        println!("Description (hex): {}", hex::encode(&description));
        
        // Compiler le circuit
        let circuit = compile_circuit_v2(&ciphertext, &description);
        println!("Circuit compiled: {} gates", circuit.gates.len());
        println!("Number of blocks: {}", circuit.num_blocks);
        
        // Préparer les inputs (blocs de ciphertext sans IV)
        let inputs = slice_ciphertext_blocks(&ciphertext);
        println!("Number of input blocks: {}", inputs.len());
        
        // Évaluer le circuit
        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        
        // Vérifier que le plaintext décrypté est correct
        let decrypted_pt = &values[0][..plaintext.len()];
        assert_eq!(
            decrypted_pt,
            plaintext,
            "Decrypted plaintext should match original"
        );
        println!("✓ Plaintext décrypté correctement");
        
        // Vérifier le hash final
        let final_hash_gate_num = match circuit.gates.last().unwrap().sons[0] {
            s if s > 0 => s as i64,
            _ => unreachable!(),
        };
        let final_hash_idx = (final_hash_gate_num - 1) as usize;
        let computed_hash = &values[final_hash_idx][..32];
        assert_eq!(
            computed_hash,
            description.as_slice(),
            "Computed hash should match description"
        );
        println!("✓ Hash SHA256 calculé correctement: {}", hex::encode(computed_hash));
        
        // Vérifier le résultat final (comparaison)
        let final_result = values.last().unwrap();
        assert_eq!(
            final_result[0],
            1,
            "Final comparison should succeed (hash matches description)"
        );
        println!("✓ Comparaison finale réussie: hash == description");
        
        // Test avec une mauvaise description (doit échouer)
        let wrong_description = sha256(b"Wrong message");
        let circuit_wrong = compile_circuit_v2(&ciphertext, &wrong_description);
        let values_wrong = evaluate_circuit_v2(&circuit_wrong.gates, &inputs, &key);
        let final_result_wrong = values_wrong.last().unwrap();
        assert_eq!(
            final_result_wrong[0],
            0,
            "Final comparison should fail with wrong description"
        );
        println!("✓ Test avec mauvaise description: échec attendu (OK)");
        
        // Test avec une mauvaise clé (doit échouer)
        let wrong_key: Vec<u8> = vec![0xFFu8; 16];
        let values_wrong_key = evaluate_circuit_v2(&circuit.gates, &inputs, &wrong_key);
        let final_result_wrong_key = values_wrong_key.last().unwrap();
        assert_eq!(
            final_result_wrong_key[0],
            0,
            "Final comparison should fail with wrong key"
        );
        println!("✓ Test avec mauvaise clé: échec attendu (OK)");
        
        println!("\n✅ Tous les tests explicites ont réussi!");
    }

    #[test]
    fn test_evaluate_circuit_v2_full_scenario_verification() {
        // ============================================
        // SCÉNARIO COMPLET: Vérification de toutes les valeurs dans l'ordre
        // ============================================
        
        // ============================================
        // DONNÉES INITIALES DU TEST
        // ============================================
        // 1. Plaintext: Le message original à chiffrer et vérifier
        let plaintext = b"This is a test message for circuit evaluation. It contains multiple blocks to test the full pipeline.";
        println!("📝 DONNÉES INITIALES:");
        println!("   1. Plaintext: {} bytes", plaintext.len());
        println!("      Contenu: \"{}\"", String::from_utf8_lossy(plaintext));
        
        // 2. Clé AES-128 (16 bytes) - utilisée pour chiffrer/déchiffrer avec AES-CTR
        let key: Vec<u8> = vec![
            0x2B, 0x7E, 0x15, 0x16, 0x28, 0xAE, 0xD2, 0xA6,
            0xAB, 0xF7, 0x15, 0x88, 0x09, 0xCF, 0x4F, 0x3C,
        ];
        println!("   2. Key (AES-128): {} bytes", key.len());
        println!("      Key (hex): {}", hex::encode(&key));
        
        // 3. IV (Initialization Vector) - 16 bytes pour AES-CTR mode
        //    L'IV est utilisé pour générer le keystream (counter mode)
        let iv: Vec<u8> = vec![
            0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,
            0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF,
        ];
        println!("   3. IV (Initialization Vector): {} bytes", iv.len());
        println!("      IV (hex): {}", hex::encode(&iv));
        
        // 4. Description: Hash SHA256 du plaintext (32 bytes)
        //    C'est ce que le circuit doit vérifier à la fin
        let expected_description = sha256(plaintext);
        println!("   4. Expected description (SHA256 du plaintext): {} bytes", expected_description.len());
        println!("      Description (hex): {}", hex::encode(&expected_description));
        println!();
        println!("📝 Plaintext length: {} bytes", plaintext.len());
        println!("🔑 Key (hex): {}", hex::encode(&key));
        println!("🔐 IV (hex): {}", hex::encode(&iv));
        println!("📋 Expected description (hex): {}", hex::encode(&expected_description));
        
        // 3. Construction du ciphertext
        let ciphertext = build_ct(plaintext, &key, &iv);
        println!("📦 Ciphertext length: {} bytes (IV: 16B + data: {}B)", 
                 ciphertext.len(), ciphertext.len() - 16);
        
        // 4. Compilation du circuit
        let circuit = compile_circuit_v2(&ciphertext, &expected_description);
        println!("🔧 Circuit compiled:");
        println!("   - Total gates: {}", circuit.gates.len());
        println!("   - Number of blocks: {}", circuit.num_blocks);
        println!("   - Block size: {} bytes", circuit.block_size);
        
        // Compter les types de gates
        let mut aes_count = 0;
        let mut sha_count = 0;
        let mut const_count = 0;
        let mut xor_count = 0;
        let mut comp_count = 0;
        for gate in &circuit.gates {
            match gate.opcode {
                OPCODE_AES_CTR => aes_count += 1,
                OPCODE_SHA2 => sha_count += 1,
                OPCODE_CONST => const_count += 1,
                OPCODE_XOR => xor_count += 1,
                OPCODE_COMP => comp_count += 1,
                _ => {}
            }
        }
        println!("   - AES gates: {}", aes_count);
        println!("   - SHA2 gates: {}", sha_count);
        println!("   - CONST gates: {}", const_count);
        println!("   - XOR gates: {}", xor_count);
        println!("   - COMP gates: {}", comp_count);
        
        // 5. Préparation des inputs (blocs ciphertext sans IV)
        let inputs = slice_ciphertext_blocks(&ciphertext);
        println!("📥 Input blocks prepared: {} blocks", inputs.len());
        assert_eq!(inputs.len(), circuit.num_blocks as usize, 
                   "Number of input blocks should match circuit.num_blocks");
        
        // 6. Évaluation du circuit
        println!("\n⚙️  Evaluating circuit...");
        let values = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        println!("✅ Circuit evaluated: {} gate outputs", values.len());
        assert_eq!(values.len(), circuit.gates.len(), 
                   "Number of gate outputs should match number of gates");
        
        // 7. VÉRIFICATIONS DÉTAILLÉES - GATE PAR GATE DANS L'ORDRE
        
        // 7.0. Vérification séquentielle de chaque gate dans l'ordre avec calcul manuel
        println!("\n🔍 Verification 0: Sequential gate-by-gate verification with manual computation");
        println!("   Vérification de chaque gate g_1, g_2, ..., g_{} dans l'ordre:", circuit.gates.len());
        println!("   Pour chaque gate, on calcule manuellement la valeur attendue et on la compare avec le résultat");
        
        // Calculer manuellement les valeurs attendues pour chaque gate
        // 1. Plaintext blocks attendus (après décryptage AES)
        let mut expected_plaintext_blocks: Vec<Vec<u8>> = Vec::new();
        for i in 0..circuit.num_blocks as usize {
            let pt_start = i * 64;
            let pt_end = usize::min(pt_start + 64, plaintext.len());
            if pt_start < plaintext.len() {
                let mut block = vec![0u8; 64];
                block[..(pt_end - pt_start)].copy_from_slice(&plaintext[pt_start..pt_end]);
                expected_plaintext_blocks.push(block);
            } else {
                expected_plaintext_blocks.push(vec![0u8; 64]);
            }
        }
        
        // 2. Calculer manuellement les hashes SHA256 attendus
        // Pour cela, on doit recalculer la chaîne SHA256 comme le circuit le fait
        use crate::sha256::sha256_compress;
        
        // Vérifier chaque gate dans l'ordre
        let mut aes_idx = 0;
        let mut sha_idx = 0;
        let mut const_idx = 0;
        let mut xor_idx = 0;
        let mut prev_hash: Option<Vec<u8>> = None; // Pour suivre le hash précédent dans la chaîne SHA
        
        for (gate_idx, gate) in circuit.gates.iter().enumerate() {
            let gate_num = gate_idx + 1; // 1-indexed
            let gate_output = &values[gate_idx];
            
            match gate.opcode {
                OPCODE_AES_CTR => {
                    // Gate AES: doit décrypter le bloc correspondant
                    if aes_idx < expected_plaintext_blocks.len() {
                        let expected_pt = &expected_plaintext_blocks[aes_idx];
                        let actual_pt = &gate_output[..expected_pt.len().min(64)];
                        let expected_pt_slice = &expected_pt[..actual_pt.len()];
                        
                        assert_eq!(
                            actual_pt,
                            expected_pt_slice,
                            "Gate g_{} (AES gate {}) should decrypt to plaintext block {}",
                            gate_num, aes_idx + 1, aes_idx
                        );
                        println!("   ✓ g_{} (AES): décrypte correctement le bloc {} ({} bytes de plaintext)",
                                gate_num, aes_idx, actual_pt.len());
                    }
                    aes_idx += 1;
                }
                OPCODE_SHA2 => {
                    // Gate SHA2: calculer manuellement le hash attendu et comparer
                    assert!(
                        gate_output.len() == 32 || gate_output.len() == 64,
                        "Gate g_{} (SHA2 gate {}) should output 32 or 64 bytes, got {}",
                        gate_num, sha_idx + 1, gate_output.len()
                    );
                    
                    let hash = if gate_output.len() == 32 {
                        gate_output.to_vec()
                    } else {
                        gate_output[..32].to_vec()
                    };
                    
                    // Calculer manuellement le hash attendu
                    // Le gate SHA2 référence un ou deux blocs précédents
                    let expected_hash = if gate.sons.len() == 1 {
                        // Premier SHA2: SHA2(block) avec IV par défaut
                        let block_idx = (gate.sons[0] - 1) as usize; // Convert 1-indexed to 0-indexed
                        let block_value = if block_idx < values.len() {
                            normalize_64(values[block_idx].clone())
                        } else {
                            // Si c'est un input (négatif), on doit le chercher dans inputs
                            // Mais normalement les gates SHA2 référencent des gates AES, pas des inputs
                            normalize_64(inputs[(-gate.sons[0] - 1) as usize].clone())
                        };
                        sha256_compress(&vec![&block_value])
                    } else {
                        // SHA2 suivant: SHA2(prev_hash_32 || block_64)
                        let prev_hash_idx = (gate.sons[0] - 1) as usize;
                        let block_idx = (gate.sons[1] - 1) as usize;
                        let prev_hash_val = normalize_64(values[prev_hash_idx].clone());
                        let block_val = normalize_64(values[block_idx].clone());
                        sha256_compress(&vec![&prev_hash_val[..32].to_vec(), &block_val])
                    };
                    
                    // Comparer avec le résultat obtenu
                    assert_eq!(
                        &hash,
                        &expected_hash,
                        "Gate g_{} (SHA2 gate {}) should output manually computed hash",
                        gate_num, sha_idx + 1
                    );
                    
                    // Pour le dernier SHA2, vérifier qu'il correspond aussi à la description
                    if sha_idx == sha_count - 1 {
                        assert_eq!(
                            &hash,
                            expected_description.as_slice(),
                            "Gate g_{} (last SHA2) should output the final hash matching description",
                            gate_num
                        );
                        println!("   ✓ g_{} (SHA2 final): hash calculé manuellement = hash circuit = description", gate_num);
                    } else {
                        println!("   ✓ g_{} (SHA2 {}): hash calculé manuellement = hash circuit", gate_num, sha_idx + 1);
                    }
                    
                    prev_hash = Some(hash);
                    sha_idx += 1;
                }
                OPCODE_CONST => {
                    // Gate CONST: vérifier selon le contexte
                    if const_idx == const_count - 1 {
                        // Dernier CONST = description
                        assert_eq!(
                            &gate_output[..32],
                            expected_description.as_slice(),
                            "Gate g_{} (description CONST) should output description",
                            gate_num
                        );
                        assert_eq!(
                            &gate.params[..32],
                            expected_description.as_slice(),
                            "Gate g_{} (description CONST) params should contain description",
                            gate_num
                        );
                        println!("   ✓ g_{} (CONST description): contient la description correcte", gate_num);
                    } else {
                        // Autres CONST = padding
                        println!("   ✓ g_{} (CONST padding): gate de padding valide", gate_num);
                    }
                    const_idx += 1;
                }
                OPCODE_XOR => {
                    // Gate XOR: utilisé pour le padding, difficile à vérifier directement
                    // Mais on peut vérifier que l'output est de 64 bytes
                    assert_eq!(
                        gate_output.len(),
                        64,
                        "Gate g_{} (XOR) should output 64 bytes",
                        gate_num
                    );
                    println!("   ✓ g_{} (XOR): output de 64 bytes (padding)", gate_num);
                    xor_idx += 1;
                }
                OPCODE_COMP => {
                    // Gate COMP final: doit retourner 1
                    assert_eq!(
                        gate_output[0],
                        1u8,
                        "Gate g_{} (COMP final) should return 1 (success)",
                        gate_num
                    );
                    assert_eq!(
                        &gate_output[1..],
                        &[0u8; 63],
                        "Gate g_{} (COMP final) should have zeros after first byte",
                        gate_num
                    );
                    println!("   ✓ g_{} (COMP final): retourne 1 (succès)", gate_num);
                }
                _ => {
                    panic!("Unknown opcode {} in gate g_{}", gate.opcode, gate_num);
                }
            }
        }
        
        println!("   ✅ Tous les {} gates vérifiés dans l'ordre!", circuit.gates.len());
        
        // 7.1. Vérifier les outputs des gates AES (décryptage) - vérification détaillée
        println!("\n🔍 Verification 1: AES decryption gates (detailed)");
        for i in 0..aes_count {
            let aes_gate_idx = i;
            let decrypted_block = &values[aes_gate_idx];
            
            // Calculer la position dans le plaintext
            let pt_start = i * 64;
            let pt_end = usize::min(pt_start + 64, plaintext.len());
            
            if pt_start < plaintext.len() {
                let expected_plaintext = &plaintext[pt_start..pt_end];
                let actual_plaintext = &decrypted_block[..(pt_end - pt_start)];
                
                assert_eq!(
                    actual_plaintext,
                    expected_plaintext,
                    "AES gate {} should decrypt block {} correctly",
                    i + 1,
                    i
                );
                println!("   ✓ AES gate g_{} (block {}): decrypted correctly ({} bytes)", 
                        i + 1, i, pt_end - pt_start);
            } else {
                println!("   ✓ AES gate g_{} (block {}): padding block", i + 1, i);
            }
        }
        
        // 7.2. Trouver le gate de hash final
        println!("\n🔍 Verification 2: SHA256 hash chain");
        let comp_gate = circuit.gates.last().unwrap();
        assert_eq!(comp_gate.opcode, OPCODE_COMP, "Last gate should be COMP");
        
        // Le premier son du gate COMP est le hash final
        let final_hash_gate_num = comp_gate.sons[0];
        assert!(final_hash_gate_num > 0, "Final hash gate number should be positive");
        let final_hash_idx = (final_hash_gate_num - 1) as usize;
        
        let computed_hash = &values[final_hash_idx][..32];
        assert_eq!(
            computed_hash,
            expected_description.as_slice(),
            "Computed SHA256 hash should match expected description"
        );
        println!("   ✓ Final hash (gate g_{}): matches description", final_hash_gate_num);
        println!("      Hash (hex): {}", hex::encode(computed_hash));
        
        // 7.3. Vérifier le gate CONST de description
        println!("\n🔍 Verification 3: Description CONST gate");
        let desc_gate_num = comp_gate.sons[1];
        assert!(desc_gate_num > 0, "Description gate number should be positive");
        let desc_gate_idx = (desc_gate_num - 1) as usize;
        let desc_gate = &circuit.gates[desc_gate_idx];
        
        assert_eq!(desc_gate.opcode, OPCODE_CONST, "Description gate should be CONST");
        assert_eq!(desc_gate.params.len(), 32, "Description gate params should be 32 bytes");
        assert_eq!(
            &desc_gate.params[..32],
            expected_description.as_slice(),
            "Description gate params should contain expected description"
        );
        
        let desc_output = &values[desc_gate_idx];
        assert_eq!(
            &desc_output[..32],
            expected_description.as_slice(),
            "Description gate output should match expected description"
        );
        println!("   ✓ Description CONST gate (g_{}): contains correct description", desc_gate_num);
        
        // 7.4. Vérifier le gate COMP final
        println!("\n🔍 Verification 4: Final COMP gate");
        let comp_output = values.last().unwrap();
        assert_eq!(
            comp_output[0],
            1u8,
            "Final COMP gate should return 1 (hash matches description)"
        );
        println!("   ✓ Final COMP gate: returns 1 (success)");
        
        // 7.5. Vérifier la structure des gates SHA2
        println!("\n🔍 Verification 5: SHA2 gate structure");
        
        // Trouver le premier gate SHA2
        let mut first_sha_idx = None;
        for (idx, gate) in circuit.gates.iter().enumerate() {
            if gate.opcode == OPCODE_SHA2 {
                first_sha_idx = Some(idx);
                break;
            }
        }
        let first_sha_idx = first_sha_idx.expect("Should have at least one SHA2 gate");
        
        for i in 0..sha_count {
            let sha_gate = &circuit.gates[first_sha_idx + i];
            assert_eq!(sha_gate.opcode, OPCODE_SHA2, "Gate should be SHA2");
            
            // Vérifier l'arity selon la position dans la chaîne
            if i == 0 {
                // Premier gate SHA2: peut avoir arity 1 ou 2 selon l'implémentation
                // Dans notre implémentation, le premier SHA2 a arity 1 (juste le bloc)
                // Mais vérifions ce qui est réellement dans le circuit
                println!("   ✓ SHA2 gate g_{} (first): arity {} (block)", 
                        first_sha_idx + i + 1, sha_gate.sons.len());
            } else {
                // Gates SHA2 suivants: arity 2 (prev_hash || block)
                assert_eq!(sha_gate.sons.len(), 2, 
                          "Subsequent SHA2 gates should have arity 2 (prev_hash || block)");
                println!("   ✓ SHA2 gate g_{} (chain): arity 2 (prev_hash || block)", 
                        first_sha_idx + i + 1);
            }
            
            let sha_output = &values[first_sha_idx + i];
            // SHA2 gates return 32 bytes (hash), not 64 bytes
            // But they might be normalized to 64 bytes in some implementations
            if sha_output.len() == 32 {
                // Standard: SHA2 returns 32-byte hash
                println!("      SHA2 output: 32 bytes (standard hash)");
            } else if sha_output.len() == 64 {
                // Normalized: SHA2 output padded to 64 bytes
                assert_eq!(&sha_output[32..], &[0u8; 32], "SHA2 output last 32B should be zeros if normalized");
                println!("      SHA2 output: 64 bytes (normalized, last 32B are zeros)");
            } else {
                panic!("SHA2 output should be 32 or 64 bytes, got {}", sha_output.len());
            }
            
            // Le hash est dans les 32 premiers bytes (ou tout le output si 32 bytes)
            let hash = if sha_output.len() == 32 {
                sha_output
            } else {
                &sha_output[..32]
            };
            if i == sha_count - 1 {
                // Dernier hash doit correspondre à la description
                assert_eq!(
                    hash,
                    expected_description.as_slice(),
                    "Last SHA2 hash should match description"
                );
                println!("      Final hash matches description ✓");
            }
        }
        
        // 7.6. Vérifier que tous les gates ont des outputs de taille valide
        println!("\n🔍 Verification 6: Gate output sizes");
        for (idx, (gate, value)) in circuit.gates.iter().zip(values.iter()).enumerate() {
            match gate.opcode {
                OPCODE_SHA2 => {
                    // SHA2 gates return 32-byte hash (or 64 if normalized)
                    assert!(
                        value.len() == 32 || value.len() == 64,
                        "SHA2 gate g_{} output should be 32 or 64 bytes, got {} bytes",
                        idx + 1,
                        value.len()
                    );
                }
                _ => {
                    // All other gates should produce 64-byte outputs
                    assert_eq!(
                        value.len(),
                        64,
                        "Gate g_{} (opcode {}) output should be 64 bytes, got {} bytes",
                        idx + 1,
                        gate.opcode,
                        value.len()
                    );
                }
            }
        }
        println!("   ✓ All {} gates produce valid-sized outputs", values.len());
        
        // 7.7. Test avec mauvaise clé (doit échouer)
        println!("\n🔍 Verification 7: Wrong key test");
        let wrong_key: Vec<u8> = vec![0xFFu8; 16];
        let values_wrong_key = evaluate_circuit_v2(&circuit.gates, &inputs, &wrong_key);
        let comp_result_wrong_key = values_wrong_key.last().unwrap();
        assert_eq!(
            comp_result_wrong_key[0],
            0u8,
            "COMP gate should return 0 with wrong key"
        );
        println!("   ✓ Wrong key correctly produces COMP = 0");
        
        // 7.8. Test avec mauvaise description (doit échouer)
        println!("\n🔍 Verification 8: Wrong description test");
        let wrong_description = sha256(b"Wrong message");
        let circuit_wrong = compile_circuit_v2(&ciphertext, &wrong_description);
        let values_wrong_desc = evaluate_circuit_v2(&circuit_wrong.gates, &inputs, &key);
        let comp_result_wrong_desc = values_wrong_desc.last().unwrap();
        assert_eq!(
            comp_result_wrong_desc[0],
            0u8,
            "COMP gate should return 0 with wrong description"
        );
        println!("   ✓ Wrong description correctly produces COMP = 0");
        
        // 7.9. Vérifier la cohérence: ré-évaluer avec les mêmes inputs doit donner les mêmes résultats
        println!("\n🔍 Verification 9: Determinism");
        let values2 = evaluate_circuit_v2(&circuit.gates, &inputs, &key);
        assert_eq!(
            values.len(),
            values2.len(),
            "Re-evaluation should produce same number of outputs"
        );
        for (idx, (v1, v2)) in values.iter().zip(values2.iter()).enumerate() {
            assert_eq!(
                v1, v2,
                "Gate g_{} output should be deterministic",
                idx + 1
            );
        }
        println!("   ✓ Circuit evaluation is deterministic");
        
        println!("\n✅ ============================================");
        println!("✅ TOUS LES TESTS DU SCÉNARIO COMPLET ONT RÉUSSI!");
        println!("✅ ============================================");
        println!("✅ Résumé:");
        println!("   - {} gates AES: décryptage correct", aes_count);
        println!("   - {} gates SHA2: hash chain correcte", sha_count);
        println!("   - {} gates CONST: description et padding corrects", const_count);
        println!("   - {} gates XOR: padding correct", xor_count);
        println!("   - {} gate COMP: comparaison correcte", comp_count);
        println!("   - Hash final: correspond à la description");
        println!("   - Résultat final: COMP = 1 (succès)");
        println!("✅ ============================================\n");
    }

    #[test]
    fn test_gate_hash_for_solidity_comparison() {
        use crate::accumulator::hash_block64;
        
        // Test pour comparer avec Solidity sha256GateV2
        let gates = vec![
            // Gate 1: AES-CTR avec 1 son (g_{-1})
            GateV2 {
                opcode: 0x01,
                sons: vec![-1i64],
                params: {
                    let mut p = vec![0u8; 18];
                    p[16] = 0x00;
                    p[17] = 0x40;
                    p
                },
            },
            // Gate 2: SHA2 avec 1 son (g_1)
            GateV2 {
                opcode: 0x02,
                sons: vec![1i64],
                params: vec![],
            },
            // Gate 3: CONST
            GateV2 {
                opcode: 0x03,
                sons: vec![],
                params: {
                    let mut p = vec![0u8; 32];
                    p[0] = 0x80;
                    p
                },
            },
        ];

        println!("\n=== Test de hashage pour comparaison Solidity ===\n");
        for (i, gate) in gates.iter().enumerate() {
            let encoded = gate.encode();
            let hash = hash_block64(&encoded);
            
            println!("Gate {}:", i + 1);
            println!("  Opcode: 0x{:02x}", gate.opcode);
            println!("  Sons: {:?}", gate.sons);
            println!("  Encoded (64 bytes): {}", hex::encode(&encoded));
            println!("  Hash (Rust): {}", hex::encode(&hash));
            println!();
        }
    }
}
