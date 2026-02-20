import hre from "hardhat";
import { ethers } from "hardhat";

async function main() {
    const contractAddress = process.env.CONTRACT || "0x610178da211fef7d417bc0e6fed39f05609ad788";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🔧 Fixing contract for vendor");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddress);
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    const vendorWallet = new ethers.Wallet(vendorPrivateKey, ethers.provider);
    const vendorAddress = await vendorWallet.getAddress();
    console.log("Vendor address:", vendorAddress);
    console.log("");
    
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function addSessionKey(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddress, accountAbi, sponsor);
    
    const vendorSigner = await contract.vendorSigner();
    const vendor = await contract.vendor();
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    
    console.log("📋 Current state:");
    console.log("   vendor:", vendor);
    console.log("   vendorSigner:", vendorSigner);
    console.log("   vendorAddress:", vendorAddress);
    console.log("   Is session key?", isSessionKey);
    console.log("");
    
    if (vendorAddress.toLowerCase() === vendorSigner.toLowerCase()) {
        console.log("✅ vendorSigner already matches vendor!");
        return;
    }
    
    if (isSessionKey) {
        console.log("✅ Vendor is already an authorized session key!");
        return;
    }
    
    console.log("🔧 Adding vendor as session key...");
    try {
        const tx = await contract.connect(sponsor).addSessionKey(vendorAddress);
        console.log("   Transaction sent:", tx.hash);
        await tx.wait();
        console.log("✅ Session key added successfully!");
        
        const newIsSessionKey = await contract.sessionKeys(vendorAddress);
        if (newIsSessionKey) {
            console.log("✅ Verification: Vendor is now an authorized session key!");
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
        throw error;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
