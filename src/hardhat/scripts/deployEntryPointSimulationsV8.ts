import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function updateBundlerConfig(configPath: string, address: string) {
    let bundlerConfig: any = {};
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
    } catch (error: any) {
        console.warn("⚠️  Unable to read bundler configuration:", error.message);
        console.warn("   File will be created.");
    }

    bundlerConfig["entrypoint-simulation-contract-v8"] = address;
    delete bundlerConfig["entrypoint-simulation-contract-v7"];

    try {
        fs.writeFileSync(
            configPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("✅ Bundler config updated:", configPath);
        console.log(`   "entrypoint-simulation-contract-v8": "${address}"`);
    } catch (error: any) {
        console.error("❌ Error writing config.local.json:", error.message);
    }
}

function updateEnv(envPath: string, address: string) {
    try {
        let envContent = "";
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, "utf-8");
        }

        const line = `NEXT_PUBLIC_ENTRY_POINT_SIM_V8=${address}`;
        if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT_SIM_V8=")) {
            envContent = envContent.replace(
                /^NEXT_PUBLIC_ENTRY_POINT_SIM_V8=.*$/m,
                line
            );
        } else {
            envContent = envContent.trimEnd();
            envContent = envContent.length
                ? `${envContent}\n${line}\n`
                : `${line}\n`;
        }

        fs.writeFileSync(envPath, envContent, "utf-8");
        console.log("✅ .env.local updated:", envPath);
    } catch (error: any) {
        console.error(
            "❌ Error updating .env.local:",
            error.message
        );
    }
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying EntryPointSimulations v0.8 with:",
        await deployer.getAddress()
    );

    const altoContractsPath = path.join(
        __dirname,
        "../../../bundler-alto/src/esm/contracts"
    );
    const entryPointSimulationsJsonPath = path.join(
        altoContractsPath,
        "EntryPointSimulations.sol/EntryPointSimulations08.json"
    );

    let bytecode: string;
    let abi: any[];

    try {
        const json = JSON.parse(
            fs.readFileSync(entryPointSimulationsJsonPath, "utf-8")
        );
        bytecode = json.bytecode.object;
        abi = json.abi;
        console.log("✅ Found compiled EntryPointSimulations08 from Alto");
    } catch (e) {
        throw new Error(
            "Please build Alto contracts first: cd bundler-alto && pnpm run build:all"
        );
    }

    const factory = new ethers.ContractFactory(abi, bytecode, deployer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("✅ EntryPointSimulations v0.8 deployed at:", address);

    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    updateBundlerConfig(bundlerConfigPath, address);

    const envPath = path.join(__dirname, "../../../.env.local");
    updateEnv(envPath, address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
