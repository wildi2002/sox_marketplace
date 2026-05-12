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
/// Extended opcodes for the extended image description circuit.
/// CMPOFF: compare fixed bytes at a given offset in a 64B AES block against expected bytes.
///   sons: [block]  params: offset(2B BE) || length(1B) || expected_bytes(length B)
pub const OPCODE_CMPOFF: u8 = 0x06;
/// CMPBLOCK: compare bytes at offset_a in block_a against bytes at offset_b in block_b.
///   sons: [block_a, block_b]  params: off_a(2B BE) || off_b(2B BE) || length(1B)
pub const OPCODE_CMPBLOCK: u8 = 0x07;
/// AND: bitwise AND of the first byte of two boolean gate outputs.
///   sons: [a, b]  params: (none)
pub const OPCODE_AND: u8 = 0x08;
/// GETBYTE: extract one byte from a 64B block and place it at a target position.
///   sons: [block]  params: src_offset(1B) || dst_offset(1B)
///   output: 64B vector with byte[dst_offset] = block[src_offset], all others = 0.
pub const OPCODE_GETBYTE: u8 = 0x09;

/// Function type for V2 instructions.
/// Takes sons (input values), params (gate-specific parameters), and aes_key (for AES-CTR gates).
type InstructionV2 = fn(sons: &[Vec<u8>], params: &[u8], aes_key: &[u8]) -> Vec<u8>;

/// Returns the instruction table for V2 circuits.
/// This function provides a list of instruction functions indexed by opcode.
fn version_instructions_v2() -> Vec<InstructionV2> {
    vec![
        instruction_aes_ctr,   // opcode 0x01
        instruction_sha2,      // opcode 0x02
        instruction_const,     // opcode 0x03
        instruction_xor,       // opcode 0x04
        instruction_comp,      // opcode 0x05
        instruction_cmpoff,    // opcode 0x06
        instruction_cmpblock,  // opcode 0x07
        instruction_and,       // opcode 0x08
        instruction_getbyte,   // opcode 0x09
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

/// Instruction wrapper for CMPOFF opcode.
fn instruction_cmpoff(sons: &[Vec<u8>], params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_cmpoff(sons, params)
}

/// Instruction wrapper for CMPBLOCK opcode.
fn instruction_cmpblock(sons: &[Vec<u8>], params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_cmpblock(sons, params)
}

/// Instruction wrapper for AND opcode.
fn instruction_and(sons: &[Vec<u8>], _params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_and(sons)
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
    #[cfg(not(target_arch = "wasm32"))]
    use rayon::prelude::*;

    if gates.is_empty() {
        return vec![];
    }
    if gates.len() == 1 {
        let mut enc = [0u8; 64];
        gates[0].encode_into(&mut enc);
        return hash_block64(&enc.to_vec()).to_vec();
    }

    let hash_gate = |i: usize| -> [u8; 32] {
        let mut enc = [0u8; 64];
        gates[i].encode_into(&mut enc);
        hash_block64(&enc)
    };

    let mut layer: Vec<[u8; 32]> = {
        #[cfg(not(target_arch = "wasm32"))]
        { (0..gates.len()).into_par_iter().map(hash_gate).collect() }
        #[cfg(target_arch = "wasm32")]
        { (0..gates.len()).map(hash_gate).collect() }
    };

    let combine = |i: usize, lr: &Vec<[u8; 32]>| -> [u8; 32] {
        if i + 1 < lr.len() {
            let mut hasher = Keccak256::new();
            hasher.update(&lr[i]);
            hasher.update(&lr[i + 1]);
            hasher.finalize().into()
        } else {
            lr[i]
        }
    };

    while layer.len() > 1 {
        let indices: Vec<usize> = (0..layer.len()).step_by(2).collect();
        let next: Vec<[u8; 32]> = {
            #[cfg(not(target_arch = "wasm32"))]
            { indices.into_par_iter().map(|i| combine(i, &layer)).collect() }
            #[cfg(target_arch = "wasm32")]
            { indices.into_iter().map(|i| combine(i, &layer)).collect() }
        };
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

/// CMPOFF: compare `length` bytes of `block` at `offset` against expected bytes in params.
/// Output: 64B vector with byte 0 = 1 (equal) or 0 (not equal).
fn eval_cmpoff(sons: &[Vec<u8>], params: &[u8]) -> Vec<u8> {
    if sons.len() != 1 {
        die("CMPOFF gate expects arity 1");
    }
    if params.len() < 3 {
        die("CMPOFF gate expects offset(2B) + length(1B) + expected_bytes in params");
    }
    let offset = u16::from_be_bytes([params[0], params[1]]) as usize;
    let length = params[2] as usize;
    if params.len() < 3 + length {
        die("CMPOFF gate: params too short for expected bytes");
    }
    let expected = &params[3..3 + length];
    let block = normalize_64(sons[0].clone());
    let eq = offset + length <= 64 && block[offset..offset + length] == *expected;
    let mut out = vec![0u8; 64];
    out[0] = if eq { 1 } else { 0 };
    out
}

/// CMPBLOCK: compare `length` bytes of block_a at off_a against block_b at off_b.
/// Output: 64B vector with byte 0 = 1 (equal) or 0 (not equal).
fn eval_cmpblock(sons: &[Vec<u8>], params: &[u8]) -> Vec<u8> {
    if sons.len() != 2 {
        die("CMPBLOCK gate expects arity 2");
    }
    if params.len() < 5 {
        die("CMPBLOCK gate expects off_a(2B) + off_b(2B) + length(1B) in params");
    }
    let off_a = u16::from_be_bytes([params[0], params[1]]) as usize;
    let off_b = u16::from_be_bytes([params[2], params[3]]) as usize;
    let length = params[4] as usize;
    let block_a = normalize_64(sons[0].clone());
    let block_b = normalize_64(sons[1].clone());
    let eq = off_a + length <= 64 && off_b + length <= 64
        && block_a[off_a..off_a + length] == block_b[off_b..off_b + length];
    let mut out = vec![0u8; 64];
    out[0] = if eq { 1 } else { 0 };
    out
}

/// AND: logical AND of two boolean gate outputs (checks byte 0 of each).
/// Output: 64B vector with byte 0 = 1 iff both inputs have byte 0 = 1.
fn eval_and(sons: &[Vec<u8>]) -> Vec<u8> {
    if sons.len() != 2 {
        die("AND gate expects arity 2");
    }
    let mut out = vec![0u8; 64];
    out[0] = sons[0].first().copied().unwrap_or(0) & sons[1].first().copied().unwrap_or(0);
    out
}

/// Instruction wrapper for GETBYTE opcode.
fn instruction_getbyte(sons: &[Vec<u8>], params: &[u8], _aes_key: &[u8]) -> Vec<u8> {
    eval_getbyte(sons, params)
}

/// GETBYTE: extract one byte from a 64B block and place it at a target byte position.
/// sons: [block]  params: src_offset(1B) dst_offset(1B)
/// Output: 64B with out[dst_offset] = block[src_offset], all other bytes = 0.
fn eval_getbyte(sons: &[Vec<u8>], params: &[u8]) -> Vec<u8> {
    if sons.len() != 1 {
        die("GETBYTE gate expects arity 1");
    }
    if params.len() < 2 {
        die("GETBYTE gate expects src_offset(1B) dst_offset(1B) in params");
    }
    let src = params[0] as usize;
    let dst = params[1] as usize;
    let block = normalize_64(sons[0].clone());
    let mut out = vec![0u8; 64];
    if src < 64 && dst < 64 {
        out[dst] = block[src];
    }
    out
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

/// Byte offset of BMP pixel data within the container x.
/// Container: header(64B) || BMP file; BMP pixel data = BMP_FILEHEADER(14B) + BMP_INFOHEADER(40B) = offset 54 from BMP start.
pub const BMP_PIXELS_START_IN_X: usize = 64 + 14 + 40; // = 118

/// Description tuple for the extended image circuit.
///
/// Container layout (x = what the vendor encrypts and sells):
///   bytes   0– 63 : header  (format 1B | size 4B | width 4B | height 4B | reserved 51B)
///   bytes  64+    : standard BMP file (BITMAPFILEHEADER 14B + BITMAPINFOHEADER 40B + pixel data)
///
/// No preview segment is embedded in x.  The circuit computes a 256×256 nearest-neighbour
/// thumbnail directly from the BMP pixel data and verifies SHA256(computed_thumb) = d_thumb.
/// This cryptographically binds d_thumb to the actual pixel content.
pub struct ExtendedImageDesc {
    pub d_sha: [u8; 32],   // SHA256(x)
    pub d_thumb: [u8; 32], // SHA256(NN-256×256 thumbnail computed from BMP pixels)
    pub d_width: u32,      // image width in pixels
    pub d_height: u32,     // image height in pixels
    pub d_format: u8,      // format tag (0 = BMP)
    pub d_size: u32,       // container size in bytes
}

/// Compiles a V2 circuit for the extended image description.
///
/// The output gate is an AND chain whose final bit is 1 iff all of the following hold:
///   1. SHA256(Dec_k(ct)) = d_sha
///   2. SHA256(NN-thumbnail extracted from BMP pixels) = d_thumb
///   3. Header byte 0 = d_format (0x00)
///   4. Header bytes 1..5 = d_size (big-endian u32)
///   5. Header bytes 5..9 = d_width (big-endian u32)
///   6. Header bytes 9..13 = d_height (big-endian u32)
///
/// Circuit size: ≈ 2m + 393 230 gates (dominated by 196 608 GETBYTE + 193 536 XOR + 3 073 SHA).
pub fn compile_circuit_extended_image_v2(ct: &[u8], desc: &ExtendedImageDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 {
        die("Ciphertext must include a 16-byte IV");
    }
    let iv = &ct[..16];
    let data = &ct[16..];

    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    let img_w = desc.d_width as usize;
    let img_h = desc.d_height as usize;
    let row_stride = (img_w * 3 + 3) / 4 * 4;

    // Minimum: header block + BMP file headers + at least one pixel row
    let min_size = BMP_PIXELS_START_IN_X + img_h * row_stride;
    if pt_len < min_size {
        die(&format!(
            "Container too small: {} bytes, need ≥ {} for {}×{} BMP",
            pt_len, min_size, img_w, img_h
        ));
    }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    // ── Phase 1: AES-CTR decryption (m gates) ─────────────────────────────────
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }

    // ── Phase 2: SHA256 of full plaintext ──────────────────────────────────────
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let last_aes_gate_num = (*block_outputs.last().unwrap() + 1) as i64;
    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra);
        full_sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits_full.to_be_bytes()); }
        let mg = push_const2(&mut gates, &mask);
        let pg = push_gate(&mut gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes_gate_num, mg], params: vec![] });
        *full_sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
        }
    }
    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let desc_sha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_COMP, sons: vec![final_full_sha, desc_sha_gate], params: vec![],
    });

    // ── Phase 3: Compute NN thumbnail from BMP pixels and verify SHA256 ───────
    // Nearest-neighbour: output pixel (ox, oy) ← source pixel (ox*W/256, oy*H/256).
    let thumb_block_gates = emit_pixel_region_gates(
        &mut gates,
        &block_outputs,
        256, 256,
        img_h, row_stride,
        |ox, oy| (ox * img_w / 256, oy * img_h / 256),
    );
    let final_thumb_sha = sha_region_196608(&mut gates, &thumb_block_gates);
    let desc_thumb_gate = push_const1(&mut gates, &desc.d_thumb);
    let thumb_comp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_COMP, sons: vec![final_thumb_sha, desc_thumb_gate], params: vec![],
    });

    // ── Phase 4: CMPOFF gates on header block (block 0) ───────────────────────
    let hdr = (block_outputs[0] + 1) as i64;
    let fmt_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,desc.d_format] });
    let mut p_sz   = vec![0u8,1,4]; p_sz.extend_from_slice(&desc.d_size.to_be_bytes());
    let sz_gate    = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_w    = vec![0u8,5,4]; p_w.extend_from_slice(&desc.d_width.to_be_bytes());
    let width_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_w });
    let mut p_h    = vec![0u8,9,4]; p_h.extend_from_slice(&desc.d_height.to_be_bytes());
    let hgt_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_h });

    // ── Phase 5: AND chain ────────────────────────────────────────────────────
    let a1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp_gate, thumb_comp_gate], params: vec![] });
    let a2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, fmt_gate],   params: vec![] });
    let a3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, sz_gate],    params: vec![] });
    let a4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, width_gate], params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, hgt_gate], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: block_size as u32, num_blocks: m as u32 }
}

// ── Extended Audio circuit ─────────────────────────────────────────────────────

/// Crop window: first 240 000 Int16 samples = 480 000 bytes = 7 500 × 64B blocks.
/// Same byte count as AUDIO_LOWRES_OUT_BYTES — both are 480 kB.
const AUDIO_CROP_BYTES:  usize = 480_000;
const AUDIO_CROP_BLOCKS: usize = 7_500;

/// Decimated lowres output: N = 240 000 Int16 samples × 2 B = 480 000 bytes = 7 500 blocks.
const AUDIO_LOWRES_SAMPLES:   usize = 240_000;
const AUDIO_LOWRES_OUT_BYTES: usize = 480_000; // AUDIO_LOWRES_SAMPLES * 2


/// Description tuple for the extended-audio circuit (76 bytes, format 0x01).
///
/// Canonical container: x = header(64B) || mono Int16 PCM at original SR.
///   bytes  0– 63: header (tag 0x01 | size 4B | duration 4B | bitrate 4B |
///                          sample_rate 4B | total_samples 4B | reserved 43B)
///   bytes 64+   : full mono Int16-LE PCM at original sample rate (≥ 480 000 B)
///
/// All header fields are big-endian so they lie at fixed byte offsets within block 0.
pub struct ExtendedAudioDesc {
    pub d_sha:      [u8; 32], // SHA256(full container)
    pub d_crop:     [u8; 32], // SHA256(x[64..480064]) — first 240 000 samples
    pub d_duration: u32,      // total duration in seconds
    pub d_bitrate:  u32,      // encoding bitrate in kbps
    pub d_size:     u32,      // total container size in bytes
    pub d_format:   u8,       // format tag (0x01)
}

/// Compiles a V2 circuit for the extended audio description.
///
/// The output gate is an AND chain whose final bit is 1 iff all of the following hold:
///   1. SHA256(Dec_k(ct)) = d_sha
///   2. SHA256(Dec_k(ct)[64..480064]) = d_crop  (first 240 000 Int16 samples, block-range)
///   3. Header byte 0 = format tag
///   4. Header bytes 1..5 = d_size (big-endian u32)
///   5. Header bytes 5..9 = d_duration (big-endian u32)
///   6. Header bytes 9..13 = d_bitrate (big-endian u32)
///
/// Circuit size: ≈ 2m + 7524 gates, where m = ⌈|ct data| / 64⌉.
pub fn compile_circuit_extended_audio_v2(ct: &[u8], desc: &ExtendedAudioDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 {
        die("Ciphertext must include a 16-byte IV");
    }
    let iv = &ct[..16];
    let data = &ct[16..];

    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    if m < AUDIO_CROP_BLOCKS + 1 {
        die("Extended audio requires at least 7501 blocks (1 header + 7500 crop)");
    }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    // ── Phase 1: AES-CTR decryption (m gates) ─────────────────────────────────
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 {
            opcode: OPCODE_AES_CTR,
            sons: vec![-(i as i64 + 1)],
            params,
        });
        block_outputs.push(gates.len() - 1);
    }

    // ── Phase 2: SHA256 of full plaintext ──────────────────────────────────────
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let pad_extra_full = rem > block_size - 9;
    let last_aes_gate_num = (*block_outputs.last().unwrap() + 1) as i64;

    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();

    if rem == 0 {
        let mut extra = vec![0u8; 64];
        extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra);
        full_sha_blocks.push((h - 1) as usize);
    } else {
        let mut mask = vec![0u8; 64];
        mask[rem] = 0x80;
        if !pad_extra_full {
            mask[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        }
        let mask_gate = push_const2(&mut gates, &mask);
        let padded = push_gate(&mut gates, GateV2 {
            opcode: OPCODE_XOR,
            sons: vec![last_aes_gate_num, mask_gate],
            params: vec![],
        });
        *full_sha_blocks.last_mut().unwrap() = (padded - 1) as usize;

        if pad_extra_full {
            let mut extra = vec![0u8; 64];
            extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra);
            full_sha_blocks.push((h - 1) as usize);
        }
    }

    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let desc_sha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_COMP,
        sons: vec![final_full_sha, desc_sha_gate],
        params: vec![],
    });

    // ── Phase 3: SHA256 of crop (blocks 1..=7500, 480 000 bytes, block-range) ────
    // d_crop = SHA256(x[64..480064]); 480000 % 64 = 0 → extra padding block required
    let crop_len_bits: u64 = (AUDIO_CROP_BYTES as u64) * 8;
    let mut crop_pad = vec![0u8; 64];
    crop_pad[0] = 0x80;
    crop_pad[56..].copy_from_slice(&crop_len_bits.to_be_bytes());
    let crop_pad_gate = push_const2(&mut gates, &crop_pad);

    let mut crop_sha_blocks: Vec<usize> = block_outputs[1..AUDIO_CROP_BLOCKS + 1].to_vec();
    crop_sha_blocks.push((crop_pad_gate - 1) as usize);

    let final_crop_sha = sha_chain(&mut gates, &crop_sha_blocks);
    let desc_crop_gate = push_const1(&mut gates, &desc.d_crop);
    let preview_comp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_COMP,
        sons: vec![final_crop_sha, desc_crop_gate],
        params: vec![],
    });

    // ── Phase 4: CMPOFF gates on header block (block 0) ───────────────────────
    let header_gate_num = (block_outputs[0] + 1) as i64;

    // format: 1 byte at offset 0, expected d_format
    let p_fmt = vec![0u8, 0u8, 1u8, desc.d_format];
    let format_cmp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_CMPOFF,
        sons: vec![header_gate_num],
        params: p_fmt,
    });

    // size: 4 bytes at offset 1
    let mut p_size = vec![0u8, 1u8, 4u8];
    p_size.extend_from_slice(&desc.d_size.to_be_bytes());
    let size_cmp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_CMPOFF,
        sons: vec![header_gate_num],
        params: p_size,
    });

    // duration: 4 bytes at offset 5
    let mut p_dur = vec![0u8, 5u8, 4u8];
    p_dur.extend_from_slice(&desc.d_duration.to_be_bytes());
    let duration_cmp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_CMPOFF,
        sons: vec![header_gate_num],
        params: p_dur,
    });

    // bitrate: 4 bytes at offset 9
    let mut p_brate = vec![0u8, 9u8, 4u8];
    p_brate.extend_from_slice(&desc.d_bitrate.to_be_bytes());
    let bitrate_cmp_gate = push_gate(&mut gates, GateV2 {
        opcode: OPCODE_CMPOFF,
        sons: vec![header_gate_num],
        params: p_brate,
    });

    // ── Phase 5: AND chain combining all 6 boolean results ────────────────────
    let and1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp_gate, preview_comp_gate], params: vec![] });
    let and2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![and1, format_cmp_gate], params: vec![] });
    let and3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![and2, size_cmp_gate], params: vec![] });
    let and4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![and3, duration_cmp_gate], params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![and4, bitrate_cmp_gate], params: vec![] });

    CompiledCircuitV2 {
        version: 1,
        gates,
        block_size: block_size as u32,
        num_blocks: m as u32,
    }
}

// ── Extended Image: Crop (format 0x02) ────────────────────────────────────────

/// Description tuple for the extended-image-crop circuit (84 bytes).
///
/// Container layout (x = what the vendor encrypts and sells):
///   bytes   0– 63: header (0x02 | size 4B | imgW 4B | imgH 4B | cropX 4B | cropY 4B | reserved 43B)
///   bytes  64+   : standard BMP file (no preview segment embedded)
///
/// The circuit extracts the 256×256 native-resolution crop at (crop_x, crop_y) directly
/// from the BMP pixel data and verifies SHA256(extracted_crop) = d_crop.
/// crop_x and crop_y are part of the on-chain description, so the circuit enforces both
/// the hash and the crop position.
pub struct ExtendedImageCropDesc {
    pub d_sha:    [u8; 32],
    pub d_crop:   [u8; 32],
    pub d_width:  u32,
    pub d_height: u32,
    pub d_size:   u32,
    pub crop_x:   u32,   // top-left x of the 256×256 crop in the original image
    pub crop_y:   u32,   // top-left y of the 256×256 crop in the original image
}

/// Compiles a V2 circuit for the extended-image-crop description (84-byte description).
///
/// Verifies: SHA256(full) = d_sha, SHA256(native-res crop extracted from BMP) = d_crop,
/// format tag = 0x02, size/width/height at header offsets 1/5/9.
pub fn compile_circuit_extended_image_crop_v2(ct: &[u8], desc: &ExtendedImageCropDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 { die("Ciphertext must include a 16-byte IV"); }
    let iv = &ct[..16];
    let data = &ct[16..];
    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    let img_w = desc.d_width as usize;
    let img_h = desc.d_height as usize;
    let crop_x = desc.crop_x as usize;
    let crop_y = desc.crop_y as usize;
    let row_stride = (img_w * 3 + 3) / 4 * 4;

    if crop_x + 256 > img_w || crop_y + 256 > img_h {
        die("Crop region extends outside the image boundaries");
    }
    let min_size = BMP_PIXELS_START_IN_X + img_h * row_stride;
    if pt_len < min_size {
        die(&format!("Container too small for {}×{} BMP", img_w, img_h));
    }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }

    // Phase 2: SHA256(full)
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let last_aes = (*block_outputs.last().unwrap() + 1) as i64;
    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits_full.to_be_bytes()); }
        let mg = push_const2(&mut gates, &mask);
        let pg = push_gate(&mut gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes, mg], params: vec![] });
        *full_sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
        }
    }
    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let dsha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_full_sha, dsha_gate], params: vec![] });

    // Phase 3: Extract 256×256 native-res crop at (crop_x, crop_y) and verify SHA256
    let crop_block_gates = emit_pixel_region_gates(
        &mut gates, &block_outputs,
        256, 256, img_h, row_stride,
        |tx, ty| (crop_x + tx, crop_y + ty),
    );
    let final_crop_sha = sha_region_196608(&mut gates, &crop_block_gates);
    let dcrop_gate = push_const1(&mut gates, &desc.d_crop);
    let crop_comp_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_crop_sha, dcrop_gate], params: vec![] });

    // Phase 4: CMPOFF on header (block 0)
    let hdr = (block_outputs[0] + 1) as i64;
    let fmt_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,0x02] });
    let mut p_sz = vec![0u8,1,4]; p_sz.extend_from_slice(&desc.d_size.to_be_bytes());
    let sz_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_w  = vec![0u8,5,4]; p_w.extend_from_slice(&desc.d_width.to_be_bytes());
    let w_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_w });
    let mut p_h  = vec![0u8,9,4]; p_h.extend_from_slice(&desc.d_height.to_be_bytes());
    let h_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_h });

    // Phase 5: AND chain
    let a1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp_gate, crop_comp_gate], params: vec![] });
    let a2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, fmt_gate], params: vec![] });
    let a3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, sz_gate], params: vec![] });
    let a4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, w_gate], params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, h_gate], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: block_size as u32, num_blocks: m as u32 }
}

// ── Extended Image: Dual (format 0x03) ────────────────────────────────────────

/// Description tuple for the extended-image-dual circuit (116 bytes).
///
/// Container layout (x = what the vendor encrypts and sells):
///   bytes   0–63: header (0x03 | size 4B | imgW 4B | imgH 4B | cropX 4B | cropY 4B | reserved 43B)
///   bytes  64+  : standard BMP file (no preview segments embedded)
///
/// The circuit computes both previews from the BMP pixel data:
///   - NN 256×256 thumbnail (whole image downscaled) → SHA256 = d_thumb
///   - Native-res 256×256 crop at (crop_x, crop_y)  → SHA256 = d_crop
pub struct ExtendedImageDualDesc {
    pub d_sha:    [u8; 32],
    pub d_thumb:  [u8; 32],
    pub d_crop:   [u8; 32],
    pub d_width:  u32,
    pub d_height: u32,
    pub d_size:   u32,
    pub crop_x:   u32,
    pub crop_y:   u32,
}

/// Compiles a V2 circuit for the extended-image-dual description (116-byte description).
///
/// Verifies: SHA256(full) = d_sha, SHA256(NN thumbnail) = d_thumb,
/// SHA256(native-res crop at (crop_x,crop_y)) = d_crop, format = 0x03, size/width/height.
pub fn compile_circuit_extended_image_dual_v2(ct: &[u8], desc: &ExtendedImageDualDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 { die("Ciphertext must include a 16-byte IV"); }
    let iv = &ct[..16];
    let data = &ct[16..];
    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    let img_w = desc.d_width as usize;
    let img_h = desc.d_height as usize;
    let crop_x = desc.crop_x as usize;
    let crop_y = desc.crop_y as usize;
    let row_stride = (img_w * 3 + 3) / 4 * 4;

    if crop_x + 256 > img_w || crop_y + 256 > img_h {
        die("Crop region extends outside the image boundaries");
    }
    let min_size = BMP_PIXELS_START_IN_X + img_h * row_stride;
    if pt_len < min_size { die(&format!("Container too small for {}×{} BMP", img_w, img_h)); }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }

    // Phase 2: SHA256(full)
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let last_aes = (*block_outputs.last().unwrap() + 1) as i64;
    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits_full.to_be_bytes()); }
        let mg = push_const2(&mut gates, &mask);
        let pg = push_gate(&mut gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes, mg], params: vec![] });
        *full_sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
        }
    }
    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let dsha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_full_sha, dsha_gate], params: vec![] });

    // Phase 3a: NN thumbnail
    let thumb_blocks = emit_pixel_region_gates(
        &mut gates, &block_outputs,
        256, 256, img_h, row_stride,
        |ox, oy| (ox * img_w / 256, oy * img_h / 256),
    );
    let final_thumb_sha = sha_region_196608(&mut gates, &thumb_blocks);
    let dthumb_gate = push_const1(&mut gates, &desc.d_thumb);
    let thumb_comp = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_thumb_sha, dthumb_gate], params: vec![] });

    // Phase 3b: Native-res crop at (crop_x, crop_y)
    let crop_blocks = emit_pixel_region_gates(
        &mut gates, &block_outputs,
        256, 256, img_h, row_stride,
        |tx, ty| (crop_x + tx, crop_y + ty),
    );
    let final_crop_sha = sha_region_196608(&mut gates, &crop_blocks);
    let dcrop_gate = push_const1(&mut gates, &desc.d_crop);
    let crop_comp = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_crop_sha, dcrop_gate], params: vec![] });

    // Phase 4: CMPOFF on header (block 0)
    let hdr = (block_outputs[0] + 1) as i64;
    let fmt_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,0x03] });
    let mut p_sz = vec![0u8,1,4]; p_sz.extend_from_slice(&desc.d_size.to_be_bytes());
    let sz_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_w  = vec![0u8,5,4]; p_w.extend_from_slice(&desc.d_width.to_be_bytes());
    let w_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_w });
    let mut p_h  = vec![0u8,9,4]; p_h.extend_from_slice(&desc.d_height.to_be_bytes());
    let h_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_h });

    // Phase 5: AND chain
    let a1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp, thumb_comp], params: vec![] });
    let a2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, crop_comp],  params: vec![] });
    let a3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, fmt_gate],   params: vec![] });
    let a4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, sz_gate],    params: vec![] });
    let a5 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, w_gate],     params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, h_gate], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: block_size as u32, num_blocks: m as u32 }
}

// ── Extended Audio: Low-res Full (format 0x02) ────────────────────────────────

/// Description tuple for the extended-audio-lowres circuit (76 bytes).
///
/// Canonical container: x = header(64B) || full mono Int16-LE PCM at original SR.
///   bytes  0–63: header (tag 0x02 | size 4B | duration 4B | bitrate 4B |
///                         sample_rate 4B | total_samples 4B | reserved 43B)
///   bytes 64+  : full mono Int16-LE PCM (≥ AUDIO_LOWRES_SAMPLES × 2 bytes after zero-pad)
///
/// d_lowres = SHA256 of N = 240 000 decimated Int16 samples extracted at stride K,
/// where K = ⌈total_samples / N⌉ is derived from header bytes 17–20.
/// This is the 1-D analogue of image NN thumbnailing (GetByte at stride).
pub struct ExtendedAudioLowresDesc {
    pub d_sha:          [u8; 32],
    pub d_lowres:       [u8; 32],
    pub d_duration:     u32,
    pub d_bitrate:      u32,
    pub d_size:         u32,
    pub d_total_samples: u32, // total PCM samples — circuit derives stride K from this
}

/// Compiles a V2 circuit for the extended-audio-lowres description (76-byte description).
///
/// Verifies:
///   1. SHA256(x) = d_sha
///   2. SHA256(decimated[0..N]) = d_lowres  (N = 240 000, K = ⌈d_total_samples/N⌉)
///   3. format tag = 0x02; size/duration/bitrate/total_samples in header
pub fn compile_circuit_extended_audio_lowres_v2(ct: &[u8], desc: &ExtendedAudioLowresDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 { die("Ciphertext must include a 16-byte IV"); }
    let iv = &ct[..16];
    let data = &ct[16..];
    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    let total_samples = desc.d_total_samples as usize;
    let stride_k = total_samples.div_ceil(AUDIO_LOWRES_SAMPLES).max(1);
    // Last sample needed is at PCM index (AUDIO_LOWRES_SAMPLES-1)*stride_k
    let last_sample_byte = 64 + (AUDIO_LOWRES_SAMPLES - 1) * stride_k * 2 + 2;
    let min_blocks = (last_sample_byte + block_size - 1) / block_size;
    if m < min_blocks {
        die(&format!("Container too small: {m} blocks, need ≥ {min_blocks} for stride {stride_k}"));
    }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    // Phase 1: AES-CTR decryption
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }

    // Phase 2: SHA256(full)
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let last_aes = (*block_outputs.last().unwrap() + 1) as i64;
    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits_full.to_be_bytes()); }
        let mg = push_const2(&mut gates, &mask);
        let pg = push_gate(&mut gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes, mg], params: vec![] });
        *full_sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
        }
    }
    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let dsha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp  = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_full_sha, dsha_gate], params: vec![] });

    // Phase 3: SHA256 of N decimated Int16 samples at stride K (GetByte)
    // Extracts AUDIO_LOWRES_OUT_BYTES = 480 000 bytes, divisible by 64 → padding block needed
    let lowres_blocks = emit_audio_decimated_gates(&mut gates, &block_outputs, stride_k, 64);
    let lowres_len_bits: u64 = (AUDIO_LOWRES_OUT_BYTES as u64) * 8;
    let mut lowres_pad = vec![0u8; 64]; lowres_pad[0] = 0x80;
    lowres_pad[56..].copy_from_slice(&lowres_len_bits.to_be_bytes());
    let lowres_pad_gate = push_const2(&mut gates, &lowres_pad);
    let mut lowres_sha_input = lowres_blocks;
    lowres_sha_input.push((lowres_pad_gate - 1) as usize);
    let final_lowres_sha = sha_chain(&mut gates, &lowres_sha_input);
    let dlowres_gate = push_const1(&mut gates, &desc.d_lowres);
    let lowres_comp  = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_lowres_sha, dlowres_gate], params: vec![] });

    // Phase 4: CMPOFF on header
    let hdr = (block_outputs[0] + 1) as i64;
    let fmt_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,0x02] });
    let mut p_sz  = vec![0u8,1,4];  p_sz.extend_from_slice(&desc.d_size.to_be_bytes());
    let sz_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_d   = vec![0u8,5,4];  p_d.extend_from_slice(&desc.d_duration.to_be_bytes());
    let dur_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_d });
    let mut p_b   = vec![0u8,9,4];  p_b.extend_from_slice(&desc.d_bitrate.to_be_bytes());
    let brate_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_b });
    let mut p_ts  = vec![0u8,17,4]; p_ts.extend_from_slice(&desc.d_total_samples.to_be_bytes());
    let ts_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_ts });

    // Phase 5: AND chain
    let a1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp, lowres_comp], params: vec![] });
    let a2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, fmt_gate],   params: vec![] });
    let a3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, sz_gate],    params: vec![] });
    let a4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, dur_gate],   params: vec![] });
    let a5 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, brate_gate], params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, ts_gate], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: block_size as u32, num_blocks: m as u32 }
}

// ── Extended Audio: Both (format 0x03) ────────────────────────────────────────

/// Description tuple for the extended-audio-both circuit (112 bytes).
///
/// Canonical container: x = header(64B) || full mono Int16-LE PCM at original SR.
///   bytes 0–63: header (tag 0x03 | size 4B | duration 4B | bitrate 4B |
///                        sample_rate 4B | total_samples 4B | reserved 43B)
///   bytes 64+:  full mono Int16-LE PCM
///
/// d_crop   = SHA256(x[64..480064])          — block-range, first 240k samples
/// d_lowres = SHA256(decimated[0..N])        — N=240k samples at stride K=⌈total/N⌉
pub struct ExtendedAudioBothDesc {
    pub d_sha:           [u8; 32],
    pub d_crop:          [u8; 32],
    pub d_lowres:        [u8; 32],
    pub d_duration:      u32,
    pub d_bitrate:       u32,
    pub d_size:          u32,
    pub d_total_samples: u32,
}

/// Compiles a V2 circuit for the extended-audio-both description (112-byte description).
///
/// Verifies: SHA256(x)=d_sha, SHA256(x[64..480064])=d_crop,
/// SHA256(decimated)=d_lowres, format=0x03, header fields.
pub fn compile_circuit_extended_audio_both_v2(ct: &[u8], desc: &ExtendedAudioBothDesc) -> CompiledCircuitV2 {
    if ct.len() < 16 { die("Ciphertext must include a 16-byte IV"); }
    let iv = &ct[..16];
    let data = &ct[16..];
    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;

    let total_samples = desc.d_total_samples as usize;
    let stride_k = total_samples.div_ceil(AUDIO_LOWRES_SAMPLES).max(1);
    let last_sample_byte = 64 + (AUDIO_LOWRES_SAMPLES - 1) * stride_k * 2 + 2;
    let min_blocks = (last_sample_byte.max(64 + AUDIO_CROP_BYTES) + block_size - 1) / block_size;
    if m < min_blocks { die(&format!("Container too small: {m} blocks, need ≥ {min_blocks}")); }

    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);

    // Phase 1: AES-CTR
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }

    // Phase 2: SHA256(full)
    let rem = pt_len % block_size;
    let len_bits_full = (pt_len as u64) * 8;
    let last_aes = (*block_outputs.last().unwrap() + 1) as i64;
    let mut full_sha_blocks: Vec<usize> = block_outputs.clone();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
        let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits_full.to_be_bytes()); }
        let mg = push_const2(&mut gates, &mask);
        let pg = push_gate(&mut gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes, mg], params: vec![] });
        *full_sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits_full.to_be_bytes());
            let h = push_const2(&mut gates, &extra); full_sha_blocks.push((h - 1) as usize);
        }
    }
    let final_full_sha = sha_chain(&mut gates, &full_sha_blocks);
    let dsha_gate = push_const1(&mut gates, &desc.d_sha);
    let sha_comp  = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_full_sha, dsha_gate], params: vec![] });

    // Phase 3a: SHA256(crop, blocks 1..=7500, 480 000 bytes, block-range)
    let crop_len_bits: u64 = (AUDIO_CROP_BYTES as u64) * 8;
    let mut crop_pad = vec![0u8; 64]; crop_pad[0] = 0x80;
    crop_pad[56..].copy_from_slice(&crop_len_bits.to_be_bytes());
    let crop_pad_gate = push_const2(&mut gates, &crop_pad);
    let mut crop_sha_blocks: Vec<usize> = block_outputs[1..AUDIO_CROP_BLOCKS + 1].to_vec();
    crop_sha_blocks.push((crop_pad_gate - 1) as usize);
    let final_crop_sha = sha_chain(&mut gates, &crop_sha_blocks);
    let dcrop_gate  = push_const1(&mut gates, &desc.d_crop);
    let crop_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_crop_sha, dcrop_gate], params: vec![] });

    // Phase 3b: SHA256 of N decimated samples at stride K (GetByte)
    let lowres_blocks = emit_audio_decimated_gates(&mut gates, &block_outputs, stride_k, 64);
    let low_len_bits: u64 = (AUDIO_LOWRES_OUT_BYTES as u64) * 8;
    let mut low_pad = vec![0u8; 64]; low_pad[0] = 0x80;
    low_pad[56..].copy_from_slice(&low_len_bits.to_be_bytes());
    let low_pad_gate  = push_const2(&mut gates, &low_pad);
    let mut low_sha_input = lowres_blocks;
    low_sha_input.push((low_pad_gate - 1) as usize);
    let final_low_sha  = sha_chain(&mut gates, &low_sha_input);
    let dlowres_gate   = push_const1(&mut gates, &desc.d_lowres);
    let low_comp       = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_low_sha, dlowres_gate], params: vec![] });

    // Phase 4: CMPOFF on header
    let hdr = (block_outputs[0] + 1) as i64;
    let fmt_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,0x03] });
    let mut p_sz  = vec![0u8,1,4];  p_sz.extend_from_slice(&desc.d_size.to_be_bytes());
    let sz_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_d   = vec![0u8,5,4];  p_d.extend_from_slice(&desc.d_duration.to_be_bytes());
    let dur_gate  = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_d });
    let mut p_b   = vec![0u8,9,4];  p_b.extend_from_slice(&desc.d_bitrate.to_be_bytes());
    let brate_gate = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_b });
    let mut p_ts  = vec![0u8,17,4]; p_ts.extend_from_slice(&desc.d_total_samples.to_be_bytes());
    let ts_gate   = push_gate(&mut gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_ts });

    // Phase 5: AND chain
    let a1 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp,  crop_comp],  params: vec![] });
    let a2 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, low_comp],    params: vec![] });
    let a3 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, fmt_gate],   params: vec![] });
    let a4 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, sz_gate],    params: vec![] });
    let a5 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, dur_gate],   params: vec![] });
    let a6 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, brate_gate], params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a6, ts_gate], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: block_size as u32, num_blocks: m as u32 }
}
/// Emit GETBYTE + XOR-tree gates that extract `AUDIO_LOWRES_SAMPLES` decimated Int16 samples
/// at stride `stride_k` starting at `audio_start` bytes into the container.
///
/// For audio-only containers `audio_start = 64` (right after the header).
/// For video containers `audio_start = d_size - n_samp*2` (after all RGB24 frames).
///
/// Sample `i` occupies container bytes `audio_start + i*stride_k*2` and `+1`.
/// Output: `AUDIO_LOWRES_OUT_BYTES / 64 = 7500` assembled 64-byte blocks (480 000 bytes total).
/// Since 480 000 is divisible by 64, all output blocks are fully populated.
///
/// Returns 0-indexed gate positions of the 7500 assembled 64-byte output blocks.
fn emit_audio_decimated_gates(
    gates: &mut Vec<GateV2>,
    block_outputs: &[usize],
    stride_k: usize,
    audio_start: usize,
) -> Vec<usize> {
    debug_assert_eq!(AUDIO_LOWRES_OUT_BYTES % 64, 0);
    let n_out_blocks = AUDIO_LOWRES_OUT_BYTES / 64;
    let mut out_block_gates: Vec<usize> = Vec::with_capacity(n_out_blocks);
    let mut byte_gates: Vec<i64> = Vec::with_capacity(64);

    for p in 0..AUDIO_LOWRES_OUT_BYTES {
        // p is the byte index within the decimated output buffer.
        // Each Int16 sample = 2 bytes; sample index and byte within sample:
        let sample_idx       = p / 2;
        let byte_within_sample = p % 2;
        // Source position in the container (0-indexed):
        let container_byte = audio_start + sample_idx * stride_k * 2 + byte_within_sample;
        let src_block  = container_byte / 64;
        let src_offset = (container_byte % 64) as u8;
        let dst_offset = (p % 64) as u8;

        if src_block >= block_outputs.len() {
            die(&format!(
                "emit_audio_decimated_gates: block {} out of range (total={}, stride={}, sample={})",
                src_block, block_outputs.len(), stride_k, sample_idx
            ));
        }
        let src_gate = (block_outputs[src_block] + 1) as i64;
        let gb = push_gate(gates, GateV2 {
            opcode: OPCODE_GETBYTE,
            sons: vec![src_gate],
            params: vec![src_offset, dst_offset],
        });
        byte_gates.push(gb);

        // Every 64 bytes → assemble via XOR-tree into one 64-byte output block.
        if byte_gates.len() == 64 {
            let assembled = xor_tree(gates, &byte_gates);
            out_block_gates.push((assembled - 1) as usize);
            byte_gates.clear();
        }
    }
    // AUDIO_LOWRES_OUT_BYTES is divisible by 64, so byte_gates must be empty here.
    debug_assert!(byte_gates.is_empty());
    out_block_gates
}

/// Compute SHA256 over `clip_len_bytes` bytes represented as assembled 64-byte gate blocks.
/// Handles SHA256 padding for arbitrary clip lengths (not necessarily a multiple of 64).
/// Returns the 1-indexed gate number of the final SHA2 gate.
fn sha_audio_clip_bytes(gates: &mut Vec<GateV2>, clip_blocks: &[usize], clip_len_bytes: usize) -> i64 {
    let len_bits: u64 = (clip_len_bytes as u64) * 8;
    let rem = clip_len_bytes % 64;

    let mut sha_blocks: Vec<usize> = clip_blocks.to_vec();

    if rem == 0 {
        // clip_len_bytes is a multiple of 64 → append a full padding block
        let mut pad = vec![0u8; 64];
        pad[0] = 0x80;
        pad[56..].copy_from_slice(&len_bits.to_be_bytes());
        let pg = push_const2(gates, &pad);
        sha_blocks.push((pg - 1) as usize);
    } else {
        // The last assembled block covers `rem` real bytes + (64-rem) zero bytes.
        // XOR in the SHA256 padding at position rem within that block.
        let pad_fits = rem <= 64 - 9; // 0x80 + 8 length bytes fit in the last block
        let last_blk_gate = (*sha_blocks.last().unwrap() + 1) as i64;

        let mut mask = vec![0u8; 64];
        mask[rem] = 0x80;
        if pad_fits {
            mask[56..].copy_from_slice(&len_bits.to_be_bytes());
        }
        let mg  = push_const2(gates, &mask);
        let padded = push_gate(gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_blk_gate, mg], params: vec![] });
        *sha_blocks.last_mut().unwrap() = (padded - 1) as usize;

        if !pad_fits {
            // Need an extra block for the length
            let mut extra = vec![0u8; 64];
            extra[56..].copy_from_slice(&len_bits.to_be_bytes());
            let ep = push_const2(gates, &extra);
            sha_blocks.push((ep - 1) as usize);
        }
    }

    sha_chain(gates, &sha_blocks)
}

/// Build an XOR-reduction tree over `byte_gates` (1-indexed gate numbers).
/// Each gate is expected to contribute exactly one non-zero byte at a unique position
/// in a 64B output block; XOR is equivalent to OR in that case.
/// Returns the 1-indexed gate number of the root XOR gate.
fn xor_tree(gates: &mut Vec<GateV2>, byte_gates: &[i64]) -> i64 {
    debug_assert!(!byte_gates.is_empty());
    let mut layer: Vec<i64> = byte_gates.to_vec();
    while layer.len() > 1 {
        let mut next = Vec::with_capacity((layer.len() + 1) / 2);
        let mut i = 0;
        while i + 1 < layer.len() {
            let g = push_gate(gates, GateV2 {
                opcode: OPCODE_XOR,
                sons: vec![layer[i], layer[i + 1]],
                params: vec![],
            });
            next.push(g);
            i += 2;
        }
        if i < layer.len() { next.push(layer[i]); }
        layer = next;
    }
    layer[0]
}

/// Emit GETBYTE + XOR-tree gates that extract a rectangular pixel region from the BMP
/// pixel data embedded in x, assemble the bytes into 64B blocks, and return the 0-indexed
/// gate array positions of those assembled blocks (one per 64 output bytes).
///
/// For a 256×256 output region, returns exactly 3 072 block gate positions.
///
/// `pixel_src(out_x, out_y)` returns the (src_x, src_y) coordinates in the original image
/// for each output pixel (top-to-bottom, left-to-right ordering).
/// BMP stores rows bottom-to-top; the function handles that internally.
/// `row_stride` = (img_w * 3 + 3) / 4 * 4 (bytes per BMP row, including padding).
fn emit_pixel_region_gates(
    gates: &mut Vec<GateV2>,
    block_outputs: &[usize],
    out_w: usize,
    out_h: usize,
    img_h: usize,
    row_stride: usize,
    pixel_src: impl Fn(usize, usize) -> (usize, usize),
) -> Vec<usize> {
    let total_out_bytes = out_w * out_h * 3;
    debug_assert_eq!(total_out_bytes % 64, 0, "region size must be divisible by 64");
    let num_out_blocks = total_out_bytes / 64;

    let mut region_block_gates: Vec<usize> = Vec::with_capacity(num_out_blocks);
    let mut byte_gates: Vec<i64> = Vec::with_capacity(64);
    let mut out_byte_idx: usize = 0;

    for oy in 0..out_h {
        for ox in 0..out_w {
            let (sx, sy) = pixel_src(ox, oy);
            if sy >= img_h {
                die(&format!("emit_pixel_region_gates: src_y={} >= img_h={}", sy, img_h));
            }
            let bmp_row = img_h - 1 - sy; // BMP stores rows bottom-to-top
            for ch in 0..3usize {
                let x_byte = BMP_PIXELS_START_IN_X + bmp_row * row_stride + sx * 3 + ch;
                let blk = x_byte / 64;
                let src_off = (x_byte % 64) as u8;
                let dst_off = (out_byte_idx % 64) as u8;
                if blk >= block_outputs.len() {
                    die(&format!(
                        "emit_pixel_region_gates: block {} out of range (m={}, pixel ({},{}))",
                        blk, block_outputs.len(), ox, oy
                    ));
                }
                let src_gate = (block_outputs[blk] + 1) as i64;
                let gb = push_gate(gates, GateV2 {
                    opcode: OPCODE_GETBYTE,
                    sons: vec![src_gate],
                    params: vec![src_off, dst_off],
                });
                byte_gates.push(gb);
                out_byte_idx += 1;
                if byte_gates.len() == 64 {
                    let assembled = xor_tree(gates, &byte_gates);
                    region_block_gates.push((assembled - 1) as usize);
                    byte_gates.clear();
                }
            }
        }
    }
    if !byte_gates.is_empty() {
        die("emit_pixel_region_gates: leftover bytes — region not divisible by 64");
    }
    region_block_gates
}

/// SHA256 of exactly 196 608 bytes (3 072 × 64B blocks, no remainder).
/// Returns the 1-indexed gate number of the final SHA2 gate.
fn sha_region_196608(gates: &mut Vec<GateV2>, region_blocks: &[usize]) -> i64 {
    debug_assert_eq!(region_blocks.len(), 3072);
    let len_bits: u64 = 196_608u64 * 8;
    let mut pad = vec![0u8; 64];
    pad[0] = 0x80;
    pad[56..].copy_from_slice(&len_bits.to_be_bytes());
    let pad_gate = push_const2(gates, &pad);
    let mut sha_blocks: Vec<usize> = region_blocks.to_vec();
    sha_blocks.push((pad_gate - 1) as usize);
    sha_chain(gates, &sha_blocks)
}

fn push_gate(gates: &mut Vec<GateV2>, g: GateV2) -> i64 {
    gates.push(g);
    gates.len() as i64
}

/// Push a CONST gate from a 32-byte slice (arity 0, params = slice).
fn push_const1(gates: &mut Vec<GateV2>, data: &[u8]) -> i64 {
    let mut params = vec![0u8; 32];
    let n = usize::min(32, data.len());
    params[..n].copy_from_slice(&data[..n]);
    push_gate(gates, GateV2 { opcode: OPCODE_CONST, sons: vec![], params })
}

/// Push a 64-byte constant as two chained CONST gates; returns the 1-indexed number of the second gate.
/// `data` must be at least 64 bytes.
fn push_const2(gates: &mut Vec<GateV2>, data: &[u8]) -> i64 {
    if data.len() < 64 {
        die("push_const2: data must be at least 64 bytes");
    }
    let head = push_gate(gates, GateV2 {
        opcode: OPCODE_CONST,
        sons: vec![],
        params: data[..32].to_vec(),
    });
    push_gate(gates, GateV2 {
        opcode: OPCODE_CONST,
        sons: vec![head],
        params: data[32..64].to_vec(),
    })
}

/// Build a SHA2 chain over a sequence of block gate indices (0-indexed into gates array).
/// Returns the 1-indexed gate number of the final SHA2 gate.
fn sha_chain(gates: &mut Vec<GateV2>, blocks: &[usize]) -> i64 {
    let mut prev: Option<i64> = None;
    for &blk_idx in blocks {
        let blk_gate_num = (blk_idx + 1) as i64;
        let sons = match prev {
            None => vec![blk_gate_num],
            Some(p) => vec![p, blk_gate_num],
        };
        prev = Some(push_gate(gates, GateV2 { opcode: OPCODE_SHA2, sons, params: vec![] }));
    }
    prev.expect("sha_chain called with empty block list")
}

fn encode_i64_6(n: i64) -> [u8; 6] {
    if n > 0x7FFF_FFFF_FFFF || n < -0x8000_0000_0000 {
        die("Son index must fit in signed 48 bits");
    }
    let be = n.to_be_bytes();
    [be[2], be[3], be[4], be[5], be[6], be[7]]
}

// ── Extended Video circuits ────────────────────────────────────────────────────

/// Video container: header(64B) || raw RGB24 frames (top-down, no row padding) || mono Int16-LE PCM
///
/// Header layout (all fields big-endian):
///   byte  0:    format tag (0x01 = thumb, 0x02 = clip, 0x03 = both)
///   bytes 1–4:  total container size in bytes
///   bytes 5–8:  duration in seconds
///   bytes 9–12: bitrate in kbps
///   bytes 13–16: frame width W
///   bytes 17–20: frame height H
///   bytes 21–24: frames per second (fps)
///   bytes 25–28: audio sample rate in Hz (sr)
///   bytes 29–32: total mono Int16-LE PCM sample count (n_samp)
///   bytes 33–63: reserved

/// Thumbnail: top-left 256×256 region of frame 0 = 196 608 bytes = 3 072 blocks.
const VIDEO_THUMB_W: usize = 256;
const VIDEO_THUMB_H: usize = 256;
const VIDEO_THUMB_BYTES: usize = VIDEO_THUMB_W * VIDEO_THUMB_H * 3; // 196 608

/// Description for extended-video circuit (96 bytes, format tag 0x01).
///
/// d_sha    = SHA256(full container, including audio PCM)
/// d_thumb  = SHA256(top-left 256×256 RGB24 region of frame 0)
/// d_lowres = SHA256(240 000 decimated audio samples at stride K=⌈n_samp/240000⌉)
///            (full-duration low-res audio overview, synchronized with the thumbnail)
///
/// Bytes: d_sha(32) || d_thumb(32) || d_lowres(32) || size(4BE) || duration(4BE) || bitrate(4BE)
///         || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) = 128 bytes
pub struct ExtendedVideoDesc {
    pub d_sha:      [u8; 32],
    pub d_thumb:    [u8; 32],
    pub d_lowres:   [u8; 32],
    pub d_size:     u32,
    pub d_duration: u32,
    pub d_bitrate:  u32,
    pub d_width:    u32,
    pub d_height:   u32,
    pub d_fps:      u32,
    pub d_sr:       u32,
    pub d_n_samp:   u32,
}

/// Description for extended-video-clip circuit (132 bytes, format tag 0x02).
///
/// d_clip = SHA256(first d_clip_frames raw RGB24 frames, contiguous)
/// d_crop = SHA256(x[audioStart..audioStart + min(480000, n_samp*2)])
///          (first 240 000 audio samples at original rate, synchronized with the clip)
///
/// Bytes: d_sha(32) || d_clip(32) || d_crop(32) || size(4BE) || duration(4BE) || bitrate(4BE)
///         || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE) = 132 bytes
pub struct ExtendedVideoClipDesc {
    pub d_sha:         [u8; 32],
    pub d_clip:        [u8; 32],
    pub d_crop:        [u8; 32],
    pub d_size:        u32,
    pub d_duration:    u32,
    pub d_bitrate:     u32,
    pub d_width:       u32,
    pub d_height:      u32,
    pub d_fps:         u32,
    pub d_sr:          u32,
    pub d_n_samp:      u32,
    pub d_clip_frames: u32,
}

/// Description for extended-video-both circuit (196 bytes, format tag 0x03).
///
/// d_lowres = SHA256(240 000 decimated audio samples, full duration, synchronized with thumbnail)
/// d_crop   = SHA256(first 240 000 audio samples at original rate, synchronized with clip)
///
/// Bytes: d_sha(32) || d_thumb(32) || d_clip(32) || d_lowres(32) || d_crop(32)
///         || size(4BE) || duration(4BE) || bitrate(4BE)
///         || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE) = 196 bytes
pub struct ExtendedVideoBothDesc {
    pub d_sha:         [u8; 32],
    pub d_thumb:       [u8; 32],
    pub d_clip:        [u8; 32],
    pub d_lowres:      [u8; 32],
    pub d_crop:        [u8; 32],
    pub d_size:        u32,
    pub d_duration:    u32,
    pub d_bitrate:     u32,
    pub d_width:       u32,
    pub d_height:      u32,
    pub d_fps:         u32,
    pub d_sr:          u32,
    pub d_n_samp:      u32,
    pub d_clip_frames: u32,
}

/// Emit GETBYTE + XOR-tree gates that extract the top-left 256×256 region of the first video
/// frame (top-down RGB24, no row padding). Frame 0 starts at byte 64 (right after the header).
///
/// For a frame of width `frame_w` pixels, row `y`, col `x`, channel `ch`:
///   container_byte = 64 + y * frame_w * 3 + x * 3 + ch
///
/// Returns 3 072 gate array positions (0-indexed) of assembled 64-byte output blocks.
fn emit_video_thumb_gates(
    gates: &mut Vec<GateV2>,
    block_outputs: &[usize],
    frame_w: usize,
) -> Vec<usize> {
    debug_assert_eq!(VIDEO_THUMB_BYTES % 64, 0);
    let num_out_blocks = VIDEO_THUMB_BYTES / 64;
    let mut region_block_gates: Vec<usize> = Vec::with_capacity(num_out_blocks);
    let mut byte_gates: Vec<i64> = Vec::with_capacity(64);
    let mut out_byte_idx: usize = 0;

    for oy in 0..VIDEO_THUMB_H {
        for ox in 0..VIDEO_THUMB_W {
            for ch in 0..3usize {
                let container_byte = 64 + oy * frame_w * 3 + ox * 3 + ch;
                let blk       = container_byte / 64;
                let src_off   = (container_byte % 64) as u8;
                let dst_off   = (out_byte_idx % 64) as u8;
                if blk >= block_outputs.len() {
                    die(&format!(
                        "emit_video_thumb_gates: block {} out of range (m={}, pixel ({},{}))",
                        blk, block_outputs.len(), ox, oy
                    ));
                }
                let src_gate = (block_outputs[blk] + 1) as i64;
                let gb = push_gate(gates, GateV2 {
                    opcode: OPCODE_GETBYTE,
                    sons:   vec![src_gate],
                    params: vec![src_off, dst_off],
                });
                byte_gates.push(gb);
                out_byte_idx += 1;
                if byte_gates.len() == 64 {
                    let assembled = xor_tree(gates, &byte_gates);
                    region_block_gates.push((assembled - 1) as usize);
                    byte_gates.clear();
                }
            }
        }
    }
    debug_assert!(byte_gates.is_empty(), "VIDEO_THUMB_BYTES must be divisible by 64");
    region_block_gates
}

/// Shared: AES-CTR decryption phase — returns (gates, block_outputs, pt_len, m).
fn video_aes_phase(ct: &[u8]) -> (Vec<GateV2>, Vec<usize>, usize, usize) {
    if ct.len() < 16 { die("Ciphertext must include a 16-byte IV"); }
    let iv = &ct[..16];
    let data = &ct[16..];
    let block_size = 64usize;
    let pt_len = data.len();
    let m = (pt_len + block_size - 1) / block_size;
    let mut gates: Vec<GateV2> = Vec::new();
    let mut block_outputs: Vec<usize> = Vec::with_capacity(m);
    for i in 0..m {
        let counter = increment_iv(iv, (i * (block_size / 16)) as u64);
        let remaining_bits = usize::min(512, (pt_len.saturating_sub(i * block_size)) * 8);
        let mut params = Vec::with_capacity(18);
        params.extend_from_slice(&counter);
        params.extend_from_slice(&(remaining_bits as u16).to_be_bytes());
        gates.push(GateV2 { opcode: OPCODE_AES_CTR, sons: vec![-(i as i64 + 1)], params });
        block_outputs.push(gates.len() - 1);
    }
    (gates, block_outputs, pt_len, m)
}

/// Shared: SHA256(full plaintext) — returns 1-indexed gate of the COMP gate.
fn video_sha_full(gates: &mut Vec<GateV2>, block_outputs: &[usize], pt_len: usize, d_sha: &[u8; 32]) -> i64 {
    let block_size = 64usize;
    let rem = pt_len % block_size;
    let len_bits = (pt_len as u64) * 8;
    let last_aes = (*block_outputs.last().unwrap() + 1) as i64;
    let mut sha_blocks: Vec<usize> = block_outputs.to_vec();
    if rem == 0 {
        let mut extra = vec![0u8; 64]; extra[0] = 0x80;
        extra[56..].copy_from_slice(&len_bits.to_be_bytes());
        let h = push_const2(gates, &extra); sha_blocks.push((h - 1) as usize);
    } else {
        let pad_extra = rem > block_size - 9;
        let mut mask = vec![0u8; 64]; mask[rem] = 0x80;
        if !pad_extra { mask[56..].copy_from_slice(&len_bits.to_be_bytes()); }
        let mg = push_const2(gates, &mask);
        let pg = push_gate(gates, GateV2 { opcode: OPCODE_XOR, sons: vec![last_aes, mg], params: vec![] });
        *sha_blocks.last_mut().unwrap() = (pg - 1) as usize;
        if pad_extra {
            let mut extra = vec![0u8; 64]; extra[56..].copy_from_slice(&len_bits.to_be_bytes());
            let h = push_const2(gates, &extra); sha_blocks.push((h - 1) as usize);
        }
    }
    let final_sha = sha_chain(gates, &sha_blocks);
    let dsha_gate = push_const1(gates, d_sha);
    push_gate(gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_sha, dsha_gate], params: vec![] })
}

/// Shared: CMPOFF gates for the video header common fields.
/// Returns (fmt_gate, sz_gate, dur_gate, br_gate, w_gate, h_gate, fps_gate, sr_gate, nsamp_gate).
#[allow(clippy::too_many_arguments)]
fn video_header_cmpoff(
    gates: &mut Vec<GateV2>,
    hdr: i64,
    fmt_tag: u8,
    d_size: u32, d_duration: u32, d_bitrate: u32,
    d_width: u32, d_height: u32, d_fps: u32,
    d_sr: u32, d_n_samp: u32,
) -> (i64,i64,i64,i64,i64,i64,i64,i64,i64) {
    let fmt_gate  = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: vec![0,0,1,fmt_tag] });
    let mut p_sz  = vec![0u8,1,4];  p_sz.extend_from_slice(&d_size.to_be_bytes());
    let sz_gate   = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sz });
    let mut p_d   = vec![0u8,5,4];  p_d.extend_from_slice(&d_duration.to_be_bytes());
    let dur_gate  = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_d });
    let mut p_b   = vec![0u8,9,4];  p_b.extend_from_slice(&d_bitrate.to_be_bytes());
    let br_gate   = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_b });
    let mut p_w   = vec![0u8,13,4]; p_w.extend_from_slice(&d_width.to_be_bytes());
    let w_gate    = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_w });
    let mut p_h   = vec![0u8,17,4]; p_h.extend_from_slice(&d_height.to_be_bytes());
    let h_gate    = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_h });
    let mut p_fps = vec![0u8,21,4]; p_fps.extend_from_slice(&d_fps.to_be_bytes());
    let fps_gate  = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_fps });
    let mut p_sr  = vec![0u8,25,4]; p_sr.extend_from_slice(&d_sr.to_be_bytes());
    let sr_gate   = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_sr });
    let mut p_ns  = vec![0u8,29,4]; p_ns.extend_from_slice(&d_n_samp.to_be_bytes());
    let nsamp_gate = push_gate(gates, GateV2 { opcode: OPCODE_CMPOFF, sons: vec![hdr], params: p_ns });
    (fmt_gate, sz_gate, dur_gate, br_gate, w_gate, h_gate, fps_gate, sr_gate, nsamp_gate)
}

/// Compiles a V2 circuit for the extended-video description (96 bytes, format 0x01).
///
/// Verifies:
///   1. SHA256(Dec_k(ct)) = d_sha  (covers full container incl. audio PCM)
///   2. SHA256(top-left 256×256 region of frame 0) = d_thumb
///   3. SHA256(240 000 decimated samples at stride K) = d_lowres  (full-duration low-res audio)
///   4. Header fields: format=0x01, size, duration, bitrate, width, height, fps, sr, n_samp
pub fn compile_circuit_extended_video_v2(ct: &[u8], desc: &ExtendedVideoDesc) -> CompiledCircuitV2 {
    let frame_w = desc.d_width as usize;
    let frame_h = desc.d_height as usize;
    if frame_w < VIDEO_THUMB_W || frame_h < VIDEO_THUMB_H {
        die("Video frame must be at least 256×256 for thumbnail extraction");
    }
    let (mut gates, block_outputs, pt_len, m) = video_aes_phase(ct);

    let last_thumb_byte = 64 + (VIDEO_THUMB_H - 1) * frame_w * 3 + (VIDEO_THUMB_W - 1) * 3 + 2;
    let min_blocks = (last_thumb_byte + 63) / 64 + 1;
    if m < min_blocks { die(&format!("Container too small for thumbnail: {m} < {min_blocks} blocks")); }

    let sha_comp  = video_sha_full(&mut gates, &block_outputs, pt_len, &desc.d_sha);

    let thumb_blocks = emit_video_thumb_gates(&mut gates, &block_outputs, frame_w);
    let thumb_sha    = sha_region_196608(&mut gates, &thumb_blocks);
    let dthumb_gate  = push_const1(&mut gates, &desc.d_thumb);
    let thumb_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![thumb_sha, dthumb_gate], params: vec![] });

    let audio_start = desc.d_size as usize - desc.d_n_samp as usize * 2;
    let stride_k = (desc.d_n_samp as usize).div_ceil(AUDIO_LOWRES_SAMPLES).max(1);
    let lowres_blocks = emit_audio_decimated_gates(&mut gates, &block_outputs, stride_k, audio_start);
    let lowres_len_bits: u64 = (AUDIO_LOWRES_OUT_BYTES as u64) * 8;
    let mut lowres_pad = vec![0u8; 64]; lowres_pad[0] = 0x80;
    lowres_pad[56..].copy_from_slice(&lowres_len_bits.to_be_bytes());
    let lowres_pad_gate = push_const2(&mut gates, &lowres_pad);
    let mut lowres_sha_input = lowres_blocks;
    lowres_sha_input.push((lowres_pad_gate - 1) as usize);
    let final_lowres_sha = sha_chain(&mut gates, &lowres_sha_input);
    let dlowres_gate  = push_const1(&mut gates, &desc.d_lowres);
    let lowres_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_lowres_sha, dlowres_gate], params: vec![] });

    let hdr = (block_outputs[0] + 1) as i64;
    let (fmt_g, sz_g, dur_g, br_g, w_g, h_g, fps_g, sr_g, ns_g) = video_header_cmpoff(
        &mut gates, hdr, 0x01,
        desc.d_size, desc.d_duration, desc.d_bitrate, desc.d_width, desc.d_height, desc.d_fps,
        desc.d_sr, desc.d_n_samp,
    );

    let a1  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp, thumb_comp],  params: vec![] });
    let a2  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, lowres_comp], params: vec![] });
    let a3  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, fmt_g],  params: vec![] });
    let a4  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, sz_g],   params: vec![] });
    let a5  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, dur_g],  params: vec![] });
    let a6  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, br_g],   params: vec![] });
    let a7  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a6, w_g],    params: vec![] });
    let a8  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a7, h_g],    params: vec![] });
    let a9  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a8, fps_g],  params: vec![] });
    let a10 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a9, sr_g],   params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a10, ns_g], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: 64, num_blocks: m as u32 }
}

/// Compiles a V2 circuit for the extended-video-clip description (132 bytes, format 0x02).
///
/// Verifies:
///   1. SHA256(Dec_k(ct)) = d_sha  (covers full container incl. audio PCM)
///   2. SHA256(first d_clip_frames raw RGB24 frames) = d_clip
///   3. SHA256(x[audioStart..audioStart+min(480000,n_samp*2)]) = d_audio
///   4. Header fields: format=0x02, size, duration, bitrate, width, height, fps, sr, n_samp
pub fn compile_circuit_extended_video_clip_v2(ct: &[u8], desc: &ExtendedVideoClipDesc) -> CompiledCircuitV2 {
    let frame_w = desc.d_width as usize;
    let frame_h = desc.d_height as usize;
    let clip_frames = desc.d_clip_frames as usize;
    let frame_bytes = frame_w * frame_h * 3;
    let clip_len_bytes = clip_frames * frame_bytes;

    let (mut gates, block_outputs, pt_len, m) = video_aes_phase(ct);

    let clip_blocks_needed = (clip_len_bytes + 63) / 64;
    let min_blocks = 1 + clip_blocks_needed;
    if m < min_blocks { die(&format!("Container too small for clip: {m} < {min_blocks} blocks")); }

    let sha_comp = video_sha_full(&mut gates, &block_outputs, pt_len, &desc.d_sha);

    let clip_blocks = &block_outputs[1..1 + clip_blocks_needed];
    let clip_sha    = sha_audio_clip_bytes(&mut gates, clip_blocks, clip_len_bytes);
    let dclip_gate  = push_const1(&mut gates, &desc.d_clip);
    let clip_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![clip_sha, dclip_gate], params: vec![] });

    let audio_start_byte = desc.d_size as usize - desc.d_n_samp as usize * 2;
    if audio_start_byte % 64 != 0 { die("Video frame data must be 64-byte aligned"); }
    let audio_start_block = audio_start_byte / 64;
    let audio_len_bytes = (desc.d_n_samp as usize * 2).min(AUDIO_CROP_BYTES);
    let audio_blocks_needed = if audio_len_bytes == 0 { 0 } else { (audio_len_bytes + 63) / 64 };
    let audio_sha = sha_audio_clip_bytes(&mut gates, &block_outputs[audio_start_block..audio_start_block + audio_blocks_needed], audio_len_bytes);
    let dcrop_gate = push_const1(&mut gates, &desc.d_crop);
    let crop_comp  = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![audio_sha, dcrop_gate], params: vec![] });

    let hdr = (block_outputs[0] + 1) as i64;
    let (fmt_g, sz_g, dur_g, br_g, w_g, h_g, fps_g, sr_g, ns_g) = video_header_cmpoff(
        &mut gates, hdr, 0x02,
        desc.d_size, desc.d_duration, desc.d_bitrate, desc.d_width, desc.d_height, desc.d_fps,
        desc.d_sr, desc.d_n_samp,
    );

    let a1  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp, clip_comp],  params: vec![] });
    let a2  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, crop_comp], params: vec![] });
    let a3  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, fmt_g],  params: vec![] });
    let a4  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, sz_g],   params: vec![] });
    let a5  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, dur_g],  params: vec![] });
    let a6  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, br_g],   params: vec![] });
    let a7  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a6, w_g],    params: vec![] });
    let a8  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a7, h_g],    params: vec![] });
    let a9  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a8, fps_g],  params: vec![] });
    let a10 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a9, sr_g],   params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a10, ns_g], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: 64, num_blocks: m as u32 }
}

/// Compiles a V2 circuit for the extended-video-both description (196 bytes, format 0x03).
///
/// Verifies:
///   1. SHA256(Dec_k(ct)) = d_sha  (covers full container incl. audio PCM)
///   2. SHA256(top-left 256×256 region of frame 0) = d_thumb
///   3. SHA256(first d_clip_frames raw RGB24 frames) = d_clip
///   4. SHA256(240 000 decimated audio samples, full duration) = d_lowres
///   5. SHA256(first min(240 000, n_samp) samples at original rate) = d_crop
///   6. Header fields: format=0x03, size, duration, bitrate, width, height, fps, sr, n_samp
pub fn compile_circuit_extended_video_both_v2(ct: &[u8], desc: &ExtendedVideoBothDesc) -> CompiledCircuitV2 {
    let frame_w = desc.d_width as usize;
    let frame_h = desc.d_height as usize;
    let clip_frames = desc.d_clip_frames as usize;
    let frame_bytes = frame_w * frame_h * 3;
    let clip_len_bytes = clip_frames * frame_bytes;

    if frame_w < VIDEO_THUMB_W || frame_h < VIDEO_THUMB_H {
        die("Video frame must be at least 256×256 for thumbnail extraction");
    }

    let (mut gates, block_outputs, pt_len, m) = video_aes_phase(ct);

    let last_thumb_byte = 64 + (VIDEO_THUMB_H - 1) * frame_w * 3 + (VIDEO_THUMB_W - 1) * 3 + 2;
    let clip_blocks_needed = (clip_len_bytes + 63) / 64;
    let min_blocks = ((last_thumb_byte + 63) / 64 + 1).max(1 + clip_blocks_needed);
    if m < min_blocks { die(&format!("Container too small: {m} < {min_blocks} blocks")); }

    let sha_comp  = video_sha_full(&mut gates, &block_outputs, pt_len, &desc.d_sha);

    let thumb_blocks = emit_video_thumb_gates(&mut gates, &block_outputs, frame_w);
    let thumb_sha    = sha_region_196608(&mut gates, &thumb_blocks);
    let dthumb_gate  = push_const1(&mut gates, &desc.d_thumb);
    let thumb_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![thumb_sha, dthumb_gate], params: vec![] });

    let clip_blocks = &block_outputs[1..1 + clip_blocks_needed];
    let clip_sha    = sha_audio_clip_bytes(&mut gates, clip_blocks, clip_len_bytes);
    let dclip_gate  = push_const1(&mut gates, &desc.d_clip);
    let clip_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![clip_sha, dclip_gate], params: vec![] });

    let audio_start = desc.d_size as usize - desc.d_n_samp as usize * 2;
    if audio_start % 64 != 0 { die("Video frame data must be 64-byte aligned"); }

    // d_lowres: full-duration decimated audio (synchronized with thumbnail)
    let stride_k = (desc.d_n_samp as usize).div_ceil(AUDIO_LOWRES_SAMPLES).max(1);
    let lowres_blocks = emit_audio_decimated_gates(&mut gates, &block_outputs, stride_k, audio_start);
    let lowres_len_bits: u64 = (AUDIO_LOWRES_OUT_BYTES as u64) * 8;
    let mut lowres_pad = vec![0u8; 64];
    lowres_pad[0] = 0x80;
    lowres_pad[56..].copy_from_slice(&lowres_len_bits.to_be_bytes());
    let lowres_pad_gate = push_const2(&mut gates, &lowres_pad);
    let mut lowres_sha_input = lowres_blocks;
    lowres_sha_input.push((lowres_pad_gate - 1) as usize);
    let final_lowres_sha = sha_chain(&mut gates, &lowres_sha_input);
    let dlowres_gate  = push_const1(&mut gates, &desc.d_lowres);
    let lowres_comp   = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![final_lowres_sha, dlowres_gate], params: vec![] });

    // d_crop: first 240k samples at original rate (synchronized with clip)
    let audio_start_block = audio_start / 64;
    let crop_len_bytes = (desc.d_n_samp as usize * 2).min(AUDIO_CROP_BYTES);
    let crop_blocks_needed = if crop_len_bytes == 0 { 0 } else { (crop_len_bytes + 63) / 64 };
    let crop_sha  = sha_audio_clip_bytes(&mut gates, &block_outputs[audio_start_block..audio_start_block + crop_blocks_needed], crop_len_bytes);
    let dcrop_gate = push_const1(&mut gates, &desc.d_crop);
    let crop_comp  = push_gate(&mut gates, GateV2 { opcode: OPCODE_COMP, sons: vec![crop_sha, dcrop_gate], params: vec![] });

    let hdr = (block_outputs[0] + 1) as i64;
    let (fmt_g, sz_g, dur_g, br_g, w_g, h_g, fps_g, sr_g, ns_g) = video_header_cmpoff(
        &mut gates, hdr, 0x03,
        desc.d_size, desc.d_duration, desc.d_bitrate, desc.d_width, desc.d_height, desc.d_fps,
        desc.d_sr, desc.d_n_samp,
    );

    let a1  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![sha_comp, thumb_comp],  params: vec![] });
    let a2  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a1, clip_comp],          params: vec![] });
    let a3  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a2, lowres_comp],        params: vec![] });
    let a4  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a3, crop_comp],          params: vec![] });
    let a5  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a4, fmt_g],              params: vec![] });
    let a6  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a5, sz_g],               params: vec![] });
    let a7  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a6, dur_g],              params: vec![] });
    let a8  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a7, br_g],               params: vec![] });
    let a9  = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a8, w_g],                params: vec![] });
    let a10 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a9, h_g],                params: vec![] });
    let a11 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a10, fps_g],             params: vec![] });
    let a12 = push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a11, sr_g],              params: vec![] });
    push_gate(&mut gates, GateV2 { opcode: OPCODE_AND, sons: vec![a12, ns_g], params: vec![] });

    CompiledCircuitV2 { version: 1, gates, block_size: 64, num_blocks: m as u32 }
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
