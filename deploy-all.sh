#!/bin/bash

# Script to deploy the complete SOX application
# This script deploys all necessary contracts in the correct order

set -e

echo "🚀 Deploying SOX Application"
echo "============================="
echo ""

# Colors for messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0
    else
        return 1
    fi
}

# Step 1: Check that Hardhat node is running
echo "📡 Step 1: Checking Hardhat node..."
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Hardhat node is not running${NC}"
    echo ""
    echo "Start Hardhat node in a separate terminal:"
    echo -e "${GREEN}  cd src/hardhat && npx hardhat node${NC}"
    echo ""
    echo "Then run this script again."
    exit 1
fi
echo -e "${GREEN}✅ Hardhat node is active${NC}"
echo ""

# Step 2: Check/Create bundler structure
echo "📝 Step 2: Preparing environment..."
if [ ! -d "bundler-alto/scripts" ]; then
    echo "  - Creating bundler structure..."
    mkdir -p bundler-alto/scripts
    # Create minimal config.local.json if needed
    if [ ! -f "bundler-alto/scripts/config.local.json" ]; then
        echo '{}' > bundler-alto/scripts/config.local.json
    fi
fi

# Step 3: Deploy contracts
echo "📝 Step 3: Deploying contracts..."
cd src/hardhat

# Deploy EntryPoint v0.8 (canonical)
echo "  - Deploying EntryPoint v0.8..."
if ! npx hardhat run scripts/deployEntryPointV8.ts --network localhost; then
    echo -e "${RED}❌ Failed to deploy EntryPoint v0.8${NC}"
    echo -e "${YELLOW}   Check that Hardhat node is running${NC}"
    exit 1
fi

# Deploy simulation contracts
echo "  - Deploying simulation contracts..."
npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost || echo -e "${YELLOW}   ⚠️  Pimlico simulation ignored${NC}"
npx hardhat run scripts/deployEntryPointSimulationsV8.ts --network localhost || echo -e "${YELLOW}   ⚠️  EntryPoint v0.8 simulation ignored${NC}"

# Deploy all other contracts (deployCompleteStack generates deployed-contracts.json)
echo "  - Deploying all contracts..."
if ! npx hardhat run scripts/deployCompleteStack.ts --network localhost; then
    echo -e "${RED}❌ Failed to deploy contracts${NC}"
    exit 1
fi

cd ../..
echo -e "${GREEN}✅ Contracts deployed${NC}"
echo ""

# Step 4: Check that bundler can start
echo "🔌 Step 4: Checking bundler..."
if check_port 3002; then
    echo -e "${YELLOW}⚠️  Port 3002 is already in use (bundler may already be running)${NC}"
else
    echo -e "${GREEN}✅ Port 3002 is available${NC}"
fi
echo ""

# Step 5: Check that Next.js can start
echo "🌐 Step 5: Checking Next.js..."
if check_port 3000; then
    echo -e "${YELLOW}⚠️  Port 3000 is already in use (Next.js may already be running)${NC}"
else
    echo -e "${GREEN}✅ Port 3000 is available${NC}"
fi
echo ""

echo "============================="
echo -e "${GREEN}✅ Deployment completed!${NC}"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Start the bundler in a terminal:"
echo -e "   ${GREEN}./run-alto.sh${NC}"
echo ""
echo "2. Start Next.js in another terminal:"
echo -e "   ${GREEN}npm run dev${NC}"
echo ""
echo "3. (Optional) Start Electron in another terminal:"
echo -e "   ${GREEN}cd desktop && npm start${NC}"
echo ""
echo "🌐 The application will be accessible at:"
echo "   - Web: http://localhost:3000"
echo "   - Bundler: http://localhost:4337/rpc"
echo ""
