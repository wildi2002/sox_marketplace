#!/bin/bash

# Script to launch Anvil (Foundry) instead of Hardhat node
# Anvil has better support for tracers needed for Alto

set -e

echo "🚀 Starting Anvil (Foundry node)..."

# Launch Anvil with same parameters as Hardhat node
anvil \
  --host 127.0.0.1 \
  --port 8545 \
  --chain-id 31337 \
  --block-time 1 \
  --gas-limit 30000000
