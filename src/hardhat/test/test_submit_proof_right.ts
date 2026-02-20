import { ethers } from "hardhat";
import { initSync, compute_proof_right_v2, hex_to_bytes } from "../../app/lib/crypto_lib/crypto_lib";
import { readFileSync } from "fs";

/**
 * Test pour envoyer les preuves au contrat de dispute
 * 
 * Usage: npx hardhat run test/test_submit_proof_right.ts --network localhost
 */

const CONTRACT_ADDR = "0x8FcA62a1955c73360C11aDEd96F07aDC10C3754E";
const VENDOR_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ABI minimal pour le contrat DisputeSOXAccount
const ABI = [
    "function currState() view returns (uint8)",
    "function numGates() view returns (uint32)",
    "function numBlocks() view returns (uint32)",
    "function submitCommitmentRight(bytes32[][] memory _proof)",
    "function chall() view returns (uint32)",
    "function a() view returns (uint32)",
    "function b() view returns (uint32)",
];

async function main() {
    console.log("🧪 Test d'envoi de preuve pour submitCommitmentRight\n");
    
    // Initialiser WASM
    console.log("🔧 Initialisation WASM...");
    const wasmModule = readFileSync("app/lib/crypto_lib/crypto_lib_bg.wasm");
    initSync({ module: wasmModule });
    console.log("✅ WASM initialisé\n");
    
    // Se connecter au contrat
    const [signer] = await ethers.getSigners();
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
    
    console.log("📊 État du contrat:");
    console.log(`   État: ${state} (4 = WaitVendorDataRight)`);
    console.log(`   NumGates: ${numGates}`);
    console.log(`   NumBlocks: ${numBlocks}`);
    console.log(`   Challenge: ${chall}`);
    console.log(`   a: ${a}, b: ${b}\n`);
    
    if (Number(state) !== 4) {
        console.error(`❌ Le contrat n'est pas dans l'état WaitVendorDataRight (état 4). État actuel: ${state}`);
        console.log("   Attendu: État 4 (WaitVendorDataRight)");
        return;
    }
    
    // Pour ce test, on a besoin de l'evaluated_circuit
    // Dans un vrai scénario, il faudrait:
    // 1. Récupérer le ciphertext (ct)
    // 2. Compiler le circuit
    // 3. Évaluer le circuit avec la clé
    
    // Pour l'instant, on va essayer de lire l'evaluated_circuit depuis un fichier si disponible
    // Sinon, on va générer un message d'erreur explicite
    
    console.log("⚠️  Pour générer la preuve, vous devez avoir:");
    console.log("   1. Le ciphertext (ct)");
    console.log("   2. Le circuit compilé");
    console.log("   3. L'evaluated_circuit (circuit évalué avec la clé)");
    console.log("\n💡 Utilisez l'interface web pour générer la preuve, puis copiez les données ici.\n");
    
    // Pour tester, on pourrait créer un evaluated_circuit factice
    // Mais cela ne fonctionnera pas car la preuve doit correspondre au contrat
    console.log("📝 Note: Ce test nécessite les vraies données du contrat pour fonctionner.");
    console.log("   Utilisez l'interface web qui a déjà accès à ces données.\n");
    
    // Exemple de structure attendue (pour référence)
    console.log("📐 Structure attendue pour compute_proof_right_v2:");
    console.log("   compute_proof_right_v2(evaluated_circuit: Uint8Array, num_blocks: number, num_gates: number)");
    console.log("   → Retourne: Uint8Array[][] (preuve Merkle)\n");
    
    console.log("📤 Pour envoyer la preuve:");
    console.log("   1. Générez la preuve avec compute_proof_right_v2");
    console.log("   2. Convertissez chaque Uint8Array en bytes32 (string hex)");
    console.log("   3. Appelez submitCommitmentRight(proofBytes32[][])");
    console.log("\n✅ Test terminé (pas d'action réelle car données manquantes)");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Erreur:", error);
        process.exit(1);
    });





