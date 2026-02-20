# Complete Installation Guide - SOX Implementation

This guide will help you install and run the SOX project from scratch on a new machine.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Alto Bundler Installation (Detailed)](#-alto-bundler-installation-detailed)
4. [Configuration](#configuration)
5. [Contract Deployment](#contract-deployment)
6. [Starting Services](#starting-services)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)
9. [Important Modifications](#important-modifications)

---

## 🔧 Prerequisites

### Required Software

1. **Node.js** >= 22.13.1
   ```bash
   # Check version
   node -v
   
   # Install Node.js if needed
   # macOS: brew install node@22
   # Linux: https://nodejs.org/
   ```

2. **npm** (included with Node.js)
   ```bash
   npm -v
   ```

3. **Rust/Cargo** (to compile WASM binary)
   ```bash
   # Check if installed
   cargo --version
   
   # Install Rust if needed
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

4. **sqlite3** (for database)
   ```bash
   # Check if installed
   sqlite3 --version
   
   # Install if needed
   # macOS: brew install sqlite3
   # Linux: sudo apt-get install sqlite3
   ```

5. **pnpm** (will be installed automatically if missing)
   ```bash
   npm install -g pnpm
   ```

6. **Foundry (forge)** (will be installed automatically for Alto)
   ```bash
   # Will be installed via foundryup in install-alto.sh
   ```

---

## 🚀 Installation

### Step 1: Clone the project

```bash
git clone <REPO_URL>
cd sox_implementation
```

### Step 2: Run the installation script

The `install.sh` script automatically installs all dependencies:

```bash
chmod +x install.sh
./install.sh
```

**This script does:**
- ✅ Checks prerequisites (Node.js, Rust, sqlite3, pnpm)
- ✅ Installs root dependencies (npm install)
- ✅ Installs additional tools (tsx, typescript)
- ✅ Installs desktop dependencies (cd desktop && npm install)
- ✅ Installs Hardhat dependencies (cd src/hardhat && npm install)
- ✅ Compiles Rust binary `precontract_cli` (src/wasm/target/release/precontract_cli)
- ✅ Initializes SQLite database
- ✅ Installs pnpm globally if needed
- ✅ **Installs and configures Alto bundler** (see details below)

### Alto Bundler Installation

The `install.sh` script automatically calls `install-alto.sh` which:

1. **Checks and installs Foundry (forge)** if needed
   - Foundry is required to compile Alto contracts
   - Installation via `foundryup` (curl -L https://foundry.paradigm.xyz | bash)

2. **Clones Alto repository** if `bundler-alto` directory is empty or missing
   - Clones from: https://github.com/pimlicolabs/alto.git

3. **Installs pnpm dependencies** for the bundler
   - Runs `pnpm install` in `bundler-alto/`

4. **Builds Alto bundler**
   - Compiles Solidity contracts with Foundry
   - Builds TypeScript code
   - Creates `alto` binary or files in `src/esm/`

**Bundler installation verification:**

After installation, you can verify everything is in place:

```bash
# Check that directory exists
ls -la bundler-alto/

# Check that dependencies are installed
ls -la bundler-alto/node_modules/

# Check that bundler is built
ls -la bundler-alto/alto
# or
ls -la bundler-alto/src/esm/cli/alto.js

# Check that Foundry is installed
forge --version
```

**Important note:** If bundler installation fails, you can install it manually:

```bash
./install-alto.sh
```

**Note:** If you encounter npm permission errors, you can run:
```bash
sudo ./install.sh
```

---

## 📦 Alto Bundler Installation (Detailed)

If the `install.sh` script worked correctly, the Alto bundler is already installed. This section explains what happens during installation.

### What `install-alto.sh` does

The `install-alto.sh` script (called automatically by `install.sh`) performs the following steps:

1. **Foundry (forge) Installation**
   ```bash
   # If forge is not installed, the script:
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
   - Foundry is necessary to compile Alto's Solidity contracts
   - Installation in `$HOME/.foundry/bin/`

2. **Alto Repository Cloning**
   ```bash
   # If bundler-alto is empty or missing:
   git clone https://github.com/pimlicolabs/alto.git bundler-alto
   ```

3. **Dependencies Installation**
   ```bash
   cd bundler-alto
   pnpm install
   ```
   - Installs all required Node.js/pnpm dependencies

4. **Bundler Build**
   ```bash
   pnpm build:all
   ```
   - Compiles Solidity contracts with Foundry
   - Builds TypeScript code
   - Generates executable binary

### Verify bundler installation

After installation, verify everything is in place:

```bash
# 1. Check that directory exists
ls -la bundler-alto/

# 2. Check that dependencies are installed
ls -la bundler-alto/node_modules/ | head -5

# 3. Check that bundler is built
# Option 1: alto binary
ls -lh bundler-alto/alto

# Option 2: Compiled files
ls -la bundler-alto/src/esm/cli/alto.js

# 4. Check that Foundry is installed
forge --version
# Should display: forge 0.x.x
```

### Manual Installation (if needed)

If automatic installation failed, you can install the bundler manually:

```bash
# 1. Install Foundry
curl -L https://foundry.paradigm.xyz | bash
source $HOME/.foundry/bin/foundryup

# 2. Install bundler
./install-alto.sh

# Or manually:
cd bundler-alto
pnpm install
export PATH="$HOME/.foundry/bin:$PATH"
pnpm build:all
cd ..
```

---

## ⚙️ Configuration

### Step 1: Create missing configuration files

#### 1.1 `deployed-contracts.json` file at root

```bash
echo '{}' > deployed-contracts.json
```

#### 1.2 `deployed-contracts.json` file in `src/`

```bash
echo '{}' > src/deployed-contracts.json
```

These files will be automatically filled during contract deployment.

#### 1.3 Alto Bundler Configuration

The `bundler-alto/scripts/config.local.json` file must be configured with:

```json
{
    "network-name": "local",
    "rpc-url": "http://127.0.0.1:8545",
    "min-entity-stake": 1,
    "min-executor-balance": "1000000000000000000",
    "min-entity-unstake-delay": 1,
    "max-bundle-wait": 3,
    "max-bundle-size": 3,
    "port": 4337,
    "executor-private-keys": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "utility-private-key": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "entrypoints": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    "pimlico-simulation-contract": "0x998abeb3E57409262aE5b751f60747921B33613E",
    "deploy-simulations-contract": false,
    "enable-debug-endpoints": true,
    "enable-cors": true,
    "expiration-check": false,
    "safe-mode": false,
    "api-version": "v1,v2",
    "public-client-log-level": "info",
    "entrypoint-simulation-contract-v8": "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49"
}
```

**Important points:**
- `entrypoints`: Canonical EntryPoint v0.8 address (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`)
- `enable-cors`: **MUST be `true`** to allow requests from Next.js
- `deploy-simulations-contract`: **MUST be `false`** (contracts are deployed via Hardhat)
- `port`: Port on which bundler listens (4337 by default)

---

## 📦 Contract Deployment

### Step 1: Start Hardhat node

In a **first terminal**, start the local blockchain node:

```bash
cd src/hardhat
npx hardhat node
```

Keep this terminal open. Hardhat node listens on `http://localhost:8545`.

### Step 2: Deploy contracts

In a **second terminal**, deploy all contracts:

```bash
# From project root
./deploy-all.sh
```

**This script does:**
1. ✅ Checks that Hardhat node is running
2. ✅ Creates bundler structure if needed
3. ✅ Deploys EntryPoint v0.8 (canonical) via `deployEntryPointV8.ts`
4. ✅ Deploys Pimlico simulation contracts
5. ✅ Deploys EntryPoint v0.8 simulation contracts
6. ✅ Deploys all SOX contracts via `deployCompleteStack.ts`
   - Automatically generates `deployed-contracts.json` with all addresses

**Alternative:** You can also use:
```bash
./deploy-contracts.sh
```

### Step 3: Verify deployment

Check that the `deployed-contracts.json` file has been created and filled:

```bash
cat deployed-contracts.json
```

You should see addresses of deployed libraries and contracts.

---

## 🚀 Starting Services

**⚠️ IMPORTANT: Execution Order**

The order is crucial to avoid errors. Follow this exact order:

### Step 0: Deploy contracts BEFORE starting Next.js

**⚠️ CRITICAL:** Contract JSON files (`OptimisticSOXAccount.json`, etc.) are generated during deployment. If Next.js is started before deployment, Turbopack won't detect these files and you'll get errors.

```bash
# 1. First, start Hardhat node
cd src/hardhat
npx hardhat node

# 2. In another terminal, deploy contracts (from project root)
./deploy-all.sh

# 3. NOW you can start Next.js
./LANCER_APP.sh
```

### Terminal 1: Hardhat node
```bash
cd src/hardhat
npx hardhat node
```

### Terminal 2: Deploy contracts
```bash
# From project root
./deploy-all.sh
```

**This script automatically generates:**
- ✅ `deployed-contracts.json` (deployed contract addresses)
- ✅ `src/app/lib/blockchain/contracts/OptimisticSOXAccount.json` (ABI + bytecode)
- ✅ `src/app/lib/blockchain/contracts/DisputeSOXAccount.json` (ABI + bytecode)
- ✅ All other library JSON files

### Terminal 3: Alto Bundler
```bash
# From project root
./run-alto.sh
```

The bundler will be accessible at `http://localhost:4337/rpc`

### Terminal 4: Next.js Application
```bash
# From project root
./LANCER_APP.sh
```

**⚠️ Start Next.js AFTER contract deployment** so Turbopack detects generated JSON files.

The application will be accessible at `http://localhost:3000`

### Terminal 5 (Optional): Electron Desktop Application
```bash
cd desktop
npm start
```

---

## ✅ Verification

### Verify everything works

1. **Hardhat node**: Check logs in terminal 1
   - Should display "Started HTTP and WebSocket JSON-RPC server"

2. **Alto Bundler**: Test RPC endpoint
   ```bash
   curl -X POST http://localhost:4337/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
   ```
   Should return: `{"jsonrpc":"2.0","id":1,"result":"0x7a69"}`

3. **Next.js**: Open `http://localhost:3000` in your browser
   - Application should load without errors

4. **Rust Binary**: Verify it exists
   ```bash
   ls -lh src/wasm/target/release/precontract_cli
   ```
   Should display an executable file (~773KB)

---

## 🔧 Troubleshooting

### Problem 1: "Hardhat node not responding"

**Solution:**
- Verify Hardhat node is running on port 8545
- Verify no other process is using port 8545
- Restart Hardhat node

### Problem 2: "Failed to fetch" when sending UserOperation

**Solution:**
- Verify `enable-cors: true` is in `bundler-alto/scripts/config.local.json`
- Restart bundler after modifying config
- Verify bundler is listening on correct port (4337)

### Problem 3: "No deployed library addresses found"

**Solution:**
- Verify `deployed-contracts.json` exists and contains addresses
- Rerun `./deploy-all.sh` to deploy contracts
- Verify Hardhat node is running before deploying

### Problem 3a: "Module not found: Can't resolve deployed-contracts.json"

**Symptoms:**
```
Module not found: Can't resolve '../../../../deployed-contracts.json'
Module not found: Can't resolve '../../../deployed-contracts.json'
```

**Cause:**
Turbopack may have difficulty resolving JSON files outside the `src/` directory with relative paths that go beyond `src/`.

**How this error was resolved:**

The `deployCompleteStack.ts` script was modified to automatically write to **two locations**:
1. `deployed-contracts.json` at root (for compatibility)
2. `src/deployed-contracts.json` (so Next.js/Turbopack can find it)

**Immediate solution:**

1. **Verify files exist and are synchronized:**
   ```bash
   ls -la deployed-contracts.json src/deployed-contracts.json
   ```

2. **If `src/deployed-contracts.json` is empty or missing, copy from root:**
   ```bash
   cp deployed-contracts.json src/deployed-contracts.json
   ```

3. **Or better, redeploy contracts to generate both files automatically:**
   ```bash
   ./deploy-all.sh
   ```

4. **Clear Next.js cache:**
   ```bash
   rm -rf .next
   ```

5. **Restart Next.js:**
   ```bash
   ./LANCER_APP.sh
   ```

**Note:** 
- The `deployCompleteStack.ts` script now automatically generates both files (`deployed-contracts.json` at root AND `src/deployed-contracts.json`)
- If you deploy contracts with `./deploy-all.sh`, both files will be created automatically
- If you still see the error after deployment, clear Next.js cache and restart

### Problem 3b: Turbopack error "Expected module to match pattern: OptimisticSOXAccount.json"

**Solution:**
This error occurs when Turbopack doesn't correctly detect JSON files generated after contract deployment.

1. **Verify file exists:**
   ```bash
   ls -lh src/app/lib/blockchain/contracts/OptimisticSOXAccount.json
   ```

2. **Regenerate contract JSON files:**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployCompleteStack.ts --network localhost
   ```

3. **Restart Next.js** (stop with Ctrl+C and restart):
   ```bash
   ./LANCER_APP.sh
   ```

4. **If problem persists, clear Next.js cache:**
   ```bash
   rm -rf .next
   ./LANCER_APP.sh
   ```

**Note:** Contract JSON files (`OptimisticSOXAccount.json`, `DisputeSOXAccount.json`) are automatically generated by `deployCompleteStack.ts`. Make sure this script has been executed successfully.

### Problem 4: Errors during contract deployment

#### Error 4a: "EntryPoint address not found" or "EntryPoint not deployed"

**Symptoms:**
```
Error: EntryPoint address not found. Run deployEntryPointForBundler.ts first.
or
Error: EntryPoint not deployed at 0x...
```

**Possible causes:**
- Hardhat node is not running
- EntryPoint was not deployed before `deployCompleteStack.ts`
- The `deployEntryPointV8.ts` script failed silently

**Solution:**
1. **Verify Hardhat node is running:**
   ```bash
   curl http://localhost:8545
   # Should return a JSON response
   ```

2. **Deploy EntryPoint manually:**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployEntryPointV8.ts --network localhost
   ```

3. **Verify EntryPoint is deployed:**
   ```bash
   # In Hardhat console or via curl
   # Address should be: 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
   ```

4. **Rerun complete deployment:**
   ```bash
   ./deploy-all.sh
   ```

#### Error 4b: "Failed to read EntryPoint runtime code"

**Symptoms:**
```
Error: Failed to read EntryPoint runtime code
```

**Cause:**
The `deployCompleteStack.ts` script tries to deploy EntryPoint v0.8 at canonical address but cannot read runtime code.

**Solution:**
1. **Verify Alto contracts are compiled:**
   ```bash
   cd bundler-alto
   ls -la src/contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json
   ```

2. **If file doesn't exist, compile Alto contracts:**
   ```bash
   cd bundler-alto
   export PATH="$HOME/.foundry/bin:$PATH"
   pnpm build:all
   ```

3. **Rerun deployment:**
   ```bash
   ./deploy-all.sh
   ```

#### Error 4c: "hardhat_setCode" or "anvil_setCode" failed

**Symptoms:**
```
Error during hardhat_setCode or anvil_setCode call
```

**Cause:**
Script tries to deploy EntryPoint at canonical address but Hardhat/Anvil refuses.

**Solution:**
1. **Verify you're using Hardhat node (not Anvil):**
   ```bash
   # Stop Anvil if running
   # Start Hardhat node:
   cd src/hardhat
   npx hardhat node
   ```

2. **If problem persists, check permissions:**
   - Ensure Hardhat node has necessary permissions
   - Verify deployer account has enough funds

#### Error 4d: "Cannot find module" or TypeScript compilation errors

**Symptoms:**
```
Error: Cannot find module '@account-abstraction/contracts'
Error HHE22: Trying to use a non-local installation of Hardhat
or TypeScript compilation errors
```

**Cause:**
Hardhat dependencies are not installed locally in `src/hardhat/`. Hardhat requires a local installation to work correctly.

**How this error was resolved:**

The `install.sh` script automatically installs Hardhat dependencies in `src/hardhat/`:

```bash
# In install.sh (lines 121-140)
cd src/hardhat
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/hardhat" ]; then
    npm install  # Installs Hardhat locally
fi
```

**Manual solution if error persists:**

1. **Verify dependencies are installed:**
   ```bash
   cd src/hardhat
   ls -la node_modules/.bin/hardhat
   # Should display Hardhat binary
   ```

2. **If missing, reinstall Hardhat dependencies:**
   ```bash
   cd src/hardhat
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Verify Hardhat works:**
   ```bash
   npx hardhat --version
   # Should display: Hardhat 2.24.0 (or similar)
   ```

4. **Compile contracts to verify:**
   ```bash
   npx hardhat compile
   ```

5. **Rerun deployment:**
   ```bash
   cd ../..
   ./deploy-all.sh
   ```

**Important note:** 
- Hardhat MUST be installed locally in `src/hardhat/node_modules/`
- A global Hardhat installation is not sufficient
- The `install.sh` script handles this automatically, but if you skipped this step, install manually

#### Error 4e: "Nonce too high" or "Transaction underpriced"

**Symptoms:**
```
Error: nonce too high
or
Error: transaction underpriced
```

**Cause:**
Hardhat node was restarted or transactions are conflicting.

**Solution:**
1. **Restart Hardhat node cleanly:**
   ```bash
   # Stop Hardhat node (Ctrl+C)
   # Restart it:
   cd src/hardhat
   npx hardhat node
   ```

2. **Wait for Hardhat node to fully start** (message "Started HTTP...")

3. **Rerun deployment:**
   ```bash
   ./deploy-all.sh
   ```

#### Error 4f: "Library not found" or linking errors

**Symptoms:**
```
Error: Library DisputeDeployer not found
or bytecode linking errors
```

**Cause:**
Libraries were not deployed before contracts that use them.

**Solution:**
1. **Check deployment order in `deployCompleteStack.ts`**:
   - Libraries must be deployed first
   - DisputeDeployer must be deployed before OptimisticSOXAccount

2. **Rerun complete deployment** (script handles order automatically):
   ```bash
   ./deploy-all.sh
   ```

#### Error 4g: Deployment script hangs or times out

**Symptoms:**
The `deploy-all.sh` script hangs without visible error.

**Possible causes:**
- Hardhat node is not responding
- Transaction blocked
- Network issue

**Solution:**
1. **Verify Hardhat node responds:**
   ```bash
   curl -X POST http://localhost:8545 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. **Check Hardhat node logs** to see where it's stuck

3. **Restart Hardhat node** if needed:
   ```bash
   # Stop (Ctrl+C) and restart
   cd src/hardhat
   npx hardhat node
   ```

4. **Rerun deployment with more verbosity:**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployCompleteStack.ts --network localhost --verbose
   ```

#### Error 4h: "Cannot read property" or JavaScript errors in scripts

**Symptoms:**
```
TypeError: Cannot read property '...' of undefined
or JavaScript errors in deployment scripts
```

**Cause:**
Scripts try to access properties that don't exist (undeployed contracts, missing config, etc.).

**Solution:**
1. **Verify all prerequisites are met:**
   - Hardhat node running
   - Contracts compiled (`npx hardhat compile`)
   - Bundler configuration exists

2. **Run scripts in order:**
   ```bash
   # 1. EntryPoint
   npx hardhat run scripts/deployEntryPointV8.ts --network localhost
   
   # 2. Simulations
   npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost
   npx hardhat run scripts/deployEntryPointSimulationsV8.ts --network localhost
   
   # 3. Complete stack
   npx hardhat run scripts/deployCompleteStack.ts --network localhost
   ```

3. **Check logs** to identify which script fails exactly

### Problem 4: "spawn precontract_cli ENOENT"

**Solution:**
- Compile Rust binary manually:
  ```bash
  cd src/wasm
  cargo build --release --bin precontract_cli
  ```
- Verify binary exists: `ls -lh target/release/precontract_cli`

### Problem 5: "forge: command not found"

**Solution:**
- Install Foundry:
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  source $HOME/.foundry/bin/foundryup
  ```
- Add to PATH: `export PATH="$HOME/.foundry/bin:$PATH"`

### Problem 6: "EntryPoint address not found"

**Solution:**
- Verify EntryPoint v0.8 is deployed at canonical address
- Rerun `./deploy-all.sh` which now uses `deployEntryPointV8.ts`
- Verify `bundler-alto/scripts/config.local.json` contains correct EntryPoint address

### Problem 7: npm permission errors

**Solution:**
- Use `sudo` if needed: `sudo npm install`
- Or configure npm to use a local directory:
  ```bash
  mkdir ~/.npm-global
  npm config set prefix '~/.npm-global'
  export PATH=~/.npm-global/bin:$PATH
  ```

---

## 📝 Important Modifications

### 1. `install.sh` Script

**Modifications:**
- ✅ Automatically checks and installs pnpm
- ✅ Compiles Rust binary `precontract_cli`
- ✅ Initializes SQLite database
- ✅ Installs and configures Alto bundler

### 2. `deploy-all.sh` Script

**Modifications:**
- ✅ Now uses `deployEntryPointV8.ts` instead of `deployEntryPointForBundler.ts`
- ✅ Deploys canonical EntryPoint v0.8 (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`)
- ✅ Uses `deployEntryPointSimulationsV8.ts` for v0.8 simulations
- ✅ Uses `deployCompleteStack.ts` which generates `deployed-contracts.json`

### 3. `bundler-alto/scripts/config.local.json` Configuration

**Critical modifications:**
- ✅ `entrypoints`: Canonical EntryPoint v0.8 address
- ✅ `enable-cors: true` - **ESSENTIAL** for requests from Next.js
- ✅ `deploy-simulations-contract: false` - Contracts are deployed via Hardhat
- ✅ `entrypoint-simulation-contract-v8`: v0.8 simulation contract address
- ✅ `pimlico-simulation-contract`: Pimlico simulation contract address

### 4. `deployed-contracts.json` Files

**Creation:**
- ✅ `deployed-contracts.json` at root (empty initially)
- ✅ `src/deployed-contracts.json` (empty initially)
- ✅ Automatically filled by `deployCompleteStack.ts`

### 5. `run-alto.sh` Script

**Modifications:**
- ✅ Verifies bundler is built
- ✅ Verifies configuration exists
- ✅ Verifies Hardhat node is running
- ✅ Uses port from configuration

### 6. Rust Compilation

**Modifications:**
- ✅ `precontract_cli` binary is automatically compiled in `install.sh`
- ✅ Path: `src/wasm/target/release/precontract_cli`
- ✅ Required for precomputes in the application

---

## 📚 Complete Execution Order

Here is the exact order to start the project:

```bash
# 1. Installation (one time only)
./install.sh

# 2. Terminal 1: Start Hardhat node
cd src/hardhat
npx hardhat node

# 3. Terminal 2: Deploy contracts (from project root)
./deploy-all.sh

# 4. Terminal 3: Start bundler
./run-alto.sh

# 5. Terminal 4: Start Next.js
./LANCER_APP.sh

# 6. Terminal 5 (Optional): Start Electron
cd desktop && npm start
```

---

## 🎯 Verification Checklist

Before starting to use the application, verify:

- [ ] Node.js >= 22.13.1 installed
- [ ] Rust/Cargo installed
- [ ] sqlite3 installed
- [ ] `./install.sh` executed successfully
- [ ] Hardhat node running and listening on port 8545
- [ ] `./deploy-all.sh` executed successfully
- [ ] `deployed-contracts.json` contains addresses
- [ ] Alto Bundler running and listening on port 4337
- [ ] Bundler responds to RPC requests
- [ ] Next.js running and accessible at http://localhost:3000
- [ ] Rust binary `precontract_cli` exists and is executable
- [ ] `bundler-alto/scripts/config.local.json` configuration is correct
- [ ] `enable-cors: true` in bundler config

---

## 🔗 Important URLs

- **Web Application**: http://localhost:3000
- **Bundler RPC**: http://localhost:4337/rpc
- **Hardhat RPC**: http://localhost:8545
- **Bundler Health**: http://localhost:4337/health

---

## 📞 Support

If you encounter problems not covered in this guide:

1. Check logs of each service
2. Verify all ports are available
3. Verify all configuration files are correct
4. Restart services in the indicated order

---

**Last updated:** January 2025
**Version:** 1.0

