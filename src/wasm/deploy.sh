#!/bin/bash

# Set the default directory
DEFAULT_DIR="../app/lib/crypto_lib"

# Assign the first argument to the variable 'dir' or use the default
DIR=${1:-$DEFAULT_DIR}

# Run the wasm-pack build command with the specified directory
RUSTFLAGS='--cfg getrandom_backend="wasm_js"' wasm-pack build --target web --out-dir "$DIR"
