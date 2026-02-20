import { ethers } from "hardhat";

const DETERMINISTIC_DEPLOYER_TX = "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying deterministic deployer with:", await deployer.getAddress());
    
    const tx = await deployer.sendTransaction({
        data: DETERMINISTIC_DEPLOYER_TX
    });
    await tx.wait();
    
    const deterministicDeployerAddress = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
    const code = await ethers.provider.getCode(deterministicDeployerAddress);
    
    if (code && code !== "0x") {
        console.log("✅ Deterministic deployer deployed at:", deterministicDeployerAddress);
    } else {
        console.log("❌ Deterministic deployer deployment failed");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













