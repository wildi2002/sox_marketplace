import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";
import { PROVIDER } from "@/app/lib/blockchain/config";
import { Contract, formatEther, parseEther } from "ethers";

const OPTIMISTIC_ABI_MIN = [
    "function currState() view returns (uint8)",
    "function sponsorDeposit() view returns (uint256)",
];

const S = { WaitPayment: 0, WaitKey: 1, WaitSB: 2, WaitSV: 3, InDispute: 4, End: 5 };

function toStatus(state: number | null): string {
    if (state === null) return "Pending";
    if (state === S.WaitPayment) return "Pending";
    if (state === S.End) return "Fulfilled";
    if (state === S.InDispute) return "In Dispute";
    return "Active";
}

type ContractMeta = {
    id: number;
    label: string;
    role: "buyer" | "vendor" | "sponsor" | "dispute_sb" | "dispute_sv";
    price: number;
    tipCompletion: number;
    tipDispute: number;
    state: number | null;
    sponsorDepositWei: bigint;
};

export async function GET(req: NextRequest) {
    const pk = req.nextUrl.searchParams.get("pk");
    if (!pk) return NextResponse.json({ error: "pk required" }, { status: 400 });
    const pkLower = pk.toLowerCase();

    // ── Load contracts and build address → role map ───────────────────────────
    const contracts = db.prepare(`
        SELECT c.id, c.pk_buyer, c.pk_vendor, c.price, c.tip_completion, c.tip_dispute,
               c.item_description, c.file_name, c.sponsor, c.optimistic_smart_contract
        FROM contracts c
        WHERE LOWER(c.pk_buyer) = ? OR LOWER(c.pk_vendor) = ? OR LOWER(c.sponsor) = ?
    `).all(pkLower, pkLower, pkLower) as any[];

    const disputeRecords = db.prepare(`
        SELECT d.contract_id, d.pk_buyer_sponsor, d.pk_vendor_sponsor,
               c.tip_dispute, c.price, c.item_description, c.file_name,
               c.optimistic_smart_contract
        FROM disputes d JOIN contracts c ON d.contract_id = c.id
        WHERE LOWER(d.pk_buyer_sponsor) = ? OR LOWER(d.pk_vendor_sponsor) = ?
    `).all(pkLower, pkLower) as any[];

    // Fetch on-chain state for all deployed contracts in parallel
    const allAddrs = [
        ...contracts.filter(c => c.optimistic_smart_contract).map(c => c.optimistic_smart_contract as string),
        ...disputeRecords.filter(d => d.optimistic_smart_contract).map(d => d.optimistic_smart_contract as string),
    ];
    const uniqueAddrs = [...new Set(allAddrs.map(a => a.toLowerCase()))];

    const onChainArr = await Promise.all(uniqueAddrs.map(async addr => {
        try {
            const c = new Contract(addr, OPTIMISTIC_ABI_MIN, PROVIDER);
            const [state, deposit] = await Promise.all([c.currState(), c.sponsorDeposit()]);
            return { addr, state: Number(state), deposit: BigInt(deposit) };
        } catch {
            return { addr, state: null as number | null, deposit: 0n };
        }
    }));
    const onChain = new Map(onChainArr.map(x => [x.addr, x]));

    // Map: contractAddress → user's role + metadata for that contract
    const byAddr = new Map<string, ContractMeta>();

    for (const c of contracts) {
        if (!c.optimistic_smart_contract) continue;
        const addr = c.optimistic_smart_contract.toLowerCase();
        const isBuyer = c.pk_buyer?.toLowerCase() === pkLower;
        const isVendor = !isBuyer && c.pk_vendor?.toLowerCase() === pkLower;
        const isSponsor = !isBuyer && !isVendor && c.sponsor?.toLowerCase() === pkLower;
        const role = isBuyer ? "buyer" : isVendor ? "vendor" : isSponsor ? "sponsor" : null;
        if (!role) continue;
        const oc = onChain.get(addr);
        byAddr.set(addr, {
            id: c.id,
            label: c.file_name || c.item_description || `Contract #${c.id}`,
            role, price: Number(c.price) || 0,
            tipCompletion: Number(c.tip_completion) || 0,
            tipDispute: Number(c.tip_dispute) || 0,
            state: oc?.state ?? null,
            sponsorDepositWei: oc?.deposit ?? 0n,
        });
    }

    for (const d of disputeRecords) {
        if (!d.optimistic_smart_contract) continue;
        const addr = d.optimistic_smart_contract.toLowerCase();
        if (byAddr.has(addr)) continue;
        const isSB = d.pk_buyer_sponsor?.toLowerCase() === pkLower;
        const isSV = !isSB && d.pk_vendor_sponsor?.toLowerCase() === pkLower;
        const role = isSB ? "dispute_sb" : isSV ? "dispute_sv" : null;
        if (!role) continue;
        const oc = onChain.get(addr);
        byAddr.set(addr, {
            id: d.contract_id,
            label: d.file_name || d.item_description || `Contract #${d.contract_id}`,
            role, price: Number(d.price) || 0,
            tipCompletion: 0, tipDispute: Number(d.tip_dispute) || 0,
            state: oc?.state ?? null, sponsorDepositWei: 0n,
        });
    }

    // ── Blockchain scan ───────────────────────────────────────────────────────
    // For every block: check if balance changed via eth_getBalance.
    // If yes: decompose the change into outgoing (direct TXs) and incoming (internal transfers).
    // The saldo is always eth_getBalance at that block — 100% accurate, no back-calculation.
    //
    // Balance formula per block:
    //   delta = curBal - prevBal
    //   delta = -directSent - gasPaid + internalReceived
    //   → internalReceived = delta + directSent + gasPaid
    //
    // This works even without debug_traceTransaction.
    const blockNumber = await PROVIDER.getBlockNumber();
    const events: {
        ref: string; type: string; description: string;
        amount: number; status: string; gas_wei: string | null;
        saldo: number;
    }[] = [];

    let prevBal = BigInt((await PROVIDER.send("eth_getBalance", [pk, "0x0"])) ?? "0x0");

    for (let b = 1; b <= blockNumber; b++) {
        const hexB = "0x" + b.toString(16);
        const curBal = BigInt((await PROVIDER.send("eth_getBalance", [pk, hexB])) ?? "0x0");
        if (curBal === prevBal) { prevBal = curBal; continue; }

        const block = await PROVIDER.send("eth_getBlockByNumber", [hexB, true]) as any;
        const saldo = parseFloat(formatEther(curBal));

        let gasPaidInBlock = 0n;
        let directSentInBlock = 0n;

        // ── Pass 1: outgoing TXs initiated directly by user ──────────────────
        for (const tx of (block?.transactions ?? [])) {
            const isFromUser = tx.from?.toLowerCase() === pkLower;
            if (!isFromUser) continue;

            const receipt = await PROVIDER.send("eth_getTransactionReceipt", [tx.hash]) as any;
            if (!receipt) continue;

            const gasUsed = BigInt(receipt.gasUsed ?? "0x0");
            const gasPrice = BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice ?? "0x0");
            const gasFee = gasUsed * gasPrice;
            const value = BigInt(tx.value ?? "0x0");

            gasPaidInBlock += gasFee;
            directSentInBlock += value;

            // Determine which contract this TX targets
            const contractCreated = receipt.contractAddress?.toLowerCase();
            const toAddr = contractCreated ?? tx.to?.toLowerCase();
            const meta = toAddr ? byAddr.get(toAddr) : null;
            const ref = meta ? `Contract #${meta.id}` : `TX ${tx.hash.slice(0, 10)}…`;
            const desc = meta ? meta.label : (toAddr ?? "Unknown");

            if (value > 0n) {
                // ETH was sent outbound
                let type = "Transfer";
                let status = "Fulfilled";
                if (meta?.role === "buyer") {
                    type = "Purchase"; status = toStatus(meta.state);
                } else if (meta?.role === "sponsor") {
                    type = "Insurance";
                    status = meta.state !== null ? (meta.state === S.End ? "Fulfilled" : "Active") : "Pending";
                } else if (meta?.role === "dispute_sb") {
                    type = "Dispute SB"; status = toStatus(meta.state);
                } else if (meta?.role === "dispute_sv") {
                    type = "Dispute SV"; status = toStatus(meta.state);
                }
                events.push({
                    ref, type, description: desc,
                    amount: -parseFloat(formatEther(value)),
                    status, gas_wei: gasFee > 0n ? gasFee.toString() : null, saldo,
                });
            } else if (gasFee > 0n) {
                // Gas-only TX (e.g. sending key, completing transaction — 0 ETH value)
                const label = meta ? `${meta.label} — gas` : `${desc} — gas`;
                events.push({
                    ref, type: "Gas", description: label,
                    amount: 0,
                    status: "Fulfilled", gas_wei: gasFee.toString(), saldo,
                });
            }
        }

        // ── Pass 2: incoming ETH (internal transfers from contracts) ─────────
        // internalReceived = balance increase after undoing outflows
        const internalReceived = (curBal - prevBal) + directSentInBlock + gasPaidInBlock;

        // Ignore dust (< 0.00005 ETH) to avoid spurious near-zero entries
        if (internalReceived > 50_000_000_000_000n) {
            // Identify source: find a TX in this block that targets a known contract
            // (the contract's function call triggers the internal transfer to user)
            let sourceMeta: ContractMeta | null = null;
            for (const tx of (block?.transactions ?? [])) {
                const toAddr = tx.to?.toLowerCase();
                if (!toAddr) continue;
                const m = byAddr.get(toAddr);
                if (m) { sourceMeta = m; break; }
            }

            // Fallback: when completeTransaction() was called via UserOp the TX goes to
            // EntryPoint (not the contract), so tx.to won't match byAddr.
            // Match by comparing internalReceived against known contract amounts.
            if (!sourceMeta) {
                for (const [, m] of byAddr) {
                    const priceWei = parseEther(String(m.price));
                    if (m.role === "vendor" &&
                        internalReceived >= priceWei * 95n / 100n &&
                        internalReceived <= priceWei * 105n / 100n) {
                        sourceMeta = m; break;
                    }
                    if (m.role === "sponsor" && m.sponsorDepositWei > 0n &&
                        internalReceived >= m.sponsorDepositWei * 95n / 100n) {
                        sourceMeta = m; break;
                    }
                    if (m.role === "buyer" &&
                        internalReceived >= priceWei * 95n / 100n) {
                        sourceMeta = m; break;
                    }
                    if ((m.role === "dispute_sb" || m.role === "dispute_sv") && m.tipDispute > 0) {
                        const dTipWei = parseEther(String(m.tipDispute));
                        if (internalReceived >= dTipWei * 95n / 100n) { sourceMeta = m; break; }
                    }
                }
            }

            if (sourceMeta?.role === "vendor") {
                // completeTransaction() → contract pays vendor agreedPrice
                events.push({
                    ref: `Contract #${sourceMeta.id}`, type: "Sale",
                    description: sourceMeta.label,
                    amount: parseFloat(formatEther(internalReceived)),
                    status: "Fulfilled", gas_wei: null, saldo,
                });
            } else if (sourceMeta?.role === "sponsor") {
                // completeTransaction() → contract pays sponsor (deposit + tip in one transfer)
                // cancelTransaction(WaitPayment) → only deposit (no tip)
                const depositWei = sourceMeta.sponsorDepositWei;
                const actualDeposit = internalReceived < depositWei ? internalReceived : depositWei;
                const tipWei = internalReceived > depositWei ? internalReceived - depositWei : 0n;
                events.push({
                    ref: `Contract #${sourceMeta.id}`, type: "Return",
                    description: `${sourceMeta.label} — Insurance return`,
                    amount: parseFloat(formatEther(actualDeposit)),
                    status: "Fulfilled", gas_wei: null, saldo,
                });
                if (tipWei > 0n) {
                    events.push({
                        ref: `Contract #${sourceMeta.id}`, type: "Tip",
                        description: `${sourceMeta.label} — Completion tip`,
                        amount: parseFloat(formatEther(tipWei)),
                        status: "Fulfilled", gas_wei: null, saldo,
                    });
                }
            } else if (sourceMeta?.role === "buyer") {
                // cancelTransaction() → contract refunds buyer
                events.push({
                    ref: `Contract #${sourceMeta.id}`, type: "Refund",
                    description: `${sourceMeta.label} — Refund`,
                    amount: parseFloat(formatEther(internalReceived)),
                    status: "Fulfilled", gas_wei: null, saldo,
                });
            } else if (sourceMeta?.role === "dispute_sb" || sourceMeta?.role === "dispute_sv") {
                events.push({
                    ref: `Contract #${sourceMeta.id}`, type: "Dispute Tip",
                    description: `${sourceMeta.label} — Dispute payout`,
                    amount: parseFloat(formatEther(internalReceived)),
                    status: "Fulfilled", gas_wei: null, saldo,
                });
            } else {
                // Unknown source — show it anyway so nothing is hidden
                events.push({
                    ref: `Block #${b}`, type: "Received",
                    description: "Incoming transfer",
                    amount: parseFloat(formatEther(internalReceived)),
                    status: "Fulfilled", gas_wei: null, saldo,
                });
            }
        }

        prevBal = curBal;
    }

    events.reverse();
    return NextResponse.json(events);
}
