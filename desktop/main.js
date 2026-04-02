const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Load Next.js web application instead of local file
    const nextjsUrl = process.env.NEXTJS_URL || 'http://localhost:3000';
    mainWindow.loadURL(nextjsUrl);

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Function to run precompute
async function runPrecompute(filePath) {
    return new Promise((resolve, reject) => {
        // Path to Rust binary precontract_cli
        // Binary is compiled in src/wasm/target/release/precontract_cli
        const cliPath = path.join(__dirname, '..', 'src', 'wasm', 'target', 'release', 'precontract_cli');
        
        // On Windows, add .exe
        const command = process.platform === 'win32' ? cliPath + '.exe' : cliPath;
        
        // Arguments: binary takes file as first argument (no --input)
        const args = [filePath];
        
        const child = spawn(command, args, {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve({
                        success: true,
                        inputPath: filePath,
                        ...result,
                    });
                } catch (e) {
                    resolve({
                        success: true,
                        inputPath: filePath,
                        output: stdout,
                    });
                }
            } else {
                reject(new Error(stderr || `Process exited with code ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}

function getApiBaseUrl() {
    return process.env.NEXTJS_URL || 'http://localhost:3000';
}

async function uploadCiphertext(filePath, contractId) {
    if (!filePath || !contractId) {
        throw new Error('Missing filePath or contractId');
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`Ciphertext file not found: ${filePath}`);
    }

    const url = new URL(`/api/files/${contractId}`, getApiBaseUrl());
    const stat = fs.statSync(filePath);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                method: 'PUT',
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': stat.size,
                },
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk.toString();
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(body ? JSON.parse(body) : { ok: true });
                        } catch {
                            resolve({ ok: true });
                        }
                        return;
                    }
                    reject(new Error(`Upload failed (${res.statusCode}): ${body.slice(0, 200)}`));
                });
            }
        );

        req.on('error', reject);
        fs.createReadStream(filePath).pipe(req);
    });
}

const ZK_HOST_PATH = path.join(__dirname, '..', 'src', 'zk', 'target', 'release', 'zk-host');
const BRISQUE_SCRIPT = path.join(__dirname, '..', 'src', 'scripts', 'brisque_from_file.py');

// Compute BRISQUE via Python script (fallback when Rust returns 0 or unavailable).
function runPythonBrisque(filePath) {
    return new Promise((resolve) => {
        const child = spawn('python3', [BRISQUE_SCRIPT, filePath], {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(typeof result.brisque === 'number' ? result.brisque : null);
                } catch { resolve(null); }
            } else { resolve(null); }
        });
        child.on('error', () => resolve(null));
    });
}

// PATCH JSON to a local API endpoint (used by background IPC handlers).
function patchJson(urlStr, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const data = JSON.stringify(body);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            method: 'PATCH',
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function runZkHost(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(ZK_HOST_PATH, args, {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, SP1_PROVER: 'cpu', ...env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (code) => {
            if (code === 0) {
                try { resolve(JSON.parse(stdout.trim())); }
                catch (e) { resolve({ raw: stdout }); }
            } else {
                reject(new Error(stderr || `zk-host exited with code ${code}`));
            }
        });
        child.on('error', reject);
    });
}

// Expose API to preload
const { ipcMain } = require('electron');

ipcMain.handle('precompute', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select a file for precompute',
            properties: ['openFile'],
            filters: [
                { name: 'All files', extensions: ['*'] },
                { name: 'Binary files', extensions: ['bin', 'dat'] },
            ],
        });

        if (result.canceled) {
            return { cancelled: true };
        }

        const filePath = result.filePaths[0];
        const precomputeResult = await runPrecompute(filePath);
        
        return precomputeResult;
    } catch (error) {
        return {
            error: error.message || 'Unknown error during precompute',
        };
    }
});

// analyzeImage: fast BRISQUE + thumbnail_hash without proof generation (for listings)
ipcMain.handle('analyzeImage', async () => {
    try {
        if (!fs.existsSync(ZK_HOST_PATH)) {
            return { error: 'zk-host binary not found. Run: cd src/zk && cargo build --release -p zk-host' };
        }
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select image to list',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        });
        if (result.canceled) return { cancelled: true };
        const filePath = result.filePaths[0];

        // Run fast analyze (thumbnail_hash + BRISQUE, no SP1 proof)
        const analyzed = await runZkHost(['analyze', '--image', filePath]);

        // Read image bytes so the renderer can build a preview thumbnail locally
        const imageBytes = fs.readFileSync(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        const imageDataUrl = `data:${mime};base64,${imageBytes.toString('base64')}`;

        // Use Rust BRISQUE if valid (non-zero), else fall back to Python implementation.
        let brisque = (typeof analyzed.brisque === 'number' && analyzed.brisque > 0)
            ? analyzed.brisque
            : await runPythonBrisque(filePath);

        return {
            success: true,
            filePath,
            imageDataUrl,
            thumbnail_hash: analyzed.thumbnail_hash,
            brisque,
        };
    } catch (error) {
        return { error: error.message || 'analyzeImage failed' };
    }
});

// generateZkProof: full SP1 Groth16 proof generation for a precontract (slow, minutes)
ipcMain.handle('generateZkProof', async (_event, payload) => {
    try {
        if (!fs.existsSync(ZK_HOST_PATH)) {
            return { error: 'zk-host binary not found' };
        }
        const { filePath } = payload || {};
        if (!filePath || !fs.existsSync(filePath)) {
            return { error: `Image file not found: ${filePath}` };
        }
        const result = await runZkHost(['generate', '--image', filePath]);
        return { success: true, ...result };
    } catch (error) {
        return { error: error.message || 'generateZkProof failed' };
    }
});

// verifyZkProof: verify a ZK proof locally (no network, no server) for the buyer
ipcMain.handle('verifyZkProof', async (_event, payload) => {
    try {
        if (!fs.existsSync(ZK_HOST_PATH)) {
            return { error: 'zk-host binary not found' };
        }
        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpJson = path.join(tmpDir, `zk_verify_${Date.now()}.json`);
        try {
            fs.writeFileSync(tmpJson, JSON.stringify(payload));
            const result = await runZkHost(['verify', '--json', tmpJson]);
            return result;
        } finally {
            if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
        }
    } catch (error) {
        return { error: error.message || 'verifyZkProof failed' };
    }
});

// generateZkProofForListing: generate proof in background and patch listing when done.
// The renderer fires this without awaiting — the main process handles it and updates the DB.
ipcMain.handle('generateZkProofForListing', async (_event, { listingId, filePath }) => {
    try {
        if (!fs.existsSync(ZK_HOST_PATH)) {
            return { error: 'zk-host binary not found' };
        }
        if (!filePath || !fs.existsSync(filePath)) {
            return { error: `Image file not found: ${filePath}` };
        }
        const result = await runZkHost(['generate', '--image', filePath]);
        const apiUrl = `${getApiBaseUrl()}/api/listings/${listingId}/zk-proof`;
        await patchJson(apiUrl, {
            zk_proof: result.proof ?? null,
            zk_proof_full: result.proof_full ?? null,
            zk_h_pt: result.h_pt ?? null,
            zk_thumbnail_hash: result.thumbnail_hash ?? null,
            zk_brisque: result.brisque ?? null,
            zk_vk_hash: result.vk_hash ?? null,
        });
        return { success: true };
    } catch (error) {
        return { error: error.message || 'generateZkProofForListing failed' };
    }
});

ipcMain.handle('uploadCiphertext', async (_event, payload) => {
    try {
        const { filePath, contractId } = payload || {};
        const result = await uploadCiphertext(filePath, contractId);
        return { success: true, result };
    } catch (error) {
        return {
            success: false,
            error: error.message || 'Unknown error during upload',
        };
    }
});
