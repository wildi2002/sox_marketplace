# 🚀 Quick Start - SOX Implementation

Quick guide to get started with the SOX project.

## Quick Installation

```bash
# 1. Install all dependencies
./install.sh

# 2. In Terminal 1: Start Hardhat node
cd src/hardhat && npx hardhat node

# 3. In Terminal 2: Deploy contracts
./deploy-all.sh

# 4. In Terminal 3: Start the bundler
./run-alto.sh

# 5. In Terminal 4: Start Next.js
npm run dev

# 6. In Terminal 5 (Optional): Start Electron Desktop
# ⚠️ IMPORTANT: Next.js must be running BEFORE Electron
cd desktop && npm start
```

## Access

- **Web Application**: http://localhost:3000
- **Bundler RPC**: http://localhost:4337/rpc

## Complete Guide

For a detailed guide with all steps, configurations, and troubleshooting, see **[INSTALLATION_GUIDE_COMPLETE.md](./INSTALLATION_GUIDE_COMPLETE.md)**

## Prerequisites

- Node.js >= 22.13.1
- Rust/Cargo (to compile WASM binary)
- sqlite3 (for database)
- pnpm (installed automatically)

## Common Issues

### "Failed to fetch"
→ Check that `enable-cors: true` is in `bundler-alto/scripts/config.local.json` and restart the bundler

### "No deployed library addresses found"
→ Run `./deploy-all.sh` again to deploy contracts

### "spawn precontract_cli ENOENT"
→ Compile the Rust binary: `cd src/wasm && cargo build --release --bin precontract_cli`

For more details, see the [Complete Guide](./INSTALLATION_GUIDE_COMPLETE.md)
