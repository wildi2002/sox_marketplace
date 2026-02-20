import { abi } from "./contracts/DisputeSOXAccount.json";
import { PK_SK_MAP, PROVIDER, ENTRY_POINT_V8, EIP7702_DELEGATE } from "./config";
import { sendUserOperation, sendUserOperationV8, waitForUserOperationReceipt } from "./userops";
import { Contract, isAddress, hexlify, getBytes, Wallet, keccak256 } from "ethers";

const DISPUTE_ERROR_HINTS: Record<string, string> = {
    InvalidState: "The contract is not in the expected state for this action.",
    UnexpectedSender: "The signer is not the expected actor (buyer/vendor/sponsor).",
    AESKeyInvalid: "The AES key is not yet set (the vendor must send the key).",
    InvalidGateBytes: "The gate bytes format is invalid (64 bytes expected).",
    InvalidV2SonIndex: "Invalid son index in the proof.",
    CTIndexOutOfBounds: "CT index out of bounds.",
    InvalidOptimisticState: "The optimistic contract is not in the expected state.",
    InsufficientFunds: "Insufficient funds for the action.",
    InvalidSignature: "Invalid signature for this role.",
    InvalidSignatureLength: "Invalid signature (length).",
    InvalidSignatureV: "Invalid signature (v).",
    InvalidSignatureS: "Invalid signature (s).",
    OnlyBuyer: "Only the buyer can perform this action.",
    OnlyVendor: "Only the vendor can perform this action.",
    OnlyBuyerDisputeSponsor: "Only the buyer sponsor can perform this action.",
    OnlyVendorDisputeSponsor: "Only the vendor sponsor can perform this action.",
};

function extractErrorName(contract: Contract, error: any): string | null {
    const data = error?.data || error?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
        try {
            const parsed = contract.interface.parseError(data);
            if (parsed?.name) {
                return parsed.name;
            }
        } catch {
            // ignore parse failures
        }
    }

    const message =
        error?.shortMessage || error?.reason || error?.message || "";
    const match = message.match(/reverted:?\s*([A-Za-z0-9_]+)/i);
    if (match && match[1]) {
        return match[1];
    }

    return null;
}

function formatDisputeError(contract: Contract, error: any): string {
    console.error("🔍 formatDisputeError - Raw error:", error);
    console.error("🔍 formatDisputeError - Type:", typeof error);
    console.error("🔍 formatDisputeError - Constructor:", error?.constructor?.name);
    
    // Try to extract the custom error name
    const errorName = extractErrorName(contract, error);
    if (errorName) {
        const hint = DISPUTE_ERROR_HINTS[errorName];
        return hint ? `${hint} (${errorName})` : `Error: ${errorName}`;
    }

    // Try multiple sources for error message
    let errorMessage = error?.shortMessage || error?.reason || error?.message;
    
    // If no message, try to decode data
    if (!errorMessage || errorMessage === "Error") {
        const data = error?.data || error?.error?.data;
        if (data) {
            console.error("🔍 Error data:", data);
            // If it's a hex string, try to decode
            if (typeof data === 'string' && data.startsWith('0x')) {
                // Probably a custom error selector
                const selector = data.slice(0, 10).toLowerCase();
                console.error("🔍 Error selector:", selector);
                // TransactionReverted() = 0x9167c27a
                if (selector === '0x9167c27a') {
                    errorMessage = "Transaction reverted: Internal contract call failed. This may be due to a failed proof verification, invalid state check, or error in provided data.";
                } else {
                    errorMessage = `Contract error (selector: ${selector})`;
                }
            } else {
                errorMessage = String(data);
            }
        }
    }
    
    // If still no message, use toString or generic description
    if (!errorMessage || errorMessage === "Error") {
        if (typeof error?.toString === 'function') {
            const errorStr = error.toString();
            if (errorStr !== '[object Object]' && errorStr !== 'Error') {
                errorMessage = errorStr;
            }
        }
    }
    
    if (!errorMessage || errorMessage === "Error") {
        errorMessage = `Unknown error during pre-verification. Type: ${typeof error}, Constructor: ${error?.constructor?.name || 'N/A'}`;
    }
    
    return errorMessage;
}

async function preflightDisputeCall(
    contract: Contract,
    signerAddr: string,
    method: string,
    args: any[]
) {
    const privateKey = PK_SK_MAP.get(signerAddr);
    if (!privateKey) {
        return;
    }
    const wallet = new Wallet(privateKey, PROVIDER);
    try {
        console.log(`🔍 Pre-verification: ${method} with ${args.length} arguments`);
        const connected = contract.connect(wallet) as any;
        await connected[method].staticCall(...args);
        console.log(`✅ Pre-verification successful for ${method}`);
    } catch (error: any) {
        console.error(`❌ Pre-verification failed for ${method}:`, error);
        
        // Try multiple ways to extract error message
        // With ethers.js v6, errors can have a different structure
        let errorMessage: string | undefined;
        
        // 1. Try standard properties
        errorMessage = error?.message || error?.reason || error?.shortMessage;
        
        // 2. Try error.error (nested errors)
        if (!errorMessage && error?.error) {
            errorMessage = error.error.message || error.error.reason || error.error.shortMessage || error.error.data;
        }
        
        // 3. Try error.cause (chained errors)
        if (!errorMessage && error?.cause) {
            errorMessage = error.cause.message || error.cause.reason || String(error.cause);
        }
        
        // 4. Try to decode error.data (hex data)
        if (!errorMessage) {
            const data = error?.data || error?.error?.data || error?.cause?.data;
            if (data) {
                if (typeof data === 'string' && data.startsWith('0x')) {
                    const selector = data.slice(0, 10).toLowerCase();
                    if (selector === '0x9167c27a') {
                        errorMessage = "Transaction reverted: Internal contract call failed (TransactionReverted). This may be due to a failed proof verification, invalid state check, or error in provided data.";
                    } else if (selector === '0x08c379a0') {
                        // Error(string) - try to decode
                        try {
                            const decoded = contract.interface.decodeErrorResult("Error(string)", data);
                            errorMessage = decoded[0] || `Contract error (Error string)`;
                        } catch {
                            errorMessage = `Contract error (selector: ${selector})`;
                        }
                    } else {
                        errorMessage = `Contract error (selector: ${selector})`;
                    }
                } else if (typeof data === 'string') {
                    errorMessage = data;
                } else {
                    errorMessage = String(data);
                }
            }
        }
        
        // 5. Try toString()
        if (!errorMessage) {
            try {
                const errorStr = String(error);
                if (errorStr && errorStr !== '[object Object]' && errorStr !== 'Error' && errorStr.trim() !== '') {
                    errorMessage = errorStr;
                }
            } catch (e) {
                // Ignore
            }
        }
        
        // 6. Default message
        if (!errorMessage || errorMessage.trim() === '') {
            errorMessage = `Error during pre-verification of ${method}. Contract rejected the transaction. Verify that the contract is in the correct state and data is correct.`;
        }
        
        throw new Error(errorMessage);
    }
}

export async function getDisputeState(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.currState().catch(() => {});
}

export async function getChallenge(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.chall();
}

async function sendDisputeUserOp(
    signerAddr: string,
    contractAddr: string,
    callData: string
): Promise<string> {
    const privateKey = PK_SK_MAP.get(signerAddr);
    if (!privateKey) {
        throw new Error(`Private key not found for address: ${signerAddr}`);
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    const executeData = contract.interface.encodeFunctionData("execute", [
        contractAddr,
        0,
        callData,
    ]);

    return sendUserOperation({
        sender: contractAddr,
        callData: executeData,
        signerPrivateKey: privateKey,
    });
}

/**
 * Responds to the challenge with the buyer's response.
 */
export async function respondChallenge(
    buyerAddr: string,
    contractAddr: string,
    response: string
) {
    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, buyerAddr, "respondChallenge", [
        response,
    ]);
    const callData = contract.interface.encodeFunctionData("respondChallenge", [
        response,
    ]);
    await sendDisputeUserOp(buyerAddr, contractAddr, callData);
}

/**
 * Gets the latest challenge response from the buyer.
 */
export async function getLatestChallengeResponse(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    let contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.getLatestBuyerResponse();
}

/**
 * Gets the next timeout timestamp for the dispute.
 */
export async function getNextDisputeTimeout(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.nextTimeoutTime().catch(() => {});
}

/**
 * Gives the vendor's opinion on the buyer's response (agree or disagree).
 */
export async function giveOpinion(
    vendorAddr: string,
    contractAddr: string,
    opinion: boolean
) {
    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, vendorAddr, "giveOpinion", [opinion]);
    const callData = contract.interface.encodeFunctionData("giveOpinion", [
        opinion,
    ]);
    
    // Use the private key of the person sending the transaction (vendorAddr)
    // Note: For ERC-4337 user operations, the signature must match vendorSigner in the contract.
    // If the contract doesn't have the handleStep9 fix, vendorSigner won't be updated when
    // the sponsor takes over, and the transaction will fail. The contract must be redeployed
    // with the fix for this to work properly.
    await sendDisputeUserOp(vendorAddr, contractAddr, callData);
}

/**
 * Submits a commitment value to the dispute contract.
 */
export async function submitCommitment(
    openingValue: string,
    gateNum: number,
    gateBytes: number[] | Uint8Array, // V2 format: 64-byte gate bytes
    values: Uint8Array[],
    currAcc: Uint8Array,
    proof1: Uint8Array[][],
    proof2: Uint8Array[][],
    proof3: Uint8Array[][],
    proofExt: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    // Convert gateBytes to Uint8Array for ethers.js bytes format
    const gateBytesUint8 = gateBytes instanceof Uint8Array 
        ? gateBytes 
        : new Uint8Array(gateBytes);
    if (gateBytesUint8.length !== 64) {
        throw new Error(
            `InvalidGateBytes: gate_bytes.length=${gateBytesUint8.length}, attendu 64`
        );
    }

    // Convert openingValue to bytes format (ensure it has 0x prefix if it's a hex string)
    let openingValueBytes: string;
    if (openingValue.startsWith("0x")) {
        openingValueBytes = openingValue;
    } else {
        openingValueBytes = "0x" + openingValue;
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, vendorAddr, "submitCommitment", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
        values,
        currAcc,
        proof1,
        proof2,
        proof3,
        proofExt,
    ]);
    const callData = contract.interface.encodeFunctionData("submitCommitment", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
        values,
        currAcc,
        proof1,
        proof2,
        proof3,
        proofExt,
    ]);
    const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
    
    // Attendre la confirmation de la UserOperation
    console.log("⏳ En attente de la confirmation de la UserOperation...");
    const receipt = await waitForUserOperationReceipt(userOpHash);
    if (!receipt.success) {
        // Log le receipt complet pour debug
        console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
        const receiptInfo = receipt as any;
        const reason = receiptInfo.reason || "Raison inconnue";
        const receiptJson = JSON.stringify(receipt, null, 2);
        
        // Décoder le selector d'erreur si c'est un hex string
        let errorMessage = "Transaction rejetée par le contrat";
        if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
            const selector = reason.slice(0, 10).toLowerCase();
            // TransactionReverted() = 0x9167c27a
            if (selector === '0x9167c27a') {
                errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué. Cela peut être dû à:\n- Une vérification de preuve qui a échoué\n- Une vérification d'état invalide\n- Une erreur dans les données fournies";
            }
        }
        
        throw new Error(
            `${errorMessage}\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}\n\nUserOperation échouée. Receipt complet:\n${receiptJson}`
        );
    }
    console.log("✅ UserOperation confirmée:", receipt);
    
    return userOpHash;
}

/**
 * Submits the left commitment data with proofs for a specific gate.
 */
export async function submitCommitmentLeft(
    openingValue: string,
    gateNum: number,
    gateBytes: number[] | Uint8Array, // V2 format: 64-byte gate bytes
    values: Uint8Array[] | number[][],
    currAcc: Uint8Array | number[],
    proof1: Uint8Array[][],
    proof2: Uint8Array[][],
    proofExt: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    // Convert gateBytes to Uint8Array for ethers.js bytes format
    const gateBytesUint8 = gateBytes instanceof Uint8Array 
        ? gateBytes 
        : new Uint8Array(gateBytes);
    if (gateBytesUint8.length !== 64) {
        throw new Error(
            `InvalidGateBytes: gate_bytes.length=${gateBytesUint8.length}, attendu 64`
        );
    }
    
    // Convert values to Uint8Array[] (comme dans le script de test)
    const valuesArray = values.map(v => 
        v instanceof Uint8Array ? v : new Uint8Array(v)
    );
    
    // Convert currAcc to Uint8Array (comme dans le script de test)
    const currAccArray = currAcc instanceof Uint8Array 
        ? currAcc 
        : new Uint8Array(currAcc);

    // Convert openingValue to bytes format (ensure it has 0x prefix if it's a hex string)
    let openingValueBytes: string;
    if (openingValue.startsWith("0x")) {
        openingValueBytes = openingValue;
    } else {
        openingValueBytes = "0x" + openingValue;
    }

    // Convert currAcc to hex string for comparison (use currAccArray after conversion)
    const currAccHex = hexlify(currAccArray);

    const contract = new Contract(contractAddr, abi, PROVIDER);
    
    // Vérifier buyerResponses[gateNum] avant d'envoyer
    try {
        const buyerResponse = await contract.getBuyerResponse(gateNum);
        const buyerResponseHex = buyerResponse;
        console.log(`🔍 Vérification: curr_acc = ${currAccHex.slice(0, 20)}..., buyerResponses[${gateNum}] = ${buyerResponseHex.slice(0, 20)}...`);
        if (currAccHex.toLowerCase() === buyerResponseHex.toLowerCase()) {
            console.warn(`⚠️ ATTENTION: curr_acc est égal à buyerResponses[${gateNum}]!`);
            console.warn(`   Cela signifie que le vendor et le buyer calculent la même valeur.`);
            console.warn(`   Dans ce cas, la condition _currAcc != buyerResponses[_gateNum] échouera.`);
            console.warn(`   Si les fichiers sont identiques, le vendor ne peut pas gagner.`);
        }
    } catch (error) {
        console.warn("⚠️ Impossible de vérifier buyerResponses avant l'envoi:", error);
    }
    
    // Verify commitment matches opening value before sending
    try {
        const contractCommitment = await contract.commitment();
        const openingValueBytesForHash = getBytes(openingValueBytes);
        const calculatedCommitment = keccak256(openingValueBytesForHash);
        console.log(`🔍 Vérification commitment:`);
        console.log(`   Commitment du contrat: ${contractCommitment}`);
        console.log(`   Commitment calculé (keccak256(opening_value)): ${calculatedCommitment}`);
        if (calculatedCommitment.toLowerCase() !== contractCommitment.toLowerCase()) {
            throw new Error(
                `L'opening value ne correspond pas au commitment du contrat!\n` +
                `Commitment du contrat: ${contractCommitment}\n` +
                `Commitment calculé: ${calculatedCommitment}\n` +
                `Opening value utilisé: ${openingValueBytes.slice(0, 40)}...\n\n` +
                `Vérifiez que vous utilisez le bon opening value de la base de données.`
            );
        }
        console.log(`✅ Commitment vérifié - l'opening value correspond`);
    } catch (commitmentError: any) {
        if (commitmentError.message?.includes('opening value ne correspond pas')) {
            throw commitmentError;
        }
        console.warn("⚠️ Impossible de vérifier le commitment:", commitmentError.message);
    }

    // Try to simulate the call first to catch errors early
    // But don't block if it fails - sometimes staticCall fails but real call works
    try {
        console.log("🧪 Simulation de submitCommitmentLeft avec staticCall...");
    await preflightDisputeCall(contract, vendorAddr, "submitCommitmentLeft", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
            valuesArray,
            currAccArray,
        proof1,
        proof2,
        proofExt,
    ]);
        console.log("✅ Simulation réussie - les preuves devraient passer");
    } catch (preflightError: any) {
        console.error("❌ Simulation échouée (preflight):", preflightError);
        const errorData = preflightError?.data || preflightError?.error?.data || preflightError?.cause?.data;
        if (errorData) {
            try {
                const parsed = contract.interface.parseError(errorData);
                if (parsed) {
                    console.error(`   Erreur parsée: ${parsed.name}`);
                    if (parsed.args) {
                        console.error(`   Args:`, parsed.args);
                    }
                }
            } catch (e) {
                // ignore
            }
        }
        // Check for specific errors that indicate the real call will also fail
        const errorMsg = preflightError?.message || preflightError?.reason || preflightError?.shortMessage || '';
        const errorDataStr = typeof errorData === 'string' ? errorData : '';
        
        // Decode the error if possible
        let decodedError: string | null = null;
        if (errorData && typeof errorData === 'string' && errorData.startsWith('0x')) {
            try {
                // Try to decode Error(string) selector 0x08c379a0
                if (errorData.startsWith('0x08c379a0')) {
                    const decoded = contract.interface.decodeErrorResult("Error(string)", errorData);
                    decodedError = decoded[0];
                    console.error(`   Erreur décodée: ${decodedError}`);
                }
            } catch (e) {
                // ignore
            }
        }
        
        if (errorMsg.includes('Commitment and opening value do not match') || decodedError?.includes('Commitment and opening value do not match')) {
            throw new Error("L'opening value ne correspond pas au commitment du contrat. Vérifiez que vous utilisez le bon opening value de la base de données.");
        }
        
        // If it's TransactionReverted, it might be from openCommitment or verifyCommitmentLeft
        if (errorDataStr.includes('0x9167c27a') || errorMsg.includes('TransactionReverted')) {
            console.error("   ⚠️ TransactionReverted détectée dans la simulation");
            console.error("   Cela peut être dû à:");
            console.error("   1. openCommitment échoue (commitment/opening value mismatch)");
            console.error("   2. Les preuves ne passent pas (AccumulatorVerifier.verify échoue)");
            console.error("   3. L'évaluation de la gate échoue (EvaluatorSOX_V2.evaluateGateFromSons)");
            console.error("   La transaction réelle échouera probablement aussi.");
        }
        
        // Continue anyway - sometimes staticCall fails but the real call works (but log a warning)
        console.warn("⚠️ Continuation malgré l'échec de la simulation...");
        console.warn("   La transaction réelle peut échouer si la simulation échoue.");
    }
    const callData = contract.interface.encodeFunctionData(
        "submitCommitmentLeft",
        [
            openingValueBytes,
            gateNum,
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1,
            proof2,
            proofExt,
        ]
    );
    const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
    
    // Attendre la confirmation de la UserOperation
    console.log("⏳ En attente de la confirmation de la UserOperation...");
    const receipt = await waitForUserOperationReceipt(userOpHash);
    if (!receipt.success) {
        // Log le receipt complet pour debug
        console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
        const receiptInfo = receipt as any;
        const reason = receiptInfo.reason || "Raison inconnue";
        const receiptJson = JSON.stringify(receipt, null, 2);
        
        // Décoder le selector d'erreur si c'est un hex string
        let errorMessage = "Transaction rejetée par le contrat";
        if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
            const selector = reason.slice(0, 10).toLowerCase();
            // TransactionReverted() = 0x9167c27a
            if (selector === '0x9167c27a') {
                errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué. Cela peut être dû à:\n- Une vérification de preuve qui a échoué\n- Une vérification d'état invalide\n- Une erreur dans les données fournies";
            }
        }
        
        throw new Error(
            `${errorMessage}\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}\n\nUserOperation échouée. Receipt complet:\n${receiptJson}`
        );
    }
    console.log("✅ UserOperation confirmée:", receipt);
    
    return userOpHash;
}

/**
 * TEST ONLY: Envoie submitCommitmentLeft directement via transaction (sans UserOperation)
 * ATTENTION: Cette fonction échouera probablement avec UnexpectedSender() car le contrat
 * utilise onlyExpected() qui vérifie que l'appel vient d'une UserOperation.
 * Utilisée uniquement pour tester et voir l'erreur exacte.
 */
/**
 * Submits the left commitment data directly via transaction (without user operation).
 */
export async function submitCommitmentLeftDirect(
    openingValue: string,
    gateNum: number,
    gateBytes: number[] | Uint8Array,
    values: Uint8Array[] | number[][],
    currAcc: Uint8Array | number[],
    proof1: Uint8Array[][],
    proof2: Uint8Array[][],
    proofExt: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    const gateBytesUint8 = gateBytes instanceof Uint8Array 
        ? gateBytes 
        : new Uint8Array(gateBytes);
    if (gateBytesUint8.length !== 64) {
        throw new Error(
            `InvalidGateBytes: gate_bytes.length=${gateBytesUint8.length}, attendu 64`
        );
    }
    
    const valuesArray = values.map(v => 
        v instanceof Uint8Array ? v : new Uint8Array(v)
    );
    
    const currAccArray = currAcc instanceof Uint8Array 
        ? currAcc 
        : new Uint8Array(currAcc);

    let openingValueBytes: string;
    if (openingValue.startsWith("0x")) {
        openingValueBytes = openingValue;
    } else {
        openingValueBytes = "0x" + openingValue;
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    
    // Get private key for vendor
    const privateKey = PK_SK_MAP.get(vendorAddr);
    if (!privateKey) {
        throw new Error(`Private key not found for address: ${vendorAddr}`);
    }
    
    const wallet = new Wallet(privateKey, PROVIDER);
    const contractWithSigner = contract.connect(wallet);
    
    console.log("🧪 TEST: Envoi direct de submitCommitmentLeft (sans UserOperation)...");
    console.log("⚠️  ATTENTION: Cela échouera probablement avec UnexpectedSender()");
    
    try {
        const tx = await contractWithSigner.submitCommitmentLeft(
            openingValueBytes,
            gateNum,
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1,
            proof2,
            proofExt
        );
        
        console.log("⏳ Transaction envoyée, en attente de confirmation...");
        const receipt = await tx.wait();
        console.log("✅ Transaction confirmée!");
        return receipt.hash;
    } catch (error: any) {
        console.error("❌ Transaction échouée:", error);
        throw error;
    }
}

/**
 * Submits the right commitment data with proofs for a specific gate.
 */
export async function submitCommitmentRight(
    proof: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    try {
        // Vérifier que la preuve est valide
        if (!proof || !Array.isArray(proof) || proof.length === 0) {
            throw new Error("Preuve invalide: doit être un tableau non vide");
        }
        
        console.log(`📊 Conversion de la preuve: ${proof.length} couches`);
        
        // Convertir les preuves Uint8Array[][] en bytes32[][] (chaînes hex)
        // Chaque élément doit être exactement 32 bytes pour être un bytes32 valide
        const proofBytes32: string[][] = [];
        for (let layer = 0; layer < proof.length; layer++) {
            if (!Array.isArray(proof[layer])) {
                throw new Error(`Preuve invalide: la couche ${layer} n'est pas un tableau`);
            }
            
            const layerArray: string[] = [];
            for (let item = 0; item < proof[layer].length; item++) {
                let itemBytes: Uint8Array;
                
                // Gérer différents formats possibles
                if (proof[layer][item] instanceof Uint8Array) {
                    itemBytes = proof[layer][item];
                } else if (Array.isArray(proof[layer][item])) {
                    itemBytes = new Uint8Array(proof[layer][item]);
                } else {
                    throw new Error(`Preuve invalide: l'élément à la couche ${layer}, index ${item} n'est pas un Uint8Array`);
                }
                
                // S'assurer que l'élément fait exactement 32 bytes
                if (itemBytes.length !== 32) {
                    throw new Error(`Preuve invalide: l'élément à la couche ${layer}, index ${item} a une longueur de ${itemBytes.length} bytes, attendu 32 bytes`);
                }
                layerArray.push(hexlify(itemBytes));
            }
            proofBytes32.push(layerArray);
        }
        
        console.log(`📊 Preuve convertie: ${proofBytes32.length} couches`);
        if (proofBytes32.length > 0) {
            console.log(`   Première couche: ${proofBytes32[0].length} éléments`);
            if (proofBytes32[0].length > 0) {
                console.log(`   Premier élément: ${proofBytes32[0][0].slice(0, 20)}...`);
            }
        }
        
        const contract = new Contract(contractAddr, abi, PROVIDER);
        console.log("🔍 Pré-vérification de l'appel (preflight)...");
        try {
            await preflightDisputeCall(contract, vendorAddr, "submitCommitmentRight", [
                proofBytes32,
            ]);
            console.log("✅ Pré-vérification réussie");
        } catch (preflightError: any) {
            console.error("❌ Pré-vérification échouée:", preflightError);
            console.error("⚠️  La pré-vérification a échoué, mais on continue quand même pour voir l'erreur réelle du contrat");
            // Ne pas throw ici, continuer pour voir l'erreur réelle
            // throw preflightError;
        }
        
        console.log("📝 Encodage des données de la fonction...");
        const callData = contract.interface.encodeFunctionData("submitCommitmentRight", [
            proofBytes32,
        ]);
        
        console.log("📤 Envoi de la UserOperation...");
        const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
        console.log(`✅ UserOperation envoyée: ${userOpHash}`);
        
        // Attendre la confirmation de la UserOperation
        console.log("⏳ En attente de la confirmation de la UserOperation...");
        const receipt = await waitForUserOperationReceipt(userOpHash);
        if (!receipt.success) {
            // Log le receipt complet pour debug
            console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
            const receiptInfo = receipt as any;
            const reason = receiptInfo.reason || "Raison inconnue";
            const receiptJson = JSON.stringify(receipt, null, 2);
            
            // Décoder le selector d'erreur si c'est un hex string
            let errorMessage = "Transaction rejetée par le contrat";
            if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
                const selector = reason.slice(0, 10).toLowerCase();
                // TransactionReverted() = 0x9167c27a
                if (selector === '0x9167c27a' || selector.startsWith('0x9167')) {
                    errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué.\n\nCauses possibles:\n- La vérification de la preuve a échoué (buyerResponses[numGates] n'est peut-être pas défini)\n- Le format de la preuve est incorrect\n- L'état du contrat n'est pas celui attendu\n\nNote: Pour submitCommitmentRight, le buyer doit avoir répondu pour le challenge numGates avant que le vendor puisse envoyer les preuves.";
                }
            }
            
            throw new Error(
                `${errorMessage}\n\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}\n\nUserOperation échouée. Receipt complet:\n${receiptJson}`
            );
        }
        console.log("✅ UserOperation confirmée:", receipt);
        
        return userOpHash;
    } catch (error: any) {
        console.error("❌ Erreur dans submitCommitmentRight:", error);
        console.error("Type d'erreur:", typeof error);
        console.error("Constructeur:", error?.constructor?.name);
        console.error("Détails de l'erreur:", {
            message: error?.message,
            reason: error?.reason,
            code: error?.code,
            data: error?.data,
            shortMessage: error?.shortMessage,
            stack: error?.stack,
        });
        
        // Essayer de sérialiser l'erreur complète
        let errorString = "";
        try {
            errorString = JSON.stringify(error, Object.getOwnPropertyNames(error));
        } catch (e) {
            errorString = String(error);
        }
        console.error("Erreur complète (JSON):", errorString);
        
        // Si c'est déjà une Error avec un message informatif, la relancer
        if (error instanceof Error && error.message && error.message !== "Error" && error.message.trim() !== "") {
            throw error;
        }
        
        // Extraire le message le plus informatif possible
        let errorMessage = error?.message || error?.reason || error?.shortMessage;
        if (!errorMessage || errorMessage === "Error" || errorMessage.trim() === "") {
            // Essayer toString si disponible
            if (typeof error?.toString === 'function') {
                const errorStr = error.toString();
                if (errorStr !== '[object Object]' && errorStr !== 'Error' && errorStr.trim() !== "") {
                    errorMessage = errorStr;
                }
            }
        }
        
        // Si toujours pas de message, utiliser la sérialisation
        if (!errorMessage || errorMessage === "Error") {
            errorMessage = errorString.length > 200 ? errorString.substring(0, 200) + "..." : errorString;
        }
        
        if (!errorMessage || errorMessage.trim() === "") {
            errorMessage = "Erreur inconnue lors de l'envoi des preuves";
        }
        
        throw new Error(errorMessage);
    }
}

/**
 * Finishes the dispute process.
 */
export async function finishDispute(
    state: number,
    requesterAddr: string,
    contractAddr: string
) {
    if (state == 5) {
        const contract = new Contract(contractAddr, abi, PROVIDER);
        const callData = contract.interface.encodeFunctionData("completeDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
    } else if (state == 6) {
        const contract = new Contract(contractAddr, abi, PROVIDER);
        const callData = contract.interface.encodeFunctionData("cancelDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
    }
}

/**
 * Ends the dispute timeout, allowing the requester to claim timeout.
 */
export async function endDisputeTimeout(
    contractAddr: string,
    requesterAddr: string
) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    const state = await contract.currState();

    if ([0, 5].includes(Number(state))) {
        const callData = contract.interface.encodeFunctionData("completeDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
        return true;
    } else if (state != 7) {
        const callData = contract.interface.encodeFunctionData("cancelDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
        return false;
    } else {
        throw Error("Cannot end dispute when it is already over");
    }
}

/**
 * Gets step 9 information from the dispute contract.
 */
export async function getStep9Info(contractAddr: string) {
    if (!isAddress(contractAddr)) return null;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    try {
        const step9Count = await contract.step9Count();
        const lastLosingPartyWasVendor = await contract.lastLosingPartyWasVendor();
        return {
            step9Count: Number(step9Count),
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
        };
    } catch (error) {
        console.error("Error fetching Step 9 info:", error);
        return null;
    }
}

/**
 * Gets detailed information about the dispute contract.
 */
export async function getDisputeDetails(contractAddr: string) {
    if (!isAddress(contractAddr)) return null;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    try {
        const [step9Count, lastLosingPartyWasVendor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await Promise.all([
            contract.step9Count(),
            contract.lastLosingPartyWasVendor(),
            contract.buyer(),
            contract.vendor(),
            contract.buyerDisputeSponsor(),
            contract.vendorDisputeSponsor(),
        ]);
        
        return {
            step9Count: Number(step9Count),
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
            buyer: buyer,
            vendor: vendor,
            buyerDisputeSponsor: buyerDisputeSponsor,
            vendorDisputeSponsor: vendorDisputeSponsor,
        };
    } catch (error) {
        console.error("Error fetching dispute details:", error);
        return null;
    }
}
