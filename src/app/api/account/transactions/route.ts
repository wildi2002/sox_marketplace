import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";
import { PROVIDER } from "@/app/lib/blockchain/config";

/**
 * Scans all blocks for transactions initiated BY userAddress that interact with
 * any of the given contract addresses (either calls or deployments).
 * Returns a map: contractAddress (lowercase) → total gas fee paid in Wei (bigint).
 * Uses raw JSON-RPC calls to reliably access effectiveGasPrice.
 */
async function getGasForContracts(
    userAddress: string,
    contractAddresses: string[]
): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    if (!contractAddresses.length) return result;

    const contractSet = new Set(contractAddresses.map(a => a.toLowerCase()));
    const userLower = userAddress.toLowerCase();

    const blockNumber = await PROVIDER.getBlockNumber();

    for (let b = 1; b <= blockNumber; b++) {
        const hexBlock = "0x" + b.toString(16);
        // Raw RPC: returns full tx objects with from/to/hash fields
        const block = await PROVIDER.send("eth_getBlockByNumber", [hexBlock, true]) as any;
        if (!block || !Array.isArray(block.transactions)) continue;

        for (const tx of block.transactions) {
            if (tx.from?.toLowerCase() !== userLower) continue;

            // Raw RPC: receipt has effectiveGasPrice as hex string
            const receipt = await PROVIDER.send("eth_getTransactionReceipt", [tx.hash]) as any;
            if (!receipt) continue;

            const gasUsed = BigInt(receipt.gasUsed ?? "0x0");
            const gasPrice = BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice ?? "0x0");
            const fee = gasUsed * gasPrice;

            const toAddr = tx.to?.toLowerCase() as string | undefined;
            const createdAddr = receipt.contractAddress?.toLowerCase() as string | undefined;

            if (toAddr && contractSet.has(toAddr)) {
                result.set(toAddr, (result.get(toAddr) ?? 0n) + fee);
            } else if (createdAddr && contractSet.has(createdAddr)) {
                result.set(createdAddr, (result.get(createdAddr) ?? 0n) + fee);
            }
        }
    }

    return result;
}

export async function GET(req: NextRequest) {
    const pk = req.nextUrl.searchParams.get("pk");
    if (!pk) return NextResponse.json({ error: "pk required" }, { status: 400 });
    const pkLower = pk.toLowerCase();

    const contracts = db.prepare(`
        SELECT
            c.id,
            c.pk_buyer,
            c.pk_vendor,
            c.price,
            c.tip_completion,
            c.item_description,
            c.file_name,
            c.sponsor,
            c.optimistic_smart_contract
        FROM contracts c
        WHERE LOWER(c.pk_buyer) = ?
           OR LOWER(c.pk_vendor) = ?
           OR LOWER(c.sponsor) = ?
        ORDER BY c.id ASC
    `).all(pkLower, pkLower, pkLower) as any[];

    // Collect deployed contract addresses for gas scanning
    const deployedAddresses = contracts
        .filter(c => !!c.optimistic_smart_contract)
        .map(c => c.optimistic_smart_contract as string);

    // Scan blockchain for gas fees (best-effort; falls back to null on error)
    let gasMap = new Map<string, bigint>();
    try {
        gasMap = await getGasForContracts(pkLower, deployedAddresses);
    } catch (e) {
        console.error("Gas scanning failed:", e);
    }

    const events: {
        ref: string;
        type: string;
        description: string;
        amount: number;
        status: string;
        gas_wei: string | null;
    }[] = [];

    for (const c of contracts) {
        const isBuyer   = c.pk_buyer?.toLowerCase()  === pkLower;
        const isVendor  = c.pk_vendor?.toLowerCase() === pkLower;
        const isSponsor = c.sponsor?.toLowerCase()   === pkLower;
        const label     = c.file_name || c.item_description || `Contract #${c.id}`;
        const isActive  = !!c.optimistic_smart_contract;
        const gasKey    = c.optimistic_smart_contract?.toLowerCase();
        const gas_wei   = gasKey && gasMap.has(gasKey) ? gasMap.get(gasKey)!.toString() : null;

        if (isBuyer) {
            events.push({
                ref: `Contract #${c.id}`,
                type: "Purchase",
                description: label,
                amount: -((Number(c.price) || 0) + (Number(c.tip_completion) || 0)),
                status: isActive ? "Active" : "Pending",
                gas_wei,
            });
        }
        if (isVendor && !isBuyer) {
            events.push({
                ref: `Contract #${c.id}`,
                type: "Sale",
                description: label,
                amount: Number(c.price) || 0,
                status: isActive ? "Active" : "Pending",
                gas_wei,
            });
        }
        if (isSponsor && !isBuyer && !isVendor) {
            events.push({
                ref: `Contract #${c.id}`,
                type: "Sponsoring",
                description: label,
                amount: -(Number(c.tip_completion) || 0),
                status: isActive ? "Active" : "Pending",
                gas_wei,
            });
        }
    }

    // Newest first; saldo is computed client-side anchored to current on-chain balance
    events.reverse();

    return NextResponse.json(events);
}
