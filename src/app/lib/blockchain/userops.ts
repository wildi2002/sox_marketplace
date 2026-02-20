import { getBytes, toBeHex, Wallet, Contract } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import { signAuthorization } from "viem/accounts";
import { BUNDLER_URL, PROVIDER, requireEntryPoint, ENTRY_POINT, ENTRY_POINT_V8 } from "./config";

export type UserOpGas = {
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
};

export type UserOpGasV8 = UserOpGas & {
    paymasterVerificationGasLimit?: bigint;
    paymasterPostOpGasLimit?: bigint;
};

export type UserOperationReceipt = {
    userOpHash: string;
    success: boolean;
    reason?: string; // Reason for revert if success is false
    receipt?: {
        transactionHash?: string;
        blockNumber?: string;
    };
    [key: string]: any; // Allow additional fields from bundler
};

const DEFAULT_GAS_V8: UserOpGasV8 = {
    callGasLimit: 1_500_000n,
    verificationGasLimit: 1_000_000n,
    preVerificationGas: 100_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymasterVerificationGasLimit: 500_000n,
    paymasterPostOpGasLimit: 200_000n,
};

const DEFAULT_RECEIPT_TIMEOUT_MS = 60_000;
const DEFAULT_RECEIPT_POLL_MS = 2_000;
const EIP7702_FACTORY_ADDRESS = "0x7702";

type PaymasterInfo = {
    paymaster: string;
    verificationGasLimit: bigint;
    postOpGasLimit: bigint;
    data: string;
};

function normalizeHex(value: string | undefined): string {
    if (!value) return "0x";
    return value.startsWith("0x") ? value : `0x${value}`;
}

function parseInitCode(initCode: string): { factory: string; factoryData: string } {
    const normalized = normalizeHex(initCode);
    if (normalized.length < 42) {
        throw new Error("initCode is too short to contain a factory address");
    }
    return {
        factory: normalized.slice(0, 42),
        factoryData:
            normalized.length > 42 ? `0x${normalized.slice(42)}` : "0x",
    };
}

function parsePaymasterAndData(paymasterAndData: string): PaymasterInfo {
    const normalized = normalizeHex(paymasterAndData);
    if (normalized.length < 106) {
        throw new Error(
            "paymasterAndData is too short for v0.8 (needs paymaster + gas limits)"
        );
    }
    const paymaster = normalized.slice(0, 42);
    const verificationGasHex = normalized.slice(42, 74);
    const postOpGasHex = normalized.slice(74, 106);
    const data = normalized.length > 106 ? `0x${normalized.slice(106)}` : "0x";
    return {
        paymaster,
        verificationGasLimit: BigInt(`0x${verificationGasHex}`),
        postOpGasLimit: BigInt(`0x${postOpGasHex}`),
        data,
    };
}

function normalizeSignature(signature: string): string {
    let normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
    if (normalized.length !== 132) {
        throw new Error(
            `Invalid signature length: ${normalized.length}, expected 132 (65 bytes)`
        );
    }

    const r = normalized.slice(2, 66);
    const s = normalized.slice(66, 130);
    const vHex = normalized.slice(130, 132);
    const v = parseInt(vHex, 16);

    if (v === 27 || v === 28) {
        return normalized;
    }

    const normalizedV = v < 27 ? v + 27 : v % 2 === 0 ? 28 : 27;
    const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
    return `0x${r}${s}${normalizedVHex}`;
}

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerBundlerSendNow(): Promise<boolean> {
    if (!BUNDLER_URL) {
        return false;
    }

    try {
        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "debug_bundler_sendBundleNow",
                params: [],
            }),
        });
        
        if (!response.ok) {
            console.warn("⚠️ Bundler n'a pas répondu OK à sendBundleNow:", response.status);
            return false;
        }
        
        const payload = await response.json();
        if (payload.error) {
            console.warn("⚠️ Bundler erreur lors de sendBundleNow:", payload.error);
            return false;
        }
        
        console.log("✅ Bundler a inclus la UserOperation immédiatement:", payload.result);
        return true;
    } catch (err) {
        console.warn("⚠️ Impossible d'appeler debug_bundler_sendBundleNow:", err);
        return false;
    }
}

/**
 * Gets the receipt for a user operation hash.
 */
export async function getUserOperationReceipt(
    userOpHash: string
): Promise<UserOperationReceipt | null> {
    if (!BUNDLER_URL) {
        throw new Error("NEXT_PUBLIC_BUNDLER_URL is not set.");
    }

    const response = await fetch(BUNDLER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getUserOperationReceipt",
            params: [userOpHash],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bundler HTTP error (${response.status}): ${text}`);
    }

    const payload = await response.json();
    if (payload.error) {
        const errorMsg = payload.error.message || "Bundler receipt error";
        const errorData = payload.error.data
            ? ` (data: ${JSON.stringify(payload.error.data)})`
            : "";
        throw new Error(`${errorMsg}${errorData}`);
    }

    if (!payload.result) {
        return null;
    }

    return payload.result as UserOperationReceipt;
}

/**
 * Waits for a user operation receipt to be available.
 */
export async function waitForUserOperationReceipt(
    userOpHash: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<UserOperationReceipt> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_RECEIPT_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const receipt = await getUserOperationReceipt(userOpHash);
        if (receipt) {
            return receipt;
        }
        await sleep(pollIntervalMs);
    }

    throw new Error("UserOperation receipt not found (bundler did not include it yet).");
}

/**
 * Sends a user operation to the bundler (ERC-4337 EntryPoint v0.6/v0.7).
 */
export async function sendUserOperation(params: {
    sender: string;
    callData: string;
    signerPrivateKey: string;
    gas?: Partial<UserOpGasV8>;
    initCode?: string;
    paymasterAndData?: string;
    entryPoint?: string; // EntryPoint optionnel (par défaut: requireEntryPoint())
    // EIP-7702 support (v0.8)
    factory?: string;
    factoryData?: string;
    eip7702Auth?: {
        address: string;
        chainId: number;
        nonce: number;
        r: string;
        s: string;
        yParity: number;
    };
}) {
    if (!BUNDLER_URL) {
        throw new Error("NEXT_PUBLIC_BUNDLER_URL is not set.");
    }

    const entryPoint = params.entryPoint || requireEntryPoint();
    const gas = { ...DEFAULT_GAS_V8, ...params.gas };
    const initCode = normalizeHex(params.initCode);
    const paymasterAndData = normalizeHex(params.paymasterAndData);

    const contract = new Contract(
        params.sender,
        ["function nonce() view returns (uint256)"],
        PROVIDER
    );
    const nonce = await contract.nonce();
    const network = await PROVIDER.getNetwork();
    const chainId = Number(network.chainId);

    // Pour v0.8, déterminer si nous avons une factory (création de compte) ou non (compte existant)
    let factory: string | undefined = params.factory;
    let factoryData: string | undefined = params.factoryData;
    
    if (!factory && initCode !== "0x") {
        // Si initCode est fourni, parser pour obtenir factory et factoryData
        const parsed = parseInitCode(initCode);
        factory = parsed.factory;
        factoryData = parsed.factoryData;
    }
    // Pour EIP-7702 (Alto), le bundler attend factory = "0x7702".
    if (!factory && params.eip7702Auth) {
        factory = EIP7702_FACTORY_ADDRESS;
        factoryData = "0x";
    }
    
    // Normaliser factoryData seulement si factory est défini
    const normalizedFactoryData = factory ? normalizeHex(factoryData || "0x") : undefined;

    const paymasterInfo =
        paymasterAndData !== "0x"
            ? parsePaymasterAndData(paymasterAndData)
            : undefined;

    const authorization = params.eip7702Auth
        ? {
              address: params.eip7702Auth.address as `0x${string}`,
              chainId: params.eip7702Auth.chainId,
              nonce: params.eip7702Auth.nonce,
              r: params.eip7702Auth.r as `0x${string}`,
              s: params.eip7702Auth.s as `0x${string}`,
              yParity: params.eip7702Auth.yParity,
          }
        : undefined;

    // Construire userOpForHash : pour les comptes existants, omettre factory/factoryData complètement
    // (pas undefined, mais vraiment omis dans l'objet)
    const userOpForHash: any = {
        sender: params.sender as `0x${string}`,
        nonce: BigInt(nonce),
        callData: params.callData as `0x${string}`,
        callGasLimit: gas.callGasLimit,
        verificationGasLimit: gas.verificationGasLimit,
        preVerificationGas: gas.preVerificationGas,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
        // factory et factoryData seulement si factory est défini (création de compte ou EIP-7702)
        // Sinon, complètement omis (pas undefined) pour les comptes existants
    };
    
    // Ajouter factory/factoryData seulement si définis.
    if (factory) {
        userOpForHash.factory = factory as `0x${string}`;
        if (normalizedFactoryData) {
            userOpForHash.factoryData = normalizedFactoryData as `0x${string}`;
        }
    }
    
    // Ajouter paymaster fields seulement si définis
    if (paymasterInfo) {
        userOpForHash.paymaster = paymasterInfo.paymaster as `0x${string}`;
        if (paymasterInfo.verificationGasLimit) {
            userOpForHash.paymasterVerificationGasLimit = paymasterInfo.verificationGasLimit;
        }
        if (paymasterInfo.postOpGasLimit) {
            userOpForHash.paymasterPostOpGasLimit = paymasterInfo.postOpGasLimit;
        }
        if (paymasterInfo.data) {
            userOpForHash.paymasterData = paymasterInfo.data as `0x${string}`;
        }
    }
    
    // Ajouter authorization seulement si EIP-7702
    if (authorization) {
        userOpForHash.authorization = authorization;
    }

    // Détecter automatiquement la version de l'EntryPoint
    // EntryPoint v0.8 commence par "0x4337" ou est ENTRY_POINT_V8
    // EntryPoint v0.7 est "0x0000000071727De22E5E9d8BAf0edAc6f37da032" ou ENTRY_POINT
    // Sinon, utiliser v0.6
    let entryPointVersion: "0.6" | "0.7" | "0.8" = "0.6";
    const entryPointLower = entryPoint.toLowerCase();
    
    if (entryPointLower.startsWith("0x4337") || ENTRY_POINT_V8?.toLowerCase() === entryPointLower) {
        entryPointVersion = "0.8";
    } else if (
        entryPointLower === "0x0000000071727de22e5e9d8baf0edac6f37da032" ||
        ENTRY_POINT?.toLowerCase() === entryPointLower
    ) {
        entryPointVersion = "0.7";
    } else {
        entryPointVersion = "0.6";
    }

    const calculatedUserOpHash = getUserOperationHash({
        chainId,
        entryPointAddress: entryPoint as `0x${string}`,
        entryPointVersion,
        userOperation: userOpForHash,
    });
    const wallet = new Wallet(params.signerPrivateKey);
    const signature = normalizeSignature(
        await wallet.signMessage(getBytes(calculatedUserOpHash))
    );

    // Construire userOpForBundler selon la version de l'EntryPoint
    // v0.6: utilise initCode et paymasterAndData
    // v0.7/v0.8: utilise factory/factoryData et paymaster séparé
    const userOpForBundler: Record<string, unknown> = {
        sender: params.sender.toLowerCase(),
        nonce: toBeHex(nonce),
        callData: params.callData,
        callGasLimit: toBeHex(gas.callGasLimit),
        verificationGasLimit: toBeHex(gas.verificationGasLimit),
        preVerificationGas: toBeHex(gas.preVerificationGas),
        maxFeePerGas: toBeHex(gas.maxFeePerGas),
        maxPriorityFeePerGas: toBeHex(gas.maxPriorityFeePerGas),
        signature,
    };

    // Format selon la version
    if (entryPointVersion === "0.6") {
        // v0.6: utiliser initCode et paymasterAndData
        userOpForBundler.initCode = initCode || "0x";
        userOpForBundler.paymasterAndData = paymasterAndData || "0x";
    } else {
        // v0.7/v0.8: utiliser factory/factoryData et paymaster séparé
        if (factory) {
            userOpForBundler.factory = factory;
            userOpForBundler.factoryData = normalizedFactoryData || "0x";
        }
        // Note: Si factory n'est pas défini, ces champs sont omis

        // Ajouter paymaster fields seulement si paymaster est défini
        if (paymasterInfo) {
            userOpForBundler.paymaster = paymasterInfo.paymaster;
            userOpForBundler.paymasterVerificationGasLimit = toBeHex(
                paymasterInfo.verificationGasLimit
            );
            userOpForBundler.paymasterPostOpGasLimit = toBeHex(
                paymasterInfo.postOpGasLimit
            );
            if (paymasterInfo.data && paymasterInfo.data !== "0x") {
                userOpForBundler.paymasterData = paymasterInfo.data;
            }
        }
        // Note: Si paymaster n'est pas défini, ces champs sont omis (pas undefined/null)

        // Ajouter eip7702Auth seulement si EIP-7702 est utilisé (v0.8)
        if (entryPointVersion === "0.8" && params.eip7702Auth) {
            userOpForBundler.eip7702Auth = {
                address: params.eip7702Auth.address,
                chainId: toBeHex(BigInt(params.eip7702Auth.chainId)),
                nonce: toBeHex(BigInt(params.eip7702Auth.nonce)),
                r: params.eip7702Auth.r,
                s: params.eip7702Auth.s,
                yParity: toBeHex(BigInt(params.eip7702Auth.yParity)),
            };
        }
    }

    // Envoyer la UserOperation au bundler
    const response = await fetch(BUNDLER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendUserOperation",
            params: [userOpForBundler, entryPoint],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bundler HTTP error (${response.status}): ${text}`);
    }

    const payload = await response.json();
    if (payload.error) {
        const errorMsg = payload.error.message || "Bundler rejected UserOperation";
        const errorData = payload.error.data
            ? ` (data: ${JSON.stringify(payload.error.data)})`
            : "";
        
        // Si l'erreur est "Already known", cela signifie que la UserOperation a déjà été soumise
        // Cela peut arriver si l'utilisateur clique plusieurs fois rapidement
        if (errorMsg.includes("Already known") || errorMsg.includes("already known")) {
            console.warn("⚠️ UserOperation déjà connue du bundler. La transaction est peut-être déjà en cours.");
            throw new Error(`Already known: ${errorMsg}${errorData}`);
        }
        
        throw new Error(`${errorMsg}${errorData}`);
    }

    const userOpHash = payload.result as string;
    console.log("✅ UserOperation soumise au bundler:", userOpHash);
    
    // Forcer le bundler à inclure immédiatement la UserOperation (comme dans les tests)
    const included = await triggerBundlerSendNow();
    if (included) {
        console.log("✅ Bundler a inclus la UserOperation immédiatement");
    } else {
        console.warn("⚠️ Bundler n'a pas pu inclure immédiatement la UserOperation. Elle sera incluse au prochain bundle.");
    }
    
    return userOpHash;
}

/**
 * Sends a user operation to the bundler (ERC-4337 EntryPoint v0.8 with EIP-7702 support).
 */
export async function sendUserOperationV8(params: {
    sender: string;
    callData: string;
    signerPrivateKey: string;
    entryPoint: string;
    delegate: string;
    gas?: Partial<UserOpGasV8>;
    factoryData?: string;
    paymaster?: {
        address: string;
        verificationGasLimit: bigint;
        postOpGasLimit: bigint;
        data: string;
    };
}) {
    if (!BUNDLER_URL) {
        throw new Error("NEXT_PUBLIC_BUNDLER_URL is not set.");
    }

    const signerWallet = new Wallet(params.signerPrivateKey);
    const signerAddress = signerWallet.address.toLowerCase();
    const senderAddress = params.sender.toLowerCase();
    if (signerAddress !== senderAddress) {
        throw new Error(
            `EIP-7702 authorization must be signed by the sender. signer=${signerWallet.address} sender=${params.sender}`
        );
    }

    const gas = { ...DEFAULT_GAS_V8, ...params.gas };
    const factoryData = params.factoryData || "0x";

    const entryPointContract = new Contract(
        params.entryPoint,
        ["function getNonce(address,uint192) view returns (uint256)"],
        PROVIDER
    );
    const nonce = await entryPointContract.getNonce(signerWallet.address, 0);
    const network = await PROVIDER.getNetwork();
    const chainId = Number(network.chainId);
    const authNonce = await PROVIDER.getTransactionCount(signerWallet.address, "pending");

    const { signAuthorization } = await import("viem/accounts");
    const authorization = await signAuthorization({
        contractAddress: params.delegate as `0x${string}`,
        chainId,
        nonce: authNonce,
        privateKey: params.signerPrivateKey as `0x${string}`,
    });

    const userOpForHash: any = {
        sender: params.sender as `0x${string}`,
        nonce: BigInt(nonce),
        callData: params.callData as `0x${string}`,
        callGasLimit: gas.callGasLimit,
        verificationGasLimit: gas.verificationGasLimit,
        preVerificationGas: gas.preVerificationGas,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
        factory: EIP7702_FACTORY_ADDRESS as `0x${string}`,
        factoryData: factoryData as `0x${string}`,
        authorization,
        paymaster: params.paymaster?.address as `0x${string}` | undefined,
        paymasterVerificationGasLimit: params.paymaster?.verificationGasLimit,
        paymasterPostOpGasLimit: params.paymaster?.postOpGasLimit,
        paymasterData: params.paymaster?.data as `0x${string}` | undefined,
        signature: "0x" as `0x${string}`,
    };

    const computedUserOpHash = getUserOperationHash({
        chainId,
        entryPointAddress: params.entryPoint as `0x${string}`,
        entryPointVersion: "0.8",
        userOperation: userOpForHash,
    });

    const signature = normalizeSignature(
        await signerWallet.signMessage(getBytes(computedUserOpHash))
    );

    const eip7702Auth = {
        address: authorization.address,
        chainId: toBeHex(BigInt(authorization.chainId)),
        nonce: toBeHex(BigInt(authorization.nonce)),
        r: authorization.r,
        s: authorization.s,
        yParity: toBeHex(BigInt(authorization.yParity ?? 0)),
    };

    const userOpForBundler: Record<string, unknown> = {
        sender: signerWallet.address.toLowerCase(),
        nonce: toBeHex(nonce),
        factory: EIP7702_FACTORY_ADDRESS,
        factoryData,
        callData: params.callData,
        callGasLimit: toBeHex(gas.callGasLimit),
        verificationGasLimit: toBeHex(gas.verificationGasLimit),
        preVerificationGas: toBeHex(gas.preVerificationGas),
        maxFeePerGas: toBeHex(gas.maxFeePerGas),
        maxPriorityFeePerGas: toBeHex(gas.maxPriorityFeePerGas),
        signature,
        eip7702Auth,
    };
    
    // Ajouter paymaster fields seulement si définis
    if (params.paymaster) {
        userOpForBundler.paymaster = params.paymaster.address;
        userOpForBundler.paymasterVerificationGasLimit = toBeHex(params.paymaster.verificationGasLimit);
        userOpForBundler.paymasterPostOpGasLimit = toBeHex(params.paymaster.postOpGasLimit);
        if (params.paymaster.data && params.paymaster.data !== "0x") {
            userOpForBundler.paymasterData = params.paymaster.data;
        }
    }

    const response = await fetch(BUNDLER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendUserOperation",
            params: [userOpForBundler, params.entryPoint],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bundler HTTP error (${response.status}): ${text}`);
    }

    const payload = await response.json();
    if (payload.error) {
        const errorMsg = payload.error.message || "Bundler rejected UserOperation";
        const errorData = payload.error.data
            ? ` (data: ${JSON.stringify(payload.error.data)})`
            : "";
        throw new Error(`${errorMsg}${errorData}`);
    }

    const userOpHash = payload.result as string;
    console.log("✅ UserOperation soumise au bundler:", userOpHash);
    
    // Forcer le bundler à inclure immédiatement la UserOperation (comme dans les tests)
    const included = await triggerBundlerSendNow();
    if (included) {
        console.log("✅ Bundler a inclus la UserOperation immédiatement");
    } else {
        console.warn("⚠️ Bundler n'a pas pu inclure immédiatement la UserOperation. Elle sera incluse au prochain bundle.");
    }
    
    return userOpHash;
}
