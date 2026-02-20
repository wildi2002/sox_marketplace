import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Script pour déployer EntryPoint v0.7 en utilisant le CREATE2 call du bundler
 * Cela déploie EntryPoint v0.7 à l'adresse déterministe: 0x0000000071727De22E5E9d8BAf0edAc6f37da032
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🚀 DEPLOYMENT ENTRYPOINT V0.7 (via CREATE2)");
    console.log("=".repeat(80));
    console.log("");
    console.log("Deployer:", await deployer.getAddress());
    console.log("");

    // Adresse déterministe pour EntryPoint v0.7
    const ENTRY_POINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

    // verify si déjà deployed
    const existingCode = await provider.getCode(ENTRY_POINT_V07_ADDRESS);
    if (existingCode && existingCode !== "0x" && existingCode.length > 100) {
        console.log("✅ EntryPoint v0.7 already deployed at:", ENTRY_POINT_V07_ADDRESS);
        updateConfig(ENTRY_POINT_V07_ADDRESS);
        return;
    }

    console.log("📋 Reading CREATE2 call from bundler...");
    
    // Lire le CREATE2 call depuis les constantes du bundler
    const constantsPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/localDeployer/constants.ts"
    );

    if (!fs.existsSync(constantsPath)) {
        throw new Error(`Fichier constants.ts non found: ${constantsPath}`);
    }

    const constantsContent = fs.readFileSync(constantsPath, "utf-8");
    
    // Extraire ENTRY_POINT_V07_CREATECALL (c'est un hex string très long)
    const match = constantsContent.match(/ENTRY_POINT_V07_CREATECALL[^=]*=\s*"([^"]+)"/s);
    
    if (!match || !match[1]) {
        throw new Error("ENTRY_POINT_V07_CREATECALL non found dans constants.ts");
    }

    const createCallData = match[1].trim();
    console.log("   CREATE2 call data length:", createCallData.length, "chars");
    console.log("");

    // verify si le deterministic deployer existe
    const deployerCode = await provider.getCode(DETERMINISTIC_DEPLOYER);
    if (!deployerCode || deployerCode === "0x") {
        console.error("❌ Deterministic Deployer not found at", DETERMINISTIC_DEPLOYER);
        console.error("   Deterministic deployer must be deployed first");
        console.error("   Standard address: 0x4e59b44847b379578588920ca78fbf26c0b4956c");
        process.exit(1);
    }

    console.log("📤 Sending CREATE2 call to deterministic deployer...");
    console.log("   Deployer:", DETERMINISTIC_DEPLOYER);
    console.log("   Target address:", ENTRY_POINT_V07_ADDRESS);
    console.log("");

    try {
        const tx = await deployer.sendTransaction({
            to: DETERMINISTIC_DEPLOYER,
            data: createCallData,
            gasLimit: 15_000_000n,
        });

        console.log("   Transaction hash:", tx.hash);
        console.log("   Waiting for confirmation...");
        
        const receipt = await tx.wait();
        console.log("   ✅ Transaction confirmed in block:", receipt?.blockNumber);
        console.log("");

        const newCode = await provider.getCode(ENTRY_POINT_V07_ADDRESS);
        if (newCode && newCode !== "0x" && newCode.length > 100) {
            console.log("✅ EntryPoint v0.7 deployed successfully!");
            console.log("   Address:", ENTRY_POINT_V07_ADDRESS);
            console.log("   Code length:", newCode.length, "bytes");
        } else {
            console.error("❌ EntryPoint v0.7 not found after deployment");
            console.error("   Check transaction:", tx.hash);
            process.exit(1);
        }

        updateConfig(ENTRY_POINT_V07_ADDRESS);
    } catch (error: any) {
        console.error("❌ Error during deployment:", error.message);
        if (error.data) {
            console.error("   Error data:", error.data);
        }
        process.exit(1);
    }
}

function updateConfig(entryPointAddress: string) {
    // Mettre à jour la configuration du bundler
    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    let bundlerConfig: any = {};

    try {
        const configContent = fs.readFileSync(bundlerConfigPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
    } catch (error: any) {
        console.warn("⚠️  Unable to read bundler configuration:", error.message);
    }

    bundlerConfig.entrypoints = entryPointAddress;

    try {
        fs.writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("✅ Bundler config updated:", bundlerConfigPath);
        console.log(`   "entrypoints": "${entryPointAddress}"`);
    } catch (error: any) {
        console.error("❌ Error writing config.local.json:", error.message);
    }

    const envPath = path.join(__dirname, "../../../.env.local");
    try {
        let envContent = "";
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, "utf-8");
        }

        const line = `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`;
        if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT=")) {
            envContent = envContent.replace(/^NEXT_PUBLIC_ENTRY_POINT=.*$/m, line);
        } else {
            envContent = envContent.trimEnd();
            envContent = envContent.length ? `${envContent}\n${line}\n` : `${line}\n`;
        }

        fs.writeFileSync(envPath, envContent, "utf-8");
        console.log("✅ .env.local updated:", envPath);
    } catch (error: any) {
        console.error("❌ Error updating .env.local:", error.message);
    }

    console.log("");
    console.log("⚠️  IMPORTANT: Restart bundler to use this new address!");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });





