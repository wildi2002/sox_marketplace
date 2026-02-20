import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UPLOADS_PATH } from "../../files/[id]/route";

const execFileAsync = promisify(execFile);

const COMPUTE_PROOFS_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "compute_proofs_cli"
);

export async function POST(req: Request) {
    try {
        const { state, contractId, num_blocks, num_gates } = await req.json();

        if (!state || contractId === undefined || !num_blocks || !num_gates) {
            return NextResponse.json(
                { error: "Fields 'state', 'contractId', 'num_blocks' and 'num_gates' are required" },
                { status: 400 }
            );
        }


        if (state !== 4) {
            return NextResponse.json(
                { error: `State ${state} not supported. Only state 4 (WaitVendorDataRight) is supported for now.` },
                { status: 400 }
            );
        }

        const { evaluated_circuit_hex } = await req.json();
        
        if (!evaluated_circuit_hex) {
            return NextResponse.json(
                { error: "Field 'evaluated_circuit_hex' is required" },
                { status: 400 }
            );
        }

        const tempDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempEvaluatedCircuitPath = path.join(tempDir, `evaluated_circuit_${contractId}.bin`);
        const evaluated_circuit_bytes = Buffer.from(evaluated_circuit_hex, "hex");
        fs.writeFileSync(tempEvaluatedCircuitPath, evaluated_circuit_bytes);

        const { stdout } = await execFileAsync(COMPUTE_PROOFS_CLI_PATH, [
            state.toString(),
            tempEvaluatedCircuitPath,
            num_blocks.toString(),
            num_gates.toString(),
        ]);

        fs.unlinkSync(tempEvaluatedCircuitPath);

        let parsed: any;
        try {
            parsed = JSON.parse(stdout.toString());
        } catch (e: any) {
            console.error(
                "JSON parsing error from compute_proofs_cli:",
                e,
                stdout.toString()
            );
            return NextResponse.json(
                {
                    error:
                        "Server error: invalid output from proof computation binary",
                },
                { status: 500 }
            );
        }

        return NextResponse.json(parsed);
    } catch (error: any) {
        console.error("Error in POST /api/proofs/compute:", error);
        return NextResponse.json(
            { error: `Server error: ${error.message || error}` },
            { status: 500 }
        );
    }
}
