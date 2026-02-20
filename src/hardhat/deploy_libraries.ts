import { writeFileSync } from "fs";
import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
    // Utiliser les signers Hardhat au lieu de PROVIDER pour bénéficier de la config allowUnlimitedContractSize
    const [deployer] = await ethers.getSigners();

    let addresses = new Map();
    for (const lName of [
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "AccumulatorVerifier",
        "CommitmentOpener",
        "DisputeSOXHelpers",
    ]) {
        let factory = await ethers.getContractFactory(lName);
        let lib = await factory.deploy();
        await lib.waitForDeployment();
        addresses.set(lName, await lib.getAddress());
    }

    // circuit evaluator depends on some of the others
    const CircuitEvaluatorFactory = await ethers.getContractFactory(
        "CircuitEvaluator",
        {
            libraries: {
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
                SimpleOperationsEvaluator: await addresses.get(
                    "SimpleOperationsEvaluator"
                ),
                AES128CtrEvaluator: await addresses.get("AES128CtrEvaluator"),
            },
        }
    );
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    addresses.set("CircuitEvaluator", await circuitEvaluator.getAddress());

    // dispute deployer depends on the others
    // Note: DisputeDeployer deploys DisputeSOXAccount which inherits from DisputeSOX
    // DisputeDeployer itself only needs: AccumulatorVerifier, CommitmentOpener, DisputeSOXHelpers
    const DisputeDeployerFactory = await ethers.getContractFactory(
        "DisputeDeployer",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                CommitmentOpener: await addresses.get("CommitmentOpener"),
                DisputeSOXHelpers: await addresses.get("DisputeSOXHelpers"),
            },
        }
    );
    let disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    addresses.set("DisputeDeployer", await disputeDeployer.getAddress());

    // link libraries to contracts
    const optimisticFac = await ethers.getContractFactory("OptimisticSOX", {
        libraries: {
            DisputeDeployer: addresses.get("DisputeDeployer"),
        },
    });

    const optimisticArtifact = await hre.artifacts.readArtifact(
        "OptimisticSOX"
    );

    const optimisticData = {
        abi: optimisticArtifact.abi,
        bytecode: optimisticFac.bytecode,
    };

    const disputeFac = await ethers.getContractFactory("DisputeSOX", {
        libraries: {
            AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
            CommitmentOpener: addresses.get("CommitmentOpener"),
            DisputeSOXHelpers: addresses.get("DisputeSOXHelpers"),
        },
    });

    const disputeArtifact = await hre.artifacts.readArtifact("DisputeSOX");

    const disputeData = {
        abi: disputeArtifact.abi,
        bytecode: disputeFac.bytecode,
    };

    // link libraries to OptimisticSOXAccount
    // IMPORTANT: On génère le bytecode linké avec des adresses de placeholder
    // qui seront remplacées dynamiquement lors du déploiement dans l'application web
    const optimisticAccountFac = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: addresses.get("DisputeDeployer"),
        },
    });

    const optimisticAccountArtifact = await hre.artifacts.readArtifact(
        "OptimisticSOXAccount"
    );

    // Utiliser le bytecode linké (les adresses seront remplacées dynamiquement dans l'app web)
    const optimisticAccountData = {
        abi: optimisticAccountArtifact.abi,
        bytecode: optimisticAccountFac.bytecode, // Bytecode linké avec les adresses actuelles
    };

    const contractsDir = "../app/lib/blockchain/contracts/";
    
    // Écrire les contrats principaux
    writeFileSync(
        contractsDir + "OptimisticSOX.json",
        JSON.stringify(optimisticData)
    );
    writeFileSync(
        contractsDir + "DisputeSOX.json",
        JSON.stringify(disputeData)
    );
    writeFileSync(
        contractsDir + "OptimisticSOXAccount.json",
        JSON.stringify(optimisticAccountData)
    );

    // Écrire les libraries nécessaires pour deploy-libraries.ts
    for (const lName of [
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "AccumulatorVerifier",
        "CommitmentOpener",
        "CircuitEvaluator",
        "DisputeSOXHelpers",
        "DisputeDeployer",
    ]) {
        const artifact = await hre.artifacts.readArtifact(lName);
        let factory;
        
        if (lName === "CircuitEvaluator") {
            factory = await ethers.getContractFactory("CircuitEvaluator", {
                libraries: {
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                    SimpleOperationsEvaluator: addresses.get("SimpleOperationsEvaluator"),
                    AES128CtrEvaluator: addresses.get("AES128CtrEvaluator"),
                },
            });
        } else if (lName === "DisputeDeployer") {
            factory = await ethers.getContractFactory("DisputeDeployer", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    CommitmentOpener: addresses.get("CommitmentOpener"),
                    DisputeSOXHelpers: addresses.get("DisputeSOXHelpers"),
                },
            });
        } else if (lName === "DisputeSOXHelpers") {
            factory = await ethers.getContractFactory("DisputeSOXHelpers");
        } else {
            factory = await ethers.getContractFactory(lName);
        }
        
        const libraryData = {
            abi: artifact.abi,
            bytecode: factory.bytecode,
        };
        
        writeFileSync(
            contractsDir + lName + ".json",
            JSON.stringify(libraryData)
        );
    }

    console.log("✅ Tous les fichiers JSON ont été générés!");
    console.log("  Contrats: OptimisticSOX, DisputeSOX, OptimisticSOXAccount");
    console.log("  Libraries: SHA256Evaluator, SimpleOperationsEvaluator, AES128CtrEvaluator, AccumulatorVerifier, CommitmentOpener, CircuitEvaluator, DisputeSOXHelpers, DisputeDeployer");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
