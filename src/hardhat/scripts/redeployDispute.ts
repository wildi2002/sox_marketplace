import hre from "hardhat";
import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("🔄 DisputeSOXAccount redeployment script");
    console.log("=".repeat(80));
    console.log("");
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    const contractsJsonPath = join(__dirname, "../../deployed-contracts.json");
    let deployedContracts: any;
    try {
        const jsonContent = readFileSync(contractsJsonPath, "utf-8");
        deployedContracts = JSON.parse(jsonContent);
    } catch (error: any) {
        console.error("❌ Error reading deployed-contracts.json:", error);
        process.exit(1);
    }
    
    const disputeDeployerAddr = deployedContracts?.addresses?.DisputeDeployer;
    if (!disputeDeployerAddr) {
        console.error("❌ DisputeDeployer not found in deployed-contracts.json");
        console.error("   Run first: npx hardhat run scripts/redeployDisputeDeployer.ts --network localhost");
        process.exit(1);
    }
    
    console.log("📋 DisputeDeployer found at:", disputeDeployerAddr);
    console.log("");
    console.log("✅ IMPORTANT:");
    console.log("   DisputeSOXAccount contract has been fixed (getAesKey()).");
    console.log("   For a new contract to use this fix:");
    console.log("");
    console.log("   1. Verify that DisputeDeployer has been redeployed with new bytecode:");
    console.log("      npx hardhat run scripts/redeployDisputeDeployer.ts --network localhost");
    console.log("");
    console.log("   2. Create a new Dispute contract via the application interface");
    console.log("      (which calls triggerDispute() in optimistic.ts)");
    console.log("");
    console.log("   The new contract will automatically use the getAesKey() fix.");
    console.log("");
    console.log("⚠️  Note: Existing Dispute contracts cannot be updated.");
    console.log("   You must create a new contract to use the fix.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
