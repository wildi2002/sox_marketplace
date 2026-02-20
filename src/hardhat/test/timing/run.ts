import "@nomicfoundation/hardhat-chai-matchers";
import { readFile } from "node:fs/promises";
import __wbg_init, {
    initSync,
    bytes_to_hex,
    hex_to_bytes,
    check_received_ct_key,
    compute_precontract_values,
    check_precontract,
    make_argument,
    check_argument,
    evaluate_circuit,
    hpre,
    compute_proofs,
    compute_proofs_left,
    compute_proof_right,
} from "../../../app/lib/crypto_lib";
import { readFileSync, writeFileSync } from "node:fs";

const TMP_DIR = "./tmp";
const BLOCK_SIZE = 64;

async function time_vendor_compute_precontract_values() {
    // let numBlocks = 1 << 16;

    let key = new Uint8Array(16);
    let file: Uint8Array | undefined = new Uint8Array(8);

    console.log(
        "Vendor precontract computations (description, ct, circuit, ct_blocks)"
    );
    const start = performance.now();

    const {
        ct,
        circuit_bytes,
        description,
        h_ct,
        h_circuit,
        commitment,
        num_blocks,
        num_gates,
    } = compute_precontract_values(file, key);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    writeFileSync(`${TMP_DIR}/ct_v.enc`, ct);
    writeFileSync(`${TMP_DIR}/circuit_v.bin`, circuit_bytes);

    return {
        time: end - start,
        description: bytes_to_hex(description),
        commitment: bytes_to_hex(commitment.c),
        opening_value: bytes_to_hex(commitment.o),
        key: bytes_to_hex(key),
        num_gates,
        num_blocks,
    };
}

async function time_buyer_check_precontract(
    desc: string,
    commitment_vendor: string,
    opening_value_vendor: string
) {
    console.log("Buyer precontract checks");

    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const { success, h_circuit, h_ct } = check_precontract(
        desc,
        commitment_vendor,
        opening_value_vendor,
        ct
    );
    if (!success) throw new Error("precontract check failed");

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
        h_circuit: bytes_to_hex(h_circuit),
        h_ct: bytes_to_hex(h_ct),
    };
}

async function time_buyer_check_received_ct_key(key: string, desc_v: string) {
    console.log("Buyer checks before dispute trigger");

    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const { success, decrypted_file } = check_received_ct_key(
        ct,
        hex_to_bytes(key),
        desc_v
    );

    if (!success) throw new Error("Decryption's description doesn't match");

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    writeFileSync(`${TMP_DIR}/file_b.bin`, decrypted_file);

    return {
        time: end - start,
    };
}

async function time_bv_make_argument(desc: string, opening_value: string) {
    console.log("Buyer makes argument");

    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const argument = make_argument(ct, desc, opening_value);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    writeFileSync(`${TMP_DIR}/argument.bin`, argument);

    return {
        time: end - start,
    };
}

async function time_sponsor_check_argument(
    commitment: string,
    description: string,
    key: string
) {
    console.log("Dispute sponsor checks argument");
    // argument = (circuit_b, ct, o)
    const argument = readFileSync(`${TMP_DIR}/argument.bin`);

    const start = performance.now();

    const success = check_argument(argument, commitment, description, key);
    if (!success) throw new Error("Argument check failed");

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
    };
}

async function time_bv_evaluate_circuit(key: string, description: string) {
    console.log("Buyer/vendor evaluates the circuit for the dispute");
    const circuit = readFileSync(`${TMP_DIR}/circuit_v.bin`);
    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const evaluated = evaluate_circuit(circuit, ct, [key], description);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    writeFileSync(`${TMP_DIR}/circuit_evaluated.bin`, evaluated.to_bytes());

    return {
        time: end - start,
        evaluated,
    };
}

async function time_bv_compute_hpre(num_blocks: number, challenge: number) {
    console.log("Buyer/vendor computes hpre(i)");
    const values = readFileSync(`${TMP_DIR}/circuit_evaluated.bin`);

    const start = performance.now();

    hpre(values, num_blocks, challenge);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
    };
}

async function time_vendor_computes_proofs_8a(challenge: number) {
    console.log("Vendor computes proofs (8a)");
    const evaluated_circuit = readFileSync(`${TMP_DIR}/circuit_evaluated.bin`);
    const circuit = readFileSync(`${TMP_DIR}/circuit_v.bin`);
    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const { gate, values, curr_acc, proof1, proof2, proof3, proof_ext } =
        compute_proofs(circuit, evaluated_circuit, ct, challenge);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
        gate,
        values,
        curr_acc,
        proof1,
        proof2,
        proof3,
        proof_ext,
    };
}

async function time_vendor_computes_proofs_8b(challenge: number) {
    console.log("Vendor computes proofs (8b)");
    const evaluated_circuit = readFileSync(`${TMP_DIR}/circuit_evaluated.bin`);
    const circuit = readFileSync(`${TMP_DIR}/circuit_v.bin`);
    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const { gate, values, curr_acc, proof1, proof2, proof_ext } =
        compute_proofs_left(circuit, evaluated_circuit, ct, challenge);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
        gate,
        values,
        curr_acc,
        proof1,
        proof2,
        proof_ext,
    };
}

async function time_vendor_computes_proofs_8c(
    num_blocks: number,
    num_gates: number
) {
    console.log("Vendor computes proofs (8c)");
    const evaluated_circuit = readFileSync(`${TMP_DIR}/circuit_evaluated.bin`);
    const circuit = readFileSync(`${TMP_DIR}/circuit_v.bin`);
    const ct = readFileSync(`${TMP_DIR}/ct_v.enc`);

    const start = performance.now();

    const proof = compute_proof_right(evaluated_circuit, num_blocks, num_gates);

    const end = performance.now();
    console.log(`\tTook ${end - start} ms`);

    return {
        time: end - start,
        proof,
    };
}

async function main() {
    const module = await readFile(
        "../../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    initSync({ module: module });

    let vendor_time = 0;
    let buyer_time = 0;
    let sponsors_time = 0;

    let precontract = await time_vendor_compute_precontract_values();
    vendor_time += precontract.time;

    let precontract_check = await time_buyer_check_precontract(
        precontract.description,
        precontract.commitment,
        precontract.opening_value
    );
    buyer_time += precontract_check.time;

    let extra_time = (
        await time_buyer_check_received_ct_key(
            precontract.key,
            precontract.description
        )
    ).time;
    buyer_time += extra_time;

    let opt_vendor_time = vendor_time;
    let opt_buyer_time = buyer_time;
    console.log(
        "============================== OPTIMISTIC TIME ===================="
    );
    console.log(`Buyer: ${opt_buyer_time} ms`);
    console.log(`Vendor: ${opt_vendor_time} ms`);
    console.log("\n");

    extra_time = (
        await time_bv_make_argument(
            precontract.description,
            precontract.opening_value
        )
    ).time;
    buyer_time += extra_time;
    vendor_time += extra_time;

    sponsors_time = (
        await time_sponsor_check_argument(
            precontract.commitment,
            precontract.description,
            precontract.key
        )
    ).time;

    const { time, evaluated } = await time_bv_evaluate_circuit(
        precontract.key,
        precontract.description
    );
    buyer_time += time;
    vendor_time += time;

    let a = precontract.num_blocks;
    let b = precontract.num_gates;
    let chall;
    while (a != b) {
        chall = Math.floor((a + b) / 2);
        const { time: time_hpre } = await time_bv_compute_hpre(
            precontract.num_blocks,
            chall
        );
        buyer_time += time_hpre;
        vendor_time += time_hpre;

        a = chall + 1;
    }

    // these may crash, issok
    const components_8a = await time_vendor_computes_proofs_8a(
        precontract.num_blocks + 3
    );

    const components_8b = await time_vendor_computes_proofs_8b(
        precontract.num_blocks + 3
    );

    const proof_8c = await time_vendor_computes_proofs_8c(
        precontract.num_blocks,
        precontract.num_gates
    );
    vendor_time += max(components_8a.time, components_8b.time, proof_8c.time);
    console.log(
        "==================== DISPUTE-ONLY RUNNING TIME ==============="
    );
    console.log(`Buyer: ${buyer_time - opt_buyer_time} ms`);
    console.log(`Vendor: ${vendor_time - opt_vendor_time} ms`);

    console.log("==================== WORST CASE RUNNING TIME ===============");
    console.log(`Buyer: ${buyer_time} ms`);
    console.log(`Vendor: ${vendor_time} ms`);
    console.log(`Dispute sponsors: ${sponsors_time} ms`);
}

function max(...vals: number[]): number {
    let max = vals[0];
    for (let i = 1; i < vals.length; ++i) {
        max = max >= vals[i] ? max : vals[i];
    }

    return max;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
