/* tslint:disable */
/* eslint-disable */
export function compile_circuit_extended_video_clip_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
export function check_received_ct_key_extended_video_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Verifies an extended-video-both V2 precontract commitment.
 * description must be 196 bytes:
 *   d_sha(32) || d_thumb(32) || d_clip(32) || d_lowres(32) || d_crop(32) || size(4BE) || duration(4BE) || bitrate(4BE)
 *   || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE)
 */
export function check_precontract_extended_video_both_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Creates a dispute argument from the given components.
 *
 * # Arguments
 * * `ct` - Ciphertext bytes
 * * `description` - Description hash in hex format
 * * `opening_value` - Opening value in hex format
 *
 * # Returns
 * Serialized dispute argument bytes
 */
export function make_argument(ct: Uint8Array, description: string, opening_value: string): Uint8Array;
/**
 * Verifies an extended-audio-lowres V2 precontract commitment.
 * description must be 80 bytes: d_sha(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) || total_samples(4BE).
 */
export function check_precontract_extended_audio_lowres_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Computes precontract values for V2 circuit. This includes encryption, V2 circuit compilation,
 * and commitment generation.
 *
 * # Arguments
 * * `file` - The file data to be encrypted
 * * `key` - The encryption key
 *
 * # Returns
 * A `Precontract` containing all necessary components for the optimistic phase of the protocol
 */
export function compute_precontract_values_v2(file: Uint8Array, key: Uint8Array): Precontract;
export function compile_circuit_extended_image_crop_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Computes precontract for a dual-preview image container (format 0x03).
 * description = d_sha(32) || d_thumb(32) || d_crop(32) || imgW(4BE) || imgH(4BE)
 *             || size(4BE) || crop_x(4BE) || crop_y(4BE) = 116 bytes.
 */
export function compute_precontract_extended_image_dual_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_thumb: Uint8Array, d_crop: Uint8Array, d_width: number, d_height: number, d_size: number, crop_x: number, crop_y: number): Precontract;
/**
 * Verifies an extended-audio-both V2 precontract commitment.
 * description must be 112 bytes: d_sha(32) || d_crop(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) || total_samples(4BE).
 */
export function check_precontract_extended_audio_both_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Verifies ciphertext decryption by checking against the description.
 *
 * # Arguments
 * * `ct` - Ciphertext bytes to decrypt
 * * `key` - Decryption key
 * * `description` - Expected description hash in hex
 *
 * # Returns
 * A `CheckCtResult` containing the verification status and decrypted data
 */
export function check_received_ct_key(ct: Uint8Array, key: Uint8Array, description: string): CheckCtResult;
/**
 * Computes precontract for a low-res-full audio container (format 0x02).
 * description = d_sha(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) || total_samples(4BE) = 80 bytes.
 */
export function compute_precontract_extended_audio_lowres_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_lowres: Uint8Array, d_duration: number, d_bitrate: number, d_size: number, d_total_samples: number): Precontract;
export function check_received_ct_key_extended_video_both_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
export function check_received_ct_key_extended_image_crop_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
export function compile_circuit_extended_audio_lowres_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Computes precontract for a video-thumb container (format 0x01).
 * description = d_sha(32) || d_thumb(32) || d_audio(32) || size(4BE) || duration(4BE) || bitrate(4BE)
 *              || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) = 128 bytes.
 */
export function compute_precontract_extended_video_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_thumb: Uint8Array, d_lowres: Uint8Array, d_size: number, d_duration: number, d_bitrate: number, d_width: number, d_height: number, d_fps: number, d_sr: number, d_n_samp: number): Precontract;
/**
 * Computes proofs for step 8b.
 *
 * # Arguments
 * * `circuit_bytes` - Serialized circuit bytes
 * * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
 * * `ct` - Ciphertext bytes
 * * `challenge` - Challenge point in the circuit
 *
 * # Returns
 * A `FinalStepComponents` containing:
 * - Gate information for the challenge point
 * - Evaluated values at the challenge point
 * - Current accumulator value
 * - Multiple proofs (proof1, proof2, proof_ext)
 * Note that the returning object will have a proof3 component which is an empty array.
 */
export function compute_proofs_left(circuit_bytes: Uint8Array, evaluated_circuit_bytes: Uint8Array, ct: Uint8Array, challenge: number): FinalStepComponents;
/**
 * Compute a V3 precontract for extended_audio.
 *
 * d = SHA256(T ‖ Q ‖ D) where:
 *   T = first 240k samples as Int16-LE (480000B)
 *   Q = 256-segment RMS energy profile (1024B)
 *   D = dur ‖ sr ‖ n_samp (12B)
 */
export function compute_precontract_audio_v3(x_hat: Uint8Array, key: Uint8Array, dur: number, sr: number, n_samp: number): PrecontractV3;
export function compile_circuit_extended_audio_both_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Computes proofs for step 8a.
 *
 * # Arguments
 * * `circuit_bytes` - Serialized circuit bytes
 * * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
 * * `ct` - Ciphertext bytes
 * * `challenge` - Challenge point in the circuit
 *
 * # Returns
 * A `FinalStepComponents` containing:
 * - Gate information for the challenge point
 * - Evaluated values at the challenge point
 * - Current accumulator value
 * - Multiple proofs (proof1, proof2, proof3, proof_ext)
 */
export function compute_proofs(circuit_bytes: Uint8Array, evaluated_circuit_bytes: Uint8Array, ct: Uint8Array, challenge: number): FinalStepComponents;
/**
 * Computes the answer to send to a smart contract based on the issued challenge.
 *
 * # Arguments
 * * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
 * * `num_blocks` - Number of blocks for the ciphertext
 * * `challenge` - Challenge issued by the smart contract
 *
 * # Returns
 * The response to the challenge
 */
export function hpre(evaluated_circuit_bytes: Uint8Array, num_blocks: number, challenge: number): Uint8Array;
/**
 * After receiving the key, verify that the decrypted content matches the committed desc.
 * Returns success=true if SHA256(T(dec) ‖ Q(dec) ‖ D(dec)) = d.
 */
export function check_received_ct_image_dual_v3(ct: Uint8Array, key: Uint8Array, d: Uint8Array, w: number, h: number, cx: number, cy: number): CheckCtResult;
/**
 * Verifies a precontract by checking the commitment and description with respect to the received
 * ciphertext.
 *
 * # Arguments
 * * `description` - Hex-encoded description hash
 * * `commitment` - Hex-encoded commitment
 * * `opening_value` - Hex-encoded opening value
 * * `ct` - Ciphertext bytes
 *
 * # Returns
 * A `CheckPrecontractResult` containing the verification status and hash values
 */
export function check_precontract(description: string, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Computes precontract for a crop-preview image container (format 0x02).
 * description = d_sha(32) || d_crop(32) || imgW(4BE) || imgH(4BE) || size(4BE)
 *             || crop_x(4BE) || crop_y(4BE) = 84 bytes.
 */
export function compute_precontract_extended_image_crop_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_crop: Uint8Array, d_width: number, d_height: number, d_size: number, crop_x: number, crop_y: number): Precontract;
/**
 * Verifies an extended-image V2 precontract commitment.
 * description (hex) must encode 76 bytes: d_sha(32) || d_thumb(32) || w(4BE) || h(4BE) || size(4BE).
 */
export function check_precontract_extended_image_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
export function compile_circuit_extended_video_both_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Decrypts a ciphertext and verifies all extended-audio description components.
 */
export function check_received_ct_key_extended_audio_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Compute the 256-segment delta proxy Q for an audio SOX container.
 *
 * Returns 1024 bytes: 256 × u32-BE where each u32 = mean(|PCM[i+1] − PCM[i]|).
 * Pass x_hat (uncompressed canonical container) and n_samp (total sample count from header).
 * Matches compute_delta_quality in desc.rs exactly.
 */
export function compute_audio_delta_quality(x_hat: Uint8Array, n_samp: number): Uint8Array;
export function check_received_ct_key_extended_audio_lowres_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
export function check_received_ct_key_extended_image_dual_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Evaluates a circuit with the given ciphertext, constants, and description.
 *
 * # Arguments
 * * `circuit_bytes` - Serialized circuit bytes. If empty, a new basic circuit will be compiled
 * * `ct` - Ciphertext bytes to evaluate
 * * `constants` - Vector of hex-encoded constant values
 * * `description` - Description hash in hex format
 *
 * # Returns
 * An `EvaluatedCircuit` containing the evaluation results and circuit constants
 *
 * # Details
 * This function either uses an existing circuit (from circuit_bytes) or creates a new basic circuit
 * based on the ciphertext length and description. It then evaluates the circuit with the given
 * ciphertext and constants.
 */
export function evaluate_circuit(circuit_bytes: Uint8Array, ct: Uint8Array, constants: string[], description: string): EvaluatedCircuit;
/**
 * Compiles an extended-audio V2 circuit from a 76-byte serialised description.
 */
export function compile_circuit_extended_audio_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Verifies an extended-video V2 precontract commitment.
 * description must be 128 bytes:
 *   d_sha(32) || d_thumb(32) || d_lowres(32) || size(4BE) || duration(4BE) || bitrate(4BE) || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE)
 */
export function check_precontract_extended_video_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Computes proofs for step 8b (V2) - corresponds to Step 8b in paper (Section F.2).
 *
 * # Arguments
 * * `circuit_bytes` - Serialized V2 circuit bytes
 * * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
 * * `ct` - Ciphertext bytes
 * * `challenge` - Challenge point in the circuit (1-indexed gate index, matching paper notation)
 *
 * # Returns
 * A `FinalStepComponentsV2` containing:
 * - Gate information (64-byte encoded gate)
 * - Evaluated values at the challenge point
 * - Current accumulator value
 * - Multiple proofs (proof1, proof2, proof_ext)
 * Note that the returning object will have a proof3 component which is an empty array.
 *
 * # Paper Correspondence
 * This implements Step 8b from the paper: "Case i = 1 following Step 8"
 * - challenge (code) = 1 corresponds to i = 1 in paper notation
 * - This case occurs when V said "left" for all challenges (disagreed on every hpre)
 * - There is no w_{i-1} defined in this case (hpre(0) = ∅ by convention in paper)
 */
export function compute_proofs_left_v2(circuit_bytes: Uint8Array, evaluated_circuit_bytes: Uint8Array, ct: Uint8Array, challenge: number): FinalStepComponentsV2;
/**
 * Verifies an extended-video-clip V2 precontract commitment.
 * description must be 132 bytes:
 *   d_sha(32) || d_clip(32) || d_crop(32) || size(4BE) || duration(4BE) || bitrate(4BE) || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE)
 */
export function check_precontract_extended_video_clip_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Evaluates a V2 circuit with the given ciphertext and key.
 *
 * # Arguments
 * * `circuit_bytes` - Serialized V2 circuit bytes
 * * `ct` - Ciphertext bytes to evaluate
 * * `key` - AES key in hex format
 *
 * # Returns
 * An `EvaluatedCircuitV2` containing the evaluation results
 * The values array contains: [inputs (num_blocks), gate outputs (num_gates)]
 */
export function evaluate_circuit_v2_wasm(circuit_bytes: Uint8Array, ct: Uint8Array, key: string): EvaluatedCircuitV2;
/**
 * Compute desc(x̂) for extended_audio (crop: first 240k samples).
 * T=480000B, Q=1024B (RMS profile), D=12B (dur‖sr‖n_samp).
 */
export function compute_desc_audio(x_hat: Uint8Array, dur: number, sr: number, n_samp: number): DescResult;
export function compile_circuit_extended_image_dual_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Compiles an extended-image V2 circuit from a 76-byte serialised description:
 *   bytes  0-31: SHA256(x)          (d_sha)
 *   bytes 32-63: SHA256(thumbnail)  (d_thumb)
 *   bytes 64-67: width  (BE u32)    (d_width)
 *   bytes 68-71: height (BE u32)    (d_height)
 *   bytes 72-75: size   (BE u32)    (d_size)
 */
export function compile_circuit_extended_image_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Computes the answer to send to a smart contract based on the issued challenge (V2).
 *
 * # Arguments
 * * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
 * * `num_blocks` - Number of blocks for the ciphertext
 * * `challenge` - Challenge issued by the smart contract (1-indexed gate index, 1 to numGates+1 inclusive, matching paper notation)
 *
 * # Returns
 * The response to the challenge (32-byte accumulator hash)
 *
 * # Details
 * This implements hpre(i) from the paper (Section F.2), where i = challenge.
 * According to the paper: hpre(i) = Acc(val(1), ..., val(i))
 *
 * For V2, evaluated.values contains [inputs (num_blocks), gate_outputs (num_gates)].
 * This function accumulates only the gate outputs (not inputs), consistent with V1 and compute_proofs_v2.
 *
 * Notation: The smart contract now uses 1-indexed notation matching the paper:
 * - Paper: i = 1, 2, ..., n, n+1 (where n = numGates)
 * - Contract: challenge = 1, 2, ..., numGates, numGates+1
 * - Conversion to array index: array_idx = num_blocks + challenge - 1
 *
 * Examples:
 * - challenge == 1 → i == 1 (paper) → hpre(1) = Acc(val(1)) = accumulate first gate [num_blocks]
 * - challenge == k → i == k (paper) → hpre(k) = Acc(val(1), ..., val(k)) = accumulate gates [num_blocks..=num_blocks+k-1]
 */
export function hpre_v2(evaluated_circuit_bytes: Uint8Array, num_blocks: number, challenge: number): Uint8Array;
/**
 * Verifies a V2 precontract by checking the commitment and description with respect to the
 * received ciphertext, using the V2 circuit.
 *
 * # Arguments
 * * `description` - Hex-encoded description hash
 * * `commitment` - Hex-encoded commitment
 * * `opening_value` - Hex-encoded opening value
 * * `ct` - Ciphertext bytes
 *
 * # Returns
 * A `CheckPrecontractResult` containing the verification status and hash values
 */
export function check_precontract_v2(description: string, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Verify buyer pre-payment check: SHA256(T ‖ Q ‖ D) = d.
 */
export function verify_desc(d: Uint8Array, thumb: Uint8Array, quality: Uint8Array, dim: Uint8Array): boolean;
/**
 * Computes precontract for a video-clip container (format 0x02).
 * description = d_sha(32) || d_clip(32) || d_crop(32) || size(4BE) || duration(4BE) || bitrate(4BE)
 *              || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE) = 132 bytes.
 */
export function compute_precontract_extended_video_clip_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_clip: Uint8Array, d_crop: Uint8Array, d_size: number, d_duration: number, d_bitrate: number, d_width: number, d_height: number, d_fps: number, d_sr: number, d_n_samp: number, d_clip_frames: number): Precontract;
/**
 * Decrypts a ciphertext and verifies all extended-image description components.
 * Computes the NN thumbnail from the BMP pixel data (same algorithm as the circuit)
 * and verifies SHA256(computed_thumb) = d_thumb.
 */
export function check_received_ct_key_extended_image_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Verifies an extended-image-dual V2 precontract commitment.
 * description must be 116 bytes: d_sha(32) || d_thumb(32) || d_crop(32) || w(4BE) || h(4BE) || size(4BE) || crop_x(4BE) || crop_y(4BE).
 */
export function check_precontract_extended_image_dual_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * After receiving the key, verify that the decrypted audio content matches the committed desc.
 */
export function check_received_ct_audio_v3(ct: Uint8Array, key: Uint8Array, d: Uint8Array, dur: number, sr: number, n_samp: number): CheckCtResult;
/**
 * Verifies a dispute argument.
 *
 * # Arguments
 * * `argument_bin` - Serialized dispute argument bytes
 * * `commitment` - Commitment in hex format
 * * `description` - Description hash in hex format
 * * `key` - Encryption key in hex format
 *
 * # Returns
 * An `ArgumentCheckResult` containing the verification results
 */
export function check_argument(argument_bin: Uint8Array, commitment: string, description: string, key: string): ArgumentCheckResult;
/**
 * Computes precontract for a both-audio container (format 0x03).
 * description = d_sha(32) || d_crop(32) || d_lowres(32) || duration(4BE) || bitrate(4BE) || size(4BE) || total_samples(4BE) = 112 bytes.
 */
export function compute_precontract_extended_audio_both_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_crop: Uint8Array, d_lowres: Uint8Array, d_duration: number, d_bitrate: number, d_size: number, d_total_samples: number): Precontract;
/**
 * Verifies an extended-audio V2 precontract commitment.
 * description must be 76 bytes: d_sha(32) || d_crop(32) || duration(4BE) || bitrate(4BE) || size(4BE).
 */
export function check_precontract_extended_audio_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
export function check_received_ct_key_extended_audio_both_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Compute desc(x̂) for extended_image_crop (full-resolution crop only).
 * T=196608B, Q=65536B (ELA-light), D=16B (w‖h‖cx‖cy).
 */
export function compute_desc_image_crop(x_hat: Uint8Array, w: number, h: number, cx: number, cy: number): DescResult;
/**
 * Computes the proof for step 8c (V2) - corresponds to Step 8c in paper (Section F.2).
 *
 * # Arguments
 * * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
 * * `num_blocks` - Number of blocks for the ciphertext
 * * `num_gates` - Total number of gates in the circuit (n in paper notation)
 *
 * # Returns
 * A JavaScript `Array` containing the proof
 *
 * # Paper Correspondence
 * This implements Step 8c from the paper: "Case i = n + 1 following Step 8"
 * - challenge (code) = numGates corresponds to i = n + 1 in paper notation
 * - This case occurs when V said "right" for all challenges (agreed on every hpre)
 * - The proof verifies that val(n) is correct (the final gate output)
 */
export function compute_proof_right_v2(evaluated_circuit_bytes: Uint8Array, num_blocks: number, num_gates: number): Array<any>;
/**
 * Computes the proof for step 8c.
 *
 * # Arguments
 * * `evaluated_circuit_bytes` - Serialized evaluated circuit bytes
 * * `num_blocks` - Number of blocks for the ciphertext
 * * `num_gates` - Total number of gates in the circuit
 *
 * # Returns
 * A JavaScript `Array` containing the proof
 */
export function compute_proof_right(evaluated_circuit_bytes: Uint8Array, num_blocks: number, num_gates: number): Array<any>;
/**
 * Computes precontract values for a file. This includes encryption, circuit compilation,
 * and commitment generation.
 *
 * # Arguments
 * * `file` - The file data to be encrypted
 * * `key` - The encryption key
 *
 * # Returns
 * A `Precontract` containing all necessary components for the optimistic phase of the protocol
 */
export function compute_precontract_values(file: Uint8Array, key: Uint8Array): Precontract;
/**
 * Compute desc(x̂) for extended_image (lowres thumbnail only).
 * T=196608B, Q=65536B (ELA-light), D=8B (w‖h).
 */
export function compute_desc_image_lowres(x_hat: Uint8Array, w: number, h: number): DescResult;
/**
 * Computes precontract values for an audio file using the extended audio description circuit.
 *
 * The plaintext must be a canonical audio container:
 *   bytes   0– 63  : header (format=0x01 | size 4B BE | duration_secs 4B BE | bitrate_kbps 4B BE | reserved 51B)
 *   bytes  64–480063: 30s × 8kHz mono Int16-LE PCM preview (480 000 bytes)
 *   bytes 480064+  : original audio file bytes
 *
 * # Arguments
 * * `file`       - Plaintext container bytes
 * * `key`        - AES-128 key (16 bytes)
 * * `d_sha`      - SHA256(file) — 32 bytes
 * * `d_crop`     - SHA256(x[64..480064]) — first 240 000 Int16 samples — 32 bytes
 * * `d_duration` - Total duration in seconds
 * * `d_bitrate`  - Encoding bitrate in kbps
 * * `d_size`     - Container size in bytes
 */
export function compute_precontract_extended_audio_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_crop: Uint8Array, d_duration: number, d_bitrate: number, d_size: number): Precontract;
/**
 * Compiles a V2 circuit from ciphertext and description.
 *
 * # Arguments
 * * `ct` - Ciphertext bytes (must include 16-byte IV)
 * * `description` - Description hash as hex string
 *
 * # Returns
 * Serialized CompiledCircuitV2 bytes
 */
export function compile_circuit_v2_wasm(ct: Uint8Array, description: string): Uint8Array;
/**
 * Computes precontract for a video-both container (format 0x03).
 * description = d_sha(32) || d_thumb(32) || d_clip(32) || d_lowres(32) || d_crop(32) || size(4BE) || duration(4BE) || bitrate(4BE)
 *              || width(4BE) || height(4BE) || fps(4BE) || sr(4BE) || n_samp(4BE) || clip_frames(4BE) = 196 bytes.
 */
export function compute_precontract_extended_video_both_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_thumb: Uint8Array, d_clip: Uint8Array, d_lowres: Uint8Array, d_crop: Uint8Array, d_size: number, d_duration: number, d_bitrate: number, d_width: number, d_height: number, d_fps: number, d_sr: number, d_n_samp: number, d_clip_frames: number): Precontract;
/**
 * Computes precontract values for an image using the extended description circuit.
 *
 * Container layout (file = x = what the vendor encrypts and sells):
 *   bytes   0– 63: header (format 1B | size 4B | width 4B | height 4B | reserved 51B)
 *   bytes  64+   : standard BMP file (no thumbnail segment embedded)
 *
 * The circuit computes the 256×256 NN thumbnail directly from the BMP pixel data.
 * d_thumb must be SHA256(NN thumbnail computed the same way as the circuit — nearest-neighbour
 * with source pixel (ox*W/256, oy*H/256) and BGR byte order matching BMP storage).
 */
export function compute_precontract_extended_image_v2(file: Uint8Array, key: Uint8Array, d_sha: Uint8Array, d_thumb: Uint8Array, d_width: number, d_height: number, d_format: number, d_size: number): Precontract;
export function check_received_ct_key_extended_video_clip_v2(ct: Uint8Array, key: Uint8Array, description: Uint8Array): CheckCtResult;
/**
 * Compute desc(x̂) for extended_image_dual (lowres + crop).
 * T=393216B (T_lr‖T_cr), Q=65536B (ELA-light of T_lr), D=16B (w‖h‖cx‖cy).
 */
export function compute_desc_image_dual(x_hat: Uint8Array, w: number, h: number, cx: number, cy: number): DescResult;
export function compile_circuit_extended_video_v2_wasm(ct: Uint8Array, description: Uint8Array): Uint8Array;
/**
 * Computes proofs for step 8a (V2) - corresponds to Step 8a in paper (Section F.2).
 *
 * # Arguments
 * * `circuit_bytes` - Serialized V2 circuit bytes
 * * `evaluated_circuit_bytes` - Serialized evaluated V2 circuit bytes
 * * `ct` - Ciphertext bytes
 * * `challenge` - Challenge point in the circuit (1-indexed gate index, matching paper notation)
 *
 * # Returns
 * A `FinalStepComponentsV2` containing:
 * - Gate information (64-byte encoded gate)
 * - Evaluated values at the challenge point
 * - Current accumulator value
 * - Multiple proofs (proof1, proof2, proof3, proof_ext)
 *
 * # Paper Correspondence
 * This implements Step 8a from the paper: "Case 1 < i ≤ n following Step 8"
 * - challenge (code) = i (paper), where 1 < i ≤ n in paper notation
 * - So challenge must satisfy: 1 < challenge ≤ numGates
 * - The gate g_i in paper corresponds to circuit.gates[challenge - 1] in code (converting 1-indexed to 0-indexed)
 */
export function compute_proofs_v2(circuit_bytes: Uint8Array, evaluated_circuit_bytes: Uint8Array, ct: Uint8Array, challenge: number): FinalStepComponentsV2;
/**
 * Verifies an extended-image-crop V2 precontract commitment.
 * description must be 84 bytes: d_sha(32) || d_crop(32) || w(4BE) || h(4BE) || size(4BE) || crop_x(4BE) || crop_y(4BE).
 */
export function check_precontract_extended_image_crop_v2(description: Uint8Array, commitment: string, opening_value: string, ct: Uint8Array): CheckPrecontractResult;
/**
 * Compute a V3 precontract for extended_image_dual.
 *
 * d = SHA256(T_lr ‖ T_cr ‖ Q ‖ D) where:
 *   T_lr = 256×256 lowres thumbnail (196608B)
 *   T_cr = 256×256 crop at (cx,cy)  (196608B)
 *   Q    = ELA-light of T_lr        (65536B)
 *   D    = w ‖ h ‖ cx ‖ cy         (16B)
 *
 * The circuit verifies SHA256(T_lr_computed ‖ T_cr_computed ‖ Q_const ‖ D_const) = d,
 * where T_lr and T_cr are extracted from the decrypted BMP via GETBYTE gates, and
 * Q and D are embedded as CONST gates (committed through h_circuit).
 */
export function compute_precontract_image_dual_v3(x_hat: Uint8Array, key: Uint8Array, w: number, h: number, cx: number, cy: number): PrecontractV3;
export function bytes_to_hex(vec: Uint8Array): string;
export function hex_to_bytes(hex_str: string): Uint8Array;
/**
 * Creates a commitment for the given data by appending random bytes and hashing
 *
 * # Arguments
 * * `data` - Data to commit to
 *
 * # Returns
 * A `Commitment` containing the commitment hash and opening value
 */
export function commit(data: Uint8Array): Commitment;
/**
 * JavaScript-compatible wrapper for sha256_compress
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing the input data
 *
 * # Returns
 * A byte vector containing the compressed result
 */
export function sha256_compress_js(data: Uint8Array[]): Uint8Array;
/**
 * JavaScript-compatible wrapper for sha256_compress_final
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing the input data
 *
 * # Returns
 * A byte vector containing the final hash
 */
export function sha256_compress_final_js(data: Uint8Array[]): Uint8Array;
/**
 * JavaScript wrapper for encrypt_block
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing:
 *   - key (16 bytes)
 *   - blocks to encrypt (<=112 bytes)
 *   - IV/counter starting value (16 bytes)
 *
 * # Returns
 * Encrypted bytes
 */
export function encrypt_block_js(data: Uint8Array[]): Uint8Array;
/**
 * JavaScript wrapper for decrypt_block
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing:
 *   - key (16 bytes)
 *   - blocks to decrypt (<=112 bytes)
 *   - IV/counter starting value (16 bytes)
 *
 * # Returns
 * Decrypted bytes
 */
export function decrypt_block_js(data: Uint8Array[]): Uint8Array;
/**
 * Compiles a basic circuit for processing ciphertext. Once the key is bound, the circuit computes
 * the SHA256 hash of the initial plaintext and compares it to the provided description.
 *
 * # Arguments
 * * `ct_size` - Size of the ciphertext (including IV!)
 * * `description` - Description of the plaintext
 *
 * # Returns
 * A `CompiledCircuit` configured for the given parameters
 */
export function compile_basic_circuit(ct_size: number, description: Uint8Array): CompiledCircuit;
/**
 * JavaScript wrapper of the prove function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays containing all values in the tree
 * * `indices` - Array of indices for values to include in proof
 *
 * # Returns
 * Array of arrays of Uint8Arrays containing the proof layers
 */
export function prove_js(values: Uint8Array[], indices: Array<any>): Array<any>;
/**
 * JavaScript wrapper of the prove_ext function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays containing the sequence of values
 *
 * # Returns
 * Array of Uint8Arrays containing the extension proof components
 */
export function prove_ext_js(values: Uint8Array[]): Array<any>;
/**
 * JavaScript wrapper of the accumulator function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays to accumulate
 *
 * # Returns
 * Accumulated value as bytes
 */
export function acc_js(values: Uint8Array[]): Uint8Array;
/**
 * Result of checking a dispute argument.
 */
export class ArgumentCheckResult {
  private constructor();
  free(): void;
  /**
   * Whether the argument is valid
   */
  is_valid: boolean;
  /**
   * Whether the argument supports the buyer's position
   */
  supports_buyer: boolean;
  /**
   * Optional error message
   */
  get error(): string | undefined;
  /**
   * Optional error message
   */
  set error(value: string | null | undefined);
}
/**
 * Result of checking ciphertext decryption.
 */
export class CheckCtResult {
  private constructor();
  free(): void;
  /**
   * Whether the decryption verification succeeded
   */
  success: boolean;
  /**
   * The decrypted file contents
   */
  decrypted_file: Uint8Array;
}
/**
 * Result of checking a precontract, containing verification status and accumulator values.
 */
export class CheckPrecontractResult {
  private constructor();
  free(): void;
  /**
   * Whether the precontract verification succeeded
   */
  success: boolean;
  /**
   * Accumulator value of the circuit
   */
  h_circuit: Uint8Array;
  /**
   * Accumulator value of the ciphertext
   */
  h_ct: Uint8Array;
}
/**
 * Represents a commitment with its commitment value and opening value
 */
export class Commitment {
  private constructor();
  free(): void;
  /**
   * The commitment value
   */
  c: Uint8Array;
  /**
   * The opening value
   */
  o: Uint8Array;
}
/**
 * Represents a compiled circuit with gates and their associated constants
 */
export class CompiledCircuit {
  private constructor();
  free(): void;
  /**
   * Deserializes a compiled circuit from bytes.
   *
   * # Arguments
   * * `bytes` - The serialized circuit bytes
   *
   * # Returns
   * A new `CompiledCircuit` instance
   */
  static from_bytes(bytes: Uint8Array): CompiledCircuit;
  /**
   * Serializes the compiled circuit into bytes.
   *
   * Returns a vector containing the serialized circuit data.
   */
  to_bytes(): Uint8Array;
  /**
   * Version number of the instruction set
   */
  version: number;
  /**
   * Size of blocks processed by the circuit
   */
  block_size: number;
  /**
   * Number of blocks in the circuit
   */
  num_blocks: number;
}
/**
 * Represents a compiled circuit with all constants bound to specific values
 */
export class CompiledCircuitWithConstants {
  private constructor();
  free(): void;
  /**
   * Version number of instruction set
   */
  version: number;
  /**
   * Size of blocks processed by the circuit
   */
  block_size: number;
}
/**
 * Result of computing desc components without a full precontract.
 */
export class DescResult {
  private constructor();
  free(): void;
  /**
   * d = SHA256(T ‖ Q ‖ D) — 32 bytes.
   */
  d: Uint8Array;
  thumb: Uint8Array;
  quality: Uint8Array;
  dim: Uint8Array;
}
/**
 * Represents an argument in a dispute between buyer and vendor.
 */
export class DisputeArgument {
  private constructor();
  free(): void;
  /**
   * Deserializes a dispute argument from bytes.
   *
   * # Arguments
   * * `bytes` - The serialized dispute argument bytes
   *
   * # Returns
   * A new `DisputeArgument` instance
   */
  static from_bytes(bytes: Uint8Array): DisputeArgument;
  /**
   * Serializes the dispute argument into a byte vector.
   *
   * Returns a vector containing the serialized dispute argument data.
   */
  to_bytes(): Uint8Array;
  /**
   * The compiled circuit
   */
  circuit: CompiledCircuit;
  /**
   * The ciphertext
   */
  ct: Uint8Array;
  /**
   * Opening value for the commitment
   */
  opening_value: Uint8Array;
}
/**
 * Represents an evaluated circuit with its values and constants.
 */
export class EvaluatedCircuit {
  private constructor();
  free(): void;
  /**
   * Deserializes an evaluated circuit from bytes.
   *
   * # Arguments
   * * `bytes` - The serialized circuit bytes
   *
   * # Returns
   * A new `EvaluatedCircuit` instance
   */
  static from_bytes(bytes: Uint8Array): EvaluatedCircuit;
  /**
   * Serializes the evaluated circuit into bytes.
   *
   * Returns a vector containing the serialized circuit data.
   */
  to_bytes(): Uint8Array;
}
/**
 * Represents an evaluated V2 circuit with its values.
 */
export class EvaluatedCircuitV2 {
  private constructor();
  free(): void;
  /**
   * Deserializes an evaluated V2 circuit from bytes.
   *
   * # Arguments
   * * `bytes` - The serialized circuit bytes
   *
   * # Returns
   * A new `EvaluatedCircuitV2` instance
   */
  static from_bytes(bytes: Uint8Array): EvaluatedCircuitV2;
  /**
   * Serializes the evaluated V2 circuit into bytes.
   *
   * Returns a vector containing the serialized circuit data.
   */
  to_bytes(): Uint8Array;
}
/**
 * Components returned from the vendor's final step proof generation. Intended for usage in a
 * JavaScript context
 */
export class FinalStepComponents {
  private constructor();
  free(): void;
  /**
   * Gate information
   */
  gate: number[];
  /**
   * Values involved in the proof
   */
  values: Uint8Array[];
  /**
   * Current accumulator value (w_i)
   */
  curr_acc: Uint8Array;
  /**
   * First proof
   */
  proof1: Array<any>;
  /**
   * Second proof
   */
  proof2: Array<any>;
  /**
   * Third proof (empty array if no third proof is needed)
   */
  proof3: Array<any>;
  /**
   * Extension proof
   */
  proof_ext: Array<any>;
}
/**
 * Components returned from the vendor's final step proof generation for V2. Intended for usage in a
 * JavaScript context
 */
export class FinalStepComponentsV2 {
  private constructor();
  free(): void;
  /**
   * Gate information (64-byte encoded gate)
   */
  gate_bytes: Uint8Array;
  /**
   * Values involved in the proof
   */
  values: Uint8Array[];
  /**
   * Current accumulator value (w_i)
   */
  curr_acc: Uint8Array;
  /**
   * First proof
   */
  proof1: Array<any>;
  /**
   * Second proof
   */
  proof2: Array<any>;
  /**
   * Third proof (empty array if no third proof is needed)
   */
  proof3: Array<any>;
  /**
   * Extension proof
   */
  proof_ext: Array<any>;
}
/**
 * Represents a gate in the circuit with an operation code and connections to other gates
 */
export class Gate {
  private constructor();
  free(): void;
  /**
   * Converts the gate an EVM compatible ABI-encoded bytes format.
   *
   * Returns a vector of bytes representing the ABI encoding of the gate's opcode and sons.
   */
  abi_encoded(): Uint8Array;
  /**
   * Creates a dummy gate with maximum opcode value and no sons.
   *
   * Returns a new Gate instance representing a placeholder/dummy gate.
   */
  static dummy(): Gate;
  /**
   * Flattens the gate into a vector containing the opcode followed by sons.
   *
   * Returns a vector where the first element is the opcode and the remaining elements are the
   * sons.
   */
  flatten(): Uint32Array;
  /**
   * Checks if the gate is a dummy gate.
   *
   * Returns true if the gate's opcode is the maximum u32 value.
   */
  is_dummy(): boolean;
  /**
   * Opcode determining the gate's function
   */
  opcode: number;
  /**
   * Indices of connected gates (sons) in the circuit
   */
  sons: Uint32Array;
}
/**
 * Represents a precontract created by the vendor, containing encrypted data and committing
 * information.
 */
export class Precontract {
  private constructor();
  free(): void;
  /**
   * The encrypted data (ciphertext)
   */
  ct: Uint8Array;
  /**
   * Serialized circuit
   */
  circuit_bytes: Uint8Array;
  /**
   * Description of the original file
   */
  description: Uint8Array;
  /**
   * Result of the accumulator applied on the ciphertext
   */
  h_ct: Uint8Array;
  /**
   * Result of the accumulator applied on the circuit
   */
  h_circuit: Uint8Array;
  /**
   * Commitment of the ciphertext and circuit
   */
  commitment: Commitment;
  /**
   * Number of blocks in the ciphertext
   */
  num_blocks: number;
  /**
   * Number of gates in the circuit
   */
  num_gates: number;
}
/**
 * Extended precontract with desc components T, Q, D published alongside d.
 *
 * d = SHA256(T ‖ Q ‖ D) — 32 bytes (the on-chain committed description).
 * Buyer pre-payment check: SHA256(T ‖ Q ‖ D) = d.
 */
export class PrecontractV3 {
  private constructor();
  free(): void;
  ct: Uint8Array;
  circuit_bytes: Uint8Array;
  /**
   * d = SHA256(T ‖ Q ‖ D) — 32 bytes.
   */
  d: Uint8Array;
  /**
   * T — thumb bytes (varies by media type).
   */
  thumb: Uint8Array;
  /**
   * Q — quality bytes (ELA-light for images, RMS for audio).
   */
  quality: Uint8Array;
  /**
   * D — dimension/metadata bytes.
   */
  dim: Uint8Array;
  h_ct: Uint8Array;
  h_circuit: Uint8Array;
  commitment: Commitment;
  num_blocks: number;
  num_gates: number;
}
