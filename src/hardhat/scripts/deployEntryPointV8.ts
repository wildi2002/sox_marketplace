import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const CANONICAL_ENTRYPOINT_V8 =
    "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

type BundlerConfig = {
    entrypoints?: string | string[];
    [key: string]: unknown;
};

async function setCode(
    provider: typeof ethers.provider,
    address: string,
    code: string
) {
    try {
        await provider.send("hardhat_setCode", [address, code]);
        return;
    } catch {
        await provider.send("anvil_setCode", [address, code]);
    }
}

async function setStorage(
    provider: typeof ethers.provider,
    address: string,
    slot: string,
    value: string
) {
    try {
        await provider.send("hardhat_setStorageAt", [address, slot, value]);
        return;
    } catch {
        await provider.send("anvil_setStorageAt", [address, slot, value]);
    }
}

function updateEnv(envPath: string, address: string) {
    const entryPointLine = `NEXT_PUBLIC_ENTRY_POINT=${address}`;
    const entryPointV8Line = `NEXT_PUBLIC_ENTRY_POINT_V8=${address}`;
    let envContent = "";
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
    }

    if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT=")) {
        envContent = envContent.replace(
            /^NEXT_PUBLIC_ENTRY_POINT=.*$/m,
            entryPointLine
        );
    } else {
        envContent = envContent.trimEnd();
        envContent = envContent.length
            ? `${envContent}\n${entryPointLine}\n`
            : `${entryPointLine}\n`;
    }

    if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT_V8=")) {
        envContent = envContent.replace(
            /^NEXT_PUBLIC_ENTRY_POINT_V8=.*$/m,
            entryPointV8Line
        );
    } else {
        envContent = envContent.trimEnd();
        envContent = envContent.length
            ? `${envContent}\n${entryPointV8Line}\n`
            : `${entryPointV8Line}\n`;
    }

    fs.writeFileSync(envPath, envContent, "utf-8");
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🚀 Deploying EntryPoint v0.8 (canonical)");
    console.log("=".repeat(80));
    console.log("Deployer:", await deployer.getAddress());
    console.log("Canonical EntryPoint:", CANONICAL_ENTRYPOINT_V8);

    const entryPointJsonPath = path.join(
        __dirname,
        "../../../bundler-alto/src/contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json"
    );
    const entryPointJson = JSON.parse(
        fs.readFileSync(entryPointJsonPath, "utf-8")
    );

    const factory = new ethers.ContractFactory(
        entryPointJson.abi,
        entryPointJson.bytecode.object,
        deployer
    );
    const tempEntryPoint = await factory.deploy();
    await tempEntryPoint.waitForDeployment();
    const tempAddress = await tempEntryPoint.getAddress();
    const runtimeCode = await provider.getCode(tempAddress);

    if (!runtimeCode || runtimeCode === "0x") {
        throw new Error("Failed to read EntryPoint runtime code");
    }

    await setCode(provider, CANONICAL_ENTRYPOINT_V8, runtimeCode);
    await setCode(provider, tempAddress, "0x");

    console.log("✅ EntryPoint v0.8 set at canonical:", CANONICAL_ENTRYPOINT_V8);

    const senderCreatorJsonPath = path.join(
        __dirname,
        "../../../bundler-alto/src/contracts/SenderCreator.sol/SenderCreator.json"
    );
    const senderCreatorJson = JSON.parse(
        fs.readFileSync(senderCreatorJsonPath, "utf-8")
    );
    const senderCreatorFactory = new ethers.ContractFactory(
        senderCreatorJson.abi,
        senderCreatorJson.bytecode.object,
        deployer
    );
    const senderCreator = await senderCreatorFactory.deploy();
    await senderCreator.waitForDeployment();
    const senderCreatorAddress = await senderCreator.getAddress();
    console.log("✅ SenderCreator deployed at:", senderCreatorAddress);

    const senderCreatorSlot = ethers.keccak256(
        ethers.toUtf8Bytes("SENDER_CREATOR")
    );
    const senderCreatorValue = ethers.zeroPadValue(senderCreatorAddress, 32);
    await setStorage(
        provider,
        CANONICAL_ENTRYPOINT_V8,
        senderCreatorSlot,
        senderCreatorValue
    );
    console.log("✅ SenderCreator slot configured");

    const entryPoint = new ethers.Contract(
        CANONICAL_ENTRYPOINT_V8,
        ["function initDomainSeparator() external"],
        deployer
    );
    await (entryPoint.initDomainSeparator() as Promise<any>);
    console.log("✅ Domain separator initialized");

    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    let bundlerConfig: BundlerConfig = {};
    if (fs.existsSync(bundlerConfigPath)) {
        bundlerConfig = JSON.parse(fs.readFileSync(bundlerConfigPath, "utf-8"));
    }
    bundlerConfig.entrypoints = CANONICAL_ENTRYPOINT_V8;
    fs.writeFileSync(
        bundlerConfigPath,
        JSON.stringify(bundlerConfig, null, 4) + "\n",
        "utf-8"
    );
    console.log("✅ Bundler config updated:", bundlerConfigPath);
    console.log("   EntryPoints:", bundlerConfig.entrypoints);

    const envPath = path.join(__dirname, "../../../.env.local");
    updateEnv(envPath, CANONICAL_ENTRYPOINT_V8);
    console.log("✅ .env.local updated:", envPath);
    console.log("   NEXT_PUBLIC_ENTRY_POINT:", CANONICAL_ENTRYPOINT_V8);
    console.log("   NEXT_PUBLIC_ENTRY_POINT_V8:", CANONICAL_ENTRYPOINT_V8);

    console.log("=".repeat(80));
    console.log("✅ EntryPoint v0.8 deployment completed");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
