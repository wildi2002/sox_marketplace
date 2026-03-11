#!/bin/bash

# Installation script for SOX Implementation
# This script installs all dependencies and sets up the project
# 
# Features:
# - Checks prerequisites (Node.js, Rust, sqlite3, pnpm, Foundry)
# - Installs dependencies only if needed (skips if already installed)
# - Compiles Rust binary only if missing
# - Sets up Alto bundler only if not already installed
# - Can be run multiple times safely (idempotent)

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 SOX Implementation - Installation Script${NC}"
echo ""

# Check prerequisites
echo -e "${GREEN}1. Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js >= 22.13.1${NC}"
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo -e "${YELLOW}⚠️  Warning: Node.js version should be >= 22.13.1 (current: $(node -v))${NC}"
fi
echo -e "   ✅ Node.js: $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi
echo -e "   ✅ npm: $(npm -v)"

# Check Rust/Cargo (for WASM compilation)
if ! command -v cargo &> /dev/null; then
    echo -e "${YELLOW}⚠️  Warning: Rust/Cargo is not installed. WASM compilation will be skipped.${NC}"
    echo -e "   Install Rust from: https://rustup.rs/"
    RUST_AVAILABLE=false
else
    echo -e "   ✅ Rust/Cargo: $(cargo --version)"
    RUST_AVAILABLE=true
fi

# Check sqlite3
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${YELLOW}⚠️  Warning: sqlite3 is not installed. Database initialization will be skipped.${NC}"
    SQLITE_AVAILABLE=false
else
    echo -e "   ✅ sqlite3: $(sqlite3 --version | head -n1)"
    SQLITE_AVAILABLE=true
fi

# Check pnpm (for Alto bundler)
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}   pnpm not found, will install it globally...${NC}"
    INSTALL_PNPM=true
else
    echo -e "   ✅ pnpm: $(pnpm -v)"
    INSTALL_PNPM=false
fi

echo ""

# Install root dependencies
echo -e "${GREEN}2. Installing root dependencies...${NC}"
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    echo -e "   Installing root dependencies (this may take a few minutes)..."
    npm install
    echo -e "   ✅ Root dependencies installed"
else
    echo -e "   ✅ Root dependencies already installed"
    echo -e "   ${YELLOW}   (Run 'npm install' manually if you need to update dependencies)${NC}"
fi

# Install additional tools
echo -e "${GREEN}3. Installing additional tools (tsx, typescript)...${NC}"
if ! command -v tsx &> /dev/null || ! command -v tsc &> /dev/null; then
    npm install tsx typescript
    echo -e "   ✅ Additional tools installed"
else
    echo -e "   ✅ Additional tools already installed"
fi

# Install desktop dependencies
echo -e "${GREEN}4. Installing desktop dependencies (including Electron)...${NC}"
if [ -d "desktop" ]; then
    cd desktop
    # Vérifier si Electron est installé spécifiquement
    ELECTRON_INSTALLED=false
    if [ -d "node_modules" ] && [ -d "node_modules/electron" ]; then
        ELECTRON_INSTALLED=true
    fi
    
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ] || [ "$ELECTRON_INSTALLED" = false ]; then
        if [ "$ELECTRON_INSTALLED" = false ] && [ -d "node_modules" ]; then
            echo -e "   ${YELLOW}⚠️  Electron not found, reinstalling dependencies...${NC}"
        else
            echo -e "   Installing desktop dependencies (including Electron)..."
        fi
        npm install
        echo -e "   ✅ Desktop dependencies installed (Electron included)"
    else
        echo -e "   ✅ Desktop dependencies already installed (Electron verified)"
    fi
    cd ..
else
    echo -e "   ${YELLOW}⚠️  Desktop directory not found, skipping...${NC}"
fi

# Install hardhat dependencies
echo -e "${GREEN}5. Installing Hardhat dependencies...${NC}"
if [ -d "src/hardhat" ]; then
    cd src/hardhat
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/hardhat" ]; then
        echo -e "   Installing Hardhat dependencies (this may take a few minutes)..."
        if npm install; then
            echo -e "   ✅ Hardhat dependencies installed"
        else
            echo -e "   ${RED}❌ Failed to install Hardhat dependencies${NC}"
            echo -e "   ${YELLOW}   Please run manually: cd src/hardhat && npm install${NC}"
            exit 1
        fi
    else
        echo -e "   ✅ Hardhat dependencies already installed"
    fi
    cd ../..
else
    echo -e "   ${YELLOW}⚠️  Hardhat directory not found, skipping...${NC}"
fi

# Compile Rust binary
if [ "$RUST_AVAILABLE" = true ]; then
    echo -e "${GREEN}6. Compiling Rust/WASM binary...${NC}"
    if [ -d "src/wasm" ]; then
        cd src/wasm
        BINARY_PATH="target/release/precontract_cli"
        if [ -f "$BINARY_PATH" ]; then
            echo -e "   ✅ Rust binary already exists: $BINARY_PATH"
            echo -e "   ${YELLOW}   (Skipping compilation. Delete the binary to force recompilation)${NC}"
        else
            echo -e "   Compiling precontract_cli (this may take a few minutes)..."
            if cargo build --release --bin precontract_cli; then
                if [ -f "$BINARY_PATH" ]; then
                    echo -e "   ✅ Rust binary compiled successfully"
                else
                    echo -e "   ${YELLOW}⚠️  Compilation succeeded but binary not found${NC}"
                fi
            else
                echo -e "   ${RED}❌ Rust compilation failed${NC}"
                echo -e "   ${YELLOW}   Continuing without the binary...${NC}"
            fi
        fi
        cd ../..
    else
        echo -e "   ${YELLOW}⚠️  WASM directory not found, skipping...${NC}"
    fi
else
    echo -e "${YELLOW}6. Skipping Rust compilation (Cargo not available)...${NC}"
fi

# Compile ZK host binary
if [ "$RUST_AVAILABLE" = true ]; then
    echo -e "${GREEN}7. Compiling ZK host binary (zk-host)...${NC}"
    if [ -d "src/zk" ]; then
        cd src/zk
        ZK_BINARY="target/release/zk-host"
        if [ -f "$ZK_BINARY" ]; then
            echo -e "   ✅ zk-host already compiled: $ZK_BINARY"
            echo -e "   ${YELLOW}   (Delete to force recompilation)${NC}"
        else
            echo -e "   Compiling zk-host (this may take several minutes)..."
            echo -e "   ${YELLOW}   The guest ELF is pre-compiled; only standard Rust is needed.${NC}"
            if cargo build --release -p zk-host; then
                echo -e "   ✅ zk-host compiled successfully"
            else
                echo -e "   ${RED}❌ zk-host compilation failed${NC}"
                echo -e "   ${YELLOW}   ZK proof generation will be unavailable.${NC}"
                echo -e "   ${YELLOW}   Run manually: cd src/zk && cargo build --release -p zk-host${NC}"
            fi
        fi
        cd ../..
    else
        echo -e "   ${YELLOW}⚠️  src/zk directory not found, skipping...${NC}"
    fi
else
    echo -e "${YELLOW}7. Skipping zk-host compilation (Cargo not available)...${NC}"
fi

# Initialize database
if [ "$SQLITE_AVAILABLE" = true ]; then
    echo -e "${GREEN}8. Initializing database...${NC}"
    if [ -f "src/app/db/init.sql" ]; then
        mkdir -p src/app/db
        if [ ! -f "src/app/db/sox.sqlite" ]; then
            touch src/app/db/sox.sqlite
            sqlite3 src/app/db/sox.sqlite < src/app/db/init.sql
            echo -e "   ✅ Database initialized"
        else
            echo -e "   ✅ Database already exists"
        fi
    else
        echo -e "   ${YELLOW}⚠️  init.sql not found, skipping database initialization...${NC}"
    fi
else
    echo -e "${YELLOW}8. Skipping database initialization (sqlite3 not available)...${NC}"
fi

# Install pnpm if needed
if [ "$INSTALL_PNPM" = true ]; then
    echo -e "${GREEN}9. Installing pnpm globally...${NC}"
    npm install -g pnpm
    echo -e "   ✅ pnpm installed"
else
    echo -e "${GREEN}9. pnpm already installed${NC}"
fi

# Install Alto bundler
echo -e "${GREEN}10. Setting up Alto bundler...${NC}"
if [ -f "install-alto.sh" ]; then
    # Vérifier si Alto est déjà installé et construit
    if [ -d "bundler-alto" ] && [ -d "bundler-alto/node_modules" ] && ([ -f "bundler-alto/alto" ] || [ -f "bundler-alto/src/esm/cli/alto.js" ]); then
        echo -e "   ✅ Alto bundler already installed and built"
        echo -e "   ${YELLOW}   (Skipping installation. Delete bundler-alto/ to force reinstall)${NC}"
    else
        chmod +x install-alto.sh
        ./install-alto.sh
        echo -e "   ✅ Alto bundler setup complete"
    fi
else
    echo -e "   ${YELLOW}⚠️  install-alto.sh not found, skipping Alto setup...${NC}"
    echo -e "   ${YELLOW}   You can install Alto manually later${NC}"
fi

echo ""
echo -e "${GREEN}=================================================================================="
echo -e "✅ Installation completed successfully!${NC}"
echo -e "${GREEN}=================================================================================="
echo ""
echo -e "${GREEN}📋 Next steps:${NC}"
echo ""
echo -e "1. Start a local blockchain node:"
echo -e "   ${YELLOW}cd src/hardhat && npx hardhat node${NC}"
echo ""
echo -e "2. Deploy contracts (in a new terminal):"
echo -e "   ${YELLOW}./deploy-all.sh${NC}"
echo ""
echo -e "3. Start the bundler (in a new terminal):"
echo -e "   ${YELLOW}./run-alto.sh${NC}"
echo ""
echo -e "4. Start the web application (in a new terminal):"
echo -e "   ${YELLOW}./LANCER_APP.sh${NC}"
#echo -e "   ${YELLOW}npm run dev${NC}"
#echo ""
#echo -e "Or use the convenience script to start everything:"
#echo -e "   ${YELLOW}./START_ALL.sh${NC}"
#echo ""

