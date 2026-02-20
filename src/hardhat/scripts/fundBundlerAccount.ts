import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    const utilityKey = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const utilityAddress = utilityKey.address;
    console.log("Utility address:", utilityAddress);
    
    const tx = await deployer.sendTransaction({
        to: utilityAddress,
        value: ethers.parseEther("100")
    });
    await tx.wait();
    console.log("Funded utility account with 100 ETH");
    
    const balance = await ethers.provider.getBalance(utilityAddress);
    console.log("Utility balance:", ethers.formatEther(balance), "ETH");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













