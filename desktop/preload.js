const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('electronAPI', {
    precompute: () => ipcRenderer.invoke('precompute'),
    analyzeImage: () => ipcRenderer.invoke('analyzeImage'),
    generateZkProof: (payload) => ipcRenderer.invoke('generateZkProof', payload),
    verifyZkProof: (payload) => ipcRenderer.invoke('verifyZkProof', payload),
    uploadCiphertext: (payload) => ipcRenderer.invoke('uploadCiphertext', payload),
});
