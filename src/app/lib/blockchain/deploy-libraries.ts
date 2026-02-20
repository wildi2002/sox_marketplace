import { isAddress } from "ethers";
import deployedContracts from "../../../deployed-contracts.json";
import rootDeployedContracts from "../../../../deployed-contracts.json";

type DeployedContracts = {
    addresses?: Record<string, string>;
    timestamp?: string;
    deployedAt?: string;
};

function getTimestamp(contracts: DeployedContracts): number {
    const raw = contracts.timestamp || contracts.deployedAt;
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Gets deployed library addresses from deployed-contracts.json.
 */
export async function deployLibraries(
    _sponsorAddr: string
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const localContracts = deployedContracts as DeployedContracts;
    const rootContracts = rootDeployedContracts as DeployedContracts;
    const localAddresses = localContracts.addresses || {};
    const rootAddresses = rootContracts.addresses || {};

    const hasRoot = Object.keys(rootAddresses).length > 0;
    const hasLocal = Object.keys(localAddresses).length > 0;
    const useRoot =
        hasRoot && (!hasLocal || getTimestamp(rootContracts) >= getTimestamp(localContracts));

    const addresses = useRoot ? rootAddresses : localAddresses;

    for (const [name, address] of Object.entries(addresses)) {
        if (typeof address === "string" && isAddress(address)) {
            result.set(name, address);
        }
    }

    if (result.size === 0) {
        throw new Error(
            "No deployed library addresses found. Run `npx tsx scripts/deployCompleteStack.ts --network localhost` and rebuild the app."
        );
    }

    return result;
}
