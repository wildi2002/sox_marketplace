import * as wasm from "./crypto_lib_bg.wasm";
export * from "./crypto_lib_bg.js";
import { __wbg_set_wasm } from "./crypto_lib_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();

// In bundler mode wasm is initialized synchronously at module load time.
// Export a no-op init for compatibility with callers that await init().
export default async function init() {}
