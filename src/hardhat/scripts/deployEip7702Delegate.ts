import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

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

function updateEnv(envPath: string, address: string) {
    const line = `NEXT_PUBLIC_EIP7702_DELEGATE=${address}`;
    let envContent = "";
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
    }

    if (envContent.includes("NEXT_PUBLIC_EIP7702_DELEGATE=")) {
        envContent = envContent.replace(/^NEXT_PUBLIC_EIP7702_DELEGATE=.*$/m, line);
    } else {
        envContent = envContent.trimEnd();
        envContent = envContent.length ? `${envContent}\n${line}\n` : `${line}\n`;
    }

    fs.writeFileSync(envPath, envContent, "utf-8");
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying EIP-7702 delegate with:", await deployer.getAddress());

    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );

    let entryPointV8 =
        process.env.NEXT_PUBLIC_ENTRY_POINT_V8 || process.env.ENTRY_POINT_V8 || "";

    if (!entryPointV8 && fs.existsSync(bundlerConfigPath)) {
        const bundlerConfig = JSON.parse(
            fs.readFileSync(bundlerConfigPath, "utf-8")
        );
        const entrypoints = parseEntrypoints(bundlerConfig.entrypoints);
        if (entrypoints.length > 0) {
            entryPointV8 =
                entrypoints.find((entry) =>
                    entry.toLowerCase().startsWith("0x4337")
                ) || entrypoints[0];
        }
    }

    if (!entryPointV8) {
        throw new Error(
            "EntryPoint v0.8 not found. Run deployEntryPointV8.ts first."
        );
    }

    const factory = await ethers.getContractFactory("Eip7702Account");
    const contract = await factory.deploy(entryPointV8);
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log("✅ EIP-7702 delegate deployed at:", address);

    const envPath = path.join(__dirname, "../../../.env.local");
    updateEnv(envPath, address);
    console.log("✅ .env.local updated:", envPath);
    console.log("   NEXT_PUBLIC_EIP7702_DELEGATE:", address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
