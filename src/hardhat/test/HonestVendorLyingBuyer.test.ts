import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";
import { readFile } from "node:fs/promises";
import { join } from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";
import {
    initSync,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
    compute_proofs_v2,
    compute_proofs_left_v2,
    hpre_v2,
    bytes_to_hex,
} from "../../app/lib/crypto_lib/crypto_lib";

describe("Scénario: Vendor Honnête vs Buyer Menteur", function () {
    let entryPoint: any;
    let vendor: HardhatEthersSigner;
    let buyer: HardhatEthersSigner;
    let sponsor: HardhatEthersSigner;
    let buyerDisputeSponsor: HardhatEthersSigner;
    let vendorDisputeSponsor: HardhatEthersSigner;
    
    let optimisticAccount: any;
    let disputeAccount: any;
    let disputeDeployer: any;
    
    let commitment: { c: string; o: string };
    let key: Uint8Array;
    let itemDescription: Uint8Array;
    let ct: Uint8Array;
    let circuit: Uint8Array;
    let evaluatedCircuit: any;
    let numBlocks: number;
    let numGates: number;
    
    const AGREED_PRICE = parseEther("1.0");
    const COMPLETION_TIP = parseEther("0.1");
    const DISPUTE_TIP = parseEther("0.2");
    const TIMEOUT_INCREMENT = 3600n;
    const SPONSOR_FEES = 5n;
    const DISPUTE_FEES = 10n;
    
    before(async function () {
        [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await ethers.getSigners();
        
        // Initialize WASM
        const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const wasmBytes = await readFile(wasmPath);
        initSync({ module: wasmBytes });
        console.log("✅ WASM initialisé");
        
        // Load test file
        const testFilePath = join(__dirname, "../../../test_65bytes.bin");
        const fileBytes = await readFile(testFilePath);
        itemDescription = new Uint8Array(fileBytes);
        console.log(`✅ Fichier de test chargé: ${itemDescription.length} bytes`);
        
        // Generate AES key
        key = new Uint8Array([
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
        ]);
        console.log(`✅ Clé AES générée: ${bytes_to_hex(key)}`);
        
        // Compute precontract values
        const precontract = compute_precontract_values_v2(itemDescription, key);
        commitment = precontract.commitment;
        ct = precontract.ct;
        circuit = precontract.circuit_bytes;
        numBlocks = precontract.num_blocks;
        numGates = precontract.num_gates;
        console.log(`✅ Precontract calculé: commitment=${ethers.hexlify(new Uint8Array(commitment.c)).slice(0, 20)}...`);
        console.log(`   numBlocks: ${numBlocks}, numGates: ${numGates}`);
        
        // Evaluate circuit
        evaluatedCircuit = evaluate_circuit_v2_wasm(
            circuit,
            ct,
            bytes_to_hex(key)
        );
        console.log(`✅ Circuit évalué`);
        
        // Deploy EntryPoint
        const EntryPointFactory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
        await entryPoint.waitForDeployment();
        console.log(`✅ EntryPoint déployé`);
    });
    
    it("Devrait détecter que le buyer a menti et faire gagner le vendor", async function () {
        this.timeout(300000); // 5 minutes
        
        console.log("\n" + "=".repeat(80));
        console.log("📋 SCÉNARIO: Vendor Honnête vs Buyer Menteur");
        console.log("=".repeat(80));
        
        // Step 1: Deploy DisputeDeployer
        console.log("\n1️⃣ Déploiement de DisputeDeployer...");
        const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();
        
        const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();
        
        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        
        const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        });
        disputeDeployer = await DisputeDeployerFactory.deploy();
        await disputeDeployer.waitForDeployment();
        console.log(`✅ DisputeDeployer déployé: ${await disputeDeployer.getAddress()}`);
        
        // Step 2: Deploy OptimisticSOXAccount
        console.log("\n2️⃣ Déploiement de OptimisticSOXAccount...");
        const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });
        optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            commitment.c,
            numBlocks, // Défini dans before()
            numGates,  // Défini dans before()
            await vendor.getAddress(),
            { value: SPONSOR_FEES }
        );
        await optimisticAccount.waitForDeployment();
        console.log(`✅ OptimisticSOXAccount déployé: ${await optimisticAccount.getAddress()}`);
        
        // Step 3: Setup optimistic phase
        console.log("\n3️⃣ Configuration de la phase optimiste...");
        await optimisticAccount.connect(buyer).sendPayment({ value: AGREED_PRICE + COMPLETION_TIP });
        await optimisticAccount.connect(vendor).sendKey(key);
        await optimisticAccount.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
            value: DISPUTE_FEES + DISPUTE_TIP
        });
        await optimisticAccount.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE
        });
        console.log(`✅ Phase optimiste configurée`);
        
        // Step 4: Get DisputeSOXAccount (automatically deployed)
        console.log("\n4️⃣ Récupération de DisputeSOXAccount...");
        const disputeAddress = await optimisticAccount.disputeContract();
        disputeAccount = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
        console.log(`✅ DisputeSOXAccount trouvé: ${disputeAddress}`);
        
        // Step 5: Binary search - buyer responds with LIES
        console.log("\n5️⃣ Recherche binaire - Buyer répond avec des MENSONGES...");
        let state = Number(await disputeAccount.currState());
        let a = Number(await disputeAccount.a());
        let b = Number(await disputeAccount.b());
        let chall = Number(await disputeAccount.chall());
        
        console.log(`   État initial: ${state}, a=${a}, b=${b}, chall=${chall}`);
        
        // Buyer will lie: give wrong responses
        let phaseCount = 0;
        const maxPhases = 20;
        
        while ((state === 0 || state === 2 || state === 3 || state === 4) && phaseCount < maxPhases) {
            phaseCount++;
            console.log(`\n   📍 Phase ${phaseCount}: État=${state}, a=${a}, b=${b}, chall=${chall}`);
            
            if (state === 0) {
                // ChallengeBuyer - buyer responds with LIE
                const correctHpre = hpre_v2(evaluatedCircuit.to_bytes(), numBlocks, chall);
                const correctHpreHex = bytes_to_hex(correctHpre);
                
                // Buyer LIES: send a different (wrong) value
                const wrongHpre = new Uint8Array(32);
                wrongHpre.fill(0xFF); // Completely wrong value
                const wrongHpreHex = bytes_to_hex(wrongHpre);
                
                console.log(`   🎭 Buyer MENT:`);
                console.log(`      Correct hpre: ${correctHpreHex.slice(0, 20)}...`);
                console.log(`      Wrong hpre:   ${wrongHpreHex.slice(0, 20)}...`);
                
                // Buyer sends wrong response
                const buyerResponse = await disputeAccount.connect(buyer).respondChallenge(
                    wrongHpreHex
                );
                await buyerResponse.wait();
                console.log(`   ✅ Buyer a envoyé une réponse INCORRECTE`);
                
            } else if (state === 2) {
                // WaitVendorOpinion - vendor gives opinion
                const buyerResponse = await disputeAccount.buyerResponses(chall);
                const correctHpre = hpre_v2(evaluatedCircuit.to_bytes(), numBlocks, chall);
                const correctHpreHex = bytes_to_hex(correctHpre);
                const buyerResponseHex = ethers.hexlify(buyerResponse);
                
                const opinion = correctHpreHex.toLowerCase() === buyerResponseHex.toLowerCase();
                console.log(`   💭 Vendor donne son opinion: ${opinion ? "AGREE" : "DISAGREE"}`);
                console.log(`      Correct: ${correctHpreHex.slice(0, 20)}...`);
                console.log(`      Buyer:   ${buyerResponseHex.slice(0, 20)}...`);
                
                // Vendor should disagree because buyer lied
                expect(opinion).to.be.false("Vendor devrait désapprouver car buyer a menti");
                
                const opinionTx = await disputeAccount.connect(vendor).giveOpinion(opinion);
                await opinionTx.wait();
                console.log(`   ✅ Vendor a désapprouvé (correctement)`);
                
            } else if (state === 3) {
                // WaitVendorDataLeft - vendor submits proofs
                console.log(`   📤 Vendor soumet les preuves correctes pour gate ${chall}...`);
                
                const proofs = compute_proofs_left_v2(
                    circuit,
                    evaluatedCircuit.to_bytes(),
                    ct,
                    chall
                );
                
                const gateBytesArray = new Uint8Array(proofs.gate_bytes);
                const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
                const currAccArray = new Uint8Array(proofs.curr_acc);
                const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                
                const submitTx = await disputeAccount.connect(vendor).submitCommitmentLeft(
                    ethers.hexlify(new Uint8Array(commitment.o)),
                    chall,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proofExtArray
                );
                await submitTx.wait();
                console.log(`   ✅ Vendor a soumis les preuves correctes`);
                
            } else if (state === 4) {
                // WaitVendorDataRight - vendor submits proofs
                console.log(`   📤 Vendor soumet les preuves right pour gate ${chall}...`);
                
                const proof = compute_proofs_v2(
                    circuit,
                    evaluatedCircuit.to_bytes(),
                    ct,
                    chall
                );
                
                const gateBytesArray = new Uint8Array(proof.gate_bytes);
                const valuesArray = proof.values.map((v: Uint8Array) => new Uint8Array(v));
                const currAccArray = new Uint8Array(proof.curr_acc);
                const proof1Array = proof.proof1.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof2Array = proof.proof2.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof3Array = proof.proof3.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proofExtArray = proof.proof_ext.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                
                const submitTx = await disputeAccount.connect(vendor).submitCommitment(
                    ethers.hexlify(new Uint8Array(commitment.o)),
                    chall,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proof3Array,
                    proofExtArray
                );
                await submitTx.wait();
                console.log(`   ✅ Vendor a soumis les preuves correctes`);
            }
            
            // Update state
            state = Number(await disputeAccount.currState());
            a = Number(await disputeAccount.a());
            b = Number(await disputeAccount.b());
            chall = Number(await disputeAccount.chall());
        }
        
        // Step 6: Verify final outcome
        console.log("\n6️⃣ Vérification du résultat final...");
        const finalState = Number(await disputeAccount.currState());
        console.log(`   État final: ${finalState}`);
        console.log(`   - 5 = Complete (vendor gagne)`);
        console.log(`   - 6 = Cancel (buyer gagne)`);
        
        // The vendor should win because:
        // 1. Vendor submitted correct proofs
        // 2. Buyer lied (gave wrong responses)
        // 3. Contract should detect the lie and make vendor win
        
        if (finalState === 5) {
            console.log("\n✅ SUCCÈS: Le contrat a correctement détecté que le buyer a menti!");
            console.log("   Le vendor a gagné (Complete)");
            expect(finalState).to.equal(5, "Le vendor devrait gagner car le buyer a menti");
        } else if (finalState === 6) {
            console.log("\n❌ ÉCHEC: Le contrat n'a PAS détecté que le buyer a menti!");
            console.log("   Le buyer a gagné (Cancel) - ce n'est pas correct");
            expect.fail("Le vendor devrait gagner car le buyer a menti, mais le buyer a gagné");
        } else {
            console.log(`\n⚠️  État inattendu: ${finalState}`);
            expect.fail(`État final inattendu: ${finalState}`);
        }
        
        console.log("\n" + "=".repeat(80));
    });
});

