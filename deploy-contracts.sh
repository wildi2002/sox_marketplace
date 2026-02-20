#!/bin/bash

# Script to deploy all SOX contracts
# This script deploys all necessary contracts in the correct order

set -e

echo "🚀 Deploying all SOX contracts"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check that Hardhat node is running
echo "📡 Checking Hardhat node..."
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${RED}❌ Hardhat node is not running${NC}"
    echo ""
    echo "Start Hardhat node in a separate terminal:"
    echo -e "${GREEN}  cd src/hardhat && npx hardhat node${NC}"
    echo ""
    exit 1
fi
echo -e "${GREEN}✅ Hardhat node is active${NC}"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/src/hardhat"

# Step 1: Deploy EntryPoint v0.8 (canonical)
echo "📝 Step 1: Deploying EntryPoint v0.8..."
npx hardhat run scripts/deployEntryPointV8.ts --network localhost
echo ""

# Step 2: Deploy simulation contracts for bundler
echo "📝 Step 2: Deploying simulation contracts..."
npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost
echo ""
echo "📝 Step 2b: Deploying v0.8 simulation contract..."
npx hardhat run scripts/deployEntryPointSimulationsV8.ts --network localhost
echo ""

# Step 3: Deploy all libraries and main contracts + generate JSON files
echo "📝 Step 3: Deploying all SOX contracts and generating JSON files..."
npx hardhat run scripts/deployCompleteStack.ts --network localhost
echo ""

# Step 4: Deploy EIP-7702 delegate
echo "📝 Step 4: Deploying EIP-7702 delegate..."
npx hardhat run scripts/deployEip7702Delegate.ts --network localhost
echo ""

cd "$ROOT_DIR"

echo "========================================"
echo -e "${GREEN}✅ All contracts have been deployed successfully!${NC}"
echo ""
echo "📋 Next steps:"
echo "  1. Start bundler: cd bundler-alto && ./run-local.sh"
echo "  2. Start Next.js: npm run dev"
echo ""
