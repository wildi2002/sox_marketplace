import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Script pour déployer EntryPoint v0.7 (nécessaire pour PackedUserOperation)
 * Utilise le contrat EntryPoint v0.7 depuis bundler-alto
 */
async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🚀 DEPLOYMENT ENTRYPOINT V0.7 (Pour PackedUserOperation)");
    console.log("=".repeat(80));
    console.log("");
    console.log("Deployer:", await deployer.getAddress());
    console.log("");

    // Chemin vers le contrat EntryPoint v0.7
    const entryPointV07Path = path.join(
        __dirname,
        "../../../bundler-alto/contracts/src/v07/EntryPoint.sol"
    );

    if (!fs.existsSync(entryPointV07Path)) {
        throw new Error(
            `EntryPoint v0.7 not found at ${entryPointV07Path}. Make sure bundler-alto contracts are available.`
        );
    }

    console.log("📋 DEPLOYMENT du contrat EntryPoint v0.7...");
    
    // Compiler le contrat EntryPoint v0.7
    // Note: On doit utiliser hardhat pour compiler avec les bonnes remappings
    const EntryPointFactory = await ethers.getContractFactory(
        "contracts/src/v07/EntryPoint.sol:EntryPoint",
        {
            // Les remappings sont définis dans hardhat.config.ts
            // Le contrat utilise account-abstraction-v7
        }
    );

    console.log("   Compilation succeeded, DEPLOYMENT...");
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();

    const entryPointAddress = await entryPoint.getAddress();
    console.log("   ✅ EntryPoint v0.7 deployed at:", entryPointAddress);
    console.log("");

    // verify que c'est bien un EntryPoint v0.7 en testant une fonction
    try {
        const depositAddress = ethers.ZeroAddress;
        // Test: appeler balanceOf (fonction standard des EntryPoints)
        const balance = await entryPoint.balanceOf(depositAddress);
        console.log("   ✅ VERIFICATION: balanceOf fonctionne (balance:", balance.toString(), ")");
    } catch (error: any) {
        console.warn("   ⚠️  VERIFICATION balanceOf failed:", error.message);
    }
    console.log("");

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
        console.warn("⚠️  unable de lire la configuration du bundler:", error.message);
        console.warn("   Le fichier sera created.");
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

    // Mettre à jour .env.local
    const envPath = path.join(__dirname, "../../../.env.local");
    try {
        let envContent = "";
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, "utf-8");
        }

        const line = `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`;
        if (envContent.increaddes("NEXT_PUBLIC_ENTRY_POINT=")) {
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
    console.log("=".repeat(80));
    console.log("✅ DEPLOYMENT completed");
    console.log("=".repeat(80));
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





