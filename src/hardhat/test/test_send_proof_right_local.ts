import { ethers } from "hardhat";
import { 
    initSync, 
    compute_proof_right_v2, 
    hex_to_bytes,
    compile_circuit_v2_wasm,
    evaluate_circuit_v2_wasm
} from "../../app/lib/crypto_lib/crypto_lib";
import { readFileSync } from "fs";
import * as path from "path";

/**
 * Test local pour envoyer les preuves au contrat de dispute
 * 
 * Ce script:
 * 1. Vérifie l'état du contrat
 * 2. Récupère les données nécessaires (ct, circuit, evaluated_circuit)
 * 3. Génère la preuve avec compute_proof_right_v2
 * 4. Envoie la preuve via submitCommitmentRight
 * 
 * Usage: 
 *   npx hardhat run test/test_send_proof_right_local.ts --network localhost
 * 
 * Note: Vous devez avoir les fichiers ct, circuit, et evaluated_circuit, ou
 *       les passer en paramètres via les variables d'environnement.
 */

const CONTRACT_ADDR = "0x8FcA62a1955c73360C11aDEd96F07aDC10C3754E";
const VENDOR_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat account #0
const RPC_URL = "http://127.0.0.1:8545";

// ABI pour le contrat DisputeSOXAccount
const ABI = [
    "function currState() view returns (uint8)",
    "function numGates() view returns (uint32)",
    "function numBlocks() view returns (uint32)",
    "function submitCommitmentRight(bytes32[][] memory _proof)",
    "function chall() view returns (uint32)",
    "function a() view returns (uint32)",
    "function b() view returns (uint32)",
    "function vendor() view returns (address)",
];

async function main() {
    console.log("🧪 Test d'envoi de preuve pour submitCommitmentRight\n");
    
    // Initialiser WASM
    console.log("🔧 Initialisation WASM...");
    const wasmPath = path.join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmModule = readFileSync(wasmPath);
    initSync({ module: wasmModule });
    console.log("✅ WASM initialisé\n");
    
    // Se connecter au provider et créer le signer
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(VENDOR_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
    
    console.log(`📋 Contrat: ${CONTRACT_ADDR}`);
    console.log(`👤 Signer: ${await signer.getAddress()}\n`);
    
    // Vérifier l'état
    const state = await contract.currState();
    const numGates = await contract.numGates();
    const numBlocks = await contract.numBlocks();
    const chall = await contract.chall();
    const a = await contract.a();
    const b = await contract.b();
    const vendorAddr = await contract.vendor();
    
    console.log("📊 État du contrat:");
    console.log(`   État: ${state} (4 = WaitVendorDataRight)`);
    console.log(`   NumGates: ${numGates}`);
    console.log(`   NumBlocks: ${numBlocks}`);
    console.log(`   Challenge: ${chall}`);
    console.log(`   a: ${a}, b: ${b}`);
    console.log(`   Vendor: ${vendorAddr}\n`);
    
    if (Number(state) !== 4) {
        console.error(`❌ Le contrat n'est pas dans l'état WaitVendorDataRight (état 4). État actuel: ${state}`);
        console.log("   Attendu: État 4 (WaitVendorDataRight)");
        return;
    }
    
    // Vérifier que le signer est le vendor
    const signerAddr = await signer.getAddress();
    if (signerAddr.toLowerCase() !== vendorAddr.toLowerCase()) {
        console.error(`❌ Le signer (${signerAddr}) n'est pas le vendor (${vendorAddr})`);
        console.log("   Utilisez la clé privée du vendor pour signer la transaction");
        return;
    }
    
    // Pour générer la preuve, on a besoin de:
    // 1. Le ciphertext (ct)
    // 2. Le circuit compilé OU la description de l'item pour compiler le circuit
    // 3. La clé pour évaluer le circuit
    
    // Dans un scénario réel, ces données viendraient de l'interface web
    // Pour ce test, on va demander à l'utilisateur de fournir ces données
    
    console.log("📦 Pour générer la preuve, vous devez fournir:");
    console.log("   1. Le ciphertext (ct) - Uint8Array");
    console.log("   2. La description de l'item (item_description) - hex string");
    console.log("   3. La clé de décryptage (key) - hex string");
    console.log("\n⚠️  Ces données doivent correspondre aux données utilisées lors de la création du contrat.\n");
    
    // Exemple: Si vous avez ces données, vous pouvez les utiliser ici
    // Pour l'instant, on va juste montrer comment structurer le code
    
    console.log("📝 Code pour générer la preuve (une fois que vous avez les données):");
    console.log(`
    // 1. Compiler le circuit
    const circuit = compile_circuit_v2_wasm(ct, item_description);
    
    // 2. Évaluer le circuit avec la clé
    const evaluated_circuit = evaluate_circuit_v2_wasm(circuit, ct, key).to_bytes();
    
    // 3. Générer la preuve
    const proof = compute_proof_right_v2(evaluated_circuit, numBlocks, numGates);
    
    // 4. Convertir la preuve en bytes32[][]
    const proofBytes32: string[][] = proof.map(layer => 
        layer.map(item => ethers.hexlify(new Uint8Array(item)))
    );
    
    // 5. Envoyer la preuve
    const tx = await contract.submitCommitmentRight(proofBytes32);
    await tx.wait();
    `);
    
    console.log("\n💡 Pour obtenir ces données:");
    console.log("   - Utilisez l'interface web qui a déjà accès à ces données");
    console.log("   - Ou récupérez-les depuis le backend/API");
    console.log("   - Ou stockez-les lors de la création du contrat\n");
    
    console.log("✅ Test terminé (code d'exemple fourni, pas d'action réelle)");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Erreur:", error);
        console.error("Stack:", error.stack);
        process.exit(1);
    });





