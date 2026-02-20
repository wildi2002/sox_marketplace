import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ignition-ethers";
import "hardhat-gas-reporter";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.28",
        settings: {
            viaIR: true,
            optimizer: {
                enabled: true,
                runs: 1, // Minimum pour minimiser la taille du bytecode (au détriment du gas d'exécution)
            },
            // Désactiver les revert strings pour réduire encore plus la taille
            metadata: {
                bytecodeHash: "none", // Réduit significativement la taille
            },
        },
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true, // Permettre des contrats de taille illimitée en local
            accounts: [
                // sponsor
                {
                    privateKey:
                        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                    balance: "1000000000000000000000",
                },
                // buyer
                {
                    privateKey:
                        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                    balance: "1000000000000000000000",
                },
                // vendor
                {
                    privateKey:
                        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
                    balance: "1000000000000000000000",
                },
                // buyer dispute sponsor
                {
                    privateKey:
                        "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
                    balance: "1000000000000000000000",
                },
                // vendor dispute sponsor
                {
                    privateKey:
                        "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
                    balance: "1000000000000000000000",
                },
                // extra accounts
                {
                    privateKey:
                        "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
                    balance: "1000000000000000000000",
                },
                {
                    privateKey:
                        "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
                    balance: "1000000000000000000000",
                },
                {
                    privateKey:
                        "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
                    balance: "1000000000000000000000",
                },
                {
                    privateKey:
                        "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
                    balance: "1000000000000000000000",
                },
                {
                    privateKey:
                        "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
                    balance: "1000000000000000000000",
                },
            ],
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            allowUnlimitedContractSize: true, // Permettre des contrats de taille illimitée en local
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS ? true : false,
        coinmarketcap: "8160c5a0-05cc-4e77-a7c7-588e664c90f2",
        L1Etherscan: "69IG94CSPRVEENXIU7IBI3QBYWG8ZKU8W4",
        forceTerminalOutput: true,
        forceTerminalOutputFormat: "terminal",
    },
    mocha: {
        timeout: 3_600_000_000, // 1000h
    },
};

export default config;
