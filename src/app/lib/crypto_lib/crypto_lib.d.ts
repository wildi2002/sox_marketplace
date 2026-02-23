/* tslint:disable */
/* eslint-disable */
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
export function hex_to_bytes(hex_str: string): Uint8Array;
export function bytes_to_hex(vec: Uint8Array): string;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_argumentcheckresult_free: (a: number, b: number) => void;
  readonly __wbg_checkctresult_free: (a: number, b: number) => void;
  readonly __wbg_checkprecontractresult_free: (a: number, b: number) => void;
  readonly __wbg_disputeargument_free: (a: number, b: number) => void;
  readonly __wbg_evaluatedcircuit_free: (a: number, b: number) => void;
  readonly __wbg_evaluatedcircuitv2_free: (a: number, b: number) => void;
  readonly __wbg_finalstepcomponents_free: (a: number, b: number) => void;
  readonly __wbg_finalstepcomponentsv2_free: (a: number, b: number) => void;
  readonly __wbg_get_argumentcheckresult_error: (a: number) => [number, number];
  readonly __wbg_get_argumentcheckresult_is_valid: (a: number) => number;
  readonly __wbg_get_argumentcheckresult_supports_buyer: (a: number) => number;
  readonly __wbg_get_checkctresult_decrypted_file: (a: number) => [number, number];
  readonly __wbg_get_checkprecontractresult_h_ct: (a: number) => [number, number];
  readonly __wbg_get_checkprecontractresult_success: (a: number) => number;
  readonly __wbg_get_disputeargument_circuit: (a: number) => number;
  readonly __wbg_get_disputeargument_ct: (a: number) => [number, number];
  readonly __wbg_get_disputeargument_opening_value: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponents_curr_acc: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponents_gate: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponents_proof1: (a: number) => any;
  readonly __wbg_get_finalstepcomponents_proof2: (a: number) => any;
  readonly __wbg_get_finalstepcomponents_proof3: (a: number) => any;
  readonly __wbg_get_finalstepcomponents_proof_ext: (a: number) => any;
  readonly __wbg_get_finalstepcomponents_values: (a: number) => [number, number];
  readonly __wbg_get_precontract_commitment: (a: number) => number;
  readonly __wbg_get_precontract_num_blocks: (a: number) => number;
  readonly __wbg_get_precontract_num_gates: (a: number) => number;
  readonly __wbg_precontract_free: (a: number, b: number) => void;
  readonly __wbg_set_argumentcheckresult_error: (a: number, b: number, c: number) => void;
  readonly __wbg_set_argumentcheckresult_is_valid: (a: number, b: number) => void;
  readonly __wbg_set_argumentcheckresult_supports_buyer: (a: number, b: number) => void;
  readonly __wbg_set_checkctresult_decrypted_file: (a: number, b: number, c: number) => void;
  readonly __wbg_set_checkprecontractresult_h_ct: (a: number, b: number, c: number) => void;
  readonly __wbg_set_checkprecontractresult_success: (a: number, b: number) => void;
  readonly __wbg_set_disputeargument_circuit: (a: number, b: number) => void;
  readonly __wbg_set_disputeargument_ct: (a: number, b: number, c: number) => void;
  readonly __wbg_set_disputeargument_opening_value: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponents_curr_acc: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponents_gate: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponents_proof1: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponents_proof2: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponents_proof3: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponents_proof_ext: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponents_values: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_commitment: (a: number, b: number) => void;
  readonly __wbg_set_precontract_num_blocks: (a: number, b: number) => void;
  readonly __wbg_set_precontract_num_gates: (a: number, b: number) => void;
  readonly check_argument: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
  readonly check_precontract: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
  readonly check_received_ct_key: (a: number, b: number, c: any, d: number, e: number, f: number, g: number) => number;
  readonly compile_circuit_v2_wasm: (a: number, b: number, c: number, d: number) => [number, number];
  readonly compute_precontract_values: (a: number, b: number, c: any, d: number, e: number) => number;
  readonly compute_precontract_values_v2: (a: number, b: number, c: any, d: number, e: number) => number;
  readonly compute_proof_right: (a: number, b: number, c: number, d: number) => any;
  readonly compute_proof_right_v2: (a: number, b: number, c: number, d: number) => any;
  readonly compute_proofs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly compute_proofs_left: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly compute_proofs_left_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly compute_proofs_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly disputeargument_from_bytes: (a: number, b: number) => number;
  readonly disputeargument_to_bytes: (a: number) => [number, number];
  readonly evaluate_circuit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
  readonly evaluate_circuit_v2_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly evaluatedcircuit_from_bytes: (a: number, b: number) => number;
  readonly evaluatedcircuit_to_bytes: (a: number) => [number, number];
  readonly evaluatedcircuitv2_from_bytes: (a: number, b: number) => number;
  readonly evaluatedcircuitv2_to_bytes: (a: number) => [number, number];
  readonly hpre: (a: number, b: number, c: number, d: number) => [number, number];
  readonly hpre_v2: (a: number, b: number, c: number, d: number) => [number, number];
  readonly make_argument: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly __wbg_set_finalstepcomponentsv2_proof1: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponentsv2_proof2: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponentsv2_proof3: (a: number, b: any) => void;
  readonly __wbg_set_finalstepcomponentsv2_proof_ext: (a: number, b: any) => void;
  readonly __wbg_set_checkctresult_success: (a: number, b: number) => void;
  readonly __wbg_get_finalstepcomponentsv2_values: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponentsv2_proof1: (a: number) => any;
  readonly __wbg_get_finalstepcomponentsv2_proof2: (a: number) => any;
  readonly __wbg_get_finalstepcomponentsv2_proof3: (a: number) => any;
  readonly __wbg_get_finalstepcomponentsv2_proof_ext: (a: number) => any;
  readonly __wbg_set_checkprecontractresult_h_circuit: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponentsv2_curr_acc: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponentsv2_gate_bytes: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_circuit_bytes: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_ct: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_description: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_h_circuit: (a: number, b: number, c: number) => void;
  readonly __wbg_set_precontract_h_ct: (a: number, b: number, c: number) => void;
  readonly __wbg_set_finalstepcomponentsv2_values: (a: number, b: number, c: number) => void;
  readonly __wbg_get_checkctresult_success: (a: number) => number;
  readonly __wbg_get_checkprecontractresult_h_circuit: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponentsv2_curr_acc: (a: number) => [number, number];
  readonly __wbg_get_finalstepcomponentsv2_gate_bytes: (a: number) => [number, number];
  readonly __wbg_get_precontract_circuit_bytes: (a: number) => [number, number];
  readonly __wbg_get_precontract_ct: (a: number) => [number, number];
  readonly __wbg_get_precontract_description: (a: number) => [number, number];
  readonly __wbg_get_precontract_h_circuit: (a: number) => [number, number];
  readonly __wbg_get_precontract_h_ct: (a: number) => [number, number];
  readonly bytes_to_hex: (a: number, b: number) => [number, number];
  readonly decrypt_block_js: (a: number, b: number) => [number, number];
  readonly hex_to_bytes: (a: number, b: number) => [number, number];
  readonly encrypt_block_js: (a: number, b: number) => [number, number];
  readonly __wbg_commitment_free: (a: number, b: number) => void;
  readonly __wbg_get_commitment_c: (a: number) => [number, number];
  readonly __wbg_get_commitment_o: (a: number) => [number, number];
  readonly __wbg_set_commitment_c: (a: number, b: number, c: number) => void;
  readonly __wbg_set_commitment_o: (a: number, b: number, c: number) => void;
  readonly commit: (a: number, b: number) => number;
  readonly sha256_compress_final_js: (a: number, b: number) => [number, number];
  readonly sha256_compress_js: (a: number, b: number) => [number, number];
  readonly acc_js: (a: number, b: number) => [number, number];
  readonly prove_ext_js: (a: number, b: number) => any;
  readonly prove_js: (a: number, b: number, c: any) => any;
  readonly __wbg_compiledcircuit_free: (a: number, b: number) => void;
  readonly __wbg_compiledcircuitwithconstants_free: (a: number, b: number) => void;
  readonly __wbg_gate_free: (a: number, b: number) => void;
  readonly __wbg_get_compiledcircuit_block_size: (a: number) => number;
  readonly __wbg_get_compiledcircuit_num_blocks: (a: number) => number;
  readonly __wbg_get_compiledcircuit_version: (a: number) => number;
  readonly __wbg_get_gate_opcode: (a: number) => number;
  readonly __wbg_get_gate_sons: (a: number) => [number, number];
  readonly __wbg_set_compiledcircuit_block_size: (a: number, b: number) => void;
  readonly __wbg_set_compiledcircuit_num_blocks: (a: number, b: number) => void;
  readonly __wbg_set_compiledcircuit_version: (a: number, b: number) => void;
  readonly __wbg_set_gate_opcode: (a: number, b: number) => void;
  readonly __wbg_set_gate_sons: (a: number, b: number, c: number) => void;
  readonly compile_basic_circuit: (a: number, b: number, c: number) => number;
  readonly compiledcircuit_from_bytes: (a: number, b: number) => number;
  readonly compiledcircuit_to_bytes: (a: number) => [number, number];
  readonly gate_abi_encoded: (a: number) => [number, number];
  readonly gate_dummy: () => number;
  readonly gate_flatten: (a: number) => [number, number];
  readonly gate_is_dummy: (a: number) => number;
  readonly __wbg_set_compiledcircuitwithconstants_block_size: (a: number, b: number) => void;
  readonly __wbg_set_compiledcircuitwithconstants_version: (a: number, b: number) => void;
  readonly __wbg_get_compiledcircuitwithconstants_block_size: (a: number) => number;
  readonly __wbg_get_compiledcircuitwithconstants_version: (a: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
