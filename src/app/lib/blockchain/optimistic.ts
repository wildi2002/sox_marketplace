import { abi as oAccountAbi, bytecode as oAccountBytecode } from "./contracts/OptimisticSOXAccount.json";
import { abi as dAccountAbi } from "./contracts/DisputeSOXAccount.json";
import {
    EIP7702_DELEGATE,
    ENTRY_POINT_V8,
    PK_SK_MAP,
    PROVIDER,
    requireEntryPoint,
    requireEntryPointV8,
    requireEip7702Delegate,
} from "./config";
import { deployLibraries } from "./deploy-libraries";
import {
    sendUserOperation,
    sendUserOperationV8,
    waitForUserOperationReceipt,
    UserOperationReceipt,
} from "./userops";
import { keccak256, getBytes, toBeHex } from "ethers";
import { toRlp, concatHex, type Hex } from "viem";
import { BUNDLER_URL } from "./config";
import {
    Contract,
    ContractFactory,
    Wallet,
    ZeroAddress,
    isAddress,
    parseEther,
} from "ethers";

async function getOptimisticContract(contractAddr: string): Promise<Contract> {
    if (!isAddress(contractAddr)) {
        throw new Error("Invalid contract address");
    }
    
    const contract = new Contract(contractAddr, oAccountAbi, PROVIDER);
    const entryPointAddr = await contract.entryPoint().catch(() => null);
    const isAccount = entryPointAddr !== null && entryPointAddr !== ZeroAddress;
    if (!isAccount) {
        throw new Error("Contract is not an OptimisticSOXAccount");
    }
    return contract;
}

/**
 * Gets the contract type and entry point address.
 */
export async function getContractType(contractAddr: string): Promise<{ type: "OptimisticSOXAccount"; entryPoint: string } | null> {
    if (!isAddress(contractAddr)) return null;
    
    try {
        const contract = await getOptimisticContract(contractAddr);
        const entryPoint = await contract.entryPoint();
        return { type: "OptimisticSOXAccount", entryPoint };
    } catch {
        return null;
    }
}

/**
 * Deploys a new OptimisticSOXAccount contract with the specified parameters.
 * Returns the contract address and session key information.
 */
export async function deployOptimisticContract(
    pkBuyer: string,
    pkVendor: string,
    price: number,
    completionTip: number,
    disputeTip: number,
    timeoutIncrement: number,
    commitment: string,
    numBlocks: number,
    numGates: number,
    sponsorAddr: string
): Promise<{
    contractAddress: string;
    sessionKeyPrivateKey: string;
    sessionKeyAddress: string;
}> {
    const entryPoint = requireEntryPoint();
    
    // Déployer les libraries nécessaires et obtenir leurs adresses
    // Note: Le bytecode dans OptimisticSOXAccount.json est déjà linké avec des adresses spécifiques
    // Ces adresses correspondent aux libraries déployées lors de l'exécution de deploy_libraries.ts
    // Si les libraries sont redéployées avec de nouvelles adresses, le bytecode ne fonctionnera pas
    // Pour l'instant, on suppose que les libraries sont déployées aux mêmes adresses
    const libraries = await deployLibraries(sponsorAddr);
    const disputeDeployerAddr = libraries.get("DisputeDeployer");
    
    if (!disputeDeployerAddr) {
        throw new Error("DisputeDeployer library not deployed");
    }

    const privateKey = PK_SK_MAP.get(sponsorAddr);
    if (!privateKey) throw new Error("Private key not found for sponsor");

    const wallet = new Wallet(privateKey, PROVIDER);

    // Remplacer les placeholders dans le bytecode par les vraies adresses
    // Le bytecode peut contenir des placeholders comme __$e840f9821dab6b702f8ff665e4ecc4871b$__
    // qui doivent être remplacés par l'adresse de DisputeDeployer (sans 0x, en minuscules)
    let linkedBytecode = oAccountBytecode;
    
    // Remplacer les placeholders de format __$...$__ par l'adresse de DisputeDeployer
    const placeholderRegex = /__\$[a-f0-9]+\$__/gi;
    const disputeDeployerAddrHex = disputeDeployerAddr.slice(2).toLowerCase(); // Enlever 0x et mettre en minuscules
    
    if (placeholderRegex.test(linkedBytecode)) {
        linkedBytecode = linkedBytecode.replace(placeholderRegex, disputeDeployerAddrHex);
    }
    
    // Vérifier que le bytecode est maintenant valide (hexadécimal uniquement)
    if (!/^0x[0-9a-fA-F]+$/.test(linkedBytecode)) {
        throw new Error(`Bytecode invalide après remplacement des placeholders. Contient encore des caractères non-hexadécimaux.`);
    }

    // Créer le ContractFactory avec le bytecode linké
    const factory = new ContractFactory(
        oAccountAbi,
        linkedBytecode,
        wallet
    );

    // OptimisticSOXAccount constructor: 
    // (entryPoint, vendor, buyer, agreedPrice, completionTip, disputeTip, timeoutIncrement, commitment, numBlocks, numGates, vendorSigner)
    // Le sponsor envoie de l'ETH (msg.value) qui sera stocké dans sponsorDeposit
    // vendorSigner peut être le même que vendor si non spécifié
    
    const currentNonce = await PROVIDER.getTransactionCount(sponsorAddr, "pending");
    
    const contract = await factory
        .connect(wallet)
        .deploy(
            entryPoint,      // _entryPoint
            pkVendor,        // _vendor
            pkBuyer,         // _buyer
            price,           // _agreedPrice
            completionTip,   // _completionTip
            disputeTip,      // _disputeTip
            timeoutIncrement, // _timeoutIncrement
            commitment,      // _commitment
            numBlocks,       // _numBlocks
            numGates,        // _numGates
            pkVendor,        // _vendorSigner (utilise vendor par défaut)
            { 
                value: parseEther("1"), // Le sponsor envoie de l'ETH ici
                nonce: currentNonce, // Spécifier explicitement le nonce pour éviter les conflits
            }
        );
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    // Déposer un petit montant sur l'EntryPoint pour sponsoriser les UserOps.
    // Ce dépôt sera récupéré par le sponsor dans completeTransaction().
    const entryPointDeposit = parseEther("0.01");
    if (entryPointDeposit > 0n) {
        const entryPointContract = new Contract(
            entryPoint,
            ["function depositTo(address) payable", "function balanceOf(address) view returns (uint256)"],
            wallet
        );
        const depositTx = await entryPointContract.depositTo(contractAddress, {
            value: entryPointDeposit,
        });
        await depositTx.wait();
    }

    // Générer une session key pour le vendor (même si OptimisticSOX ne l'utilise pas directement)
    // On la retourne pour compatibilité avec le code existant
    const sessionKeyWallet = Wallet.createRandom();
    const sessionKeyPrivateKey = sessionKeyWallet.privateKey;
    const sessionKeyAddress = await sessionKeyWallet.getAddress();

    return {
        contractAddress,
        sessionKeyPrivateKey,
        sessionKeyAddress,
    };
}

/**
 * Gets the current state of the optimistic contract.
 */
export async function getOptimisticState(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    try {
        const contract = await getOptimisticContract(contractAddr);
        return await contract.currState().catch(() => {});
    } catch {
        return;
    }
}

/**
 * Gets the next timeout timestamp for the optimistic contract.
 */
export async function getNextOptimisticTimeout(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    try {
        const contract = await getOptimisticContract(contractAddr);
        return await contract.nextTimeoutTime().catch(() => {});
    } catch {
        return;
    }
}

/**
 * Gets basic information about the contract, optionally including dispute information.
 */
export async function getBasicInfo(
    contractAddr: string,
    withDispute?: boolean
) {
    if (!isAddress(contractAddr)) return;
    
    const contract = await getOptimisticContract(contractAddr);
    let key = await contract.key();

    if (withDispute) {
        let disputeAddr = await contract.disputeContract();
        if (disputeAddr && disputeAddr !== ZeroAddress) {
            const disputeContract = new Contract(disputeAddr, dAccountAbi, PROVIDER);
            try {
                const [state, step9Count, lastLosingPartyWasVendor, currentBuyer, currentVendor] = await Promise.all([
                    disputeContract.currState(),
                    disputeContract.step9Count(),
                    disputeContract.lastLosingPartyWasVendor(),
                    disputeContract.buyer(),
                    disputeContract.vendor(),
                ]);
                
                return {
                    state: state,
                    key: key,
                    nextTimeout: await contract.nextTimeoutTime(),
                    commitment: await contract.commitment(),
                    step9Count: Number(step9Count),
                    lastLosingPartyWasVendor: lastLosingPartyWasVendor,
                    currentBuyer: currentBuyer,
                    currentVendor: currentVendor,
                };
            } catch (error) {
                console.error("Error fetching dispute state:", error);
                return {
                    state: await disputeContract.currState().catch(() => 0),
                    key: key,
                    nextTimeout: await contract.nextTimeoutTime(),
                    commitment: await contract.commitment(),
                    step9Count: 0,
                    lastLosingPartyWasVendor: false,
                    currentBuyer: null,
                    currentVendor: null,
                };
            }
        }
    }

    return {
        state: await contract.currState(),
        key: key,
        nextTimeout: await contract.nextTimeoutTime(),
        commitment: await contract.commitment(),
    };
}

/**
 * Gets detailed information about the contract including all addresses, deposits, and parameters.
 */
export async function getDetails(contractAddr: string) {
    if (!isAddress(contractAddr)) return;
    
    const contract = await getOptimisticContract(contractAddr);

    return {
        state: await contract.currState(),
        key: await contract.key(),
        nextTimeout: await contract.nextTimeoutTime(),
        buyer: await contract.buyer(),
        vendor: await contract.vendor(),
        sponsor: await contract.sponsor(),
        bSponsor: await contract.buyerDisputeSponsor(),
        vSponsor: await contract.vendorDisputeSponsor(),
        completionTip: await contract.completionTip(),
        disputeTip: await contract.disputeTip(),
        sponsorDeposit: await contract.sponsorDeposit(),
        buyerDeposit: await contract.buyerDeposit(),
        bSponsorDeposit: await contract.sbDeposit(),
        vSponsorDeposit: await contract.svDeposit(),
        commitment: await contract.commitment(),
        numBlocks: await contract.numBlocks(),
        numGates: await contract.numGates(),
    };
}

export type PaymentMode = "eip-7702" | "direct";

export type PaymentResult =
    | {
          mode: "eip-7702";
          userOpHash: string;
          transactionHash?: string;
          receipt?: UserOperationReceipt;
      }
    | {
          mode: "direct";
          transactionHash: string;
      };

export type SendPaymentOptions = {
    mode?: PaymentMode;
    waitForReceipt?: boolean;
    receiptTimeoutMs?: number;
};

/**
 * Envoie juste l'autorisation EIP-7702 dans une transaction type 0x04
 * L'autorisation est envoyée par le sponsor qui la postera sur la blockchain
 * L'autorisation active les capacités de compte abstrait pour une adresse EOA
 */
async function sendEip7702Authorization(
    payerAddr: string,
    contractAddr: string,
    delegate: string,
    authorization: any,
    options?: { 
        transport?: "auto" | "bundler" | "rpc";
        value?: bigint; // Montant à transférer (optionnel, pour inclure le paiement)
        data?: string; // CallData pour appeler une fonction (optionnel)
    }
): Promise<string> {
    // Récupérer l'adresse du sponsor pour qu'il paie les frais de transaction
    const contract = await getOptimisticContract(contractAddr);
    const sponsorAddr = await contract.sponsor();
    const sponsorKey = PK_SK_MAP.get(sponsorAddr);
    
    if (!sponsorKey) {
        throw new Error("Sponsor private key not found for paying EIP-7702 authorization transaction fees");
    }
    
    // Le sponsor signe et paie la transaction EIP-7702
    // L'autorisation dans authorizationList est pour payerAddr (le buyer)
    // Cela active les capacités de compte abstrait pour payerAddr
    // Le sponsor paie les frais, l'autorisation est pour le buyer
    const wallet = new Wallet(sponsorKey, PROVIDER);
    const network = await PROVIDER.getNetwork();
    const chainId = Number(network.chainId);
    
    // Récupérer le nonce juste avant de construire la transaction
    // Utiliser "pending" pour inclure les transactions en attente et éviter "nonce too low"
    // On récupère le nonce juste avant de signer pour qu'il soit à jour
    const getCurrentNonce = async () => {
        return await PROVIDER.getTransactionCount(sponsorAddr, "pending");
    };
    
    // Récupérer le nonce maintenant (mais on le récupérera à nouveau juste avant de signer si nécessaire)
    let nonce = await getCurrentNonce();
    
    // Préparer les données pour une transaction type 0x04 (EIP-7702)
    // Format: 0x04 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, 
    //                       gas_limit, destination, value, data, access_list, authorization_list, 
    //                       signature_y_parity, signature_r, signature_s])
    
    // Obtenir les prix du gaz
    const feeData = await PROVIDER.getFeeData();
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 0n;
    const maxFeePerGas = feeData.maxFeePerGas || 0n;
    // Gas limit plus élevé si on inclut un paiement (data non vide)
    const gasLimit = options?.data ? 100000n : 21000n;
    
    // Helper pour convertir en hex pour toRlp de viem (doit avoir le préfixe 0x)
    const toHex = (value: bigint | number | string): Hex => {
        if (typeof value === 'string') {
            if (value.startsWith('0x')) {
                return value as Hex;
            }
            return `0x${value}` as Hex;
        }
        const num = typeof value === 'bigint' ? value : BigInt(value);
        if (num === 0n) return '0x' as Hex;
        return toBeHex(num) as Hex;
    };
    
    // Helper pour convertir en hex sans préfixe (pour les strings hex déjà avec 0x)
    const toHexWithoutPrefix = (value: string): Hex => {
        if (value.startsWith('0x')) {
            return value as Hex;
        }
        return `0x${value}` as Hex;
    };
    
    // Encoder l'autorisation pour authorizationList
    const encodedAuth: Hex[] = [
        toHex(BigInt(chainId)),
        toHexWithoutPrefix(authorization.address),
        toHex(BigInt(authorization.nonce)),
        toHex(authorization.yParity ?? 0),
        toHexWithoutPrefix(authorization.r),
        toHexWithoutPrefix(authorization.s),
    ];
    
    // Transaction payload sans signature (format pour toRlp)
    // toRlp accepte un RecursiveArray de Hex
    // Si on inclut un paiement, destination = delegate (pour utiliser execute), sinon = payerAddr
    const destination = options?.data ? delegate : payerAddr;
    const value = options?.value || 0n;
    const data = options?.data || '0x';
    
    // Fonction helper pour construire txData avec un nonce donné
    const buildTxData = (currentNonce: number): (Hex | Hex[] | Hex[][])[] => {
        return [
            toHex(BigInt(chainId)),
            toHex(BigInt(currentNonce)),
            toHex(maxPriorityFeePerGas),
            toHex(maxFeePerGas),
            toHex(gasLimit),
            toHexWithoutPrefix(destination), // Destination: delegate si paiement, sinon payerAddr
            toHex(value), // Value: montant si paiement inclus, sinon 0
            toHexWithoutPrefix(data), // Data: callData pour paiement, sinon vide
            [] as Hex[], // Access list: vide
            [encodedAuth] as Hex[][], // Authorization list avec notre autorisation (array d'arrays)
        ];
    };
    
    // Construire txData avec le nonce initial
    let txData = buildTxData(nonce);
    
    // Vérifier à nouveau le nonce juste avant de signer pour éviter "nonce too low"
    const latestNonce = await getCurrentNonce();
    if (latestNonce !== nonce) {
        nonce = latestNonce;
        txData = buildTxData(nonce);
    }
    
    // Encoder en RLP avec toRlp de viem
    const encodedTx = toRlp(txData) as Hex;
    
    // Hasher la transaction (digest brut à signer)
    const txHash = keccak256(concatHex(['0x04' as Hex, encodedTx]) as string);

    // IMPORTANT: signer le digest brut (pas signMessage, qui ajoute le prefix EIP-191)
    const sig = wallet.signingKey.sign(txHash);
    const yParity = sig.yParity; // 0 or 1
    const r = sig.r;
    const s = sig.s;
    
    // Ajouter la signature à la transaction
    const signedTxData: (Hex | Hex[] | Hex[][])[] = [
        ...txData,
        toHex(BigInt(yParity)),
        toHexWithoutPrefix(r),
        toHexWithoutPrefix(s),
    ];
    
    // Encoder la transaction signée
    const signedTx = concatHex(['0x04' as Hex, toRlp(signedTxData) as Hex]);
    
    const transport = options?.transport ?? "auto";

    // Option: envoyer direct au node RPC (le sponsor paye les frais de cette tx 0x04)
    if (transport === "rpc") {
        return await PROVIDER.send("eth_sendRawTransaction", [signedTx]);
    }

    // Option: envoyer au bundler (qui la postera), sinon fallback RPC si auto
    if (transport === "bundler" || transport === "auto") {
        if (!BUNDLER_URL) {
            if (transport === "bundler") {
                throw new Error("NEXT_PUBLIC_BUNDLER_URL is not set.");
            }
        } else {
            try {
                const response = await fetch(BUNDLER_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "eth_sendRawTransaction",
                        params: [signedTx],
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Bundler HTTP error (${response.status})`);
                }

                const payload = await response.json();
                if (payload.error) {
                    throw new Error(
                        payload.error.message || "Bundler rejected transaction"
                    );
                }

                return payload.result as string;
            } catch (error: any) {
                if (transport === "bundler") {
                    throw error;
                }
                console.warn(
                    "Bundler sendRawTransaction failed, falling back to RPC:",
                    error?.message || error
                );
            }
        }
    }

    return await PROVIDER.send("eth_sendRawTransaction", [signedTx]);
}

/**
 * Sends payment from the buyer to the contract. Supports both direct transactions and ERC-4337 user operations.
 */
export async function sendPayment(
    payerAddr: string,
    contractAddr: string,
    amount: number,
    options?: SendPaymentOptions
): Promise<PaymentResult> {
    const contract = await getOptimisticContract(contractAddr);
    
    const privateKey = PK_SK_MAP.get(payerAddr);
    if (!privateKey) {
        throw new Error("Private key not found for payer address");
    }
    const mode = options?.mode ?? "direct";
    const amountWei = BigInt(amount);
    
    // Vérifier l'état du contrat, l'adresse du buyer et le montant requis avant d'envoyer
    const currentState = await contract.currState();
    const buyer = await contract.buyer();
    const agreedPrice = await contract.agreedPrice();
    const completionTip = await contract.completionTip();
    const requiredAmount = agreedPrice + completionTip;
    
    const wallet = new Wallet(privateKey, PROVIDER);
    const walletAddress = await wallet.getAddress();
    
    if (currentState !== 0n) {
        const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
        const stateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
        throw new Error(
            `Le contrat n'est pas dans l'état WaitPayment. État actuel: ${stateName} (${currentState}). ` +
            `Le buyer doit envoyer le paiement quand le contrat est dans l'état WaitPayment.`
        );
    }
    
    // Vérifier que l'adresse du payer correspond au buyer
    if (buyer.toLowerCase() !== payerAddr.toLowerCase()) {
        throw new Error(
            `L'adresse du payer (${payerAddr}) ne correspond pas au buyer du contrat (${buyer}). ` +
            `Seul le buyer peut envoyer le paiement.`
        );
    }
    
    // Vérifier que le montant est suffisant
    if (amountWei < requiredAmount) {
        throw new Error(
            `Le montant fourni (${amount} wei) est insuffisant. ` +
            `Montant requis: ${requiredAmount.toString()} wei (agreedPrice: ${agreedPrice.toString()} + completionTip: ${completionTip.toString()}).`
        );
    }

    if (mode === "eip-7702") {
        if (!ENTRY_POINT_V8 || !EIP7702_DELEGATE) {
            throw new Error(
                "EIP-7702 n'est pas configuré. Déployez le delegate et définissez NEXT_PUBLIC_EIP7702_DELEGATE."
            );
        }

        const entryPoint = requireEntryPointV8();
        const delegate = requireEip7702Delegate();

        const sendPaymentData = contract.interface.encodeFunctionData("sendPayment");
        const delegateInterface = new Contract(
            delegate,
            ["function execute(address target,uint256 value,bytes data)"]
        ).interface;
        const executeData = delegateInterface.encodeFunctionData("execute", [
            contractAddr,
            amountWei,
            sendPaymentData,
        ]);

        const userOpHash = await sendUserOperationV8({
            sender: payerAddr,
            callData: executeData,
            signerPrivateKey: privateKey,
            entryPoint,
            delegate,
        });

        let receipt: UserOperationReceipt | undefined;
        let transactionHash: string | undefined;
        if (options?.waitForReceipt) {
            receipt = await waitForUserOperationReceipt(userOpHash, {
                timeoutMs: options.receiptTimeoutMs,
            });
            transactionHash = receipt?.receipt?.transactionHash;
        }

        return {
            mode: "eip-7702",
            userOpHash,
            transactionHash,
            receipt,
        };
    }

    // OPTION A: Transaction normale (sans EIP-7702) pour tester les autres méthodes de sponsoring
    // Le buyer paie directement avec une transaction normale
    
    // Construire un message d'erreur détaillé en cas d'échec
    const diagnosticInfo = {
        currentState: Number(currentState),
        buyerAddress: buyer,
        payerAddress: payerAddr,
        walletAddress: walletAddress,
        amountProvided: amount.toString(),
        requiredAmount: requiredAmount.toString(),
        agreedPrice: agreedPrice.toString(),
        completionTip: completionTip.toString(),
    };
    
    try {
        const tx = await (contract.connect(wallet) as Contract).sendPayment({
            value: amount,
        });
        
        if (options?.waitForReceipt) {
            await tx.wait();
        }
        
        return { mode: "direct", transactionHash: tx.hash } satisfies PaymentResult;
    } catch (error: any) {
        // Construire un message d'erreur détaillé
        let errorMessage = "Erreur lors du paiement: ";
        
        if (error.reason) {
            errorMessage += error.reason;
        } else if (error.message) {
            errorMessage += error.message;
        } else {
            errorMessage += "Transaction rejetée par le contrat";
        }
        
        errorMessage += `\n\nDétails de diagnostic:\n`;
        errorMessage += `- État du contrat: ${currentState} (attendu: 0 = WaitPayment)\n`;
        errorMessage += `- Adresse du buyer dans le contrat: ${buyer}\n`;
        errorMessage += `- Adresse utilisée pour payer: ${payerAddr}\n`;
        errorMessage += `- Adresse du wallet: ${walletAddress}\n`;
        errorMessage += `- Montant fourni: ${amount} wei\n`;
        errorMessage += `- Montant requis: ${requiredAmount.toString()} wei (agreedPrice: ${agreedPrice.toString()} + completionTip: ${completionTip.toString()})`;
        
        // Vérifier les conditions spécifiques
        if (buyer.toLowerCase() !== payerAddr.toLowerCase()) {
            errorMessage += `\n\n❌ PROBLÈME DÉTECTÉ: L'adresse du payer (${payerAddr}) ne correspond pas au buyer du contrat (${buyer}).`;
        }
        if (BigInt(amount) < requiredAmount) {
            errorMessage += `\n\n❌ PROBLÈME DÉTECTÉ: Le montant fourni (${amount}) est insuffisant. Montant requis: ${requiredAmount.toString()}`;
        }
        if (currentState !== 0n) {
            const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
            const stateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
            errorMessage += `\n\n❌ PROBLÈME DÉTECTÉ: Le contrat n'est pas dans l'état WaitPayment. État actuel: ${stateName}`;
        }
        
        throw new Error(errorMessage);
    }
}

/**
 * Sends the decryption key from the vendor to the contract.
 */
export async function sendKey(
    vendorAddr: string,
    contractAddr: string,
    key: string
) {
    // Détecter automatiquement le type de contrat
    const contract = await getOptimisticContract(contractAddr);
    
    const privateKey = PK_SK_MAP.get(vendorAddr);
    if (!privateKey) {
        throw new Error("Private key not found for vendor address");
    }

    // Vérifier l'état du contrat avant d'appeler sendKey
    const currentState = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const currentStateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
    
    // WaitKey = 1 (enum: WaitPayment=0, WaitKey=1, WaitSB=2, WaitSV=3, InDispute=4, End=5)
    if (currentState !== 1n) {
        // Récupérer plus d'informations pour le diagnostic
        let buyer: string | null = null;
        let vendor: string | null = null;
        let buyerDeposit: bigint | null = null;
        
        try {
            buyer = await contract.buyer();
            vendor = await contract.vendor();
            buyerDeposit = await contract.buyerDeposit();
        } catch {
            // Ignorer les erreurs de lecture
        }
        
        let diagnosticInfo = `Cannot send key: contract is in state "${currentStateName}" (${currentState}). ` +
            `Expected state: "WaitKey" (1).`;
        
        if (currentState === 0n) { // WaitPayment
            diagnosticInfo += ` The buyer must send payment first.`;
            if (buyer) {
                diagnosticInfo += ` Buyer address: ${buyer}.`;
            }
            if (buyerDeposit !== null) {
                diagnosticInfo += ` Buyer deposit: ${buyerDeposit.toString()} wei.`;
            }
        } else if (currentState === 2n) { // WaitSB
            diagnosticInfo += ` The key has already been sent. Waiting for buyer dispute sponsor.`;
        } else if (currentState === 3n) { // WaitSV
            diagnosticInfo += ` Waiting for vendor dispute sponsor.`;
        } else if (currentState === 4n) { // InDispute
            diagnosticInfo += ` The contract is already in dispute.`;
        } else if (currentState === 5n) { // End
            diagnosticInfo += ` The contract has ended.`;
        }
        
        throw new Error(diagnosticInfo);
    }

    // Vérifier que l'appelant est bien le vendor
    const vendor = await contract.vendor();
    const wallet = new Wallet(privateKey, PROVIDER);
    const walletAddress = await wallet.getAddress();
    
    // Pour OptimisticSOXAccount, vérifier aussi le vendorSigner
    const vendorSigner = await contract.vendorSigner();
    
    const isVendor = vendor.toLowerCase() === walletAddress.toLowerCase();
    const isVendorSigner = vendorSigner && vendorSigner.toLowerCase() === walletAddress.toLowerCase();
    
    if (!isVendor && !isVendorSigner) {
        throw new Error(
            `Cannot send key: caller address (${walletAddress}) is not the vendor (${vendor})` +
            (vendorSigner ? ` or vendor signer (${vendorSigner})` : "")
        );
    }

    // Formater la clé correctement (en format hex string)
    // Exiger exactement 16 bytes (32 hex chars) pour éviter les tronquages.
    let keyBytes: string;
    
    if (!key || key === "0x") {
        // Clé vide ou non fournie
        keyBytes = "0x";
    } else if (key.startsWith("0x")) {
        // Déjà en format hex avec préfixe
        keyBytes = key;
    } else {
        // String hex sans préfixe, ajouter "0x"
        keyBytes = "0x" + key;
    }

    let keyLength = 0;
    try {
        keyLength = getBytes(keyBytes).length;
    } catch (e: any) {
        throw new Error(
            `Invalid key format. Expected hex string (0x + 32 hex chars). ` +
            `Original error: ${e?.message || e?.toString() || "Unknown error"}`
        );
    }

    if (keyLength !== 16) {
        throw new Error(
            `Invalid key length: ${keyLength} bytes. Expected 16 bytes ` +
            `(0x + 32 hex chars).`
        );
    }

    try {
        // Récupérer l'EntryPoint depuis le contrat (il peut différer de la config)
        const contractEntryPoint = await contract.entryPoint();
        
        // Encoder l'appel sendKey
        const sendKeyData = contract.interface.encodeFunctionData("sendKey", [keyBytes]);
        
        // Encoder execute(self, 0, sendKeyData) pour UserOperation
        const executeData = contract.interface.encodeFunctionData("execute", [
            contractAddr,
            0,
            sendKeyData,
        ]);

        // Envoyer via UserOperation (fees sponsorisées depuis le deposit EntryPoint)
        // Utiliser l'EntryPoint du contrat, pas celui de la config
        return await sendUserOperation({
            sender: contractAddr,
            callData: executeData,
            signerPrivateKey: privateKey,
            entryPoint: contractEntryPoint, // Utiliser l'EntryPoint du contrat
        });
    } catch (e: any) {
        // Améliorer le message d'erreur avec plus de contexte
        const errorMessage = e?.reason || e?.message || e?.toString() || "Unknown error";
        throw new Error(
            `Failed to send key via UserOperation: ${errorMessage}. ` +
            `Contract state: ${currentStateName} (${currentState}), ` +
            `Contract type: OptimisticSOXAccount, ` +
            `Caller: ${walletAddress}, ` +
            `Vendor: ${vendor}${vendorSigner ? `, VendorSigner: ${vendorSigner}` : ""}`
        );
    }
}

/**
 * Helper function to sync sponsor and dispute contract to database
 */
async function syncSponsorToDatabase(
    contractAddr: string,
    sponsorAddr: string,
    disputeContractAddr?: string
) {
    try {
        const response = await fetch('/api/sponsored-contracts/by-address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optimistic_smart_contract: contractAddr }),
        });

        if (response.ok) {
            const { contract_id } = await response.json();
            if (contract_id) {
                // Mettre à jour le sponsor dans la base de données
                await fetch('/api/disputes/register-sponsor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contract_id: contract_id.toString(),
                        pk_sponsor: sponsorAddr,
                    }),
                });

                // Si un contrat de dispute a été déployé, le mettre à jour aussi
                if (disputeContractAddr) {
                    await fetch('/api/disputes/set-contract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contract_id: contract_id.toString(),
                            dispute_smart_contract: disputeContractAddr,
                        }),
                    });
                }
            }
        }
    } catch (dbError) {
        // Database sync failure should not block the transaction
    }
}

/**
 * Sends the buyer dispute sponsor fee to the contract.
 */
export async function sendSbFee(sbAddr: string, contractAddr: string) {
    const contract = await getOptimisticContract(contractAddr);
    
    const privateKey = PK_SK_MAP.get(sbAddr);
    if (!privateKey) {
        throw new Error(`Private key not found for buyer sponsor address: ${sbAddr}`);
    }

    // Vérifier l'état actuel du contrat
    const currentState = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const currentStateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
    
    // WaitSB = 2 (enum: WaitPayment=0, WaitKey=1, WaitSB=2, WaitSV=3, InDispute=4, End=5)
    if (currentState !== 2n) {
        let diagnosticInfo = `État actuel: "${currentStateName}" (${currentState}). État attendu: "WaitSB" (2). `;
        
        if (currentState === 0n) { // WaitPayment
            diagnosticInfo += `Le buyer doit d'abord envoyer le paiement.`;
        } else if (currentState === 1n) { // WaitKey
            diagnosticInfo += `Le vendor doit d'abord envoyer la clé.`;
        } else if (currentState === 3n) { // WaitSV
            diagnosticInfo += `Le sponsor buyer a déjà envoyé ses frais. Le contrat attend maintenant le sponsor vendor.`;
        } else if (currentState === 4n) { // InDispute
            diagnosticInfo += `Le contrat est déjà en dispute.`;
        } else if (currentState === 5n) { // End
            diagnosticInfo += `Le contrat est terminé.`;
        }
        
        throw new Error(diagnosticInfo);
    }

    // Vérifier si un sponsor buyer n'est pas déjà défini
    let buyerDisputeSponsor: string | null = null;
    try {
        buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    } catch {
        // Ignorer les erreurs de lecture
    }
    
    if (buyerDisputeSponsor && buyerDisputeSponsor !== "0x0000000000000000000000000000000000000000") {
        throw new Error(
            `Buyer dispute sponsor already set: ${buyerDisputeSponsor}. ` +
            `Cannot set a new sponsor.`
        );
    }

    // Récupérer le disputeTip depuis le contrat
    const disputeTip = await contract.disputeTip();
    // DISPUTE_FEES = 10 wei selon le contrat OptimisticSOX.sol
    const DISPUTE_FEES = 10n;
    const requiredAmount = DISPUTE_FEES + disputeTip;

    const wallet = new Wallet(privateKey, PROVIDER);
    const walletAddress = await wallet.getAddress();
    
    try {
        const tx = await (
            contract.connect(wallet) as Contract
        ).sendBuyerDisputeSponsorFee({ value: requiredAmount });
        
        // Attendre la confirmation de la transaction
        await tx.wait();
        
        const registeredSponsor = await contract.buyerDisputeSponsor();
        
        // Synchroniser avec la base de données en utilisant l'adresse du wallet qui a réellement envoyé
        await syncSponsorToDatabase(contractAddr, walletAddress);
        
        return tx;
    } catch (e: any) {
        const errorMessage = e?.reason || e?.message || e?.toString() || "Unknown error";
        throw new Error(
            `Failed to send buyer dispute sponsor fee: ${errorMessage}. ` +
            `Contract state: ${currentStateName} (${currentState}), ` +
            `Required amount: ${requiredAmount.toString()} wei (DISPUTE_FEES: ${DISPUTE_FEES} + disputeTip: ${disputeTip.toString()})`
        );
    }
}

/**
 * Triggers a dispute as the buyer using a sponsored user operation.
 */
export async function triggerDisputeAsBuyerWithUserOp(
    buyerAddr: string,
    contractAddr: string,
    paymasterAddr?: string,
    paymasterVerificationGasLimit: bigint = 500_000n,
    paymasterPostOpGasLimit: bigint = 200_000n
): Promise<string> {
    const contract = await getOptimisticContract(contractAddr);
    
    // Verify contract is in WaitSB state (buyer can trigger dispute after sendKey)
    const currentState = await contract.currState();
    if (currentState !== 2n) { // WaitSB = 2
        const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
        const currentStateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
        throw new Error(
            `Contract must be in WaitSB state to trigger dispute. Current state: ${currentStateName} (${currentState})`
        );
    }

    // Check if buyer dispute sponsor is already set
    let buyerDisputeSponsor: string | null = null;
    try {
        buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    } catch {
        // Ignore read errors
    }
    
    if (buyerDisputeSponsor && buyerDisputeSponsor !== "0x0000000000000000000000000000000000000000") {
        throw new Error(
            `Buyer dispute sponsor already set: ${buyerDisputeSponsor}. Cannot trigger dispute again.`
        );
    }

    // Get required amount (DISPUTE_FEES + disputeTip)
    const disputeTip = await contract.disputeTip();
    const DISPUTE_FEES = 10n; // According to OptimisticSOX.sol
    const requiredAmount = DISPUTE_FEES + disputeTip;

    // Get buyer's private key
    const buyerPrivateKey = PK_SK_MAP.get(buyerAddr);
    if (!buyerPrivateKey) {
        throw new Error(`Private key not found for buyer address: ${buyerAddr}`);
    }

    // Encode the function call: sendBuyerDisputeSponsorFee()
    const callData = contract.interface.encodeFunctionData("sendBuyerDisputeSponsorFee", []);

    // Determine if we should use EIP-7702 or regular user op
    const useEip7702 = ENTRY_POINT_V8 && EIP7702_DELEGATE;
    
    if (useEip7702 && !ENTRY_POINT_V8) {
        throw new Error("ENTRY_POINT_V8 is required for EIP-7702 user operations");
    }

    try {
        let userOpHash: string;

        if (useEip7702) {
            // Use EIP-7702 user operation with paymaster sponsorship
            const entryPoint = requireEntryPointV8();
            const delegate = requireEip7702Delegate();
            
            const paymaster = paymasterAddr ? {
                address: paymasterAddr,
                verificationGasLimit: paymasterVerificationGasLimit,
                postOpGasLimit: paymasterPostOpGasLimit,
                data: "0x" // Empty paymaster data for basic sponsorship
            } : undefined;

            // Note: sendBuyerDisputeSponsorFee() is payable and requires msg.value = DISPUTE_FEES + disputeTip
            // In ERC-4337 user operations, the value field sends ETH from the account to the contract
            // The paymaster sponsors gas fees only, NOT the ETH sent to the contract (value)
            // The buyer account must have enough ETH balance for the value amount
            
            userOpHash = await sendUserOperationV8({
                sender: buyerAddr,
                callData: callData,
                value: requiredAmount, // ETH amount to send to contract (msg.value)
                signerPrivateKey: buyerPrivateKey,
                entryPoint: entryPoint,
                delegate: delegate,
                paymaster: paymaster, // Paymaster sponsors gas fees only, not the value
            });
        } else {
            // Use EIP-7702 user operation for v0.7 or earlier (fallback)
            // Note: On utilise sendUserOperationV8 même pour v0.7 car il supporte le paramètre value
            const entryPointAddr = requireEntryPoint();
            const delegateAddr = requireEip7702Delegate();
            
            userOpHash = await sendUserOperationV8({
                sender: buyerAddr,
                callData: callData,
                value: requiredAmount, // ETH amount to send to contract (msg.value)
                signerPrivateKey: buyerPrivateKey,
                entryPoint: entryPointAddr,
                delegate: delegateAddr,
                paymaster: paymasterAddr ? {
                    address: paymasterAddr,
                    verificationGasLimit: paymasterVerificationGasLimit,
                    postOpGasLimit: paymasterPostOpGasLimit,
                    data: "0x",
                } : undefined,
            });
        }

        // Wait for receipt and verify
        const receipt = await waitForUserOperationReceipt(userOpHash);
        if (!receipt.success) {
            throw new Error(`User operation failed: ${userOpHash}`);
        }

        return userOpHash;
    } catch (e: any) {
        const errorMessage = e?.reason || e?.message || e?.toString() || "Unknown error";
        throw new Error(
            `Failed to trigger dispute as buyer via user operation: ${errorMessage}`
        );
    }
}

/**
 * Sends the vendor dispute sponsor fee to the contract and deploys the dispute contract.
 */
export async function sendSvFee(svAddr: string, contractAddr: string) {
    const contract = await getOptimisticContract(contractAddr);

    const privateKey = PK_SK_MAP.get(svAddr);
    if (!privateKey) {
        throw new Error(`Private key not found for vendor sponsor address: ${svAddr}`);
    }

    // Vérifier l'état actuel du contrat
    const currentState = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const currentStateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;

    // Récupérer plus d'informations pour le diagnostic
    let buyerDisputeSponsor: string | null = null;
    let vendorDisputeSponsor: string | null = null;
    try {
        buyerDisputeSponsor = await contract.buyerDisputeSponsor();
        vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    } catch {
        // Ignorer les erreurs de lecture
    }

    // Vérifier que buyerDisputeSponsor est défini avant de continuer
    if (!buyerDisputeSponsor || buyerDisputeSponsor === "0x0000000000000000000000000000000000000000") {
        throw new Error(
            `❌ Le buyer dispute sponsor n'est pas défini! ` +
            `Vous devez d'abord envoyer les frais du sponsor buyer avec sendBuyerDisputeSponsorFee(). ` +
            `L'état actuel: ${currentStateName} (${currentState}). ` +
            `L'état devrait être WaitSV (3), ce qui signifie que le sponsor buyer a déjà envoyé ses frais.`
        );
    }

    if (currentState !== 3n) { // WaitSV = 3
        let diagnosticInfo = `État actuel: "${currentStateName}" (${currentState}). État attendu: "WaitSV" (3).`;

        if (currentState === 2n) { // WaitSB
            diagnosticInfo += ` Le contrat attend que le sponsor du buyer envoie ses frais d'abord.`;
            if (buyerDisputeSponsor && buyerDisputeSponsor !== "0x0000000000000000000000000000000000000000") {
                diagnosticInfo += ` Sponsor buyer déjà défini: ${buyerDisputeSponsor}.`;
            } else {
                diagnosticInfo += ` Aucun sponsor buyer défini. Vous devez d'abord envoyer les frais du sponsor buyer.`;
            }
        } else if (currentState === 4n) { // InDispute
            diagnosticInfo += ` Le contrat est déjà en dispute.`;
            if (vendorDisputeSponsor && vendorDisputeSponsor !== "0x0000000000000000000000000000000000000000") {
                diagnosticInfo += ` Sponsor vendor déjà défini: ${vendorDisputeSponsor}.`;
            }
        } else if (currentState === 5n) { // End
            diagnosticInfo += ` Le contrat est terminé.`;
        }

        throw new Error(diagnosticInfo);
    }
    
    // (on a déjà récupéré vendorDisputeSponsor plus haut, mais on le récupère à nouveau pour être sûr)
    if (!vendorDisputeSponsor) {
        vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    }
    if (vendorDisputeSponsor && vendorDisputeSponsor !== "0x0000000000000000000000000000000000000000") {
        throw new Error(
            `Vendor dispute sponsor already set: ${vendorDisputeSponsor}. ` +
            `Cannot set a new sponsor.`
        );
    }

    // Récupérer le disputeTip et agreedPrice depuis le contrat
    const disputeTip = await contract.disputeTip();
    const agreedPrice = await contract.agreedPrice();
    // DISPUTE_FEES = 10 wei selon le contrat OptimisticSOX.sol
    const DISPUTE_FEES = 10n;

    const requiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;

    // Vérifier le solde du wallet
    const wallet = new Wallet(privateKey, PROVIDER);
    const walletAddress = await wallet.getAddress();
    const balance = await PROVIDER.getBalance(walletAddress);
    if (balance < requiredAmount) {
        const balanceDetails = `(DISPUTE_FEES: ${DISPUTE_FEES} + disputeTip: ${disputeTip.toString()} + agreedPrice: ${agreedPrice.toString()})`;
        throw new Error(
            `Insufficient balance: have ${balance.toString()} wei, need ${requiredAmount.toString()} wei ${balanceDetails}`
        );
    }

    const contractWithSigner = contract.connect(wallet) as Contract;
    const getErrorMessage = (err: any) => err?.reason || err?.message || err?.toString() || "Unknown error";
    const simulateSend = async (amount: bigint) => {
        try {
            // Utiliser estimateGas au lieu de staticCall pour avoir plus de détails sur les erreurs
            try {
                await contractWithSigner.sendVendorDisputeSponsorFee.estimateGas({ value: amount });
                return null;
            } catch (gasErr: any) {
                // Si estimateGas échoue, essayer staticCall
                await contractWithSigner.sendVendorDisputeSponsorFee.staticCall({ value: amount });
                return null;
            }
        } catch (err: any) {
            // Extraire le message d'erreur détaillé
            const errorMessage = getErrorMessage(err);
            
            // Vérifier si c'est une erreur liée à l'état
            if (errorMessage.includes("InvalidOptimisticState") || errorMessage.includes("currState")) {
                // Vérifier l'état actuel du contrat
                const actualState = await contract.currState();
                const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
                const actualStateName = stateNames[Number(actualState)] || `Unknown (${actualState})`;
                
                return `InvalidOptimisticState: Le contrat est dans l'état ${actualStateName} (${actualState}), mais le constructeur de DisputeSOXAccount attend WaitSV (3). Cela peut arriver si l'état a changé entre la vérification initiale et le déploiement.`;
            }
            
            // Vérifier si c'est une erreur liée aux fonds insuffisants
            if (errorMessage.includes("InsufficientFunds") || errorMessage.includes("agreedPrice")) {
                return `InsufficientFunds: Le montant envoyé au constructeur de DisputeSOXAccount (${totalBalanceAfter.toString()} wei) est inférieur à agreedPrice (${agreedPrice.toString()} wei). DisputeDeployer utilise address(this).balance qui devrait inclure msg.value, mais peut-être que staticCall ne simule pas correctement address(this).balance dans le contexte d'une bibliothèque.`;
            }
            
            return errorMessage;
        }
    };

    const contractBalance = await PROVIDER.getBalance(contractAddr).catch(() => 0n);
    const totalBalanceAfter = contractBalance + requiredAmount;
    
    if (totalBalanceAfter < agreedPrice) {
        throw new Error(
            `Balance insuffisante pour déployer DisputeSOXAccount. ` +
            `Balance totale après envoi: ${totalBalanceAfter.toString()} wei, ` +
            `agreedPrice requis: ${agreedPrice.toString()} wei. ` +
            `DisputeDeployer déploie avec {value: address(this).balance}, ` +
            `et le constructeur vérifie que msg.value >= agreedPrice.`
        );
    }

    try {
        await contractWithSigner.sendVendorDisputeSponsorFee({
            value: requiredAmount,
        });
        const disputeContractAddr = await contract.disputeContract();
        await syncSponsorToDatabase(contractAddr, walletAddress, disputeContractAddr);
        return disputeContractAddr;
    } catch (e: any) {
        const errorMessage = getErrorMessage(e);
        const totalBalanceAfter = contractBalance + requiredAmount;
        
        // Essayer de décoder l'erreur pour identifier quel require a échoué
        let decodedError = errorMessage;
        
        // Vérifier les différentes erreurs possibles
        if (errorMessage.includes("Cannot run this function in the current state")) {
            decodedError = `❌ L'état du contrat n'est pas WaitSV. État actuel: ${currentStateName} (${currentState}). `;
            decodedError += `Le contrat doit être dans l'état WaitSV (3) pour envoyer les frais du sponsor vendor.`;
        } else if (errorMessage.includes("Not enough money deposited")) {
            decodedError = `❌ Montant insuffisant. `;
            decodedError += `Montant envoyé: ${requiredAmount.toString()} wei, `;
            decodedError += `Montant requis: ${DISPUTE_FEES + disputeTip + agreedPrice} wei `;
            decodedError += `(DISPUTE_FEES: ${DISPUTE_FEES} + disputeTip: ${disputeTip.toString()} + agreedPrice: ${agreedPrice.toString()}).`;
        } else if (errorMessage.includes("InvalidOptimisticState") || errorMessage.includes("currState")) {
            decodedError = `❌ L'état du contrat OptimisticSOXAccount n'est pas WaitSV lors du déploiement de DisputeSOXAccount. `;
            decodedError += `Le constructeur de DisputeSOXAccount vérifie que optimisticContract.currState() == WaitSV. `;
            decodedError += `État actuel: ${currentStateName} (${currentState}). `;
            decodedError += `Cela ne devrait jamais arriver car l'état change après le déploiement.`;
        } else if (errorMessage.includes("InsufficientFunds") || errorMessage.includes("agreedPrice")) {
            decodedError = `❌ Fonds insuffisants pour déployer DisputeSOXAccount. `;
            decodedError += `DisputeDeployer envoie address(this).balance (${totalBalanceAfter.toString()} wei) au constructeur, `;
            decodedError += `mais le constructeur vérifie que msg.value >= agreedPrice (${agreedPrice.toString()} wei). `;
            decodedError += `Vérifiez que la balance totale après envoi (${totalBalanceAfter.toString()} wei) >= agreedPrice (${agreedPrice.toString()} wei).`;
        } else if (errorMessage.includes("require(false)") || errorMessage.includes("require(false)")) {
            decodedError = `❌ Un require(false) a été déclenché dans le contrat. `;
            decodedError += `Cela peut venir de plusieurs endroits:\n`;
            decodedError += `   1. Constructeur de DisputeSOXAccount - vérification de l'état (currState)\n`;
            decodedError += `   2. Constructeur de DisputeSOXAccount - vérification des fonds (agreedPrice)\n`;
            decodedError += `   3. Une autre vérification dans le constructeur\n\n`;
            decodedError += `📊 Vérifications actuelles:\n`;
            decodedError += `   - État du contrat: ${currentStateName} (${currentState}) - Attendu: WaitSV (3) ✅\n`;
            decodedError += `   - Montant envoyé: ${requiredAmount.toString()} wei - Attendu: >= ${DISPUTE_FEES + disputeTip + agreedPrice} wei ✅\n`;
            decodedError += `   - Balance après envoi: ${totalBalanceAfter.toString()} wei - Attendu: >= ${agreedPrice.toString()} wei ✅\n`;
            decodedError += `   - buyerDisputeSponsor: ${buyerDisputeSponsor || "❌ Non défini"}\n`;
            decodedError += `   - vendorDisputeSponsor (avant envoi): ${vendorDisputeSponsor || "Non défini"}\n\n`;
            decodedError += `💡 Le problème pourrait venir du fait que:\n`;
            decodedError += `   - Le constructeur de DisputeSOXAccount lit vendorDisputeSponsor depuis l'optimistic contract\n`;
            decodedError += `     alors que la valeur vient d'être définie dans la même transaction\n`;
            decodedError += `     (OptimisticSOXAccount: vendorDisputeSponsor = msg.sender)\n`;
            decodedError += `   - SOLUTION: Passer vendorDisputeSponsor explicitement au constructeur de DisputeSOXAccount\n`;
            decodedError += `     via DisputeDeployer (et redeployer les contracts/libraries si besoin)`;
        }

        let diagnosticInfo = `Échec de l'envoi des frais du sponsor vendor\n\n`;
        diagnosticInfo += decodedError + `\n\n`;
        diagnosticInfo += `📊 Informations du contrat:\n`;
        diagnosticInfo += `   - État: ${currentStateName} (${currentState})\n`;
        diagnosticInfo += `   - Type: OptimisticSOXAccount ✅\n`;
        diagnosticInfo += `   - Buyer dispute sponsor: ${buyerDisputeSponsor || "❌ Non défini"}\n`;
        diagnosticInfo += `   - Vendor dispute sponsor (avant envoi): ${vendorDisputeSponsor || "Non défini"}\n`;
        diagnosticInfo += `   - Montant envoyé: ${requiredAmount.toString()} wei\n`;
        diagnosticInfo += `   - Balance contrat: ${contractBalance.toString()} wei\n`;
        diagnosticInfo += `   - Balance après envoi: ${totalBalanceAfter.toString()} wei\n`;
        diagnosticInfo += `   - agreedPrice: ${agreedPrice.toString()} wei\n`;

        throw new Error(diagnosticInfo);
    }
}

/**
 * Starts a dispute on the contract.
 */
export async function startDispute(sponsorAddr: string, contractAddr: string) {
    const contract = await getOptimisticContract(contractAddr);
    
    const privateKey = PK_SK_MAP.get(sponsorAddr);
    if (!privateKey) return;

    const wallet = new Wallet(privateKey, PROVIDER);
    await (contract.connect(wallet) as Contract).startDispute();

    return await contract.disputeContract();
}

/**
 * Ends the optimistic timeout, allowing the requester to claim timeout.
 */
export async function endOptimisticTimeout(
    contractAddr: string,
    requesterAddr: string
) {
    if (!isAddress(contractAddr)) return;

    const contract = await getOptimisticContract(contractAddr);
    const state = await contract.currState();
    const privateKey = PK_SK_MAP.get(requesterAddr);
    if (!privateKey) return;

    if (state == 2n) {
        // WaitSB: utiliser user operation pour completeTransaction (fees sponsorisées)
        try {
            // Récupérer l'EntryPoint depuis le contrat
            const contractEntryPoint = await contract.entryPoint();
            
            // Encoder l'appel completeTransaction
            const completeTransactionData = contract.interface.encodeFunctionData("completeTransaction");
            
            // Encoder execute(self, 0, completeTransactionData) pour UserOperation
            const executeData = contract.interface.encodeFunctionData("execute", [
                contractAddr,
                0,
                completeTransactionData,
            ]);

            // Envoyer via UserOperation (fees sponsorisées depuis le deposit EntryPoint)
            const userOpHash = await sendUserOperation({
                sender: contractAddr,
                callData: executeData,
                signerPrivateKey: privateKey,
                entryPoint: contractEntryPoint,
            });
            
            // Attendre la confirmation
            const receipt = await waitForUserOperationReceipt(userOpHash);
            if (!receipt.success) {
                throw new Error(`User operation failed: ${userOpHash}`);
            }
            
            return true;
        } catch (error: any) {
            // Si la user operation échoue, fallback sur transaction normale
            // (pour compatibilité avec les anciens contrats ou si pas de deposit EntryPoint)
            console.warn("User operation failed, falling back to direct transaction:", error.message);
            const wallet = new Wallet(privateKey, PROVIDER);
            await (contract.connect(wallet) as Contract).completeTransaction();
            return true;
        }
    } else if (state != 4n && state != 5n) {
        // Autres états: utiliser transaction normale pour cancelTransaction
        const wallet = new Wallet(privateKey, PROVIDER);
        await (contract.connect(wallet) as Contract).cancelTransaction();
        return false;
    } else {
        throw Error("Cannot end transaction when in dispute or already over");
    }
}
