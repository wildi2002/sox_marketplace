#!/bin/bash

# Installation script for Pimlico Alto bundler for local testing

set -e

echo "🚀 Installing Pimlico Alto bundler..."

# Check that pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing..."
    npm install -g pnpm
fi

# Check that Foundry (forge) is installed
# Ensure forge is in PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

if ! command -v forge &> /dev/null; then
    echo "❌ Foundry (forge) is not installed. Installing..."
    echo "   Installing Foundry via foundryup..."
    
    # Install foundryup if necessary
    if ! command -v foundryup &> /dev/null && [ ! -f "$HOME/.foundry/bin/foundryup" ]; then
        curl -L https://foundry.paradigm.xyz | bash
        # Add foundryup to PATH for this session
        export PATH="$HOME/.foundry/bin:$PATH"
    fi
    
    # Run foundryup to install Foundry
    if command -v foundryup &> /dev/null; then
        foundryup || {
            echo "⚠️  foundryup failed. Checking if forge is already installed..."
            # Check if forge exists in foundry directory
            if [ -f "$HOME/.foundry/bin/forge" ]; then
                export PATH="$HOME/.foundry/bin:$PATH"
                echo "✅ forge found in $HOME/.foundry/bin"
            else
                echo "❌ Foundry installation failed"
                echo "   If forge is running, stop it and try again"
                echo "   Or install Foundry manually: foundryup"
                exit 1
            fi
        }
    elif [ -f "$HOME/.foundry/bin/foundryup" ]; then
        "$HOME/.foundry/bin/foundryup" || {
            echo "⚠️  foundryup failed. Checking if forge is already installed..."
            if [ -f "$HOME/.foundry/bin/forge" ]; then
                export PATH="$HOME/.foundry/bin:$PATH"
                echo "✅ forge found in $HOME/.foundry/bin"
            else
                echo "❌ Foundry installation failed"
                exit 1
            fi
        }
    fi
    
    # Check again after installation
    if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
        export PATH="$HOME/.foundry/bin:$PATH"
    fi
    
    if ! command -v forge &> /dev/null; then
        echo "⚠️  Foundry installed but forge not found in PATH"
        echo "   Please restart your terminal or run:"
        echo "   export PATH=\"\$HOME/.foundry/bin:\$PATH\""
        echo "   Then run this script again."
        exit 1
    fi
    echo "✅ Foundry installed"
else
    echo "✅ Foundry already installed: $(forge --version | head -n1)"
fi

# Clone Alto if not already done
if [ ! -d "bundler-alto" ] || [ -z "$(ls -A bundler-alto 2>/dev/null)" ]; then
    if [ -d "bundler-alto" ] && [ -z "$(ls -A bundler-alto 2>/dev/null)" ]; then
        echo "📦 bundler-alto directory is empty, cloning Pimlico Alto..."
        rm -rf bundler-alto
    else
        echo "📦 Cloning Pimlico Alto..."
    fi
    git clone https://github.com/pimlicolabs/alto.git bundler-alto
else
    echo "✅ Alto already cloned"
fi

# Install dependencies
echo "📦 Installing dependencies..."
cd bundler-alto
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.pnpm-lock.yaml" ]; then
    echo "   Installing dependencies (this may take a few minutes)..."
    pnpm install
    echo "   ✅ Dependencies installed"
else
    echo "   ✅ Dependencies already installed"
    echo "   ${YELLOW}   (Run 'pnpm install' manually if you need to update dependencies)${NC}"
fi

# Build
echo "🔨 Building..."
# Ensure forge is in PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

# Check if Alto is already built
if [ -f "alto" ] || [ -f "src/esm/cli/alto.js" ]; then
    echo "   ✅ Alto already built"
    echo "   ${YELLOW}   (Skipping build. Delete 'alto' or 'src/esm' to force rebuild)${NC}"
else
    echo "   Building Alto (this may take several minutes)..."
    pnpm build:all
    echo "   ✅ Build completed"
fi

echo "✅ Installation completed!"
echo ""
echo "To launch Alto, use the run-alto.sh script"
cd ..
