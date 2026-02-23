let wasm;

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_2.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_export_2.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}
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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {Uint8Array} ct
 * @param {number} challenge
 * @returns {FinalStepComponents}
 */
export function compute_proofs_left(circuit_bytes, evaluated_circuit_bytes, ct, challenge) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proofs_left(ptr0, len0, ptr1, len1, ptr2, len2, challenge);
    return FinalStepComponents.__wrap(ret);
}

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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {Uint8Array} ct
 * @param {number} challenge
 * @returns {FinalStepComponentsV2}
 */
export function compute_proofs_left_v2(circuit_bytes, evaluated_circuit_bytes, ct, challenge) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proofs_left_v2(ptr0, len0, ptr1, len1, ptr2, len2, challenge);
    return FinalStepComponentsV2.__wrap(ret);
}

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
 * @param {Uint8Array} ct
 * @param {string} description
 * @param {string} opening_value
 * @returns {Uint8Array}
 */
export function make_argument(ct, description, opening_value) {
    const ptr0 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(opening_value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.make_argument(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} ct
 * @param {string[]} constants
 * @param {string} description
 * @returns {EvaluatedCircuit}
 */
export function evaluate_circuit(circuit_bytes, ct, constants, description) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayJsValueToWasm0(constants, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.evaluate_circuit(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    return EvaluatedCircuit.__wrap(ret);
}

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
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {number} num_blocks
 * @param {number} challenge
 * @returns {Uint8Array}
 */
export function hpre_v2(evaluated_circuit_bytes, num_blocks, challenge) {
    const ptr0 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hpre_v2(ptr0, len0, num_blocks, challenge);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} ct
 * @param {string} key
 * @returns {EvaluatedCircuitV2}
 */
export function evaluate_circuit_v2_wasm(circuit_bytes, ct, key) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.evaluate_circuit_v2_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
    return EvaluatedCircuitV2.__wrap(ret);
}

/**
 * Compiles a V2 circuit from ciphertext and description.
 *
 * # Arguments
 * * `ct` - Ciphertext bytes (must include 16-byte IV)
 * * `description` - Description hash as hex string
 *
 * # Returns
 * Serialized CompiledCircuitV2 bytes
 * @param {Uint8Array} ct
 * @param {string} description
 * @returns {Uint8Array}
 */
export function compile_circuit_v2_wasm(ct, description) {
    const ptr0 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compile_circuit_v2_wasm(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {Uint8Array} ct
 * @param {number} challenge
 * @returns {FinalStepComponents}
 */
export function compute_proofs(circuit_bytes, evaluated_circuit_bytes, ct, challenge) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proofs(ptr0, len0, ptr1, len1, ptr2, len2, challenge);
    return FinalStepComponents.__wrap(ret);
}

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
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {number} num_blocks
 * @param {number} num_gates
 * @returns {Array<any>}
 */
export function compute_proof_right_v2(evaluated_circuit_bytes, num_blocks, num_gates) {
    const ptr0 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proof_right_v2(ptr0, len0, num_blocks, num_gates);
    return ret;
}

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
 * @param {Uint8Array} argument_bin
 * @param {string} commitment
 * @param {string} description
 * @param {string} key
 * @returns {ArgumentCheckResult}
 */
export function check_argument(argument_bin, commitment, description, key) {
    const ptr0 = passArray8ToWasm0(argument_bin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(commitment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.check_argument(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    return ArgumentCheckResult.__wrap(ret);
}

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
 * @param {Uint8Array} file
 * @param {Uint8Array} key
 * @returns {Precontract}
 */
export function compute_precontract_values(file, key) {
    var ptr0 = passArray8ToWasm0(file, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_precontract_values(ptr0, len0, file, ptr1, len1);
    return Precontract.__wrap(ret);
}

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
 * @param {Uint8Array} circuit_bytes
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {Uint8Array} ct
 * @param {number} challenge
 * @returns {FinalStepComponentsV2}
 */
export function compute_proofs_v2(circuit_bytes, evaluated_circuit_bytes, ct, challenge) {
    const ptr0 = passArray8ToWasm0(circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proofs_v2(ptr0, len0, ptr1, len1, ptr2, len2, challenge);
    return FinalStepComponentsV2.__wrap(ret);
}

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
 * @param {string} description
 * @param {string} commitment
 * @param {string} opening_value
 * @param {Uint8Array} ct
 * @returns {CheckPrecontractResult}
 */
export function check_precontract(description, commitment, opening_value, ct) {
    const ptr0 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(commitment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(opening_value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.check_precontract(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    return CheckPrecontractResult.__wrap(ret);
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}
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
 * @param {Uint8Array} ct
 * @param {Uint8Array} key
 * @param {string} description
 * @returns {CheckCtResult}
 */
export function check_received_ct_key(ct, key, description) {
    var ptr0 = passArray8ToWasm0(ct, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.check_received_ct_key(ptr0, len0, ct, ptr1, len1, ptr2, len2);
    return CheckCtResult.__wrap(ret);
}

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
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {number} num_blocks
 * @param {number} num_gates
 * @returns {Array<any>}
 */
export function compute_proof_right(evaluated_circuit_bytes, num_blocks, num_gates) {
    const ptr0 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_proof_right(ptr0, len0, num_blocks, num_gates);
    return ret;
}

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
 * @param {Uint8Array} evaluated_circuit_bytes
 * @param {number} num_blocks
 * @param {number} challenge
 * @returns {Uint8Array}
 */
export function hpre(evaluated_circuit_bytes, num_blocks, challenge) {
    const ptr0 = passArray8ToWasm0(evaluated_circuit_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hpre(ptr0, len0, num_blocks, challenge);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {Uint8Array} file
 * @param {Uint8Array} key
 * @returns {Precontract}
 */
export function compute_precontract_values_v2(file, key) {
    var ptr0 = passArray8ToWasm0(file, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_precontract_values_v2(ptr0, len0, file, ptr1, len1);
    return Precontract.__wrap(ret);
}

/**
 * @param {string} hex_str
 * @returns {Uint8Array}
 */
export function hex_to_bytes(hex_str) {
    const ptr0 = passStringToWasm0(hex_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hex_to_bytes(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} vec
 * @returns {string}
 */
export function bytes_to_hex(vec) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bytes_to_hex(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {Uint8Array[]} data
 * @returns {Uint8Array}
 */
export function encrypt_block_js(data) {
    const ptr0 = passArrayJsValueToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.encrypt_block_js(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {Uint8Array[]} data
 * @returns {Uint8Array}
 */
export function decrypt_block_js(data) {
    const ptr0 = passArrayJsValueToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decrypt_block_js(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Creates a commitment for the given data by appending random bytes and hashing
 *
 * # Arguments
 * * `data` - Data to commit to
 *
 * # Returns
 * A `Commitment` containing the commitment hash and opening value
 * @param {Uint8Array} data
 * @returns {Commitment}
 */
export function commit(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.commit(ptr0, len0);
    return Commitment.__wrap(ret);
}

/**
 * JavaScript-compatible wrapper for sha256_compress
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing the input data
 *
 * # Returns
 * A byte vector containing the compressed result
 * @param {Uint8Array[]} data
 * @returns {Uint8Array}
 */
export function sha256_compress_js(data) {
    const ptr0 = passArrayJsValueToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sha256_compress_js(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * JavaScript-compatible wrapper for sha256_compress_final
 *
 * # Arguments
 * * `data` - Vector of Uint8Arrays containing the input data
 *
 * # Returns
 * A byte vector containing the final hash
 * @param {Uint8Array[]} data
 * @returns {Uint8Array}
 */
export function sha256_compress_final_js(data) {
    const ptr0 = passArrayJsValueToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sha256_compress_final_js(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * JavaScript wrapper of the prove function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays containing all values in the tree
 * * `indices` - Array of indices for values to include in proof
 *
 * # Returns
 * Array of arrays of Uint8Arrays containing the proof layers
 * @param {Uint8Array[]} values
 * @param {Array<any>} indices
 * @returns {Array<any>}
 */
export function prove_js(values, indices) {
    const ptr0 = passArrayJsValueToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.prove_js(ptr0, len0, indices);
    return ret;
}

/**
 * JavaScript wrapper of the prove_ext function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays containing the sequence of values
 *
 * # Returns
 * Array of Uint8Arrays containing the extension proof components
 * @param {Uint8Array[]} values
 * @returns {Array<any>}
 */
export function prove_ext_js(values) {
    const ptr0 = passArrayJsValueToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.prove_ext_js(ptr0, len0);
    return ret;
}

/**
 * JavaScript wrapper of the accumulator function
 *
 * # Arguments
 * * `values` - Array of Uint8Arrays to accumulate
 *
 * # Returns
 * Accumulated value as bytes
 * @param {Uint8Array[]} values
 * @returns {Uint8Array}
 */
export function acc_js(values) {
    const ptr0 = passArrayJsValueToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.acc_js(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {number} ct_size
 * @param {Uint8Array} description
 * @returns {CompiledCircuit}
 */
export function compile_basic_circuit(ct_size, description) {
    const ptr0 = passArray8ToWasm0(description, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compile_basic_circuit(ct_size, ptr0, len0);
    return CompiledCircuit.__wrap(ret);
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

const ArgumentCheckResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_argumentcheckresult_free(ptr >>> 0, 1));
/**
 * Result of checking a dispute argument.
 */
export class ArgumentCheckResult {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ArgumentCheckResult.prototype);
        obj.__wbg_ptr = ptr;
        ArgumentCheckResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArgumentCheckResultFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_argumentcheckresult_free(ptr, 0);
    }
    /**
     * Whether the argument is valid
     * @returns {boolean}
     */
    get is_valid() {
        const ret = wasm.__wbg_get_argumentcheckresult_is_valid(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the argument is valid
     * @param {boolean} arg0
     */
    set is_valid(arg0) {
        wasm.__wbg_set_argumentcheckresult_is_valid(this.__wbg_ptr, arg0);
    }
    /**
     * Whether the argument supports the buyer's position
     * @returns {boolean}
     */
    get supports_buyer() {
        const ret = wasm.__wbg_get_argumentcheckresult_supports_buyer(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the argument supports the buyer's position
     * @param {boolean} arg0
     */
    set supports_buyer(arg0) {
        wasm.__wbg_set_argumentcheckresult_supports_buyer(this.__wbg_ptr, arg0);
    }
    /**
     * Optional error message
     * @returns {string | undefined}
     */
    get error() {
        const ret = wasm.__wbg_get_argumentcheckresult_error(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Optional error message
     * @param {string | null} [arg0]
     */
    set error(arg0) {
        var ptr0 = isLikeNone(arg0) ? 0 : passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_argumentcheckresult_error(this.__wbg_ptr, ptr0, len0);
    }
}

const CheckCtResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_checkctresult_free(ptr >>> 0, 1));
/**
 * Result of checking ciphertext decryption.
 */
export class CheckCtResult {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(CheckCtResult.prototype);
        obj.__wbg_ptr = ptr;
        CheckCtResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CheckCtResultFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_checkctresult_free(ptr, 0);
    }
    /**
     * Whether the decryption verification succeeded
     * @returns {boolean}
     */
    get success() {
        const ret = wasm.__wbg_get_argumentcheckresult_is_valid(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the decryption verification succeeded
     * @param {boolean} arg0
     */
    set success(arg0) {
        wasm.__wbg_set_argumentcheckresult_is_valid(this.__wbg_ptr, arg0);
    }
    /**
     * The decrypted file contents
     * @returns {Uint8Array}
     */
    get decrypted_file() {
        const ret = wasm.__wbg_get_checkctresult_decrypted_file(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The decrypted file contents
     * @param {Uint8Array} arg0
     */
    set decrypted_file(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkctresult_decrypted_file(this.__wbg_ptr, ptr0, len0);
    }
}

const CheckPrecontractResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_checkprecontractresult_free(ptr >>> 0, 1));
/**
 * Result of checking a precontract, containing verification status and accumulator values.
 */
export class CheckPrecontractResult {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(CheckPrecontractResult.prototype);
        obj.__wbg_ptr = ptr;
        CheckPrecontractResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CheckPrecontractResultFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_checkprecontractresult_free(ptr, 0);
    }
    /**
     * Whether the precontract verification succeeded
     * @returns {boolean}
     */
    get success() {
        const ret = wasm.__wbg_get_checkprecontractresult_success(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the precontract verification succeeded
     * @param {boolean} arg0
     */
    set success(arg0) {
        wasm.__wbg_set_checkprecontractresult_success(this.__wbg_ptr, arg0);
    }
    /**
     * Accumulator value of the circuit
     * @returns {Uint8Array}
     */
    get h_circuit() {
        const ret = wasm.__wbg_get_checkprecontractresult_h_circuit(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Accumulator value of the circuit
     * @param {Uint8Array} arg0
     */
    set h_circuit(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkctresult_decrypted_file(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Accumulator value of the ciphertext
     * @returns {Uint8Array}
     */
    get h_ct() {
        const ret = wasm.__wbg_get_checkprecontractresult_h_ct(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Accumulator value of the ciphertext
     * @param {Uint8Array} arg0
     */
    set h_ct(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkprecontractresult_h_ct(this.__wbg_ptr, ptr0, len0);
    }
}

const CommitmentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_commitment_free(ptr >>> 0, 1));
/**
 * Represents a commitment with its commitment value and opening value
 */
export class Commitment {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Commitment.prototype);
        obj.__wbg_ptr = ptr;
        CommitmentFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CommitmentFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_commitment_free(ptr, 0);
    }
    /**
     * The commitment value
     * @returns {Uint8Array}
     */
    get c() {
        const ret = wasm.__wbg_get_commitment_c(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The commitment value
     * @param {Uint8Array} arg0
     */
    set c(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commitment_c(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The opening value
     * @returns {Uint8Array}
     */
    get o() {
        const ret = wasm.__wbg_get_commitment_o(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The opening value
     * @param {Uint8Array} arg0
     */
    set o(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_commitment_o(this.__wbg_ptr, ptr0, len0);
    }
}

const CompiledCircuitFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compiledcircuit_free(ptr >>> 0, 1));
/**
 * Represents a compiled circuit with gates and their associated constants
 */
export class CompiledCircuit {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(CompiledCircuit.prototype);
        obj.__wbg_ptr = ptr;
        CompiledCircuitFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompiledCircuitFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compiledcircuit_free(ptr, 0);
    }
    /**
     * Deserializes a compiled circuit from bytes.
     *
     * # Arguments
     * * `bytes` - The serialized circuit bytes
     *
     * # Returns
     * A new `CompiledCircuit` instance
     * @param {Uint8Array} bytes
     * @returns {CompiledCircuit}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compiledcircuit_from_bytes(ptr0, len0);
        return CompiledCircuit.__wrap(ret);
    }
    /**
     * Serializes the compiled circuit into bytes.
     *
     * Returns a vector containing the serialized circuit data.
     * @returns {Uint8Array}
     */
    to_bytes() {
        const ret = wasm.compiledcircuit_to_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Version number of the instruction set
     * @returns {number}
     */
    get version() {
        const ret = wasm.__wbg_get_compiledcircuit_version(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Version number of the instruction set
     * @param {number} arg0
     */
    set version(arg0) {
        wasm.__wbg_set_compiledcircuit_version(this.__wbg_ptr, arg0);
    }
    /**
     * Size of blocks processed by the circuit
     * @returns {number}
     */
    get block_size() {
        const ret = wasm.__wbg_get_compiledcircuit_block_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Size of blocks processed by the circuit
     * @param {number} arg0
     */
    set block_size(arg0) {
        wasm.__wbg_set_compiledcircuit_block_size(this.__wbg_ptr, arg0);
    }
    /**
     * Number of blocks in the circuit
     * @returns {number}
     */
    get num_blocks() {
        const ret = wasm.__wbg_get_compiledcircuit_num_blocks(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of blocks in the circuit
     * @param {number} arg0
     */
    set num_blocks(arg0) {
        wasm.__wbg_set_compiledcircuit_num_blocks(this.__wbg_ptr, arg0);
    }
}

const CompiledCircuitWithConstantsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compiledcircuitwithconstants_free(ptr >>> 0, 1));
/**
 * Represents a compiled circuit with all constants bound to specific values
 */
export class CompiledCircuitWithConstants {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompiledCircuitWithConstantsFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compiledcircuitwithconstants_free(ptr, 0);
    }
    /**
     * Version number of instruction set
     * @returns {number}
     */
    get version() {
        const ret = wasm.__wbg_get_compiledcircuit_version(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Version number of instruction set
     * @param {number} arg0
     */
    set version(arg0) {
        wasm.__wbg_set_compiledcircuit_version(this.__wbg_ptr, arg0);
    }
    /**
     * Size of blocks processed by the circuit
     * @returns {number}
     */
    get block_size() {
        const ret = wasm.__wbg_get_compiledcircuit_block_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Size of blocks processed by the circuit
     * @param {number} arg0
     */
    set block_size(arg0) {
        wasm.__wbg_set_compiledcircuit_block_size(this.__wbg_ptr, arg0);
    }
}

const DisputeArgumentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disputeargument_free(ptr >>> 0, 1));
/**
 * Represents an argument in a dispute between buyer and vendor.
 */
export class DisputeArgument {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(DisputeArgument.prototype);
        obj.__wbg_ptr = ptr;
        DisputeArgumentFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisputeArgumentFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disputeargument_free(ptr, 0);
    }
    /**
     * Deserializes a dispute argument from bytes.
     *
     * # Arguments
     * * `bytes` - The serialized dispute argument bytes
     *
     * # Returns
     * A new `DisputeArgument` instance
     * @param {Uint8Array} bytes
     * @returns {DisputeArgument}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.disputeargument_from_bytes(ptr0, len0);
        return DisputeArgument.__wrap(ret);
    }
    /**
     * Serializes the dispute argument into a byte vector.
     *
     * Returns a vector containing the serialized dispute argument data.
     * @returns {Uint8Array}
     */
    to_bytes() {
        const ret = wasm.disputeargument_to_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The compiled circuit
     * @returns {CompiledCircuit}
     */
    get circuit() {
        const ret = wasm.__wbg_get_disputeargument_circuit(this.__wbg_ptr);
        return CompiledCircuit.__wrap(ret);
    }
    /**
     * The compiled circuit
     * @param {CompiledCircuit} arg0
     */
    set circuit(arg0) {
        _assertClass(arg0, CompiledCircuit);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_disputeargument_circuit(this.__wbg_ptr, ptr0);
    }
    /**
     * The ciphertext
     * @returns {Uint8Array}
     */
    get ct() {
        const ret = wasm.__wbg_get_disputeargument_ct(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The ciphertext
     * @param {Uint8Array} arg0
     */
    set ct(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_disputeargument_ct(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Opening value for the commitment
     * @returns {Uint8Array}
     */
    get opening_value() {
        const ret = wasm.__wbg_get_disputeargument_opening_value(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Opening value for the commitment
     * @param {Uint8Array} arg0
     */
    set opening_value(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_disputeargument_opening_value(this.__wbg_ptr, ptr0, len0);
    }
}

const EvaluatedCircuitFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_evaluatedcircuit_free(ptr >>> 0, 1));
/**
 * Represents an evaluated circuit with its values and constants.
 */
export class EvaluatedCircuit {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(EvaluatedCircuit.prototype);
        obj.__wbg_ptr = ptr;
        EvaluatedCircuitFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EvaluatedCircuitFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_evaluatedcircuit_free(ptr, 0);
    }
    /**
     * Deserializes an evaluated circuit from bytes.
     *
     * # Arguments
     * * `bytes` - The serialized circuit bytes
     *
     * # Returns
     * A new `EvaluatedCircuit` instance
     * @param {Uint8Array} bytes
     * @returns {EvaluatedCircuit}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evaluatedcircuit_from_bytes(ptr0, len0);
        return EvaluatedCircuit.__wrap(ret);
    }
    /**
     * Serializes the evaluated circuit into bytes.
     *
     * Returns a vector containing the serialized circuit data.
     * @returns {Uint8Array}
     */
    to_bytes() {
        const ret = wasm.evaluatedcircuit_to_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}

const EvaluatedCircuitV2Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_evaluatedcircuitv2_free(ptr >>> 0, 1));
/**
 * Represents an evaluated V2 circuit with its values.
 */
export class EvaluatedCircuitV2 {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(EvaluatedCircuitV2.prototype);
        obj.__wbg_ptr = ptr;
        EvaluatedCircuitV2Finalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EvaluatedCircuitV2Finalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_evaluatedcircuitv2_free(ptr, 0);
    }
    /**
     * Deserializes an evaluated V2 circuit from bytes.
     *
     * # Arguments
     * * `bytes` - The serialized circuit bytes
     *
     * # Returns
     * A new `EvaluatedCircuitV2` instance
     * @param {Uint8Array} bytes
     * @returns {EvaluatedCircuitV2}
     */
    static from_bytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evaluatedcircuitv2_from_bytes(ptr0, len0);
        return EvaluatedCircuitV2.__wrap(ret);
    }
    /**
     * Serializes the evaluated V2 circuit into bytes.
     *
     * Returns a vector containing the serialized circuit data.
     * @returns {Uint8Array}
     */
    to_bytes() {
        const ret = wasm.evaluatedcircuitv2_to_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}

const FinalStepComponentsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_finalstepcomponents_free(ptr >>> 0, 1));
/**
 * Components returned from the vendor's final step proof generation. Intended for usage in a
 * JavaScript context
 */
export class FinalStepComponents {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FinalStepComponents.prototype);
        obj.__wbg_ptr = ptr;
        FinalStepComponentsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FinalStepComponentsFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_finalstepcomponents_free(ptr, 0);
    }
    /**
     * Gate information
     * @returns {number[]}
     */
    get gate() {
        const ret = wasm.__wbg_get_finalstepcomponents_gate(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Gate information
     * @param {number[]} arg0
     */
    set gate(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_gate(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Values involved in the proof
     * @returns {Uint8Array[]}
     */
    get values() {
        const ret = wasm.__wbg_get_finalstepcomponents_values(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Values involved in the proof
     * @param {Uint8Array[]} arg0
     */
    set values(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_values(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Current accumulator value (w_i)
     * @returns {Uint8Array}
     */
    get curr_acc() {
        const ret = wasm.__wbg_get_finalstepcomponents_curr_acc(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Current accumulator value (w_i)
     * @param {Uint8Array} arg0
     */
    set curr_acc(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_curr_acc(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * First proof
     * @returns {Array<any>}
     */
    get proof1() {
        const ret = wasm.__wbg_get_finalstepcomponents_proof1(this.__wbg_ptr);
        return ret;
    }
    /**
     * First proof
     * @param {Array<any>} arg0
     */
    set proof1(arg0) {
        wasm.__wbg_set_finalstepcomponents_proof1(this.__wbg_ptr, arg0);
    }
    /**
     * Second proof
     * @returns {Array<any>}
     */
    get proof2() {
        const ret = wasm.__wbg_get_finalstepcomponents_proof2(this.__wbg_ptr);
        return ret;
    }
    /**
     * Second proof
     * @param {Array<any>} arg0
     */
    set proof2(arg0) {
        wasm.__wbg_set_finalstepcomponents_proof2(this.__wbg_ptr, arg0);
    }
    /**
     * Third proof (empty array if no third proof is needed)
     * @returns {Array<any>}
     */
    get proof3() {
        const ret = wasm.__wbg_get_finalstepcomponents_proof3(this.__wbg_ptr);
        return ret;
    }
    /**
     * Third proof (empty array if no third proof is needed)
     * @param {Array<any>} arg0
     */
    set proof3(arg0) {
        wasm.__wbg_set_finalstepcomponents_proof3(this.__wbg_ptr, arg0);
    }
    /**
     * Extension proof
     * @returns {Array<any>}
     */
    get proof_ext() {
        const ret = wasm.__wbg_get_finalstepcomponents_proof_ext(this.__wbg_ptr);
        return ret;
    }
    /**
     * Extension proof
     * @param {Array<any>} arg0
     */
    set proof_ext(arg0) {
        wasm.__wbg_set_finalstepcomponents_proof_ext(this.__wbg_ptr, arg0);
    }
}

const FinalStepComponentsV2Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_finalstepcomponentsv2_free(ptr >>> 0, 1));
/**
 * Components returned from the vendor's final step proof generation for V2. Intended for usage in a
 * JavaScript context
 */
export class FinalStepComponentsV2 {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FinalStepComponentsV2.prototype);
        obj.__wbg_ptr = ptr;
        FinalStepComponentsV2Finalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FinalStepComponentsV2Finalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_finalstepcomponentsv2_free(ptr, 0);
    }
    /**
     * Gate information (64-byte encoded gate)
     * @returns {Uint8Array}
     */
    get gate_bytes() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_gate_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Gate information (64-byte encoded gate)
     * @param {Uint8Array} arg0
     */
    set gate_bytes(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkctresult_decrypted_file(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Values involved in the proof
     * @returns {Uint8Array[]}
     */
    get values() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_values(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Values involved in the proof
     * @param {Uint8Array[]} arg0
     */
    set values(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_values(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Current accumulator value (w_i)
     * @returns {Uint8Array}
     */
    get curr_acc() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_curr_acc(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Current accumulator value (w_i)
     * @param {Uint8Array} arg0
     */
    set curr_acc(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_curr_acc(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * First proof
     * @returns {Array<any>}
     */
    get proof1() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_proof1(this.__wbg_ptr);
        return ret;
    }
    /**
     * First proof
     * @param {Array<any>} arg0
     */
    set proof1(arg0) {
        wasm.__wbg_set_finalstepcomponentsv2_proof1(this.__wbg_ptr, arg0);
    }
    /**
     * Second proof
     * @returns {Array<any>}
     */
    get proof2() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_proof2(this.__wbg_ptr);
        return ret;
    }
    /**
     * Second proof
     * @param {Array<any>} arg0
     */
    set proof2(arg0) {
        wasm.__wbg_set_finalstepcomponentsv2_proof2(this.__wbg_ptr, arg0);
    }
    /**
     * Third proof (empty array if no third proof is needed)
     * @returns {Array<any>}
     */
    get proof3() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_proof3(this.__wbg_ptr);
        return ret;
    }
    /**
     * Third proof (empty array if no third proof is needed)
     * @param {Array<any>} arg0
     */
    set proof3(arg0) {
        wasm.__wbg_set_finalstepcomponentsv2_proof3(this.__wbg_ptr, arg0);
    }
    /**
     * Extension proof
     * @returns {Array<any>}
     */
    get proof_ext() {
        const ret = wasm.__wbg_get_finalstepcomponentsv2_proof_ext(this.__wbg_ptr);
        return ret;
    }
    /**
     * Extension proof
     * @param {Array<any>} arg0
     */
    set proof_ext(arg0) {
        wasm.__wbg_set_finalstepcomponentsv2_proof_ext(this.__wbg_ptr, arg0);
    }
}

const GateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gate_free(ptr >>> 0, 1));
/**
 * Represents a gate in the circuit with an operation code and connections to other gates
 */
export class Gate {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Gate.prototype);
        obj.__wbg_ptr = ptr;
        GateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GateFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gate_free(ptr, 0);
    }
    /**
     * Opcode determining the gate's function
     * @returns {number}
     */
    get opcode() {
        const ret = wasm.__wbg_get_gate_opcode(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Opcode determining the gate's function
     * @param {number} arg0
     */
    set opcode(arg0) {
        wasm.__wbg_set_gate_opcode(this.__wbg_ptr, arg0);
    }
    /**
     * Indices of connected gates (sons) in the circuit
     * @returns {Uint32Array}
     */
    get sons() {
        const ret = wasm.__wbg_get_gate_sons(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Indices of connected gates (sons) in the circuit
     * @param {Uint32Array} arg0
     */
    set sons(arg0) {
        const ptr0 = passArray32ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_gate_sons(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Converts the gate an EVM compatible ABI-encoded bytes format.
     *
     * Returns a vector of bytes representing the ABI encoding of the gate's opcode and sons.
     * @returns {Uint8Array}
     */
    abi_encoded() {
        const ret = wasm.gate_abi_encoded(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Creates a dummy gate with maximum opcode value and no sons.
     *
     * Returns a new Gate instance representing a placeholder/dummy gate.
     * @returns {Gate}
     */
    static dummy() {
        const ret = wasm.gate_dummy();
        return Gate.__wrap(ret);
    }
    /**
     * Flattens the gate into a vector containing the opcode followed by sons.
     *
     * Returns a vector where the first element is the opcode and the remaining elements are the
     * sons.
     * @returns {Uint32Array}
     */
    flatten() {
        const ret = wasm.gate_flatten(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Checks if the gate is a dummy gate.
     *
     * Returns true if the gate's opcode is the maximum u32 value.
     * @returns {boolean}
     */
    is_dummy() {
        const ret = wasm.gate_is_dummy(this.__wbg_ptr);
        return ret !== 0;
    }
}

const PrecontractFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_precontract_free(ptr >>> 0, 1));
/**
 * Represents a precontract created by the vendor, containing encrypted data and committing
 * information.
 */
export class Precontract {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Precontract.prototype);
        obj.__wbg_ptr = ptr;
        PrecontractFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PrecontractFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_precontract_free(ptr, 0);
    }
    /**
     * The encrypted data (ciphertext)
     * @returns {Uint8Array}
     */
    get ct() {
        const ret = wasm.__wbg_get_precontract_ct(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The encrypted data (ciphertext)
     * @param {Uint8Array} arg0
     */
    set ct(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkctresult_decrypted_file(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Serialized circuit
     * @returns {Uint8Array}
     */
    get circuit_bytes() {
        const ret = wasm.__wbg_get_precontract_circuit_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Serialized circuit
     * @param {Uint8Array} arg0
     */
    set circuit_bytes(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_checkprecontractresult_h_ct(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Description of the original file
     * @returns {Uint8Array}
     */
    get description() {
        const ret = wasm.__wbg_get_precontract_description(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Description of the original file
     * @param {Uint8Array} arg0
     */
    set description(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_finalstepcomponents_curr_acc(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Result of the accumulator applied on the ciphertext
     * @returns {Uint8Array}
     */
    get h_ct() {
        const ret = wasm.__wbg_get_precontract_h_ct(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Result of the accumulator applied on the ciphertext
     * @param {Uint8Array} arg0
     */
    set h_ct(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_disputeargument_ct(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Result of the accumulator applied on the circuit
     * @returns {Uint8Array}
     */
    get h_circuit() {
        const ret = wasm.__wbg_get_precontract_h_circuit(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Result of the accumulator applied on the circuit
     * @param {Uint8Array} arg0
     */
    set h_circuit(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_disputeargument_opening_value(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Commitment of the ciphertext and circuit
     * @returns {Commitment}
     */
    get commitment() {
        const ret = wasm.__wbg_get_precontract_commitment(this.__wbg_ptr);
        return Commitment.__wrap(ret);
    }
    /**
     * Commitment of the ciphertext and circuit
     * @param {Commitment} arg0
     */
    set commitment(arg0) {
        _assertClass(arg0, Commitment);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_precontract_commitment(this.__wbg_ptr, ptr0);
    }
    /**
     * Number of blocks in the ciphertext
     * @returns {number}
     */
    get num_blocks() {
        const ret = wasm.__wbg_get_precontract_num_blocks(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of blocks in the ciphertext
     * @param {number} arg0
     */
    set num_blocks(arg0) {
        wasm.__wbg_set_precontract_num_blocks(this.__wbg_ptr, arg0);
    }
    /**
     * Number of gates in the circuit
     * @returns {number}
     */
    get num_gates() {
        const ret = wasm.__wbg_get_precontract_num_gates(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of gates in the circuit
     * @param {number} arg0
     */
    set num_gates(arg0) {
        wasm.__wbg_set_precontract_num_gates(this.__wbg_ptr, arg0);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_buffer_609cc3eee51ed158 = function(arg0) {
        const ret = arg0.buffer;
        return ret;
    };
    imports.wbg.__wbg_error_ce5d1daa2d5195d4 = function(arg0, arg1) {
        console.error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_getRandomValues_3c9c0d586e575a16 = function() { return handleError(function (arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
    }, arguments) };
    imports.wbg.__wbg_get_b9b93047fe3cf45b = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_getindex_5b00c274b05714aa = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_length_a446193dc22c12f8 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_e2d2a49132c1b256 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_new_78feb108b6472713 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_a12002a7f91c75be = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_newwithbyteoffsetandlength_d97e637ebe145a9a = function(arg0, arg1, arg2) {
        const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_push_737cfc8c1432c2c6 = function(arg0, arg1) {
        const ret = arg0.push(arg1);
        return ret;
    };
    imports.wbg.__wbindgen_copy_to_typed_array = function(arg0, arg1, arg2) {
        new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_2;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbindgen_number_new = function(arg0) {
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('crypto_lib_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
