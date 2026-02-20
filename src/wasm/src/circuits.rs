use crate::utils::die;
use crate::{aes_ctr, sha256, simple_operations};
use ethabi::{encode, Token};
use rmp_serde::encode::write;
use rmp_serde::from_read;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Function type for instructions
type Instruction = fn(data: &Vec<&Vec<u8>>) -> Vec<u8>;

fn version_instructions(version: usize) -> Vec<Instruction> {
    match version {
        0 => {
            vec![
                sha256::sha256_compress,
                aes_ctr::encrypt_block,
                aes_ctr::decrypt_block,
                simple_operations::binary_add,
                simple_operations::binary_mult,
                simple_operations::equal,
                simple_operations::concat_bytes,
                sha256::sha256_compress_final,
            ]
        }
        _ => vec![],
    }
}

/// Represents a gate in the circuit with an operation code and connections to other gates
#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Gate {
    /// Opcode determining the gate's function
    pub opcode: u32,

    /// Indices of connected gates (sons) in the circuit
    #[wasm_bindgen(getter_with_clone)]
    pub sons: Vec<u32>,
}

/// Methods for serializing and manipulating gates
#[wasm_bindgen]
impl Gate {
    /// Flattens the gate into a vector containing the opcode followed by sons.
    ///
    /// Returns a vector where the first element is the opcode and the remaining elements are the
    /// sons.
    pub fn flatten(&self) -> Vec<u32> {
        let mut res = Vec::with_capacity(1 + self.sons.len());
        res.push(self.opcode);
        res.extend(self.sons.clone());

        res
    }

    /// Creates a dummy gate with maximum opcode value and no sons.
    ///
    /// Returns a new Gate instance representing a placeholder/dummy gate.
    pub fn dummy() -> Gate {
        Gate {
            opcode: u32::MAX,
            sons: vec![],
        }
    }

    /// Checks if the gate is a dummy gate.
    ///
    /// Returns true if the gate's opcode is the maximum u32 value.
    pub fn is_dummy(&self) -> bool {
        self.opcode == u32::MAX
    }

    /// Converts the gate an EVM compatible ABI-encoded bytes format.
    ///
    /// Returns a vector of bytes representing the ABI encoding of the gate's opcode and sons.
    pub fn abi_encoded(&self) -> Vec<u8> {
        encode(&[Token::Array(
            self.flatten()
                .iter()
                .map(|&x| Token::Uint(x.into()))
                .collect(),
        )])
    }
}

/// Represents a compiled circuit with gates and their associated constants
#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct CompiledCircuit {
    /// Vector of gates forming the circuit
    #[wasm_bindgen(skip)]
    pub circuit: Vec<Gate>,

    /// Optional constant values used in the circuit. If one of the values is None, it is meant
    /// to be replaced by a value using the `bind_constants` method.
    #[wasm_bindgen(skip)]
    pub constants: Vec<Option<Vec<u8>>>,

    /// Version number of the instruction set
    pub version: u32,

    /// Size of blocks processed by the circuit
    pub block_size: u32,

    /// Number of blocks in the circuit
    pub num_blocks: u32,
}

#[wasm_bindgen]
impl CompiledCircuit {
    /// Serializes the compiled circuit into bytes.
    ///
    /// Returns a vector containing the serialized circuit data.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        write(&mut buf, self).unwrap();
        buf
    }

    /// Deserializes a compiled circuit from bytes.
    ///
    /// # Arguments
    /// * `bytes` - The serialized circuit bytes
    ///
    /// # Returns
    /// A new `CompiledCircuit` instance
    pub fn from_bytes(bytes: &[u8]) -> CompiledCircuit {
        from_read(bytes).unwrap()
    }
}

/// Non-WASM methods for compiled circuit
impl CompiledCircuit {
    /// Binds constant values to the circuit. Completely replaces the old constants.
    ///
    /// # Arguments
    /// * `constants` - Vector of constant values to bind
    ///
    /// # Returns
    /// A new `CompiledCircuitWithConstants` instance with the bound constants
    pub fn bind_constants(&self, constants: Vec<Vec<u8>>) -> CompiledCircuitWithConstants {
        if constants.len() != self.constants.len() {
            die("The number of constants does not match the number of constants in the circuit");
        }
        CompiledCircuitWithConstants {
            circuit: self.circuit.clone(),
            constants,
            version: self.version,
            block_size: self.block_size,
        }
    }

    /// Binds only missing constants to the circuit. Replaces the `None` values with the ones
    /// provided in the `constants` argument in the same order.
    ///
    /// # Arguments
    /// * `constants` - Vector of constant values to bind where None exists
    ///
    /// # Returns
    /// A new `CompiledCircuitWithConstants` instance with all constants bound
    pub fn bind_missing_constants(&self, constants: Vec<Vec<u8>>) -> CompiledCircuitWithConstants {
        let mut all_constants = Vec::with_capacity(self.constants.len());
        let mut i = 0;

        for c in &self.constants {
            if let Some(val) = c {
                all_constants.push(val.to_owned());
            } else {
                if i >= constants.len() {
                    die("Not enough constants to bind");
                }
                all_constants.push(constants[i].to_owned());
                i += 1;
            }
        }

        self.bind_constants(all_constants)
    }

    /// Converts the circuit into an array of byte vectors.
    ///
    /// Returns a vector of byte vectors representing the circuit components.
    pub fn to_bytes_array(&self) -> Vec<Vec<u8>> {
        let mut res = vec![self.version.to_be_bytes().to_vec()];
        for g in &self.circuit {
            let mut buf = Vec::new();
            write(&mut buf, g).unwrap();
            res.push(buf);
        }

        for c in &self.constants {
            let mut buf = Vec::new();
            write(&mut buf, c).unwrap();
            res.push(buf);
        }

        res
    }

    /// Converts the circuit into EVM compatible ABI-encoded format.
    ///
    /// Returns a vector of byte vectors containing the ABI encoding of each gate.
    pub fn to_abi_encoded(&self) -> Vec<Vec<u8>> {
        self.circuit.iter().map(|g| g.abi_encoded()).collect()
    }
}

// flag that indicates that a son is a constant
const CONSTANT_FLAG: u32 = 1 << 31;

// converts array index to constant index
fn array_idx_to_constant_idx(array_idx: u32) -> u32 {
    CONSTANT_FLAG | array_idx
}

// converts constant index to array index
fn constant_idx_to_array_idx(constant_idx: u32) -> usize {
    (CONSTANT_FLAG ^ constant_idx) as usize
}

// checks if an index is a constant index
pub fn is_constant_idx(idx: u32) -> bool {
    CONSTANT_FLAG & idx != 0
}

// compiles the basic circuit for a plaintext of size ct_size bytes
// ct_size INCLUDES THE IV!!!
// block_size is the size of the blocks in the circuit
// should only be called for plaintexts of size 64 bytes or less
fn compile_basic_circuit_one_block(
    ct_size: u32,
    description: &[u8],
    block_size: u32,
) -> CompiledCircuit {
    let mut circuit: Vec<Gate> = Vec::with_capacity(5);

    // dummy gates
    circuit.push(Gate::dummy());
    circuit.push(Gate::dummy());

    // AES decryption gate
    circuit.push(Gate {
        opcode: 2,
        sons: vec![
            array_idx_to_constant_idx(3), // key
            1,                            // blocks to encrypt
            0,                            // counter
        ],
    });

    // SHA + pad gate
    circuit.push(Gate {
        opcode: 7,
        sons: vec![
            2,                            // block to hash
            array_idx_to_constant_idx(2), // ciphertext size
        ],
    });

    // comparison gate
    circuit.push(Gate {
        opcode: 5,
        sons: vec![3, array_idx_to_constant_idx(1)],
    });

    CompiledCircuit {
        circuit,
        constants: vec![
            Some(4usize.to_be_bytes().to_vec()), // counter increment
            Some(description.to_vec()),          // description
            Some(((ct_size - 16) as u64).to_be_bytes().to_vec()), // size of the plaintext
            None,                                // key placeholder
        ],
        version: 0,
        block_size,
        num_blocks: 2, // iv + <64B block
    }
}

/// Compiles a basic circuit for processing ciphertext. Once the key is bound, the circuit computes
/// the SHA256 hash of the initial plaintext and compares it to the provided description.
///
/// # Arguments
/// * `ct_size` - Size of the ciphertext (including IV!)
/// * `description` - Description of the plaintext
///
/// # Returns
/// A `CompiledCircuit` configured for the given parameters
#[wasm_bindgen]
pub fn compile_basic_circuit(ct_size: u32, description: &[u8]) -> CompiledCircuit {
    let block_size = 64;
    let pt_size = ct_size - 16; // remove the size of the iv
    let ct_blocks_number = 1  // iv
            + pt_size / block_size // number of blocks of the plaintext
            + if pt_size % block_size == 0 { 0 } else { 1 }; // ceiling
    if ct_blocks_number < 2 {
        die("The ciphertext's length should be at least 17 bytes (incl. IV)");
    }

    if ct_blocks_number == 2 {
        // special case where pt has 1 block of data
        return compile_basic_circuit_one_block(ct_size, description, block_size);
    }

    // m dummy gates
    // + m-2 addition gates for incrementing the counter before AES (from 2nd one)
    // + m-1 AES-CTR gates
    // + m-1 SHA compression gates
    // + 1 comparison gate
    // = 4m - 3 gates in total
    let mut gates: Vec<Gate> = Vec::with_capacity((4 * ct_blocks_number - 3) as usize);

    // dummy gates
    for _ in 0..ct_blocks_number {
        gates.push(Gate::dummy());
    }

    // counter increment gates
    // first one points to the IV
    gates.push(Gate {
        opcode: 3,
        sons: vec![
            0,                            // previous counter value
            array_idx_to_constant_idx(0), // value to add
        ],
    });
    for i in ct_blocks_number..(2 * ct_blocks_number - 3) {
        gates.push(Gate {
            opcode: 3,
            sons: vec![
                i,                            // previous counter value
                array_idx_to_constant_idx(0), // value to add
            ],
        });
    }

    // AES decryption gates
    // First one uses the IV as counter
    gates.push(Gate {
        opcode: 2,
        sons: vec![
            array_idx_to_constant_idx(3), // key
            1,                            // blocks to encrypt
            0,                            // counter
        ],
    });
    for i in 2..ct_blocks_number {
        gates.push(Gate {
            opcode: 2,
            sons: vec![
                array_idx_to_constant_idx(3), // key
                i,                            // blocks to encrypt
                i + ct_blocks_number - 2,     // counter
            ],
        });
    }

    // SHA256 compression gates, first one doesn't have a previous hash
    gates.push(Gate {
        opcode: 0,
        sons: vec![2 * ct_blocks_number - 2], // only current block
    });
    for i in (3 * ct_blocks_number - 2)..(4 * ct_blocks_number - 5) {
        gates.push(Gate {
            opcode: 0,
            sons: vec![
                i - 1,                    // previous hash
                i - ct_blocks_number + 1, // current block
            ],
        });
    }
    // last SHA256 compression gate does the padding as well
    gates.push(Gate {
        opcode: 7,
        sons: vec![
            4 * ct_blocks_number - 6,     // previous hash
            3 * ct_blocks_number - 4,     // block to hash
            array_idx_to_constant_idx(2), // plaintext size
        ],
    });

    // final comparison gate
    gates.push(Gate {
        opcode: 5,
        sons: vec![4 * ct_blocks_number - 5, array_idx_to_constant_idx(1)],
    });

    CompiledCircuit {
        circuit: gates,
        constants: vec![
            Some(4u16.to_be_bytes().to_vec()),             // counter increment
            Some(description.to_vec()),                    // description
            Some((pt_size as u64).to_be_bytes().to_vec()), // size of the ciphertext
            None,                                          // key placeholder
        ],
        version: 0,
        block_size,
        num_blocks: ct_blocks_number,
    }
}

// ============================= EVALUATION =============================

/// Represents a compiled circuit with all constants bound to specific values
#[wasm_bindgen]
pub struct CompiledCircuitWithConstants {
    /// Vector of gates forming the circuit
    #[wasm_bindgen(skip)]
    pub circuit: Vec<Gate>,

    /// Constant values used in the circuit
    #[wasm_bindgen(skip)]
    pub constants: Vec<Vec<u8>>,

    /// Version number of instruction set
    pub version: u32,

    /// Size of blocks processed by the circuit
    pub block_size: u32,
}

/// Retrieves the evaluated values for a gate's sons
///
/// # Arguments
/// * `gate` - The gate whose sons' values should be retrieved
/// * `evaluated_circuit` - Vector of previously evaluated values
/// * `constants` - Vector of constant values
///
/// # Returns
/// Vector of references to the evaluated values for the gate's sons
pub fn get_evaluated_sons<'a>(
    gate: &Gate,
    evaluated_circuit: &'a Vec<Vec<u8>>,
    constants: &'a Vec<Vec<u8>>,
) -> Vec<&'a Vec<u8>> {
    let mut sons = Vec::with_capacity(gate.sons.len());

    for &s in &gate.sons {
        if !is_constant_idx(s) {
            if s >= evaluated_circuit.len() as u32 {
                die("Gates should not have non constant sons after themselves in the circuit");
            }
            sons.push(&evaluated_circuit[s as usize]);
        } else if !constants.is_empty() {
            sons.push(&constants[constant_idx_to_array_idx(s)]);
        }
    }

    sons
}

/// Evaluates a circuit with the given input and constants
///
/// # Arguments
/// * `input` - Input values for the circuit
/// * `compiled_circuit` - Circuit with constants to evaluate
///
/// # Returns
/// Vector of evaluated values for each gate in the circuit
pub fn evaluate_circuit_internal(
    input: &[Vec<u8>],
    compiled_circuit: CompiledCircuitWithConstants,
) -> Vec<Vec<u8>> {
    let instructions = version_instructions(compiled_circuit.version as usize);

    let mut evaluated_circuit: Vec<Vec<u8>> = Vec::with_capacity(compiled_circuit.circuit.len());

    for i in 0..input.len() {
        if !compiled_circuit.circuit[i].is_dummy() {
            die(&format!("The ciphertext is too large, the number of blocks for the cipher text in this circuit should be {}", i));
        }
        evaluated_circuit.push(input[i].clone());
    }

    for gate in &compiled_circuit.circuit[input.len()..] {
        if gate.is_dummy() {
            die("The ciphertext is too small");
        }
        let sons = get_evaluated_sons(gate, &evaluated_circuit, &compiled_circuit.constants);

        let op = instructions[gate.opcode as usize];

        evaluated_circuit.push(op(&sons));
    }

    evaluated_circuit
}
