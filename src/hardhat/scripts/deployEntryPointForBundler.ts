import hre from "hardhat";
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

function parseEntrypoints(entrypoints: unknown): string[] {
    if (!entrypoints) return [];
    if (Array.isArray(entrypoints)) {
        return entrypoints.map(String).map((value) => value.trim()).filter(Boolean);
    }
    if (typeof entrypoints === "string") {
        return entrypoints
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [];
}

function formatEntrypoints(entrypoints: string[]): string {
    return entrypoints.join(",");
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = hre.ethers.provider;

    console.log("=".repeat(80));
    console.log("🚀 Deploying EntryPoint for Alto bundler");
    console.log("=".repeat(80));
    console.log("");
    console.log("Deployer:", await deployer.getAddress());

    const bundlerConfigPath = path.join(__dirname, "../../../bundler-alto/scripts/config.local.json");
    let bundlerConfig: any = {};
    
    try {
        const configContent = fs.readFileSync(bundlerConfigPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
        console.log("📋 Current bundler configuration:");
        console.log("   Configured EntryPoint:", bundlerConfig.entrypoints || "not defined");
        console.log("");
    } catch (error: any) {
        console.warn("⚠️  Unable to read bundler configuration:", error);
        console.warn("   File will be created with new address");
    }

    const existingEntrypoints = parseEntrypoints(bundlerConfig.entrypoints);
    const configuredEntryPoint = existingEntrypoints[0];
    let entryPointAddress: string;

    if (configuredEntryPoint) {
        console.log("📋 Verifying configured EntryPoint:", configuredEntryPoint);
        const existingCode = await provider.getCode(configuredEntryPoint);
        
        if (existingCode && existingCode !== "0x") {
            console.log("   ✅ EntryPoint already deployed at this address!");
            console.log("   Code:", existingCode.length, "bytes");
            entryPointAddress = configuredEntryPoint;
        } else {
            console.log("   ⚠️  No code found at this address");
            console.log("   Deploying new EntryPoint...");
            
            const factory = new ethers.ContractFactory(
                EntryPointArtifact.abi,
                EntryPointArtifact.bytecode,
                deployer
            );
            const entryPoint = await factory.deploy();
            await entryPoint.waitForDeployment();
            entryPointAddress = await entryPoint.getAddress();
            console.log("   ✅ EntryPoint deployed at:", entryPointAddress);
        }
    } else {
        console.log("📋 No EntryPoint configured, deploying new EntryPoint...");
        const factory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            deployer
        );
        const entryPoint = await factory.deploy();
        await entryPoint.waitForDeployment();
        entryPointAddress = await entryPoint.getAddress();
        console.log("   ✅ EntryPoint deployed at:", entryPointAddress);
    }

    const mergedEntrypoints = [
        entryPointAddress,
        ...existingEntrypoints.filter(
            (value) => value.toLowerCase() !== entryPointAddress.toLowerCase()
        ),
    ];
    bundlerConfig.entrypoints = formatEntrypoints(mergedEntrypoints);
    
    try {
        fs.writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("");
        console.log("✅ Bundler configuration updated!");
        console.log("   File:", bundlerConfigPath);
        console.log("   EntryPoint:", entryPointAddress);
    } catch (error: any) {
        console.error("❌ Error updating configuration:", error);
        console.log("");
        console.log("📋 Manual update required:");
        console.log("   Edit bundler-alto/scripts/config.local.json:");
        console.log(`   "entrypoints": "${entryPointAddress}"`);
    }

    const envLocalPath = path.join(__dirname, "../../../.env.local");
    try {
        let envContent = "";
        if (fs.existsSync(envLocalPath)) {
            envContent = fs.readFileSync(envLocalPath, "utf-8");
        }
        
        if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT=")) {
            envContent = envContent.replace(
                /NEXT_PUBLIC_ENTRY_POINT=.*/g,
                `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`
            );
        } else {
            if (envContent && !envContent.endsWith("\n")) {
                envContent += "\n";
            }
            envContent += `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}\n`;
        }
        
        fs.writeFileSync(envLocalPath, envContent, "utf-8");
        console.log("✅ .env.local file updated!");
        console.log("   EntryPoint:", entryPointAddress);
        console.log("");
        console.log("📋 Next steps:");
        console.log("   1. Restart Next.js (if running) to load new variable");
        console.log("   2. Restart bundler (if running): Ctrl+C then ./run-local.sh");
    } catch (error: any) {
        console.warn("⚠️  Unable to update .env.local:", error);
        console.log("");
        console.log("📋 Manually set environment variable:");
        console.log(`   export NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`);
        console.log("   Or create/edit .env.local with:");
        console.log(`   NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`);
    }

    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Deployment completed!");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
