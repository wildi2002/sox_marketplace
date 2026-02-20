import { ethers, isAddress } from "ethers";
import { PROVIDER } from "./config";
import { getNextOptimisticTimeout, getOptimisticState } from "./optimistic";
import { getDisputeState, getNextDisputeTimeout } from "./dispute";

export async function getBalance(publicKey: string) {
    const balance = await PROVIDER.getBalance(publicKey);
    const balanceInEth = ethers.formatEther(balance);
    return balanceInEth;
}

export async function getState(contract: {
    optimistic_smart_contract: string;
    dispute_smart_contract?: string;
}) {
    if (contract.dispute_smart_contract)
        return getDisputeState(contract.dispute_smart_contract);

    return getOptimisticState(contract.optimistic_smart_contract);
}

export async function getNextTimeout(contract: {
    optimistic_smart_contract: string;
    dispute_smart_contract?: string;
}) {
    if (contract.dispute_smart_contract)
        return getNextDisputeTimeout(contract.dispute_smart_contract);

    return getNextOptimisticTimeout(contract.optimistic_smart_contract);
}
