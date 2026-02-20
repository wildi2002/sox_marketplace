# 🚀 Contract Redeployment Guide

## ✅ Fix Applied

The `require(false)` issue when sending vendor sponsor fees has been fixed in:
- **OptimisticSOXAccount.sol**: Pass `msg.sender` directly to constructor
- **DisputeSOXAccount.sol**: Validate that `buyerDisputeSponsor` and `vendorDisputeSponsor` are defined

## 📋 How to Redeploy

### Simple Method (Recommended)

**Simply run this script which does everything automatically**:

```bash
# From project root
cd src/hardhat
npx hardhat run scripts/deployCompleteStack.ts --network localhost
```

This script will automatically:
1. ✅ Compile all contracts (with fixes)
2. ✅ Deploy all required libraries
3. ✅ Deploy DisputeDeployer (with linked libraries)
4. ✅ Deploy EntryPoint (ERC-4337)
5. ✅ Copy ABI/JSON to `src/app/lib/blockchain/contracts/`
6. ✅ Update bundler config
7. ✅ Create/update `.env.local` with new addresses

### After Deployment

1. **Restart web application**:
```bash
# From project root
# Stop app if running (Ctrl+C)
npm run dev
```

2. **Restart bundler** (if needed):
```bash
# Bundler should automatically use new config
# Otherwise, restart bundler manually
```

3. **Test with a new contract**:
   - Create a **new contract** via web interface
   - Old contracts will **not** be automatically updated
   - You must create new contracts with the newly deployed version

## ⚠️ Important

- Contracts deployed **before** this redeployment will continue using the old version
- You must create **new contracts** to benefit from the fixes
- Existing old contracts will **not** be affected by this redeployment

## 🧪 Verification

To verify everything works:

```bash
# From project root
cd src/hardhat
npx hardhat run scripts/testDeployOptimisticSOXAccount.ts --network localhost
```

This script will deploy a test contract and verify everything works correctly.
