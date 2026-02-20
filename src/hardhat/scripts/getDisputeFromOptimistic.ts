import { ethers } from "hardhat";
import OptimisticSOXAccountABI from "../artifacts/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json";

async function main() {
    const args = process.argv.slice(2);
    const optimisticAddr = args[0] || process.env.OPTIMISTIC_ADDR;
    
    if (!optimisticAddr || !ethers.isAddress(optimisticAddr)) {
        console.error("❌ Usage: npx hardhat run scripts/getDisputeFromOptimistic.ts <OPTIMISTIC_CONTRACT_ADDRESS>");
        console.error("   Or set OPTIMISTIC_ADDR environment variable");
        process.exit(1);
    }

    const provider = ethers.provider;
    const contract = new ethers.Contract(optimisticAddr, OptimisticSOXAccountABI.abi, provider);

    console.log("\n" + "=".repeat(80));
    console.log("🔍 RETRIEVING DISPUTE CONTRACT");
    console.log("=".repeat(80));
    console.log(`\n📋 OptimisticSOXAccount contract: ${optimisticAddr}\n`);

    try {
        const code = await provider.getCode(optimisticAddr);
        if (!code || code === "0x") {
            console.error("❌ No contract found at this address!");
            process.exit(1);
        }
        console.log("✅ Contract found (code:", code.length, "bytes)\n");

        const disputeAddr = await contract.disputeContract();
        console.log(`🔹 Dispute contract address: ${disputeAddr}`);
        
        if (disputeAddr === ethers.ZeroAddress) {
            console.log("❌ No dispute contract deployed!");
            process.exit(1);
        }

        const state = await contract.currState();
        const stateNames = [
            "WaitPayment",
            "WaitKey",
            "WaitSB",
            "WaitSV",
            "WaitDisputeStart",
            "InDispute",
            "End"
        ];
        const stateNum = Number(state);
        console.log(`🔹 OptimisticSOXAccount contract state: ${stateNum} (${stateNames[stateNum] || "UNKNOWN"})`);

        if (stateNum !== 5) {
            console.log("⚠️  Contract is not in InDispute state (5)");
        } else {
            console.log("✅ Contract is in dispute\n");
            console.log(`\n💡 To diagnose the dispute contract, run:`);
            console.log(`   DISPUTE_ADDR=${disputeAddr} npx hardhat run scripts/diagnoseProofSubmission.ts`);
        }

    } catch (error: any) {
        console.error(`\n❌ Error:`, error.message);
        if (error.data) {
            console.error(`   Error data:`, error.data);
        }
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
