#!/bin/bash

# Script to start the Alto bundler

set -e

# Colors for messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Alto bundler...${NC}"
echo ""

# Check that we are in the correct directory
if [ ! -d "bundler-alto" ]; then
    echo -e "${RED}❌ bundler-alto directory does not exist${NC}"
    echo "   Run first: ./install-alto.sh"
    exit 1
fi

cd bundler-alto

# Check that Alto is built
if [ ! -f "alto" ] && [ ! -f "src/esm/cli/alto.js" ]; then
    echo -e "${YELLOW}⚠️  Alto is not built. Building...${NC}"
    export PATH="$HOME/.foundry/bin:$PATH"
    pnpm run build:all
fi

# Check that configuration exists
CONFIG_FILE="scripts/config.local.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚠️  Configuration file not found: $CONFIG_FILE${NC}"
    echo "   Creating default configuration..."
    mkdir -p scripts
    cat > "$CONFIG_FILE" << 'EOF'
{
    "network-name": "local",
    "rpc-url": "http://127.0.0.1:8545",
    "entrypoints": "",
    "port": 4337
}
EOF
    echo -e "${YELLOW}   ⚠️  Please update $CONFIG_FILE with the deployed EntryPoint address${NC}"
    echo ""
fi

# Check that Hardhat node is running
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Hardhat node does not seem to be running${NC}"
    echo "   Start Hardhat node in a separate terminal:"
    echo -e "   ${GREEN}cd src/hardhat && npx hardhat node${NC}"
    echo ""
    read -p "Press Enter to continue when Hardhat node is running... "
fi

# Ensure forge is in PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

# Read port from config if available
PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" | grep -o '[0-9]*' | head -n1)
if [ -z "$PORT" ]; then
    PORT=4337
fi

# Launch Alto
echo -e "${GREEN}📍 Launching Alto bundler...${NC}"
echo -e "${GREEN}   Bundler will be accessible at: http://localhost:${PORT}/rpc${NC}"
echo ""
echo -e "${YELLOW}   To stop the bundler, press Ctrl+C${NC}"
echo ""

# Use alto binary (which calls pnpm start) or directly node
if [ -f "alto" ]; then
    ./alto --config scripts/config.local.json
elif [ -f "src/esm/cli/alto.js" ]; then
    node src/esm/cli/alto.js run --config scripts/config.local.json
else
    echo -e "${RED}❌ Cannot find Alto binary${NC}"
    echo "   Try building: pnpm run build:all"
    exit 1
fi
