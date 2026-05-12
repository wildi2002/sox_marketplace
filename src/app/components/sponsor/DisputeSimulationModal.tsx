"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import init, {
    bytes_to_hex,
    hex_to_bytes,
    compile_circuit_v2_wasm,
    compile_circuit_extended_image_v2_wasm,
    compile_circuit_extended_image_crop_v2_wasm,
    compile_circuit_extended_image_dual_v2_wasm,
    compile_circuit_extended_audio_v2_wasm,
    compile_circuit_extended_audio_lowres_v2_wasm,
    compile_circuit_extended_audio_both_v2_wasm,
    compile_circuit_extended_video_v2_wasm,
    compile_circuit_extended_video_clip_v2_wasm,
    compile_circuit_extended_video_both_v2_wasm,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    compute_proof_right_v2,
} from "@/app/lib/crypto_lib";
import { getBasicInfo } from "@/app/lib/blockchain/optimistic";
import {
    getDisputeState,
    getChallenge,
    respondChallenge,
    giveOpinion,
    submitCommitment,
    submitCommitmentLeft,
    submitCommitmentRight,
    finishDispute,
} from "@/app/lib/blockchain/dispute";

// Dispute contract state enum (matches DisputeSOX.sol)
const STATE = {
    ChallengeBuyer: 0,
    WaitVendorOpinion: 1,
    WaitVendorData: 2,
    WaitVendorDataLeft: 3,
    WaitVendorDataRight: 4,
    Complete: 5,
    Cancel: 6,
    End: 7,
} as const;

type Props = {
    onClose: () => void;
    disputeContract: string;
    optimisticContract: string;
    publicKey: string;
    pkBuyer: string;
    pkVendor: string;
    pkBuyerSponsor?: string;
    pkVendorSponsor?: string;
    numBlocks: number;
    numGates: number;
    contractId: number;
    algorithmSuite?: string;
};

export default function DisputeSimulationModal({
    onClose,
    disputeContract,
    optimisticContract,
    pkBuyer,
    pkVendor,
    pkBuyerSponsor,
    pkVendorSponsor,
    numBlocks,
    numGates,
    contractId,
    algorithmSuite,
}: Props) {
    const [running, setRunning] = useState(false);
    const [log, setLog] = useState<{ msg: string; type: "info" | "ok" | "err" | "step" }[]>([]);
    const [done, setDone] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    const addLog = (msg: string, type: "info" | "ok" | "err" | "step" = "info") =>
        setLog((prev) => [...prev, { msg, type }]);

    // Auto-scroll log
    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    }, [log]);

    async function runSimulation() {
        setRunning(true);
        setLog([]);
        setDone(false);
        try {
            await runDisputeAutomation();
        } catch (e: any) {
            addLog(`Fatal error: ${e?.message ?? e}`, "err");
        } finally {
            setRunning(false);
            setDone(true);
        }
    }

    /** Poll getDisputeState until the state is one of the expected values or timeout. */
    async function waitForStateIn(
        contractAddr: string,
        expected: number[],
        timeoutMs = 30000
    ): Promise<number> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const s = Number(await getDisputeState(contractAddr));
            if (expected.includes(s)) return s;
            await new Promise((r) => setTimeout(r, 1000));
        }
        throw new Error(
            `Timed out waiting for state in [${expected.join(",")}] after ${timeoutMs / 1000}s`
        );
    }

    async function runDisputeAutomation() {
        // ── 1. Init WASM ─────────────────────────────────────────────────────
        addLog("Initialising WASM...", "step");
        await init();
        addLog("WASM ready.", "ok");

        // ── 2. Fetch ct + opening_value + description from server ────────────
        addLog(`Fetching contract data for #${contractId}...`, "step");
        const infoRes = await fetch(`/api/disputes/contract-info/${contractId}`);
        if (!infoRes.ok) {
            const err = await infoRes.json().catch(() => ({}));
            throw new Error(`Contract info fetch failed (${infoRes.status}): ${err.error ?? ""}`);
        }
        const { description, opening_value: openingValueHex, ct_hex: ctHex, algorithm_suite: algoSuite } = await infoRes.json();
        const ct = hex_to_bytes(ctHex);
        const descBytes = hex_to_bytes(description);
        addLog(`Data loaded — ct: ${ct.length} bytes, desc: ${descBytes.length}B, algo: ${algoSuite ?? algorithmSuite}`, "ok");

        // ── 3. Fetch AES key from blockchain ─────────────────────────────────
        addLog("Fetching AES key from smart contract...", "step");
        const info = await getBasicInfo(optimisticContract);
        if (!info) throw new Error("Could not read optimistic contract");
        const keyHex = info.key.replace(/^0x/, "").padEnd(32, "0");
        addLog(`Key fetched: ${keyHex.slice(0, 16)}...`, "ok");

        // ── 4. Compile circuit ────────────────────────────────────────────────
        const suite = algorithmSuite ?? algoSuite ?? "";
        const dLen  = descBytes.length;
        let circuitLabel: string;
        let circuitBytes: Uint8Array;
        if (suite === "extended_image" && dLen === 76) {
            circuitLabel = "extended_image (76B)";
            circuitBytes = compile_circuit_extended_image_v2_wasm(ct, descBytes);
        } else if (suite === "extended_image_crop" && dLen === 84) {
            circuitLabel = "extended_image_crop (84B)";
            circuitBytes = compile_circuit_extended_image_crop_v2_wasm(ct, descBytes);
        } else if (suite === "extended_image_dual" && dLen === 116) {
            circuitLabel = "extended_image_dual (116B)";
            circuitBytes = compile_circuit_extended_image_dual_v2_wasm(ct, descBytes);
        } else if (suite === "extended_audio" && dLen === 76) {
            circuitLabel = "extended_audio (76B)";
            circuitBytes = compile_circuit_extended_audio_v2_wasm(ct, descBytes);
        } else if (suite === "extended_audio_lowres" && dLen === 76) {
            circuitLabel = "extended_audio_lowres (76B)";
            circuitBytes = compile_circuit_extended_audio_lowres_v2_wasm(ct, descBytes);
        } else if (suite === "extended_audio_both" && dLen === 112) {
            circuitLabel = "extended_audio_both (112B)";
            circuitBytes = compile_circuit_extended_audio_both_v2_wasm(ct, descBytes);
        } else if (suite === "extended_video" && dLen === 88) {
            circuitLabel = "extended_video (88B)";
            circuitBytes = compile_circuit_extended_video_v2_wasm(ct, descBytes);
        } else if (suite === "extended_video_clip" && dLen === 92) {
            circuitLabel = "extended_video_clip (92B)";
            circuitBytes = compile_circuit_extended_video_clip_v2_wasm(ct, descBytes);
        } else if (suite === "extended_video_both" && dLen === 124) {
            circuitLabel = "extended_video_both (124B)";
            circuitBytes = compile_circuit_extended_video_both_v2_wasm(ct, descBytes);
        } else {
            // Legacy basic circuit or unknown suite — description is a hex string
            circuitLabel = `basic V2 (suite=${suite}, descLen=${dLen})`;
            circuitBytes = compile_circuit_v2_wasm(ct, description);
        }
        addLog(`Compiling ${circuitLabel} circuit...`, "step");
        addLog(`Circuit compiled — ${circuitBytes.length} bytes.`, "ok");

        // ── 5. Evaluate circuit once ──────────────────────────────────────────
        addLog("Evaluating circuit (computing all gate outputs)...", "step");
        const evaluatedBytes = evaluate_circuit_v2_wasm(circuitBytes, ct, keyHex).to_bytes();
        addLog("Circuit evaluated.", "ok");

        // ── 6 + 7. Binary search + proof, repeated if Step 9 restarts ────────
        // handleStep9 on the contract may restart the binary search with the dispute
        // sponsor replacing the original buyer/vendor (at most twice per protocol).
        let activeBuyer = pkBuyer;
        let activeVendor = pkVendor;

        for (let step9Round = 0; step9Round < 3; step9Round++) {
            if (step9Round > 0) {
                addLog(`\n── Step 9 restart #${step9Round}: active buyer=${activeBuyer.slice(0,10)}… vendor=${activeVendor.slice(0,10)}…`, "step");
            } else {
                addLog(`\nStarting binary search (numBlocks=${numBlocks}, numGates=${numGates})...`, "step");
            }

            // ── Binary search loop ────────────────────────────────────────────
            let round = 0;
            while (true) {
                let state = Number(await getDisputeState(disputeContract));

                if (state === STATE.WaitVendorOpinion) {
                    addLog(`  Resuming WaitVendorOpinion — vendor gives opinion...`, "info");
                    await giveOpinion(activeVendor, disputeContract, true);
                    state = await waitForStateIn(disputeContract, [
                        STATE.ChallengeBuyer,
                        STATE.WaitVendorData, STATE.WaitVendorDataLeft, STATE.WaitVendorDataRight,
                        STATE.Complete, STATE.Cancel,
                    ]);
                }

                if (state !== STATE.ChallengeBuyer) break;

                round++;
                const chall = Number(await getChallenge(disputeContract));
                addLog(`Round ${round} — challenge gate: ${chall}`, "step");

                const w = hpre_v2(evaluatedBytes, numBlocks, chall);
                const wHex = bytes_to_hex(w);
                addLog(`  Buyer: hpre(${chall}) = ${wHex.slice(0, 20)}...`, "info");
                await respondChallenge(activeBuyer, disputeContract, wHex);
                addLog(`  Buyer: respondChallenge sent — waiting for on-chain confirmation...`, "ok");
                await waitForStateIn(disputeContract, [
                    STATE.WaitVendorOpinion,
                    STATE.WaitVendorData, STATE.WaitVendorDataLeft, STATE.WaitVendorDataRight,
                    STATE.Complete, STATE.Cancel,
                ]);

                await giveOpinion(activeVendor, disputeContract, true);
                addLog(`  Vendor: agree → searching right — waiting for on-chain confirmation...`, "info");
                await waitForStateIn(disputeContract, [
                    STATE.ChallengeBuyer,
                    STATE.WaitVendorData, STATE.WaitVendorDataLeft, STATE.WaitVendorDataRight,
                    STATE.Complete, STATE.Cancel,
                ]);
            }

            addLog(`\nBinary search complete after ${round} rounds.`, "ok");

            // ── Proof step ────────────────────────────────────────────────────
            const stateFinal = Number(await getDisputeState(disputeContract));
            addLog(`Dispute state after binary search: ${stateFinal}`, "step");

            if (stateFinal === STATE.Complete || stateFinal === STATE.Cancel) {
                addLog("Dispute already resolved — skipping proof step.", "info");
                break;
            }

            // All proof branches wait for [ChallengeBuyer, Complete, Cancel, End] so that
            // a Step 9 restart (→ ChallengeBuyer) is detected instead of timing out.
            const AFTER_PROOF_STATES = [
                STATE.ChallengeBuyer, STATE.Complete, STATE.Cancel, STATE.End,
            ];

            if (stateFinal === STATE.WaitVendorDataRight) {
                // Vendor proves last gate = true.
                // If last gate is actually false (wrong key), AccumulatorVerifier.verify fails →
                // handleStep9(vendorLost=true) → either Cancel directly or restart with sponsor.
                addLog("Step 8c: Vendor submits right-branch proof...", "step");
                const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
                await submitCommitmentRight(proof as any, activeVendor, disputeContract);
                addLog("submitCommitmentRight sent — waiting for on-chain confirmation...", "ok");

            } else if (stateFinal === STATE.WaitVendorData) {
                const challFinal = Number(await getChallenge(disputeContract));
                addLog(`Step 8a: Vendor submits proof for gate ${challFinal}...`, "step");
                const comps = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, challFinal);
                await submitCommitment(
                    openingValueHex, challFinal,
                    comps.gate_bytes, comps.values, comps.curr_acc,
                    comps.proof1 as any, comps.proof2 as any,
                    comps.proof3 as any, comps.proof_ext as any,
                    activeVendor, disputeContract
                );
                addLog("submitCommitment sent — waiting for on-chain confirmation...", "ok");

            } else if (stateFinal === STATE.WaitVendorDataLeft) {
                const challFinal = Number(await getChallenge(disputeContract));
                addLog(`Step 8b: Vendor submits left-branch proof for gate ${challFinal}...`, "step");
                const comps = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, challFinal);
                await submitCommitmentLeft(
                    openingValueHex, challFinal,
                    comps.gate_bytes, comps.values, comps.curr_acc,
                    comps.proof1 as any, comps.proof2 as any,
                    comps.proof_ext as any,
                    activeVendor, disputeContract
                );
                addLog("submitCommitmentLeft sent — waiting for on-chain confirmation...", "ok");

            } else {
                throw new Error(`Unexpected state after binary search: ${stateFinal}`);
            }

            const stateAfterProof = await waitForStateIn(disputeContract, AFTER_PROOF_STATES, 30000);
            addLog(`State after proof: ${stateAfterProof}`, "info");

            if (stateAfterProof === STATE.ChallengeBuyer) {
                // Step 9 restarted the binary search with a sponsor replacing buyer/vendor.
                // Update active keys: if vendor lost → vendor → vendorSponsor; else buyer → buyerSponsor.
                const prevVendor = activeVendor;
                const prevBuyer = activeBuyer;
                activeVendor = pkVendorSponsor || activeVendor;
                activeBuyer = pkBuyerSponsor || activeBuyer;
                addLog(`Step 9 restart detected. Vendor: ${prevVendor !== activeVendor ? `${prevVendor.slice(0,8)}→${activeVendor.slice(0,8)}` : "unchanged"}, Buyer: ${prevBuyer !== activeBuyer ? `${prevBuyer.slice(0,8)}→${activeBuyer.slice(0,8)}` : "unchanged"}`, "info");
                continue; // restart outer loop
            }

            // Dispute resolved (Complete or Cancel)
            break;
        }

        // ── 8. Finish dispute ─────────────────────────────────────────────────
        const stateEnd = Number(await getDisputeState(disputeContract));
        if (stateEnd === STATE.End) {
            addLog("\nDispute already finalised.", "ok");
            return;
        }
        addLog("\nFinalising dispute...", "step");
        const finisher = stateEnd === STATE.Complete ? activeVendor : activeBuyer;
        await finishDispute(stateEnd, finisher, disputeContract);
        await waitForStateIn(disputeContract, [STATE.End, STATE.Complete, STATE.Cancel], 15000).catch(() => {});

        const outcome = stateEnd === STATE.Complete ? "✓ COMPLETE — vendor wins" : "✗ CANCEL — buyer wins (refunded)";
        addLog(`\nDispute finished: ${outcome}`, stateEnd === STATE.Complete ? "ok" : "err");
    }

    return (
        <Modal onClose={onClose} title="Simulate Full Dispute">
            <div className="flex flex-col gap-4" style={{ minWidth: 520 }}>
                <p className="text-sm text-gray-600">
                    Automatically drives the binary-search dispute protocol.
                    No file upload needed — all data is fetched from DB and blockchain.
                </p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 bg-gray-100 rounded p-2">
                    <span>Dispute contract:</span>
                    <span className="font-mono truncate">{disputeContract}</span>
                    <span>Gates / Blocks:</span>
                    <span>{numGates} / {numBlocks}</span>
                    <span>Buyer:</span>
                    <span className="font-mono truncate">{pkBuyer}</span>
                    <span>Vendor:</span>
                    <span className="font-mono truncate">{pkVendor}</span>
                </div>

                <Button
                    label={running ? "Running…" : "Run Full Dispute Simulation"}
                    onClick={runSimulation}
                    width="full"
                />

                {log.length > 0 && (
                    <div
                        ref={logRef}
                        className="bg-black text-green-300 font-mono text-xs rounded p-3 overflow-y-auto"
                        style={{ maxHeight: 320 }}
                    >
                        {log.map((entry, i) => (
                            <div
                                key={i}
                                className={
                                    entry.type === "ok"   ? "text-green-400" :
                                    entry.type === "err"  ? "text-red-400"   :
                                    entry.type === "step" ? "text-yellow-300 mt-1" :
                                    "text-green-300"
                                }
                            >
                                {entry.msg}
                            </div>
                        ))}
                        {running && (
                            <div className="text-yellow-300 animate-pulse">▋</div>
                        )}
                    </div>
                )}

                {done && (
                    <Button label="Close" onClick={onClose} width="full" />
                )}
            </div>
        </Modal>
    );
}
