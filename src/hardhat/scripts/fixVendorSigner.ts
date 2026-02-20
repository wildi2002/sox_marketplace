import hre from "hardhat";
import { ethers } from "hardhat";

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/fixVendorSigner.ts --network localhost <contractAddress> <vendorPrivateKey>");
        process.exit(1);
    }
    
    const contractAddress = args[0];
    const vendorPrivateKey = args[1];
    
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🔍 vendorSigner diagnostic");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddress);
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function setVendorSigner(address) external",
        "function addSessionKey(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddress, accountAbi, sponsor);
    
    const vendorSigner = await contract.vendorSigner();
    const vendor = await contract.vendor();
    
    console.log("📋 Current contract state:");
    console.log("   vendor:", vendor);
    console.log("   vendorSigner:", vendorSigner);
    console.log("");
    
    const vendorWallet = new ethers.Wallet(vendorPrivateKey, ethers.provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("📋 Vendor information:");
    console.log("   Vendor address (from private key):", vendorAddress);
    console.log("   Matches contract vendor?", vendorAddress.toLowerCase() === vendor.toLowerCase());
    console.log("   Matches vendorSigner?", vendorAddress.toLowerCase() === vendorSigner.toLowerCase());
    console.log("");
    
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    console.log("📋 Session key:");
    console.log("   Is authorized session key?", isSessionKey);
    console.log("");
    
    if (vendorAddress.toLowerCase() === vendorSigner.toLowerCase()) {
        console.log("✅ vendorSigner already matches vendor!");
        console.log("   Problem might be elsewhere (signature, hash, etc.)");
    } else if (isSessionKey) {
        console.log("✅ Vendor is an authorized session key!");
        console.log("   Problem might be elsewhere (signature, hash, etc.)");
    } else {
        console.log("❌ PROBLEM DETECTED:");
        console.log("   vendorSigner does not match vendor and it's not a session key!");
        console.log("");
        console.log("💡 Possible solutions:");
        console.log("   1. Update vendorSigner to match vendor");
        console.log("   2. Add vendor as session key");
        console.log("");
        
        console.log("🔧 Automatic fix:");
        console.log("   Option 1: Update vendorSigner...");
        
        try {
            console.log("   ⚠️  To update vendorSigner, vendor must call setVendorSigner()");
            console.log("   Or use a session key instead.");
            console.log("");
            
            console.log("   Option 2: Add as session key (recommended)...");
            const addSessionKeyTx = await contract.connect(sponsor).addSessionKey(vendorAddress);
            console.log("   Transaction sent:", addSessionKeyTx.hash);
            const receipt = await addSessionKeyTx.wait();
            console.log("   ✅ Session key added successfully!");
            console.log("   Block:", receipt?.blockNumber);
            console.log("");
            console.log("📋 New state:");
            const newIsSessionKey = await contract.sessionKeys(vendorAddress);
            console.log("   Is authorized session key?", newIsSessionKey);
        } catch (error: any) {
            console.error("   ❌ Error adding session key:", error.message);
            if (error.message?.includes("Only sponsor")) {
                console.error("   ⚠️  Only sponsor can add session keys");
            }
        }
    }
    
    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Diagnostic completed");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
