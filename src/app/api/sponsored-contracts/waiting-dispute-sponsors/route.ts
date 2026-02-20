import db from "@/app/lib/sqlite";
import { NextRequest, NextResponse } from "next/server";
import { Contract, isAddress } from "ethers";
import { PROVIDER } from "@/app/lib/blockchain/config";
import { abi as oAbi } from "@/app/lib/blockchain/contracts/OptimisticSOXAccount.json";

export async function GET(req: NextRequest) {
    try {
        // Récupérer tous les contrats sponsorisés qui ont un contrat optimiste déployé
        const stmt = db.prepare(
            `SELECT 
                contracts.id,
                contracts.pk_buyer,
                contracts.pk_vendor,
                contracts.price,
                contracts.tip_completion,
                contracts.tip_dispute,
                contracts.timeout_delay,
                contracts.commitment,
                contracts.num_blocks,
                contracts.num_gates,
                contracts.optimistic_smart_contract,
                disputes.pk_buyer_sponsor,
                disputes.pk_vendor_sponsor,
                disputes.dispute_smart_contract
            FROM contracts 
            LEFT JOIN disputes ON contracts.id = disputes.contract_id
            WHERE 
                contracts.accepted <> 0 AND 
                contracts.sponsor IS NOT NULL AND
                contracts.optimistic_smart_contract IS NOT NULL;`
        );
        
        const contracts = stmt.all() as any[];
        
        // Filtrer pour ne garder que ceux qui sont en état WaitSB ou WaitSV
        const waitingContracts = [];
        
        for (const contract of contracts) {
            try {
                if (!contract.optimistic_smart_contract) {
                    continue;
                }
                if (!isAddress(contract.optimistic_smart_contract)) {
                    console.warn(
                        `Invalid optimistic_smart_contract for contract ${contract.id}:`,
                        contract.optimistic_smart_contract
                    );
                    continue;
                }
                const code = await PROVIDER.getCode(
                    contract.optimistic_smart_contract
                );
                if (!code || code === "0x") {
                    console.warn(
                        `No code at optimistic_smart_contract for contract ${contract.id}:`,
                        contract.optimistic_smart_contract
                    );
                    continue;
                }

                const optimisticContract = new Contract(
                    contract.optimistic_smart_contract,
                    oAbi,
                    PROVIDER
                );
                const state = await optimisticContract.currState();
                
                // WaitSB = 2, WaitSV = 3
                if (state === 2n || state === 3n) {
                    // Vérifier directement sur la blockchain si le sponsor est défini
                    let buyerSponsorOnChain: string | null = null;
                    let vendorSponsorOnChain: string | null = null;
                    
                    try {
                        buyerSponsorOnChain = await optimisticContract.buyerDisputeSponsor();
                        vendorSponsorOnChain = await optimisticContract.vendorDisputeSponsor();
                    } catch (e) {
                        console.error(`Error reading sponsors from contract ${contract.id}:`, e);
                    }
                    
                    // Pour WaitSB: vérifier si buyer sponsor n'est pas encore défini (sur la blockchain)
                    // Pour WaitSV: vérifier si vendor sponsor n'est pas encore défini (sur la blockchain)
                    const buyerSponsorDefined = buyerSponsorOnChain && 
                        buyerSponsorOnChain !== "0x0000000000000000000000000000000000000000";
                    const vendorSponsorDefined = vendorSponsorOnChain && 
                        vendorSponsorOnChain !== "0x0000000000000000000000000000000000000000";
                    
                    if ((state === 2n && !buyerSponsorDefined) ||
                        (state === 3n && !vendorSponsorDefined)) {
                        waitingContracts.push({
                            ...contract,
                            state: Number(state),
                            stateName: state === 2n ? "WaitSB" : "WaitSV",
                            pk_buyer_sponsor: buyerSponsorOnChain || contract.pk_buyer_sponsor,
                            pk_vendor_sponsor: vendorSponsorOnChain || contract.pk_vendor_sponsor,
                        });
                    }
                }
            } catch (e) {
                console.error(`Error checking contract ${contract.id}:`, e);
            }
        }
        
        return NextResponse.json(waitingContracts);
    } catch (error: any) {
        console.error("Error fetching waiting dispute sponsors:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch contracts" },
            { status: 500 }
        );
    }
}
