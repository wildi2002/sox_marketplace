mod accumulator;
mod aes_ctr;
mod circuits;
mod circuits_v2;
mod commitment;
mod encryption;
mod sha256;
mod simple_operations;
mod utils;

use crate::accumulator::{acc, acc_circuit, acc_ct, proof_to_js_array, prove, prove_ext};
use crate::circuits::{
    compile_basic_circuit, evaluate_circuit_internal, get_evaluated_sons, is_constant_idx,
    CompiledCircuit,
};
use crate::circuits_v2::{
    compile_circuit_v2,
    compile_circuit_extended_image_v2, compile_circuit_extended_image_crop_v2, compile_circuit_extended_image_dual_v2,
    compile_circuit_extended_audio_v2, compile_circuit_extended_audio_lowres_v2, compile_circuit_extended_audio_both_v2,
    evaluate_circuit_v2, CompiledCircuitV2, GateV2,
    ExtendedImageDesc, ExtendedImageCropDesc, ExtendedImageDualDesc,
    ExtendedAudioDesc, ExtendedAudioLowresDesc, ExtendedAudioBothDesc,
};
use crate::commitment::{commit_hashes, open_commitment_internal, Commitment};
use crate::encryption::{decrypt, encrypt_and_prepend_iv};
use crate::sha256::sha256;
use crate::utils::{error, hex_to_bytes, split_ct_blocks};
use js_sys::{Array, Number, Uint8Array};
use rmp_serde::{decode::from_read, encode::write};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ####################################
// ###     PRECONTRACT VENDOR       ###
// ####################################

/// Represents a precontract created by the vendor, containing encrypted data and committing
/// information.
#[wasm_bindgen]
pub struct Precontract {
    /// The encrypted data (ciphertext)
    #[wasm_bindgen(getter_with_clone)]
    pub ct: Vec<u8>,

    /// Serialized circuit
    #[wasm_bindgen(getter_with_clone)]
    pub circuit_bytes: Vec<u8>,

    /// Description of the original file
    #[wasm_bindgen(getter_with_clone)]
    pub description: Vec<u8>,

    /// Result of the accumulator applied on the ciphertext
    #[wasm_bindgen(getter_with_clone)]
    pub h_ct: Vec<u8>,

    /// Result of the accumulator applied on the circuit
    #[wasm_bindgen(getter_with_clone)]
    pub h_circuit: Vec<u8>,

    /// Commitment of the ciphertext and circuit
    #[wasm_bindgen(getter_with_clone)]
    pub commitment: Commitment,

    /// Number of blocks in the ciphertext
    pub num_blocks: u32,

    /// Number of gates in the circuit
    pub num_gates: u32,
}

/// Computes precontract values for a file. This includes encryption, circuit compilation,
/// and commitment generation.
///
/// # Arguments
/// * `file` - The file data to be encrypted
/// * `key` - The encryption key
///
/// # Returns
/// A `Precontract` containing all necessary components for the optimistic phase of the protocol
#[wasm_bindgen]
pub fn compute_precontract_values(file: &mut [u8], key: &[u8]) -> Precontract {
    let description = sha256(file);
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_basic_circuit(ct.len() as u32, &description);
    let num_blocks = circuit.num_blocks;
    let num_gates = circuit.circuit.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = acc_circuit(&circuit);
    let commitment = commit_hashes(&h_circuit, &h_ct);

    Precontract {
        ct,
        circuit_bytes,
        description,
        h_ct,
        h_circuit,
        commitment,
        num_blocks,
        num_gates,
    }
}

// ####################################
// ###    BUYER PRECONTRACT CHECK   ###
// ####################################

/// Result of checking a precontract, containing verification status and accumulator values.
#[wasm_bindgen]
pub struct CheckPrecontractResult {
    /// Whether the precontract verification succeeded
    pub success: bool,

    /// Accumulator value of the circuit
    #[wasm_bindgen(getter_with_clone)]
    pub h_circuit: Vec<u8>,

    /// Accumulator value of the ciphertext
    #[wasm_bindgen(getter_with_clone)]
    pub h_ct: Vec<u8>,
}

/// Verifies a precontract by checking the commitment and description with respect to the received
/// ciphertext.
///
/// # Arguments
/// * `description` - Hex-encoded description hash
/// * `commitment` - Hex-encoded commitment
/// * `opening_value` - Hex-encoded opening value
/// * `ct` - Ciphertext bytes
///
/// # Returns
/// A `CheckPrecontractResult` containing the verification status and hash values
#[wasm_bindgen]
pub fn check_precontract(
    description: String,
    commitment: String,
    opening_value: String,
    ct: &[u8],
) -> CheckPrecontractResult {
    let description_bytes = hex_to_bytes(description);
    let circuit = compile_basic_circuit(ct.len() as u32, &description_bytes);
    let h_ct = acc_ct(ct, circuit.block_size as usize);
    let h_circuit = acc_circuit(&circuit);
    match open_commitment_internal(&hex_to_bytes(commitment), &hex_to_bytes(opening_value)) {
        Ok(opened) => {
            let success =
                opened.len() == 64 && opened[..32].eq(&h_circuit) && opened[32..].eq(&h_ct);
            CheckPrecontractResult {
                success,
                h_circuit,
                h_ct,
            }
        }
        Err(msg) => {
            error(msg);
            CheckPrecontractResult {
                success: false,
                h_circuit,
                h_ct,
            }
        }
    }
}

/// Verifies a V2 precontract by checking the commitment and description with respect to the
/// received ciphertext, using the V2 circuit.
///
/// # Arguments
/// * `description` - Hex-encoded description hash
/// * `commitment` - Hex-encoded commitment
/// * `opening_value` - Hex-encoded opening value
/// * `ct` - Ciphertext bytes
///
/// # Returns
/// A `CheckPrecontractResult` containing the verification status and hash values
#[wasm_bindgen]
pub fn check_precontract_v2(
    description: String,
    commitment: String,
    opening_value: String,
    ct: &[u8],
) -> CheckPrecontractResult {
    let description_bytes = hex_to_bytes(description);
    let circuit = compile_circuit_v2(ct, &description_bytes);
    let h_ct = acc_ct(ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    match open_commitment_internal(&hex_to_bytes(commitment), &hex_to_bytes(opening_value)) {
        Ok(opened) => {
            let success =
                opened.len() == 64 && opened[..32].eq(&h_circuit) && opened[32..].eq(&h_ct);
            CheckPrecontractResult {
                success,
                h_circuit,
                h_ct,
            }
        }
        Err(msg) => {
            error(msg);
            CheckPrecontractResult {
                success: false,
                h_circuit,
                h_ct,
            }
        }
    }
}

/// Native (non-WASM) result type for check_precontract_native
pub struct NativeCheckPrecontractResult {
    pub success: bool,
    pub h_circuit: Vec<u8>,
    pub h_ct: Vec<u8>,
}

/// Native version of check_precontract_v2 for use in CLI binaries.
pub fn check_precontract_native(
    description: &str,
    commitment: &str,
    opening_value: &str,
    ct: &[u8],
) -> NativeCheckPrecontractResult {
    let description_bytes = hex_to_bytes(description.to_string());
    let circuit = compile_circuit_v2(ct, &description_bytes);
    let h_ct = acc_ct(ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    match open_commitment_internal(&hex_to_bytes(commitment.to_string()), &hex_to_bytes(opening_value.to_string())) {
        Ok(opened) => {
            let success =
                opened.len() == 64 && opened[..32].eq(&h_circuit) && opened[32..].eq(&h_ct);
            NativeCheckPrecontractResult { success, h_circuit, h_ct }
        }
        Err(_) => {
            NativeCheckPrecontractResult { success: false, h_circuit, h_ct }
        }
    }
}

// ####################################
// ###   BUYER CHECK PRECONTRACT    ###
// ###   (extended algorithm suites)###
// ####################################

/// Internal helper: given an already-compiled extended V2 circuit, verify the commitment.
fn check_precontract_with_circuit_v2(
    circuit: CompiledCircuitV2,
    commitment: String,
    opening_value: String,
    ct: &[u8],
) -> CheckPrecontractResult {
    let h_ct = acc_ct(ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    match open_commitment_internal(&hex_to_bytes(commitment), &hex_to_bytes(opening_value)) {
        Ok(opened) => {
            let success = opened.len() == 64 && opened[..32].eq(&h_circuit) && opened[32..].eq(&h_ct);
            CheckPrecontractResult { success, h_circuit, h_ct }
        }
        Err(msg) => {
            error(msg);
            CheckPrecontractResult { success: false, h_circuit, h_ct }
        }
    }
}

/// Verifies an extended-image V2 precontract commitment.
/// description (hex) must encode 76 bytes: d_sha(32) || d_thumb(32) || w(4BE) || h(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_image_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 76 { crate::utils::die("Extended-image description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_thumb = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_thumb.copy_from_slice(&description[32..64]);
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let circuit = compile_circuit_extended_image_v2(ct, &ExtendedImageDesc { d_sha, d_thumb, d_width, d_height, d_format: 0, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

/// Verifies an extended-image-crop V2 precontract commitment.
/// description must be 76 bytes: d_sha(32) || d_crop(32) || w(4BE) || h(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_image_crop_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 76 { crate::utils::die("Extended-image-crop description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_crop = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_crop.copy_from_slice(&description[32..64]);
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let circuit = compile_circuit_extended_image_crop_v2(ct, &ExtendedImageCropDesc { d_sha, d_crop, d_width, d_height, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

/// Verifies an extended-image-dual V2 precontract commitment.
/// description must be 108 bytes: d_sha(32) || d_thumb(32) || d_crop(32) || w(4BE) || h(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_image_dual_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 108 { crate::utils::die("Extended-image-dual description must be 108 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_thumb = [0u8; 32]; let mut d_crop = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_thumb.copy_from_slice(&description[32..64]); d_crop.copy_from_slice(&description[64..96]);
    let d_width  = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[104..108].try_into().unwrap());
    let circuit = compile_circuit_extended_image_dual_v2(ct, &ExtendedImageDualDesc { d_sha, d_thumb, d_crop, d_width, d_height, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

/// Verifies an extended-audio V2 precontract commitment.
/// description must be 76 bytes: d_sha(32) || d_preview(32) || duration(4BE) || bitrate(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_audio_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 76 { crate::utils::die("Extended-audio description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_preview = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_preview.copy_from_slice(&description[32..64]);
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let circuit = compile_circuit_extended_audio_v2(ct, &ExtendedAudioDesc { d_sha, d_preview, d_duration, d_bitrate, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

/// Verifies an extended-audio-lowres V2 precontract commitment.
/// description must be 76 bytes: d_sha(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_audio_lowres_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 76 { crate::utils::die("Extended-audio-lowres description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_lowres = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_lowres.copy_from_slice(&description[32..64]);
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let circuit = compile_circuit_extended_audio_lowres_v2(ct, &ExtendedAudioLowresDesc { d_sha, d_lowres, d_duration, d_bitrate, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

/// Verifies an extended-audio-both V2 precontract commitment.
/// description must be 108 bytes: d_sha(32) || d_preview(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE).
#[wasm_bindgen]
pub fn check_precontract_extended_audio_both_v2(description: &[u8], commitment: String, opening_value: String, ct: &[u8]) -> CheckPrecontractResult {
    if description.len() != 108 { crate::utils::die("Extended-audio-both description must be 108 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_preview = [0u8; 32]; let mut d_lowres = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_preview.copy_from_slice(&description[32..64]); d_lowres.copy_from_slice(&description[64..96]);
    let d_duration = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[104..108].try_into().unwrap());
    let circuit = compile_circuit_extended_audio_both_v2(ct, &ExtendedAudioBothDesc { d_sha, d_preview: d_preview, d_lowres: d_lowres, d_duration, d_bitrate, d_size });
    check_precontract_with_circuit_v2(circuit, commitment, opening_value, ct)
}

// ####################################
// ###    BUYER CHECK CT DECRYPTION ###
// ####################################

/// Result of checking ciphertext decryption.
#[wasm_bindgen]
pub struct CheckCtResult {
    /// Whether the decryption verification succeeded
    pub success: bool,

    /// The decrypted file contents
    #[wasm_bindgen(getter_with_clone)]
    pub decrypted_file: Vec<u8>,
}

/// Verifies ciphertext decryption by checking against the description.
///
/// # Arguments
/// * `ct` - Ciphertext bytes to decrypt
/// * `key` - Decryption key
/// * `description` - Expected description hash in hex
///
/// # Returns
/// A `CheckCtResult` containing the verification status and decrypted data
#[wasm_bindgen]
pub fn check_received_ct_key(ct: &mut [u8], key: &[u8], description: String) -> CheckCtResult {
    let decrypted_file = decrypt(ct, key);
    let description_computed = sha256(&decrypted_file);
    let success = hex_to_bytes(description).eq(&description_computed);

    CheckCtResult {
        success,
        decrypted_file,
    }
}

// ####################################
// ###    B/V MAKE ARGUMENT         ###
// ####################################

/// Represents an argument in a dispute between buyer and vendor.
#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct DisputeArgument {
    /// The compiled circuit
    #[wasm_bindgen(getter_with_clone)]
    pub circuit: CompiledCircuit,

    /// The ciphertext
    #[wasm_bindgen(getter_with_clone)]
    pub ct: Vec<u8>,

    /// Opening value for the commitment
    #[wasm_bindgen(getter_with_clone)]
    pub opening_value: Vec<u8>,
}

/// Methods for dispute argument serialization and deserialization
#[wasm_bindgen]
impl DisputeArgument {
    /// Serializes the dispute argument into a byte vector.
    ///
    /// Returns a vector containing the serialized dispute argument data.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        write(&mut buf, self).unwrap();
        buf
    }

    /// Deserializes a dispute argument from bytes.
    ///
    /// # Arguments
    /// * `bytes` - The serialized dispute argument bytes
    ///
    /// # Returns
    /// A new `DisputeArgument` instance
    pub fn from_bytes(bytes: &[u8]) -> DisputeArgument {
        from_read(bytes).unwrap()
    }
}

/// Creates a dispute argument from the given components.
///
/// # Arguments
/// * `ct` - Ciphertext bytes
/// * `description` - Description hash in hex format
/// * `opening_value` - Opening value in hex format
///
/// # Returns
/// Serialized dispute argument bytes
#[wasm_bindgen]
pub fn make_argument(ct: Vec<u8>, description: String, opening_value: String) -> Vec<u8> {
    DisputeArgument {
        circuit: compile_basic_circuit(ct.len() as u32, &hex_to_bytes(description)),
        ct,
        opening_value: hex_to_bytes(opening_value),
    }
    .to_bytes()
}

// ####################################
// ###    SB/SV CHECK ARGUMENT      ###
// ####################################

/// Result of checking a dispute argument.
#[wasm_bindgen]
pub struct ArgumentCheckResult {
    /// Whether the argument is valid
    pub is_valid: bool,

    /// Whether the argument supports the buyer's position
    pub supports_buyer: bool,

    /// Optional error message
    #[wasm_bindgen(getter_with_clone)]
    pub error: Option<String>,
}

/// Verifies a dispute argument.
///
/// # Arguments
/// * `argument_bin` - Serialized dispute argument bytes
/// * `commitment` - Commitment in hex format
/// * `description` - Description hash in hex format
/// * `key` - Encryption key in hex format
///
/// # Returns
/// An `ArgumentCheckResult` containing the verification results
#[wasm_bindgen]
pub fn check_argument(
    argument_bin: &[u8],
    commitment: String,
    description: String,
    key: String,
) -> ArgumentCheckResult {
    let argument = DisputeArgument::from_bytes(argument_bin);
    let block_size = argument.circuit.block_size;
    let h_circuit = acc_circuit(&argument.circuit);
    let h_ct = acc_ct(argument.ct.as_slice(), block_size as usize);

    match open_commitment_internal(&hex_to_bytes(commitment), &argument.opening_value) {
        Ok(opened) => {
            let is_valid =
                opened.len() == 64 && opened[..32].eq(&h_circuit) && opened[32..].eq(&h_ct);
            let pt = decrypt(&argument.ct, &hex_to_bytes(key));
            let description_computed = sha256(&pt);
            let supports_buyer = !hex_to_bytes(description).eq(&description_computed);
            ArgumentCheckResult {
                is_valid,
                supports_buyer,
                error: None,
            }
        }
        Err(msg) => {
            error(msg);
            ArgumentCheckResult {
                is_valid: false,
                supports_buyer: false,
                error: Some(msg.to_string()),
            }
        }
    }
}

// ####################################
// ###    BUYER/VENDOR EVAL         ###
// ####################################

/// Represents an evaluated circuit with its values and constants.
#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct EvaluatedCircuit {
    values: Vec<Vec<u8>>,
    constants: Vec<Vec<u8>>,
}

/// Methods for evaluated circuit data access
#[wasm_bindgen]
impl EvaluatedCircuit {
    /// Serializes the evaluated circuit into bytes.
    ///
    /// Returns a vector containing the serialized circuit data.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        write(&mut buf, self).unwrap();
        buf
    }

    /// Deserializes an evaluated circuit from bytes.
    ///
    /// # Arguments
    /// * `bytes` - The serialized circuit bytes
    ///
    /// # Returns
    /// A new `EvaluatedCircuit` instance
    pub fn from_bytes(bytes: &[u8]) -> EvaluatedCircuit {
        from_read(bytes).unwrap()
    }
}

/// Evaluates a circuit with the given ciphertext, constants, and description.
///
/// # Arguments
/// * `circuit_bytes` - Serialized circuit bytes. If empty, a new basic circuit will be compiled
/// * `ct` - Ciphertext bytes to evaluate
/// * `constants` - Vector of hex-encoded constant values
/// * `description` - Description hash in hex format
///
/// # Returns
/// An `EvaluatedCircuit` containing the evaluation results and circuit constants
///
/// # Details
/// This function either uses an existing circuit (from circuit_bytes) or creates a new basic circuit
/// based on the ciphertext length and description. It then evaluates the circuit with the given
/// ciphertext and constants.
#[wasm_bindgen]
pub fn evaluate_circuit(
    circuit_bytes: &[u8],
    ct: &[u8],
    constants: Vec<String>,
    description: String,
) -> EvaluatedCircuit {
    if circuit_bytes.len() == 0 {
        let circuit = compile_basic_circuit(ct.len() as u32, &hex_to_bytes(description))
            .bind_missing_constants(constants.into_iter().map(hex_to_bytes).collect());
        let ct_blocks = split_ct_blocks(&ct, circuit.block_size as usize);
        EvaluatedCircuit {
            constants: circuit.constants.clone(),
            values: evaluate_circuit_internal(&ct_blocks, circuit),
        }
    } else {
        let circuit = CompiledCircuit::from_bytes(circuit_bytes)
            .bind_missing_constants(constants.into_iter().map(hex_to_bytes).collect());
        let ct_blocks = split_ct_blocks(&ct, circuit.block_size as usize);
        EvaluatedCircuit {
            constants: circuit.constants.clone(),
            values: evaluate_circuit_internal(&ct_blocks, circuit),
        }
    }
}

// ####################################
// ###    BUYER/VENDOR HPRE         ###
// ####################################

/// Computes the answer to send to a smart contract based on the issued challenge.
///
/// # Arguments
/// * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
/// * `num_blocks` - Number of blocks for the ciphertext
/// * `challenge` - Challenge issued by the smart contract
///
/// # Returns
/// The response to the challenge
#[wasm_bindgen]
pub fn hpre(evaluated_circuit_bytes: &[u8], num_blocks: usize, challenge: usize) -> Vec<u8> {
    let evaluated_circuit = EvaluatedCircuit::from_bytes(evaluated_circuit_bytes);
    acc(&evaluated_circuit.values[num_blocks..=challenge])
}

/// Computes the answer to send to a smart contract based on the issued challenge (V2).
///
/// # Arguments
/// * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
/// * `num_blocks` - Number of blocks for the ciphertext
/// * `challenge` - Challenge issued by the smart contract (1-indexed gate index, 1 to numGates+1 inclusive, matching paper notation)
///
/// # Returns
/// The response to the challenge (32-byte accumulator hash)
///
/// # Details
/// This implements hpre(i) from the paper (Section F.2), where i = challenge.
/// According to the paper: hpre(i) = Acc(val(1), ..., val(i))
///
/// For V2, evaluated.values contains [inputs (num_blocks), gate_outputs (num_gates)].
/// This function accumulates only the gate outputs (not inputs), consistent with V1 and compute_proofs_v2.
///
/// Notation: The smart contract now uses 1-indexed notation matching the paper:
/// - Paper: i = 1, 2, ..., n, n+1 (where n = numGates)
/// - Contract: challenge = 1, 2, ..., numGates, numGates+1
/// - Conversion to array index: array_idx = num_blocks + challenge - 1
///
/// Examples:
/// - challenge == 1 → i == 1 (paper) → hpre(1) = Acc(val(1)) = accumulate first gate [num_blocks]
/// - challenge == k → i == k (paper) → hpre(k) = Acc(val(1), ..., val(k)) = accumulate gates [num_blocks..=num_blocks+k-1]
#[wasm_bindgen]
pub fn hpre_v2(evaluated_circuit_bytes: &[u8], num_blocks: usize, challenge: usize) -> Vec<u8> {
    let evaluated = EvaluatedCircuitV2::from_bytes(evaluated_circuit_bytes);
    // Start at num_blocks to exclude inputs, consistent with V1 and compute_proofs_v2
    // Challenge is now 1-indexed from contract (matching paper notation)
    // So we convert: challenge (1-indexed) → array index = num_blocks + challenge - 1
    let start_idx = num_blocks;
    let end_idx = num_blocks + challenge - 1; // Convert 1-indexed challenge to 0-indexed array position
    if end_idx >= evaluated.values.len() {
        // This should not happen, but handle gracefully by accumulating from start to end
        if start_idx >= evaluated.values.len() {
            return vec![];
    }
        return acc(&evaluated.values[start_idx..]);
    }
    acc(&evaluated.values[start_idx..=end_idx])
}

// ####################################
// ###    VENDOR FINAL STEP         ###
// ####################################

/// Components returned from the vendor's final step proof generation. Intended for usage in a
/// JavaScript context
#[wasm_bindgen]
pub struct FinalStepComponents {
    /// Gate information
    #[wasm_bindgen(getter_with_clone)]
    pub gate: Vec<Number>,

    /// Values involved in the proof
    #[wasm_bindgen(getter_with_clone)]
    pub values: Vec<Uint8Array>,

    /// Current accumulator value (w_i)
    #[wasm_bindgen(getter_with_clone)]
    pub curr_acc: Vec<u8>,

    /// First proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof1: Array,

    /// Second proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof2: Array,

    /// Third proof (empty array if no third proof is needed)
    #[wasm_bindgen(getter_with_clone)]
    pub proof3: Array,

    /// Extension proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof_ext: Array,
}

// Splits the sons according to the paper's set L. Constant indices are not kept.
fn split_sons_indices(sons: &[u32], num_blocks: u32) -> (Vec<u32>, Vec<u32>) {
    let mut in_l = Vec::new();
    let mut not_in_l_minus_m = Vec::new();

    for &s in sons {
        if is_constant_idx(s) {
            continue;
        }
        if s < num_blocks {
            // strictly inferior because we start counting from 0
            in_l.push(s)
        } else {
            not_in_l_minus_m.push(s - num_blocks)
        }
    }

    (in_l, not_in_l_minus_m)
}

/// Computes proofs for step 8a.
///
/// # Arguments
/// * `circuit_bytes` - Serialized circuit bytes
/// * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
/// * `ct` - Ciphertext bytes
/// * `challenge` - Challenge point in the circuit
///
/// # Returns
/// A `FinalStepComponents` containing:
/// - Gate information for the challenge point
/// - Evaluated values at the challenge point
/// - Current accumulator value
/// - Multiple proofs (proof1, proof2, proof3, proof_ext)
#[wasm_bindgen]
pub fn compute_proofs(
    circuit_bytes: &[u8],
    evaluated_circuit_bytes: &[u8],
    ct: &[u8],
    challenge: u32,
) -> FinalStepComponents {
    let circuit = CompiledCircuit::from_bytes(circuit_bytes);
    let ct_blocks = split_ct_blocks(ct, circuit.block_size as usize);
    let num_blocks = ct_blocks.len() as u32;
    let evaluated_circuit = EvaluatedCircuit::from_bytes(evaluated_circuit_bytes);
    let gate = circuit.circuit[challenge as usize].clone();
    let (s_in_l, not_in_l_minus_m) = split_sons_indices(&gate.sons, num_blocks);

    let values = get_evaluated_sons(
        &gate,
        &evaluated_circuit.values,
        &evaluated_circuit.constants,
    );
    let curr_acc = acc(&evaluated_circuit.values[(num_blocks as usize)..=(challenge as usize)]);
    let proof1 = prove(&circuit.to_abi_encoded(), &[challenge]);
    let proof2 = prove(&ct_blocks, &s_in_l);
    let proof3 = prove(
        &evaluated_circuit.values[(num_blocks as usize)..(challenge as usize)],
        &not_in_l_minus_m,
    );
    let proof_ext =
        prove_ext(&evaluated_circuit.values[(num_blocks as usize)..=(challenge as usize)]);
    FinalStepComponents {
        gate: gate.flatten().iter().map(|&x| Number::from(x)).collect(),
        values: values
            .iter()
            .map(|&x| Uint8Array::from(x.as_slice()))
            .collect(),
        curr_acc,
        proof1: proof_to_js_array(proof1),
        proof2: proof_to_js_array(proof2),
        proof3: proof_to_js_array(proof3),
        proof_ext: proof_to_js_array(proof_ext),
    }
}

/// Computes proofs for step 8b.
///
/// # Arguments
/// * `circuit_bytes` - Serialized circuit bytes
/// * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
/// * `ct` - Ciphertext bytes
/// * `challenge` - Challenge point in the circuit
///
/// # Returns
/// A `FinalStepComponents` containing:
/// - Gate information for the challenge point
/// - Evaluated values at the challenge point
/// - Current accumulator value
/// - Multiple proofs (proof1, proof2, proof_ext)
/// Note that the returning object will have a proof3 component which is an empty array.
#[wasm_bindgen]
pub fn compute_proofs_left(
    circuit_bytes: &[u8],
    evaluated_circuit_bytes: &[u8],
    ct: &[u8],
    challenge: u32,
) -> FinalStepComponents {
    let circuit = CompiledCircuit::from_bytes(circuit_bytes);
    let ct_blocks = split_ct_blocks(ct, circuit.block_size as usize);
    let num_blocks = ct_blocks.len() as u32;
    let evaluated_circuit = EvaluatedCircuit::from_bytes(evaluated_circuit_bytes);
    let gate = circuit.circuit[challenge as usize].clone();
    let non_constant_sons: Vec<u32> = gate
        .sons
        .iter()
        .copied()
        .filter(|&x| !is_constant_idx(x))
        .collect();

    let values = get_evaluated_sons(
        &gate,
        &evaluated_circuit.values,
        &evaluated_circuit.constants,
    );
    let curr_acc = acc(&evaluated_circuit.values[(num_blocks as usize)..=(challenge as usize)]);
    let proof1 = prove(&circuit.to_abi_encoded(), &[challenge]);
    let proof2 = prove(&ct_blocks, &non_constant_sons);
    let proof_ext = prove_ext(&[evaluated_circuit.values[num_blocks as usize].clone()]);

    FinalStepComponents {
        gate: gate.flatten().iter().map(|&x| Number::from(x)).collect(),
        values: values
            .iter()
            .map(|&x| Uint8Array::from(x.as_slice()))
            .collect(),
        curr_acc,
        proof1: proof_to_js_array(proof1),
        proof2: proof_to_js_array(proof2),
        proof3: Array::new(),
        proof_ext: proof_to_js_array(proof_ext),
    }
}

/// Computes the proof for step 8c.
///
/// # Arguments
/// * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
/// * `num_blocks` - Number of blocks for the ciphertext
/// * `num_gates` - Total number of gates in the circuit
///
/// # Returns
/// A JavaScript `Array` containing the proof
#[wasm_bindgen]
pub fn compute_proof_right(
    evaluated_circuit_bytes: &[u8],
    num_blocks: u32,
    num_gates: u32,
) -> Array {
    let evaluated_circuit = EvaluatedCircuit::from_bytes(evaluated_circuit_bytes);

    proof_to_js_array(prove(
        &evaluated_circuit.values[(num_blocks as usize)..],
        &[num_gates - num_blocks - 1],
    ))
}

// ####################################
// ###    V2 CIRCUIT FUNCTIONS      ###
// ####################################

/// Computes precontract values for V2 circuit. This includes encryption, V2 circuit compilation,
/// and commitment generation.
///
/// # Arguments
/// * `file` - The file data to be encrypted
/// * `key` - The encryption key
///
/// # Returns
/// A `Precontract` containing all necessary components for the optimistic phase of the protocol
#[wasm_bindgen]
pub fn compute_precontract_values_v2(file: &mut [u8], key: &[u8]) -> Precontract {
    let description = sha256(file);
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_v2(&ct, &description);
    let num_blocks = circuit.num_blocks;
    let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);

    Precontract {
        ct,
        circuit_bytes,
        description,
        h_ct,
        h_circuit,
        commitment,
        num_blocks,
        num_gates,
    }
}

/// Computes precontract values for an image using the extended description circuit.
///
/// The ciphertext must wrap a BMP container:
///   bytes   0– 63: header (format 1B | size 4B | width 4B | height 4B | reserved 51B)
///   bytes  64–196671: 256×256 raw-RGB thumbnail
///   bytes 196672+  : BMP pixel data
///
/// # Arguments
/// * `file`       - Plaintext file bytes (in BMP container format)
/// * `key`        - AES-128 encryption key (16 bytes)
/// * `d_sha`      - SHA256(file) — 32 bytes
/// * `d_thumb`    - SHA256(thumbnail bytes 64..196672) — 32 bytes
/// * `d_width`    - Image width in pixels
/// * `d_height`   - Image height in pixels
/// * `d_format`   - Format tag (0 = BMP)
/// * `d_size`     - File size in bytes
///
/// # Returns
/// A `Precontract` with the extended-image circuit committed.
#[wasm_bindgen]
pub fn compute_precontract_extended_image_v2(
    file: &mut [u8],
    key: &[u8],
    d_sha: &[u8],
    d_thumb: &[u8],
    d_width: u32,
    d_height: u32,
    d_format: u8,
    d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32];
    let mut thumb_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]);
    thumb_arr.copy_from_slice(&d_thumb[..32]);

    let desc = ExtendedImageDesc {
        d_sha: sha_arr,
        d_thumb: thumb_arr,
        d_width,
        d_height,
        d_format,
        d_size,
    };

    // description = d_sha(32) || d_thumb(32) || d_width(4 BE) || d_height(4 BE) || d_size(4 BE)
    let mut description = Vec::with_capacity(76);
    description.extend_from_slice(&sha_arr);
    description.extend_from_slice(&thumb_arr);
    description.extend_from_slice(&d_width.to_be_bytes());
    description.extend_from_slice(&d_height.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_image_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks;
    let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);

    Precontract {
        ct,
        circuit_bytes,
        description,
        h_ct,
        h_circuit,
        commitment,
        num_blocks,
        num_gates,
    }
}

/// Compiles an extended-image V2 circuit from a 76-byte serialised description:
///   bytes  0-31: SHA256(x)          (d_sha)
///   bytes 32-63: SHA256(thumbnail)  (d_thumb)
///   bytes 64-67: width  (BE u32)    (d_width)
///   bytes 68-71: height (BE u32)    (d_height)
///   bytes 72-75: size   (BE u32)    (d_size)
#[wasm_bindgen]
pub fn compile_circuit_extended_image_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 76 {
        crate::utils::die("Extended-image description must be exactly 76 bytes");
    }
    let mut d_sha = [0u8; 32];
    let mut d_thumb = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]);
    d_thumb.copy_from_slice(&description[32..64]);
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let desc = ExtendedImageDesc { d_sha, d_thumb, d_width, d_height, d_format: 0, d_size };
    compile_circuit_extended_image_v2(ct, &desc).to_bytes()
}

/// Decrypts a ciphertext and verifies all extended-image description components:
///   SHA256(x), SHA256(thumb), width, height, size — against the 76-byte description tuple.
#[wasm_bindgen]
pub fn check_received_ct_key_extended_image_v2(
    ct: &mut [u8],
    key: &[u8],
    description: &[u8],
) -> CheckCtResult {
    if description.len() != 76 {
        crate::utils::die("Extended-image description must be exactly 76 bytes");
    }
    let decrypted = decrypt(ct, key);

    let d_sha   = &description[0..32];
    let d_thumb = &description[32..64];
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());

    let sha_ok    = sha256(&decrypted).as_slice() == d_sha;
    let thumb_ok  = decrypted.len() >= 196672
        && sha256(&decrypted[64..196672]).as_slice() == d_thumb;
    let width_ok  = decrypted.len() >= 9
        && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_width;
    let height_ok = decrypted.len() >= 13
        && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_height;
    let size_ok   = decrypted.len() >= 5
        && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;

    let success = sha_ok && thumb_ok && width_ok && height_ok && size_ok;
    CheckCtResult { success, decrypted_file: decrypted }
}

// ── Extended Audio WASM bindings ──────────────────────────────────────────────

/// Computes precontract values for an audio file using the extended audio description circuit.
///
/// The plaintext must be a canonical audio container:
///   bytes   0– 63  : header (format=0x01 | size 4B BE | duration_secs 4B BE | bitrate_kbps 4B BE | reserved 51B)
///   bytes  64–480063: 30s × 8kHz mono Int16-LE PCM preview (480 000 bytes)
///   bytes 480064+  : original audio file bytes
///
/// # Arguments
/// * `file`       - Plaintext container bytes
/// * `key`        - AES-128 key (16 bytes)
/// * `d_sha`      - SHA256(file) — 32 bytes
/// * `d_preview`  - SHA256(preview PCM bytes 64..480064) — 32 bytes
/// * `d_duration` - Total duration in seconds
/// * `d_bitrate`  - Encoding bitrate in kbps
/// * `d_size`     - Container size in bytes
#[wasm_bindgen]
pub fn compute_precontract_extended_audio_v2(
    file: &mut [u8],
    key: &[u8],
    d_sha: &[u8],
    d_preview: &[u8],
    d_duration: u32,
    d_bitrate: u32,
    d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32];
    let mut preview_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]);
    preview_arr.copy_from_slice(&d_preview[..32]);
    let desc = ExtendedAudioDesc { d_sha: sha_arr, d_preview: preview_arr, d_duration, d_bitrate, d_size };

    // description = d_sha(32) || d_preview(32) || d_duration(4 BE) || d_bitrate(4 BE) || d_size(4 BE)
    let mut description = Vec::with_capacity(76);
    description.extend_from_slice(&sha_arr);
    description.extend_from_slice(&preview_arr);
    description.extend_from_slice(&d_duration.to_be_bytes());
    description.extend_from_slice(&d_bitrate.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());

    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_audio_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks;
    let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);

    Precontract {
        ct,
        circuit_bytes,
        description,
        h_ct,
        h_circuit,
        commitment,
        num_blocks,
        num_gates,
    }
}

/// Compiles an extended-audio V2 circuit from a 76-byte serialised description.
#[wasm_bindgen]
pub fn compile_circuit_extended_audio_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 76 {
        crate::utils::die("Extended-audio description must be exactly 76 bytes");
    }
    let mut d_sha = [0u8; 32];
    let mut d_preview = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]);
    d_preview.copy_from_slice(&description[32..64]);
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());
    let desc = ExtendedAudioDesc { d_sha, d_preview, d_duration, d_bitrate, d_size };
    compile_circuit_extended_audio_v2(ct, &desc).to_bytes()
}

/// Decrypts a ciphertext and verifies all extended-audio description components.
#[wasm_bindgen]
pub fn check_received_ct_key_extended_audio_v2(
    ct: &mut [u8],
    key: &[u8],
    description: &[u8],
) -> CheckCtResult {
    if description.len() != 76 {
        crate::utils::die("Extended-audio description must be exactly 76 bytes");
    }
    let decrypted = decrypt(ct, key);

    let d_sha      = &description[0..32];
    let d_preview  = &description[32..64];
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());

    const PREVIEW_END: usize = 64 + 480_000; // 480_064
    let sha_ok      = sha256(&decrypted).as_slice() == d_sha;
    let preview_ok  = decrypted.len() >= PREVIEW_END
        && sha256(&decrypted[64..PREVIEW_END]).as_slice() == d_preview;
    let duration_ok = decrypted.len() >= 9
        && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_duration;
    let bitrate_ok  = decrypted.len() >= 13
        && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_bitrate;
    let size_ok     = decrypted.len() >= 5
        && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;

    let success = sha_ok && preview_ok && duration_ok && bitrate_ok && size_ok;
    CheckCtResult { success, decrypted_file: decrypted }
}

// ── Extended Image: Crop ───────────────────────────────────────────────────────

/// Computes precontract for a crop-preview image container (format 0x02).
/// description = d_sha(32) || d_crop(32) || imgW(4BE) || imgH(4BE) || size(4BE) = 76 bytes.
#[wasm_bindgen]
pub fn compute_precontract_extended_image_crop_v2(
    file: &mut [u8], key: &[u8],
    d_sha: &[u8], d_crop: &[u8],
    d_width: u32, d_height: u32, d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32]; let mut crop_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]); crop_arr.copy_from_slice(&d_crop[..32]);
    let desc = ExtendedImageCropDesc { d_sha: sha_arr, d_crop: crop_arr, d_width, d_height, d_size };
    let mut description = Vec::with_capacity(76);
    description.extend_from_slice(&sha_arr); description.extend_from_slice(&crop_arr);
    description.extend_from_slice(&d_width.to_be_bytes()); description.extend_from_slice(&d_height.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_image_crop_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks; let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);
    Precontract { ct, circuit_bytes, description, h_ct, h_circuit, commitment, num_blocks, num_gates }
}

#[wasm_bindgen]
pub fn compile_circuit_extended_image_crop_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 76 { crate::utils::die("Extended-image-crop description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_crop = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_crop.copy_from_slice(&description[32..64]);
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());
    compile_circuit_extended_image_crop_v2(ct, &ExtendedImageCropDesc { d_sha, d_crop, d_width, d_height, d_size }).to_bytes()
}

#[wasm_bindgen]
pub fn check_received_ct_key_extended_image_crop_v2(ct: &mut [u8], key: &[u8], description: &[u8]) -> CheckCtResult {
    if description.len() != 76 { crate::utils::die("Extended-image-crop description must be 76 bytes"); }
    let decrypted = decrypt(ct, key);
    let d_sha = &description[0..32]; let d_crop = &description[32..64];
    let d_width  = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[72..76].try_into().unwrap());
    const CROP_END: usize = 64 + 196_608; // 196_672
    let sha_ok    = sha256(&decrypted).as_slice() == d_sha;
    let crop_ok   = decrypted.len() >= CROP_END && sha256(&decrypted[64..CROP_END]).as_slice() == d_crop;
    let width_ok  = decrypted.len() >= 9  && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_width;
    let height_ok = decrypted.len() >= 13 && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_height;
    let size_ok   = decrypted.len() >= 5  && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;
    CheckCtResult { success: sha_ok && crop_ok && width_ok && height_ok && size_ok, decrypted_file: decrypted }
}

// ── Extended Image: Dual (thumbnail + crop) ───────────────────────────────────

/// Computes precontract for a dual-preview image container (format 0x03).
/// description = d_sha(32) || d_thumb(32) || d_crop(32) || imgW(4BE) || imgH(4BE) || size(4BE) = 108 bytes.
#[wasm_bindgen]
pub fn compute_precontract_extended_image_dual_v2(
    file: &mut [u8], key: &[u8],
    d_sha: &[u8], d_thumb: &[u8], d_crop: &[u8],
    d_width: u32, d_height: u32, d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32]; let mut thumb_arr = [0u8; 32]; let mut crop_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]); thumb_arr.copy_from_slice(&d_thumb[..32]); crop_arr.copy_from_slice(&d_crop[..32]);
    let desc = ExtendedImageDualDesc { d_sha: sha_arr, d_thumb: thumb_arr, d_crop: crop_arr, d_width, d_height, d_size };
    let mut description = Vec::with_capacity(108);
    description.extend_from_slice(&sha_arr); description.extend_from_slice(&thumb_arr); description.extend_from_slice(&crop_arr);
    description.extend_from_slice(&d_width.to_be_bytes()); description.extend_from_slice(&d_height.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_image_dual_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks; let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);
    Precontract { ct, circuit_bytes, description, h_ct, h_circuit, commitment, num_blocks, num_gates }
}

#[wasm_bindgen]
pub fn compile_circuit_extended_image_dual_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 108 { crate::utils::die("Extended-image-dual description must be 108 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_thumb = [0u8; 32]; let mut d_crop = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_thumb.copy_from_slice(&description[32..64]); d_crop.copy_from_slice(&description[64..96]);
    let d_width  = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[104..108].try_into().unwrap());
    compile_circuit_extended_image_dual_v2(ct, &ExtendedImageDualDesc { d_sha, d_thumb, d_crop, d_width, d_height, d_size }).to_bytes()
}

#[wasm_bindgen]
pub fn check_received_ct_key_extended_image_dual_v2(ct: &mut [u8], key: &[u8], description: &[u8]) -> CheckCtResult {
    if description.len() != 108 { crate::utils::die("Extended-image-dual description must be 108 bytes"); }
    let decrypted = decrypt(ct, key);
    let d_sha = &description[0..32]; let d_thumb = &description[32..64]; let d_crop = &description[64..96];
    let d_width  = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_height = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size   = u32::from_be_bytes(description[104..108].try_into().unwrap());
    const THUMB_END: usize = 64 + 196_608;         // 196_672
    const CROP_END:  usize = 64 + 196_608 * 2;     // 393_280
    let sha_ok    = sha256(&decrypted).as_slice() == d_sha;
    let thumb_ok  = decrypted.len() >= THUMB_END && sha256(&decrypted[64..THUMB_END]).as_slice() == d_thumb;
    let crop_ok   = decrypted.len() >= CROP_END  && sha256(&decrypted[THUMB_END..CROP_END]).as_slice() == d_crop;
    let width_ok  = decrypted.len() >= 9  && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_width;
    let height_ok = decrypted.len() >= 13 && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_height;
    let size_ok   = decrypted.len() >= 5  && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;
    CheckCtResult { success: sha_ok && thumb_ok && crop_ok && width_ok && height_ok && size_ok, decrypted_file: decrypted }
}

// ── Extended Audio: Low-res Full ──────────────────────────────────────────────

/// Computes precontract for a low-res-full audio container (format 0x02).
/// description = d_sha(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) = 76 bytes.
#[wasm_bindgen]
pub fn compute_precontract_extended_audio_lowres_v2(
    file: &mut [u8], key: &[u8],
    d_sha: &[u8], d_lowres: &[u8],
    d_duration: u32, d_bitrate: u32, d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32]; let mut lowres_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]); lowres_arr.copy_from_slice(&d_lowres[..32]);
    let desc = ExtendedAudioLowresDesc { d_sha: sha_arr, d_lowres: lowres_arr, d_duration, d_bitrate, d_size };
    let mut description = Vec::with_capacity(76);
    description.extend_from_slice(&sha_arr); description.extend_from_slice(&lowres_arr);
    description.extend_from_slice(&d_duration.to_be_bytes()); description.extend_from_slice(&d_bitrate.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_audio_lowres_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks; let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);
    Precontract { ct, circuit_bytes, description, h_ct, h_circuit, commitment, num_blocks, num_gates }
}

#[wasm_bindgen]
pub fn compile_circuit_extended_audio_lowres_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 76 { crate::utils::die("Extended-audio-lowres description must be 76 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_lowres = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_lowres.copy_from_slice(&description[32..64]);
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());
    compile_circuit_extended_audio_lowres_v2(ct, &ExtendedAudioLowresDesc { d_sha, d_lowres, d_duration, d_bitrate, d_size }).to_bytes()
}

#[wasm_bindgen]
pub fn check_received_ct_key_extended_audio_lowres_v2(ct: &mut [u8], key: &[u8], description: &[u8]) -> CheckCtResult {
    if description.len() != 76 { crate::utils::die("Extended-audio-lowres description must be 76 bytes"); }
    let decrypted = decrypt(ct, key);
    let d_sha = &description[0..32]; let d_lowres = &description[32..64];
    let d_duration = u32::from_be_bytes(description[64..68].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[68..72].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[72..76].try_into().unwrap());
    const LOWRES_END: usize = 64 + 720_000; // 720_064
    let sha_ok      = sha256(&decrypted).as_slice() == d_sha;
    let lowres_ok   = decrypted.len() >= LOWRES_END && sha256(&decrypted[64..LOWRES_END]).as_slice() == d_lowres;
    let duration_ok = decrypted.len() >= 9  && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_duration;
    let bitrate_ok  = decrypted.len() >= 13 && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_bitrate;
    let size_ok     = decrypted.len() >= 5  && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;
    CheckCtResult { success: sha_ok && lowres_ok && duration_ok && bitrate_ok && size_ok, decrypted_file: decrypted }
}

// ── Extended Audio: Both (preview + low-res full) ─────────────────────────────

/// Computes precontract for a both-audio container (format 0x03).
/// description = d_sha(32) || d_preview(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) = 108 bytes.
#[wasm_bindgen]
pub fn compute_precontract_extended_audio_both_v2(
    file: &mut [u8], key: &[u8],
    d_sha: &[u8], d_preview: &[u8], d_lowres: &[u8],
    d_duration: u32, d_bitrate: u32, d_size: u32,
) -> Precontract {
    let mut sha_arr = [0u8; 32]; let mut prev_arr = [0u8; 32]; let mut low_arr = [0u8; 32];
    sha_arr.copy_from_slice(&d_sha[..32]); prev_arr.copy_from_slice(&d_preview[..32]); low_arr.copy_from_slice(&d_lowres[..32]);
    let desc = ExtendedAudioBothDesc { d_sha: sha_arr, d_preview: prev_arr, d_lowres: low_arr, d_duration, d_bitrate, d_size };
    let mut description = Vec::with_capacity(108);
    description.extend_from_slice(&sha_arr); description.extend_from_slice(&prev_arr); description.extend_from_slice(&low_arr);
    description.extend_from_slice(&d_duration.to_be_bytes()); description.extend_from_slice(&d_bitrate.to_be_bytes());
    description.extend_from_slice(&d_size.to_be_bytes());
    let ct = encrypt_and_prepend_iv(file, key);
    let circuit = compile_circuit_extended_audio_both_v2(&ct, &desc);
    let num_blocks = circuit.num_blocks; let num_gates = circuit.gates.len() as u32;
    let circuit_bytes = circuit.to_bytes();
    let h_ct = acc_ct(&ct, circuit.block_size as usize);
    let h_circuit = crate::circuits_v2::acc_circuit_v2(&circuit.gates);
    let commitment = commit_hashes(&h_circuit, &h_ct);
    Precontract { ct, circuit_bytes, description, h_ct, h_circuit, commitment, num_blocks, num_gates }
}

#[wasm_bindgen]
pub fn compile_circuit_extended_audio_both_v2_wasm(ct: &[u8], description: &[u8]) -> Vec<u8> {
    if description.len() != 108 { crate::utils::die("Extended-audio-both description must be 108 bytes"); }
    let mut d_sha = [0u8; 32]; let mut d_prev = [0u8; 32]; let mut d_low = [0u8; 32];
    d_sha.copy_from_slice(&description[0..32]); d_prev.copy_from_slice(&description[32..64]); d_low.copy_from_slice(&description[64..96]);
    let d_duration = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[104..108].try_into().unwrap());
    compile_circuit_extended_audio_both_v2(ct, &ExtendedAudioBothDesc { d_sha, d_preview: d_prev, d_lowres: d_low, d_duration, d_bitrate, d_size }).to_bytes()
}

#[wasm_bindgen]
pub fn check_received_ct_key_extended_audio_both_v2(ct: &mut [u8], key: &[u8], description: &[u8]) -> CheckCtResult {
    if description.len() != 108 { crate::utils::die("Extended-audio-both description must be 108 bytes"); }
    let decrypted = decrypt(ct, key);
    let d_sha = &description[0..32]; let d_preview = &description[32..64]; let d_lowres = &description[64..96];
    let d_duration = u32::from_be_bytes(description[96..100].try_into().unwrap());
    let d_bitrate  = u32::from_be_bytes(description[100..104].try_into().unwrap());
    let d_size     = u32::from_be_bytes(description[104..108].try_into().unwrap());
    const PREV_END:  usize = 64 + 480_000;          // 480_064
    const LOWRES_END: usize = 480_064 + 720_000;    // 1_200_064
    let sha_ok      = sha256(&decrypted).as_slice() == d_sha;
    let preview_ok  = decrypted.len() >= PREV_END   && sha256(&decrypted[64..PREV_END]).as_slice() == d_preview;
    let lowres_ok   = decrypted.len() >= LOWRES_END && sha256(&decrypted[PREV_END..LOWRES_END]).as_slice() == d_lowres;
    let duration_ok = decrypted.len() >= 9  && u32::from_be_bytes(decrypted[5..9].try_into().unwrap()) == d_duration;
    let bitrate_ok  = decrypted.len() >= 13 && u32::from_be_bytes(decrypted[9..13].try_into().unwrap()) == d_bitrate;
    let size_ok     = decrypted.len() >= 5  && u32::from_be_bytes(decrypted[1..5].try_into().unwrap()) == d_size;
    CheckCtResult { success: sha_ok && preview_ok && lowres_ok && duration_ok && bitrate_ok && size_ok, decrypted_file: decrypted }
}

/// Represents an evaluated V2 circuit with its values.
#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct EvaluatedCircuitV2 {
    values: Vec<Vec<u8>>,
}

/// Methods for evaluated V2 circuit data access
#[wasm_bindgen]
impl EvaluatedCircuitV2 {
    /// Serializes the evaluated V2 circuit into bytes.
    ///
    /// Returns a vector containing the serialized circuit data.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        write(&mut buf, self).unwrap();
        buf
    }

    /// Deserializes an evaluated V2 circuit from bytes.
    ///
    /// # Arguments
    /// * `bytes` - The serialized circuit bytes
    ///
    /// # Returns
    /// A new `EvaluatedCircuitV2` instance
    pub fn from_bytes(bytes: &[u8]) -> EvaluatedCircuitV2 {
        from_read(bytes).unwrap()
    }
}

/// Compiles a V2 circuit from ciphertext and description.
///
/// # Arguments
/// * `ct` - Ciphertext bytes (must include 16-byte IV)
/// * `description` - Description hash as hex string
///
/// # Returns
/// Serialized CompiledCircuitV2 bytes
#[wasm_bindgen]
pub fn compile_circuit_v2_wasm(ct: &[u8], description: String) -> Vec<u8> {
    let description_bytes = hex_to_bytes(description);
    let circuit = compile_circuit_v2(ct, &description_bytes);
    circuit.to_bytes()
}

/// Evaluates a V2 circuit with the given ciphertext and key.
///
/// # Arguments
/// * `circuit_bytes` - Serialized V2 circuit bytes
/// * `ct` - Ciphertext bytes to evaluate
/// * `key` - AES key in hex format
///
/// # Returns
/// An `EvaluatedCircuitV2` containing the evaluation results
/// The values array contains: [inputs (num_blocks), gate outputs (num_gates)]
#[wasm_bindgen]
pub fn evaluate_circuit_v2_wasm(
    circuit_bytes: &[u8],
    ct: &[u8],
    key: String,
) -> EvaluatedCircuitV2 {
    let circuit = CompiledCircuitV2::from_bytes(circuit_bytes);
    let key_bytes = hex_to_bytes(key);
    
    // Split ciphertext into blocks (skip IV, 64-byte blocks)
    // This should match how compile_circuit_v2 calculates num_blocks
    let data = &ct[16..]; // Skip IV
    let block_size = 64usize;
    let pt_len = data.len();
    let expected_num_blocks = (pt_len + block_size - 1) / block_size; // This is num_blocks
    
    let mut inputs = Vec::with_capacity(expected_num_blocks);
    let mut start = 16; // Skip IV
    while start < ct.len() {
        let end = usize::min(start + 64, ct.len());
        let mut block = vec![0u8; 64];
        block[..(end - start)].copy_from_slice(&ct[start..end]);
        inputs.push(block);
        start = end;
    }
    
    // Verify that inputs.len() matches circuit.num_blocks
    if inputs.len() != circuit.num_blocks as usize {
        use crate::utils::die;
        die(&format!(
            "inputs.len() ({}) does not match circuit.num_blocks ({}) in evaluate_circuit_v2_wasm. Expected {} blocks from pt_len={}, block_size={}",
            inputs.len(),
            circuit.num_blocks,
            expected_num_blocks,
            pt_len,
            block_size
        ));
    }
    
    // Evaluate circuit - this returns only gate outputs, not inputs
    let gate_values = evaluate_circuit_v2(&circuit.gates, &inputs, &key_bytes);
    
    // Combine inputs and gate outputs: [inputs, gate_outputs]
    // This matches the V1 format where values[0..num_blocks] are inputs
    // and values[num_blocks..] are gate outputs
    let mut all_values = inputs;
    all_values.extend(gate_values);
    
    EvaluatedCircuitV2 { values: all_values }
}

/// Components returned from the vendor's final step proof generation for V2. Intended for usage in a
/// JavaScript context
#[wasm_bindgen]
pub struct FinalStepComponentsV2 {
    /// Gate information (64-byte encoded gate)
    #[wasm_bindgen(getter_with_clone)]
    pub gate_bytes: Vec<u8>,

    /// Values involved in the proof
    #[wasm_bindgen(getter_with_clone)]
    pub values: Vec<Uint8Array>,

    /// Current accumulator value (w_i)
    #[wasm_bindgen(getter_with_clone)]
    pub curr_acc: Vec<u8>,

    /// First proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof1: Array,

    /// Second proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof2: Array,

    /// Third proof (empty array if no third proof is needed)
    #[wasm_bindgen(getter_with_clone)]
    pub proof3: Array,

    /// Extension proof
    #[wasm_bindgen(getter_with_clone)]
    pub proof_ext: Array,
}

/// Helper function to get evaluated sons for a V2 gate
/// Returns direct references (clones) without normalization.
/// Normalization should be done in individual gate evaluators (XOR, AES-CTR) as needed.
fn get_evaluated_sons_v2(
    gate: &GateV2,
    evaluated_values: &[Vec<u8>],
    inputs: &[Vec<u8>],
) -> Vec<Vec<u8>> {
    use crate::utils::die;
    let mut sons = Vec::with_capacity(gate.sons.len());
    
    for &son_idx in &gate.sons {
        if son_idx < 0 {
            // Negative index: dummy gate (input)
            let input_idx = (-son_idx - 1) as usize;
            if input_idx >= inputs.len() {
                die(&format!("Dummy gate index {} out of bounds", son_idx));
            }
            sons.push(inputs[input_idx].clone());
        } else {
            // Positive index: previous gate (1-indexed)
            if son_idx == 0 {
                die("Gate index cannot be 0 (gates are 1-indexed)");
            }
            let array_idx = (son_idx - 1) as usize;
            if array_idx >= evaluated_values.len() {
                die(&format!("Gate index {} out of bounds", son_idx));
            }
            // Return direct clone without normalization
            sons.push(evaluated_values[array_idx].clone());
        }
    }
    
    sons
}

/// Helper function to split sons for V2 gate according to set L
fn split_sons_indices_v2(sons: &[i64], num_blocks: u32) -> (Vec<u32>, Vec<u32>) {
    let mut in_l = Vec::new();
    let mut not_in_l_minus_m = Vec::new();

    for &s in sons {
        if s < 0 {
            // Negative: dummy gate (input block)
            let ct_idx = (-s) as u32;
            if ct_idx >= 1 && ct_idx <= num_blocks {
                in_l.push(ct_idx - 1); // Convert to 0-indexed
            }
        } else if s > 0 {
            // Positive: previous gate
            not_in_l_minus_m.push((s - 1) as u32); // Convert to 0-indexed
        }
    }

    (in_l, not_in_l_minus_m)
}

/// Computes proofs for step 8a (V2) - corresponds to Step 8a in paper (Section F.2).
///
/// # Arguments
/// * `circuit_bytes` - Serialized V2 circuit bytes
/// * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
/// * `ct` - Ciphertext bytes
/// * `challenge` - Challenge point in the circuit (1-indexed gate index, matching paper notation)
///
/// # Returns
/// A `FinalStepComponentsV2` containing:
/// - Gate information (64-byte encoded gate)
/// - Evaluated values at the challenge point
/// - Current accumulator value
/// - Multiple proofs (proof1, proof2, proof3, proof_ext)
///
/// # Paper Correspondence
/// This implements Step 8a from the paper: "Case 1 < i ≤ n following Step 8"
/// - challenge (code) = i (paper), where 1 < i ≤ n in paper notation
/// - So challenge must satisfy: 1 < challenge ≤ numGates
/// - The gate g_i in paper corresponds to circuit.gates[challenge - 1] in code (converting 1-indexed to 0-indexed)
#[wasm_bindgen]
pub fn compute_proofs_v2(
    circuit_bytes: &[u8],
    evaluated_circuit_bytes: &[u8],
    ct: &[u8],
    challenge: u32,
) -> FinalStepComponentsV2 {
    let circuit = CompiledCircuitV2::from_bytes(circuit_bytes);
    let evaluated = EvaluatedCircuitV2::from_bytes(evaluated_circuit_bytes);
    
    // Split ciphertext into blocks
    let mut ct_blocks = Vec::new();
    let mut start = 16; // Skip IV
    while start < ct.len() {
        let end = usize::min(start + 64, ct.len());
        let mut block = vec![0u8; 64];
        block[..(end - start)].copy_from_slice(&ct[start..end]);
        ct_blocks.push(block);
        start = end;
    }
    
    let num_blocks = circuit.num_blocks;
    // Challenge is now 1-indexed from contract (matching paper), so convert to 0-indexed for array access
    let gate_idx = (challenge as usize) - 1;
    let gate = &circuit.gates[gate_idx];
    let (s_in_l, not_in_l_minus_m) = split_sons_indices_v2(&gate.sons, num_blocks);
    
    // Get evaluated sons
    // For V2, evaluated.values contains [inputs (num_blocks), gate_outputs (num_gates)]
    // So gate outputs start at index num_blocks
    let gate_outputs = &evaluated.values[(num_blocks as usize)..];
    let values = get_evaluated_sons_v2(gate, gate_outputs, &ct_blocks);
    
    // Compute accumulator
    // For V2, values start at num_blocks (inputs), then gates are evaluated after
    // Challenge is 1-indexed (matching paper notation), so we need values from num_blocks to num_blocks + challenge - 1 (inclusive)
    let curr_acc = acc(&evaluated.values[(num_blocks as usize)..=((num_blocks as usize + challenge as usize - 1) as usize)]);
    
    // Generate proofs
    // For V2, we need to encode all gates for proof1
    // prove() expects 0-indexed indices, so we pass gate_idx (challenge - 1)
    let encoded_gates: Vec<Vec<u8>> = circuit.gates
        .iter()
        .map(|g| {
            let mut buf = [0u8; 64];
            g.encode_into(&mut buf);
            buf.to_vec()
        })
        .collect();
    let proof1 = prove(&encoded_gates, &[gate_idx as u32]);
    
    // ⚠️ FIX: Le root hCt est calculé AVEC IV (via acc_ct qui utilise split_ct_blocks)
    // Donc proof2 doit être généré AVEC IV pour correspondre au root
    // Les indices dans s_in_l sont pour ct_blocks (sans IV), donc on doit les décaler de +1
    let mut ct_blocks_with_iv = Vec::new();
    ct_blocks_with_iv.push(ct[..16].to_vec()); // IV comme premier bloc
    ct_blocks_with_iv.extend_from_slice(&ct_blocks); // Ajouter les blocs de données
    
    // Décaler les indices de +1 pour correspondre aux nouveaux indices avec IV
    let s_in_l_with_iv: Vec<u32> = s_in_l.iter().map(|&idx| idx + 1).collect();
    let proof2 = prove(&ct_blocks_with_iv, &s_in_l_with_iv);
    
    let proof3 = prove(
        &evaluated.values[(num_blocks as usize)..(num_blocks as usize + challenge as usize - 1) as usize],
        &not_in_l_minus_m,
    );
    // proof_ext must use the same range as curr_acc to prove extension correctly
    // It proves that the last element (gate challenge) is an extension of the previous accumulator
    let proof_ext = prove_ext(&evaluated.values[(num_blocks as usize)..=((num_blocks as usize + challenge as usize - 1) as usize)]);
    
    // Encode gate to 64 bytes
    let mut gate_bytes = [0u8; 64];
    gate.encode_into(&mut gate_bytes);
    
    FinalStepComponentsV2 {
        gate_bytes: gate_bytes.to_vec(),
        values: values
            .iter()
            .map(|x| Uint8Array::from(x.as_slice()))
            .collect(),
        curr_acc,
        proof1: proof_to_js_array(proof1),
        proof2: proof_to_js_array(proof2),
        proof3: proof_to_js_array(proof3),
        proof_ext: proof_to_js_array(proof_ext),
    }
}

/// Computes proofs for step 8b (V2) - corresponds to Step 8b in paper (Section F.2).
///
/// # Arguments
/// * `circuit_bytes` - Serialized V2 circuit bytes
/// * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
/// * `ct` - Ciphertext bytes
/// * `challenge` - Challenge point in the circuit (1-indexed gate index, matching paper notation)
///
/// # Returns
/// A `FinalStepComponentsV2` containing:
/// - Gate information (64-byte encoded gate)
/// - Evaluated values at the challenge point
/// - Current accumulator value
/// - Multiple proofs (proof1, proof2, proof_ext)
/// Note that the returning object will have a proof3 component which is an empty array.
///
/// # Paper Correspondence
/// This implements Step 8b from the paper: "Case i = 1 following Step 8"
/// - challenge (code) = 1 corresponds to i = 1 in paper notation
/// - This case occurs when V said "left" for all challenges (disagreed on every hpre)
/// - There is no w_{i-1} defined in this case (hpre(0) = ∅ by convention in paper)
#[wasm_bindgen]
pub fn compute_proofs_left_v2(
    circuit_bytes: &[u8],
    evaluated_circuit_bytes: &[u8],
    ct: &[u8],
    challenge: u32,
) -> FinalStepComponentsV2 {
    let circuit = CompiledCircuitV2::from_bytes(circuit_bytes);
    let evaluated = EvaluatedCircuitV2::from_bytes(evaluated_circuit_bytes);
    
    // Split ciphertext into blocks (SANS IV, comme compute_proofs_v2)
    // ⚠️ FIX: Aligner avec compute_proofs_v2 qui utilise ct_blocks SANS IV pour proof2
    // Le root hCt est calculé AVEC IV (via acc_ct qui utilise split_ct_blocks),
    // mais les indices dans nonConstantSons (Solidity) sont pour un tableau SANS IV.
    // Donc proof2 doit être généré SANS IV pour correspondre aux indices Solidity.
    let mut ct_blocks = Vec::new();
    let mut start = 16; // Skip IV
    while start < ct.len() {
        let end = usize::min(start + 64, ct.len());
        let mut block = vec![0u8; 64];
        block[..(end - start)].copy_from_slice(&ct[start..end]);
        ct_blocks.push(block);
        start = end;
    }
    
    let num_blocks = circuit.num_blocks;
    // Challenge is now 1-indexed from contract (matching paper), so convert to 0-indexed for array access
    // For Step 8b, challenge = 1 (corresponds to i = 1 in paper, first gate)
    let gate_idx = (challenge as usize) - 1;
    let gate = &circuit.gates[gate_idx];
    
    // Get evaluated sons (utilise ct_blocks SANS IV, comme compute_proofs_v2)
    // For V2, evaluated.values contains [inputs (num_blocks), gate_outputs (num_gates)]
    // So gate outputs start at index num_blocks
    let gate_outputs = &evaluated.values[(num_blocks as usize)..];
    let values = get_evaluated_sons_v2(gate, gate_outputs, &ct_blocks);
    
    // Compute accumulator
    // For V2, values start at num_blocks (inputs), then gates are evaluated after
    // Challenge is 1-indexed (matching paper notation), so we need values from num_blocks to num_blocks + challenge - 1 (inclusive)
    // For challenge = 1 (Step 8b): accumulate only first gate [num_blocks]
    let curr_acc = acc(&evaluated.values[(num_blocks as usize)..=((num_blocks as usize + challenge as usize - 1) as usize)]);
    
    // Generate proofs
    // prove() expects 0-indexed indices, so we pass gate_idx (challenge - 1)
    let encoded_gates: Vec<Vec<u8>> = circuit.gates
        .iter()
        .map(|g| {
            let mut buf = [0u8; 64];
            g.encode_into(&mut buf);
            buf.to_vec()
        })
        .collect();
    let proof1 = prove(&encoded_gates, &[gate_idx as u32]);
    
    // For proof2, we need to convert negative sons to block indices
    // ⚠️ FIX: Utiliser split_sons_indices_v2 comme dans compute_proofs_v2 pour vérifier la validité des indices
    // Le problème était que compute_proofs_left_v2 utilisait (-s - 1) directement sans vérifier
    // si ct_idx >= 1 && ct_idx <= num_blocks, ce qui peut inclure des indices invalides
    // compute_proofs_v2 utilise split_sons_indices_v2 qui filtre les indices invalides
    let (s_in_l, _) = split_sons_indices_v2(&gate.sons, num_blocks);
    
    // ⚠️ FIX CRITIQUE: Le root hCt est calculé AVEC IV (via acc_ct qui utilise split_ct_blocks)
    // Donc proof2 doit être généré AVEC IV pour correspondre au root
    // Les indices dans s_in_l sont pour ct_blocks (sans IV), donc on doit les décaler de +1
    let mut ct_blocks_with_iv = Vec::new();
    ct_blocks_with_iv.push(ct[..16].to_vec()); // IV comme premier bloc
    ct_blocks_with_iv.extend_from_slice(&ct_blocks); // Ajouter les blocs de données
    
    // Décaler les indices de +1 pour correspondre aux nouveaux indices avec IV
    let s_in_l_with_iv: Vec<u32> = s_in_l.iter().map(|&idx| idx + 1).collect();
    let proof2 = prove(&ct_blocks_with_iv, &s_in_l_with_iv);
    
    let proof_ext = prove_ext(&[evaluated.values[num_blocks as usize].clone()]);
    
    // Encode gate to 64 bytes
    let mut gate_bytes = [0u8; 64];
    gate.encode_into(&mut gate_bytes);
    
    FinalStepComponentsV2 {
        gate_bytes: gate_bytes.to_vec(),
        values: values
            .iter()
            .map(|x| Uint8Array::from(x.as_slice()))
            .collect(),
        curr_acc,
        proof1: proof_to_js_array(proof1),
        proof2: proof_to_js_array(proof2),
        proof3: Array::new(),
        proof_ext: proof_to_js_array(proof_ext),
    }
}

/// Computes the proof for step 8c (V2) - corresponds to Step 8c in paper (Section F.2).
///
/// # Arguments
/// * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
/// * `num_blocks` - Number of blocks for the ciphertext
/// * `num_gates` - Total number of gates in the circuit (n in paper notation)
///
/// # Returns
/// A JavaScript `Array` containing the proof
///
/// # Paper Correspondence
/// This implements Step 8c from the paper: "Case i = n + 1 following Step 8"
/// - challenge (code) = numGates corresponds to i = n + 1 in paper notation
/// - This case occurs when V said "right" for all challenges (agreed on every hpre)
/// - The proof verifies that val(n) is correct (the final gate output)
#[wasm_bindgen]
pub fn compute_proof_right_v2(
    evaluated_circuit_bytes: &[u8],
    num_blocks: u32,
    num_gates: u32,
) -> Array {
    use crate::utils::{die, error};

    if num_gates == 0 {
        die("compute_proof_right_v2: num_gates must be > 0");
    }

    let evaluated = EvaluatedCircuitV2::from_bytes(evaluated_circuit_bytes);

    let total_values = evaluated.values.len();

    // gate_outputs = last num_gates values in evaluated.values
    // We derive the actual block offset from total_values rather than trusting the DB num_blocks,
    // since num_blocks in the DB may be stale or zero if not persisted correctly.
    if total_values < num_gates as usize {
        die(&format!(
            "compute_proof_right_v2: evaluated circuit has {} values but num_gates={} — too few",
            total_values,
            num_gates
        ));
    }

    // Compute actual num_blocks from total_values and num_gates
    let actual_num_blocks = total_values - num_gates as usize;

    // Warn if DB num_blocks disagrees (helps with debugging)
    if actual_num_blocks != num_blocks as usize {
        error(&format!(
            "compute_proof_right_v2: DB num_blocks={} but actual={} (total_values={}, num_gates={}); using actual",
            num_blocks, actual_num_blocks, total_values, num_gates
        ));
    }

    let gate_outputs = &evaluated.values[actual_num_blocks..];

    // gate_outputs.len() == num_gates by construction above

    // The last gate is at index num_gates - 1 (0-indexed in gate_outputs array)
    // This must match the index used in submitCommitmentRight: idxArr[0] = numGates - 1
    let last_gate_idx = (num_gates - 1) as u32;

    proof_to_js_array(prove(
        gate_outputs,
        &[last_gate_idx],
    ))
}

// =================================================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::bytes_to_hex;
    use rand::RngCore;

    #[test]
    fn test_basic_circuit() {
        let mut rng = rand::rng();
        for i in 1..(1 << 12) {
            let mut data = vec![0u8; i];
            rng.fill_bytes(&mut data);
            let description = sha256(&data);

            let mut key = vec![0u8; 16];
            rng.fill_bytes(&mut key);

            // encrypt
            let ct = encrypt_and_prepend_iv(&mut data, &key);

            let circuit = compile_basic_circuit(ct.len() as u32, &description);

            let evaluated = evaluate_circuit(
                &circuit.to_bytes(),
                &ct,
                vec![bytes_to_hex(key)],
                bytes_to_hex(description),
            );

            assert_eq!(
                "0x01",
                bytes_to_hex(evaluated.values.last().unwrap().to_vec())
            )
        }
    }
}
