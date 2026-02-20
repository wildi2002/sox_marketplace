#!/bin/bash

set -e

echo "=================================================================================="
echo "🔄 COMPLETE ALTO BUNDLER RESET"
echo "=================================================================================="
echo ""

# 1. Stop all processes
echo "📋 STEP 1: Stopping all processes"
echo "   Stop manually:"
echo "   - Bundler (Ctrl+C in its terminal)"
echo "   - Next.js (Ctrl+C in its terminal)"
echo "   - Hardhat node (Ctrl+C in its terminal)"
echo ""
read -p "Press Enter when everything is stopped..."

# 2. Clean bundler
echo ""
echo "📋 STEP 2: Cleaning bundler"
cd bundler-alto

if [ -d "node_modules" ]; then
    echo "   Removing node_modules..."
    rm -rf node_modules
fi

if [ -d ".pnpm-store" ]; then
    echo "   Removing .pnpm-store..."
    rm -rf .pnpm-store
fi

if [ -f "pnpm-lock.yaml" ]; then
    echo "   Removing pnpm-lock.yaml..."
    rm -f pnpm-lock.yaml
fi

# Clean builds
if [ -d "src/esm" ]; then
    echo "   Removing builds..."
    rm -rf src/esm
fi

if [ -d "dist" ]; then
    echo "   Removing dist..."
    rm -rf dist
fi

echo "   ✅ Cleanup completed"
cd ..

# 3. Reinstall bundler
echo ""
echo "📋 STEP 3: Reinstalling bundler"
cd bundler-alto

echo "   Installing dependencies with pnpm..."
pnpm install

echo "   Building bundler..."
pnpm run build:all

echo "   ✅ Reinstallation completed"
cd ..

# 4. Check configuration
echo ""
echo "📋 STEP 4: Checking configuration"
CONFIG_FILE="bundler-alto/scripts/config.local.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "   ❌ Configuration file not found: $CONFIG_FILE"
    echo "   💡 Create it manually or use deployment script"
else
    echo "   ✅ Configuration file found"
    echo "   Verify that 'rpc-url' is 'http://127.0.0.1:8545'"
    grep -q "127.0.0.1:8545" "$CONFIG_FILE" && echo "   ✅ RPC URL correct" || echo "   ⚠️  RPC URL needs verification"
fi

# 5. Final instructions
echo ""
echo "=================================================================================="
echo "✅ RESET COMPLETED"
echo "=================================================================================="
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. Start Hardhat node:"
echo "   cd src/hardhat"
echo "   npx hardhat node"
echo ""
echo "2. In another terminal, deploy EntryPoint (if needed):"
echo "   cd src/hardhat"
echo "   npm run deploy:entrypoint:bundler"
echo ""
echo "3. In another terminal, start bundler:"
echo "   cd bundler-alto"
echo "   ./run-local.sh"
echo ""
echo "4. In another terminal, start Next.js:"
echo "   cd src"
echo "   npm run dev"
echo ""
echo "5. Deploy a NEW contract via web interface"
echo ""
echo "6. Try sending the UserOperation"
echo ""
echo "💡 If problem persists, run diagnostics:"
echo "   cd src/hardhat"
echo "   CONTRACT_ADDRESS=0x... npx hardhat run scripts/debugBundlerIssue.ts --network localhost"
echo ""
