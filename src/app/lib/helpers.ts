import { Circuit, Gate } from "./circuits_old/evaluator";

export function concatBytes(data: Uint8Array[]): Uint8Array {
    const res = [];
    for (let d of data) {
        for (let b of d) {
            res.push(b);
        }
    }

    return new Uint8Array(res);
}

export function hexToBytes(hex: string): Uint8Array {
    if (hex[1] == "x") hex = hex.slice(2);
    if (hex.length % 2 != 0) {
        throw Error("input must have an even number of characters");
    }

    let res = new Uint8Array(hex.length / 2);

    for (let i = 0; i < hex.length; i += 2) {
        res[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }

    return res;
}

export function bytesToHex(bytes: Uint8Array, withPrefix?: boolean): string {
    let res = withPrefix ? "0x" : "";

    for (let i = 0; i < bytes.length; ++i) {
        let next = bytes[i].toString(16);
        if (bytes[i] < 0x10) {
            next = "0" + next;
        }
        res += next;
    }

    return res;
}

// Returns true if a and b have equal values
export function bytesArraysAreEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a === undefined && b === undefined) return true; // both are undefined
    if (a === undefined || b === undefined) return false; // only one is undefined
    if (a.length != b.length) return false;

    for (let i = 0; i < a.length; ++i) {
        if (a[i] != b[i]) return false;
    }

    return true;
}

export async function fileToBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
}

export function bytesToBlocks(
    data: Uint8Array,
    blockSizeBytes: number
): Uint8Array[] {
    // FIXME looks fishy
    const numBlocks = Math.ceil(data.length / blockSizeBytes);
    const paddingSize = numBlocks * blockSizeBytes - data.length;
    const res = new Array(numBlocks); // 0-padded to the right

    for (let i = 0; i < numBlocks; ++i) {
        let next = data.slice(blockSizeBytes * i, blockSizeBytes * (i + 1));

        if (next.length < blockSizeBytes) {
            let padding = new Uint8Array(paddingSize);
            next = concatBytes([next, padding]);
        }

        res[i] = next;
    }

    return res;
}

function signed32bToUint8Array(n: number): Uint8Array {
    if (n < -2147483648 || n > 2147483647) {
        throw new Error("Number out of range for 32-bit signed integer");
    }

    const res = new Uint8Array(4); // 32-bits

    for (let i = 0; i < 4; i++) {
        res[3 - i] = (n >> (i * 8)) & 0xff;
    }

    return res;
}

function gateToBytes(gate: Gate): Uint8Array {
    if (gate[0] == -1) return signed32bToUint8Array(-1);

    const res = new Array(gate[1].length + 1);
    res[0] = signed32bToUint8Array(gate[0]);

    for (let i = 1; i < res.length; ++i)
        res[i] = signed32bToUint8Array(gate[1][i - 1]);

    return new Uint8Array(res);
}

export function circuitToBytesArray(circuit: Circuit): Uint8Array[] {
    const res = new Array(circuit.length);

    for (let i = 0; i < res.length; ++i) {
        res[i] = gateToBytes(circuit[i]);
    }

    return res;
}

// Returns an copy of `v` extended/shrinked to 32 elements
// If extended, is left-padded with 0s
// If shrinked, takes the 32 first elements
export function toBytes32(v: Uint8Array): Uint8Array {
    return padBytes(v, 32);
}

export function uint8ArrayToBigInt(array: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < array.length; i++) {
        result = (result << 8n) | BigInt(array[i]);
    }
    return result;
}

export function bigIntToUint8Array(value: bigint, length: number): Uint8Array {
    const array = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        array[length - i - 1] = Number(value & 0xffn);
        value >>= 8n;
    }
    return array;
}

export function padBytes(bytes: Uint8Array, length: number, right?: boolean) {
    if (bytes.length >= length) {
        if (right) return new Uint8Array(Array.from(bytes).slice(-length));
        else return new Uint8Array(Array.from(bytes).slice(0, length));
    }

    const padding = new Uint8Array(length - bytes.length);
    return concatBytes(right ? [bytes, padding] : [padding, bytes]);
}

export function downloadFile(file: Uint8Array, filename: string) {
    try {
        const blob = new Blob([file.buffer], {
            type: "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (error) {
        console.error("Error downloading file:", error);
        throw error;
    }
}

export function openFile(): Promise<File | null> {
    return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";

        input.onchange = (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                resolve(target.files[0]);
            } else {
                resolve(null);
            }
        };

        input.click();
    });
}
