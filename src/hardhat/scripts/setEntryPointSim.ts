import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

async function main() {
    const contractAddr = process.argv[2];
    const sponsorPrivateKey = process.argv[3];
    const entryPointSim = process.env.NEXT_PUBLIC_ENTRY_POINT_SIM;
    
    if (!contractAddr || !sponsorPrivateKey) {
        console.error("Usage: NEXT_PUBLIC_ENTRY_POINT_SIM=<address> npx hardhat run scripts/setEntryPointSim.ts --network localhost <contractAddress> <sponsorPrivateKey>");
        process.exit(1);
    }
    
    if (!entryPointSim) {
        console.error("❌ NEXT_PUBLIC_ENTRY_POINT_SIM is not defined in environment!");
        console.error("   Define it in .env.local or export it before running the script.");
        process.exit(1);
    }
    
    const provider = hre.ethers.provider;
    const sponsorWallet = new Wallet(sponsorPrivateKey, provider);
    const sponsorAddress = await sponsorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🔧 Configuring EntryPointSim");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Sponsor address:", sponsorAddress);
    console.log("EntryPointSim:", entryPointSim);
    console.log("");
    
    const accountAbi = [
        "function sponsor() view returns (address)",
        "function entryPointSim() view returns (address)",
        "function setEntryPointSim(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, sponsorWallet);
    
    try {
        const contractSponsor = await contract.sponsor();
        if (contractSponsor.toLowerCase() !== sponsorAddress.toLowerCase()) {
            console.error("❌ Wallet does not match contract sponsor!");
            console.error("   Contract sponsor:", contractSponsor);
            console.error("   Wallet address:", sponsorAddress);
            process.exit(1);
        }
        console.log("✅ Wallet matches sponsor");
        
        let currentEntryPointSim: string;
        try {
            currentEntryPointSim = await contract.entryPointSim();
        } catch (e) {
            console.error("❌ Contract does not have entryPointSim() function");
            console.error("   Contract is probably an old version that does not support EntryPointSim.");
            process.exit(1);
        }
        
        console.log("   Current EntryPointSim:", currentEntryPointSim === "0x0000000000000000000000000000000000000000" ? "Not configured" : currentEntryPointSim);
        
        if (currentEntryPointSim.toLowerCase() === entryPointSim.toLowerCase()) {
            console.log("✅ EntryPointSim is already configured with this value!");
            return;
        }
        
        console.log("");
        console.log("🔄 Configuring EntryPointSim...");
        const tx = await contract.setEntryPointSim(entryPointSim);
        console.log("   Transaction sent, hash:", tx.hash);
        console.log("   Waiting for confirmation...");
        await tx.wait();
        console.log("✅ EntryPointSim configured successfully!");
        
        const updatedEntryPointSim = await contract.entryPointSim();
        if (updatedEntryPointSim.toLowerCase() === entryPointSim.toLowerCase()) {
            console.log("✅ Verification: EntryPointSim =", updatedEntryPointSim);
        } else {
            console.error("❌ Error: EntryPointSim was not updated correctly!");
            console.error("   Expected:", entryPointSim);
            console.error("   Received:", updatedEntryPointSim);
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
        if (error.message?.includes("Only sponsor")) {
            console.error("   Wallet must be the contract sponsor.");
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













