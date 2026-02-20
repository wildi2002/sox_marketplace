import axios from "axios";
import hre from "hardhat";
import entryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";
import accountArtifact from "../artifacts/src/hardhat/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json";

/**
 * Envoie un UserOp au bundler pour appeler execute(sendKey(...)) sur OptimisticSOXAccount.
 * Assure-toi que le smart account est financé via depositToEntryPoint.
 */
async function main() {
    // À ADAPTER : valeurs locales (EntryPoint bundler, account déployé, clé privée vendeur, clé à déposer)
    const bundlerUrl = "http://127.0.0.1:3002/rpc"; // bundler local
    const entryPoint = "0x0000000000000000000000000000000000000000"; // <--- mettre l'EntryPoint loggé par le bundler
    const account = "0x0000000000000000000000000000000000000000"; // <--- adresse de l'OptimisticSOXAccount déployé avec cet EntryPoint
    const vendorPrivKey = "0x0000000000000000000000000000000000000000000000000000000000000000"; // <--- clé privée du vendor/vendorSigner
    const keyToSend = "ma-cle"; // la clé à déposer

    const provider = hre.ethers.provider;
    const vendor = new hre.ethers.Wallet(vendorPrivKey, provider);
    const ep = new hre.ethers.Contract(
        entryPoint,
        entryPointArtifact.abi,
        provider
    );
    const iface = new hre.ethers.Interface(accountArtifact.abi);

    // callData = execute(self, 0, sendKey("ma-cle"))
    const sendKeyData = iface.encodeFunctionData("sendKey", [
        hre.ethers.toUtf8Bytes(keyToSend),
    ]);
    const callData = iface.encodeFunctionData("execute", [
        account,
        0,
        sendKeyData,
    ]);

    // UserOp minimal : ajuste nonce si plusieurs envois
    const userOp: any = {
        sender: account,
        nonce: 0,
        initCode: "0x",
        callData,
        callGasLimit: 3_000_000,
        verificationGasLimit: 500_000,
        preVerificationGas: 50_000,
        maxFeePerGas: hre.ethers.parseUnits("2", "gwei"),
        maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
        paymasterAndData: "0x",
        signature: "0x",
    };

    const userOpHash = await ep.getUserOpHash(userOp);
    const sig = await vendor.signMessage(hre.ethers.getBytes(userOpHash));
    userOp.signature = sig;

    const res = await axios.post(bundlerUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendUserOperation",
        params: [userOp, entryPoint],
    });

    console.log("UserOp sent:", res.data);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
