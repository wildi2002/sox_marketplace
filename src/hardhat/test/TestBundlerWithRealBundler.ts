/**
 * Test avec le bundler réel - Vendor envoie la clé via UserOperation
 * Version simplifiée qui fait directement l'appel RPC au bundler
 * 
 * PRÉREQUIS:
 * 1. Lancer le bundler: cd bundler/packages/bundler && yarn ts-node --transpile-only ./src/exec.ts --config ../../bundler.local.json
 * 2. Lancer hardhat node: npx hardhat node
 * 3. Lancer ce test avec: npx hardhat test test/TestBundlerWithRealBundler.ts --network localhost
 */

import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther, toUtf8Bytes, hexlify, getBytes, keccak256, concat, AbiCoder, zeroPadValue, toBeHex } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import fs from "fs";
import path from "path";

const { ethers } = hre;
const PAYMASTER_SIG_MAGIC = "0x22e325a297439656";

function getEntryPointFromBundlerConfig(): string {
    const envEntryPoint = process.env.ENTRY_POINT || process.env.NEXT_PUBLIC_ENTRY_POINT;
    if (envEntryPoint) return envEntryPoint;

    const configPath = path.join(__dirname, "../../../bundler-alto/scripts/config.local.json");
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        const entrypoints = config.entrypoints;
        if (Array.isArray(entrypoints)) return entrypoints[0];
        if (typeof entrypoints === "string") return entrypoints;
    } catch (error) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error.message);
    }

    throw new Error(
        "EntryPoint introuvable. Définissez ENTRY_POINT ou NEXT_PUBLIC_ENTRY_POINT."
    );
}

const ENTRY_POINT = getEntryPointFromBundlerConfig();
// Le bundler utilise le port 3002 selon bundler.local.json
const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:3002/rpc";

// Fonction pour estimer le gas d'une UserOperation
async function estimateUserOpGas(userOp: any, bundlerUrl: string, entryPoint: string): Promise<any> {
    // S'assurer que tous les champs sont des strings hex valides
    // Le bundler a besoin d'une signature valide (même si dummy) pour calculer correctement
    const cleanedUserOp: any = {
        sender: String(userOp.sender).toLowerCase(),
        nonce: String(userOp.nonce),
        callData: String(userOp.callData),
        callGasLimit: String(userOp.callGasLimit),
        verificationGasLimit: String(userOp.verificationGasLimit),
        preVerificationGas: String(userOp.preVerificationGas),
        maxFeePerGas: String(userOp.maxFeePerGas),
        maxPriorityFeePerGas: String(userOp.maxPriorityFeePerGas),
        signature: String(userOp.signature || "0x" + "ff".repeat(65)) // Signature dummy si manquante
    };
    // Ajouter factory/factoryData seulement si présents (pas initCode)
    if (userOp.factory) cleanedUserOp.factory = String(userOp.factory);
    if (userOp.factoryData) cleanedUserOp.factoryData = String(userOp.factoryData);
    if (userOp.paymaster) cleanedUserOp.paymaster = String(userOp.paymaster);
    
    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_estimateUserOperationGas',
            params: [cleanedUserOp, entryPoint],
            id: 1
        })
    });

    const data = await response.json();
    if (data.error) {
        console.error("❌ Bundler error details:", JSON.stringify(data.error, null, 2));
        throw new Error(`Bundler estimate error: ${JSON.stringify(data.error)}`);
    }
    return data.result;
}

// Fonction simplifiée pour envoyer UserOperation au bundler
async function sendUserOpToBundler(userOp: any, bundlerUrl: string, entryPoint: string): Promise<string> {
    const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_sendUserOperation',
            params: [userOp, entryPoint],
            id: 1
        })
    });

    const data = await response.json();
    if (data.error) {
        throw new Error(`Bundler error: ${JSON.stringify(data.error)}`);
    }
    return data.result;
}

// Fonction pour packer deux uint256 en un bytes32 (utilisé pour accountGasLimits et gasFees)
function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | (low128 & ((1n << 128n) - 1n));
    // Pad à 32 bytes (64 hex chars)
    return zeroPadValue(toBeHex(packed), 32);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function getPaymasterDataHash(paymasterAndData: string): string {
    const data = getBytes(paymasterAndData || "0x");
    const suffix = getBytes(PAYMASTER_SIG_MAGIC);
    if (data.length < suffix.length + 2) {
        return keccak256(data);
    }
    const suffixStart = data.length - suffix.length;
    if (!bytesEqual(data.slice(suffixStart), suffix)) {
        return keccak256(data);
    }
    const sigLenOffset = data.length - suffix.length - 2;
    const sigLen = (data[sigLenOffset] << 8) | data[sigLenOffset + 1];
    const signedLen = data.length - sigLen - (suffix.length + 2);
    if (signedLen < 0) {
        return keccak256(data);
    }
    return keccak256(concat([data.slice(0, signedLen), suffix]));
}

// Fonction pour calculer getUserOpHash selon la spécification ERC-4337
// Basée sur UserOperationLib.sol et EntryPoint.sol
function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    
    // Packer la UserOperation
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    // Typehash pour PackedUserOperation (doit correspondre à UserOperationLib.sol)
    // IMPORTANT: Le typehash utilise "bytes" même si on encode les hash
    const PACKED_USEROP_TYPEHASH = keccak256(
        toUtf8Bytes("PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)")
    );
    
    // Domain separator pour EIP-712
    const EIP712_DOMAIN_TYPEHASH = keccak256(
        toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    );
    const domainNameHash = keccak256(toUtf8Bytes("ERC4337"));
    const domainVersionHash = keccak256(toUtf8Bytes("1"));
    
    const domainSeparator = keccak256(
        abiCoder.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                EIP712_DOMAIN_TYPEHASH,
                domainNameHash,
                domainVersionHash,
                chainId,
                entryPoint
            ]
        )
    );
    
    // Encoder la PackedUserOperation pour le hash
    // On utilise les hash des bytes (initCode, callData, paymasterAndData)
    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";
    
    // Hash des bytes (comme calldataKeccak dans Solidity)
    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    
    // Pour paymasterAndData, utiliser paymasterDataKeccak (qui est juste keccak256 si pas de paymaster)
    const hashPaymasterAndData = getPaymasterDataHash(paymasterAndData);
    
    // Encoder selon PACKED_USEROP_TYPEHASH
    const encoded = abiCoder.encode(
        ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            PACKED_USEROP_TYPEHASH,
            userOp.sender,
            BigInt(userOp.nonce),
            hashInitCode,
            hashCallData,
            accountGasLimits,
            BigInt(userOp.preVerificationGas),
            gasFees,
            hashPaymasterAndData
        ]
    );
    
    // Hash final: keccak256("\x19\x01" || domainSeparator || hash(encoded))
    return keccak256(concat(["0x1901", domainSeparator, keccak256(encoded)]));
}

describe("Test Bundler avec Bundler Réel", () => {
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let optimisticAccount: any;
    let entryPoint: any;
    let provider: JsonRpcProvider;
    let chainId: number;

    before(async () => {
        [buyer, vendor, sponsor] = await ethers.getSigners();
        provider = ethers.provider as any;
        
        const network = await provider.getNetwork();
        chainId = Number(network.chainId);
        
        console.log("🌐 ChainId:", chainId);
        console.log("📍 EntryPoint:", ENTRY_POINT);
        console.log("📡 Bundler URL:", BUNDLER_URL);

        // Se connecter à l'EntryPoint avec un signer pour les transactions
        const entryPointAbi = [
            "function depositTo(address) payable",
            "function balanceOf(address) view returns (uint256)",
            "function getUserOpHash((address,uint256,bytes,bytes,uint256,uint256,uint256,bytes,bytes)) view returns (bytes32)"
        ];
        // Utiliser sponsor comme signer pour les transactions
        entryPoint = new ethers.Contract(ENTRY_POINT, entryPointAbi, sponsor);
    });

    it("Should deploy OptimisticSOXAccount by sponsor with fees", async () => {
        const sponsorAmount = parseEther("1");
        const agreedPrice = parseEther("0.2");
        const completionTip = parseEther("0.05");
        const disputeTip = parseEther("0.01");
        const timeoutIncrement = 60n;
        const commitment = new Uint8Array(32);
        const numBlocks = 512;
        const numGates = 2048;

        // Déployer les libraries nécessaires
        const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();

        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();

        const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
        const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
        await simpleOperationsEvaluator.waitForDeployment();

        const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
        const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();

        const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                SimpleOperationsEvaluator: await simpleOperationsEvaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        });
        const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
        await circuitEvaluator.waitForDeployment();

        const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();

        const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
        const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
        await disputeHelpers.waitForDeployment();

        const disputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                DisputeSOXHelpers: await disputeHelpers.getAddress(),
            },
        });
        const disputeDeployer = await disputeDeployerFactory.connect(sponsor).deploy();
        await disputeDeployer.waitForDeployment();

        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });

        optimisticAccount = await accountFactory.connect(sponsor).deploy(
            ENTRY_POINT,
            await vendor.getAddress(),
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitment,
            numBlocks,
            numGates,
            await vendor.getAddress(),
            {
                value: sponsorAmount,
            }
        );
        await optimisticAccount.waitForDeployment();

        console.log("✅ OptimisticSOXAccount déployé à:", await optimisticAccount.getAddress());
    });

    it("Should deposit funds to EntryPoint for paying gas fees", async () => {
        const depositAmount = parseEther("0.5");
        const accountAddress = await optimisticAccount.getAddress();
        
        // Vérifier que l'EntryPoint est déployé
        const code = await provider.getCode(ENTRY_POINT);
        if (code === "0x") {
            console.log("⚠️  EntryPoint non déployé à", ENTRY_POINT);
            console.log("💡 Assurez-vous que le bundler est lancé - il déploie l'EntryPoint automatiquement");
            // Pour les tests, on continue quand même - le bundler gérera le déploiement
        } else {
            console.log("✅ EntryPoint trouvé à:", ENTRY_POINT);
        }
        
        // Utiliser depositToEntryPoint du contrat OptimisticSOXAccount
        const tx = await optimisticAccount.connect(sponsor).depositToEntryPoint({
            value: depositAmount
        });
        const receipt = await tx.wait();
        
        if (receipt?.status !== 1) {
            throw new Error("Transaction failed");
        }

        const deposit = await entryPoint.balanceOf(accountAddress);
        console.log("✅ EntryPoint deposit:", deposit.toString());
        
        expect(deposit).to.equal(depositAmount);
    });

    it("Should have buyer send payment first", async () => {
        const agreedPrice = await optimisticAccount.agreedPrice();
        const completionTip = await optimisticAccount.completionTip();
        const totalPayment = agreedPrice + completionTip;

        const tx = await optimisticAccount.connect(buyer).sendPayment({
            value: totalPayment
        });
        await tx.wait();

        const state = await optimisticAccount.currState();
        console.log("✅ État après payment:", state.toString());
        
        expect(state).to.equal(1n); // WaitKey
    });

    it("Should vendor send key via bundler UserOperation without paying fees", async () => {
        const accountAddress = await optimisticAccount.getAddress();
        const key = toUtf8Bytes("test-secret-key-bundler-123");
        
        // Encoder l'appel execute -> sendKey
        const iface = optimisticAccount.interface;
        const sendKeyData = iface.encodeFunctionData("sendKey", [key]);
        
        // Créer l'appel execute(accountAddress, 0, sendKeyData)
        const executeDataRaw = iface.encodeFunctionData("execute", [
            accountAddress,
            0,
            sendKeyData
        ]);
        
        // S'assurer que c'est une string hex valide (longueur paire)
        let executeData = typeof executeDataRaw === 'string' ? executeDataRaw : ethers.hexlify(executeDataRaw);
        // Corriger si longueur impaire (ajouter un 0 au début après 0x)
        if (executeData.length % 2 !== 0) {
            executeData = executeData.slice(0, 2) + '0' + executeData.slice(2);
        }

        // Obtenir le nonce actuel
        const nonce = await optimisticAccount.nonce();
        console.log("📝 Nonce actuel:", nonce.toString());

        // Obtenir les fees du réseau
        const feeData = await provider.getFeeData();
        const maxFeePerGas = feeData.maxFeePerGas || parseEther("0.00000002");
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || parseEther("0.000000001");

        // Créer une UserOperation selon le format attendu par le bundler
        // Le bundler attend: factory/factoryData (pas initCode) et paymaster séparé (pas paymasterAndData)
        // Pour l'estimation, utiliser des valeurs par défaut (le bundler va les remplacer)
        const callGasLimitDefault = "0x0"; // Le bundler va estimer
        const verificationGasLimitDefault = "0x0"; // Le bundler va estimer
        const preVerificationGasDefault = "0x0"; // Le bundler va estimer
        
        // Format UserOperation pour le bundler (tous les champs en hex strings)
        // Le bundler a besoin d'une signature dummy pour calculer le preVerificationGas correctement
        // Créer une signature dummy de 65 bytes (taille standard ECDSA)
        const dummySignature = "0x" + "ff".repeat(65); // 65 bytes = 130 hex chars
        
        const userOpForEstimation: any = {
            sender: accountAddress.toLowerCase(),
            nonce: ethers.toBeHex(nonce),
            callData: executeData,
            callGasLimit: callGasLimitDefault,
            verificationGasLimit: verificationGasLimitDefault,
            preVerificationGas: preVerificationGasDefault,
            maxFeePerGas: ethers.toBeHex(maxFeePerGas),
            maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
            signature: dummySignature // Signature dummy pour l'estimation
        };
        // Ne pas inclure initCode, factory, paymasterAndData si vides (le bundler les gérera)
        
        console.log("📋 UserOp pour estimation:", JSON.stringify({
            ...userOpForEstimation,
            callData: userOpForEstimation.callData.substring(0, 50) + "..."
        }, null, 2));

        // Utiliser des valeurs par défaut raisonnables
        let callGasLimit = 800000n;
        let verificationGasLimit = 800000n;
        let preVerificationGas = 2_000_000n; // valeur plancher élevée
        
        try {
            console.log("📊 Estimation du gas...");
            const gasEstimate = await estimateUserOpGas(userOpForEstimation, BUNDLER_URL, ENTRY_POINT);
            console.log("✅ Gas estimé:", JSON.stringify(gasEstimate));
            
            // Convertir les valeurs estimées en BigInt si valides
            callGasLimit = gasEstimate.callGasLimit ? BigInt(gasEstimate.callGasLimit) : callGasLimit;
            verificationGasLimit = gasEstimate.verificationGasLimit ? BigInt(gasEstimate.verificationGasLimit) : verificationGasLimit;
            preVerificationGas = gasEstimate.preVerificationGas ? BigInt(gasEstimate.preVerificationGas) : preVerificationGas;
        } catch (e: any) {
            console.warn("⚠️  Impossible d'estimer le gas, utilisation de valeurs par défaut élevées:", e.message);
            console.log(`📊 Utilisation de preVerificationGas: ${preVerificationGas.toString()} (valeur très élevée pour contourner le bug NaN)`);
        }

        // Plancher pour éviter le NaN côté bundler
        const minPreVerificationGas = 1_000_000n;
        if (preVerificationGas < minPreVerificationGas) {
            preVerificationGas = minPreVerificationGas;
        }

        // Créer la UserOperation finale pour le hash (format pour getUserOpHash)
        // IMPORTANT: nonce doit être en BigNumber/hex string, pas Number
        const userOpForHash: any = {
            sender: accountAddress,
            nonce: nonce.toString(), // Convertir en string pour le hash
            initCode: "0x",
            callData: executeData,
            callGasLimit: callGasLimit.toString(),
            verificationGasLimit: verificationGasLimit.toString(),
            preVerificationGas: preVerificationGas.toString(),
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            paymasterAndData: "0x",
            signature: "0x"
        };

        // Obtenir le hash de la UserOperation
        // Utiliser le calcul manuel (plus fiable car pas de dépendance à l'ABI)
        const userOpHash = getUserOpHash(userOpForHash, ENTRY_POINT, chainId);
        console.log("📝 UserOpHash:", userOpHash);
        
        // Vérifier le vendorSigner configuré dans le compte
        const vendorSignerAddress = await optimisticAccount.vendorSigner();
        console.log("👤 VendorSigner configuré:", vendorSignerAddress);
        console.log("👤 Vendor address (signataire):", await vendor.getAddress());
        console.log("✅ Match:", vendorSignerAddress.toLowerCase() === (await vendor.getAddress()).toLowerCase());
        
        // Signer avec le vendor (ERC-191)
        // signMessage ajoute automatiquement le préfixe "Ethereum Signed Message:\n32"
        const signature = await vendor.signMessage(getBytes(userOpHash));
        console.log("✍️  Signature:", signature.substring(0, 20) + "...");
        
        // Créer la UserOperation finale pour l'envoi au bundler (format hex strings)
        // IMPORTANT: Alto n'accepte PAS le champ initCode - ne pas l'inclure
        const userOpForBundler: any = {
            sender: accountAddress.toLowerCase(),
            nonce: ethers.toBeHex(nonce),
            callData: executeData,
            callGasLimit: ethers.toBeHex(callGasLimit),
            verificationGasLimit: ethers.toBeHex(verificationGasLimit),
            preVerificationGas: ethers.toBeHex(preVerificationGas),
            maxFeePerGas: ethers.toBeHex(maxFeePerGas),
            maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
            signature: signature
        };
        // Ne pas inclure initCode, factory, paymasterAndData - Alto les rejette si non utilisés

        console.log("📤 Envoi UserOperation au bundler...");
        console.log("- Account:", accountAddress);
        console.log("- Nonce:", nonce.toString());

        // Envoyer au bundler
        try {
            const userOpHashResult = await sendUserOpToBundler(userOpForBundler, BUNDLER_URL, ENTRY_POINT);
            console.log("✅ UserOperation envoyée! Hash:", userOpHashResult);

            // Attendre que le bundler traite la transaction
            console.log("⏳ Attente du traitement par le bundler...");
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Vérifier que la clé a été stockée
            const state = await optimisticAccount.currState();
            const storedKey = await optimisticAccount.key();
            
            console.log("✅ État après UserOperation:", state.toString());
            console.log("✅ Clé stockée:", hexlify(storedKey));
            
            // État WaitSB = 2
            expect(state).to.equal(2n);
            expect(hexlify(storedKey)).to.equal(hexlify(key));

            // Vérifier que le deposit EntryPoint a été utilisé (fees déduites)
            const remainingDeposit = await entryPoint.balanceOf(accountAddress);
            console.log("💰 Deposit EntryPoint restant:", remainingDeposit.toString());
            
            // Le deposit devrait être inférieur au montant initial (fees déduites)
            expect(remainingDeposit).to.be.lessThan(parseEther("0.5"));

        } catch (error: any) {
            console.error("❌ Erreur lors de l'envoi au bundler:", error);
            throw error;
        }
    });
});
