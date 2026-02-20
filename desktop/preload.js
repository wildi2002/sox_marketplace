const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('electronAPI', {
    precompute: () => ipcRenderer.invoke('precompute'),
    uploadCiphertext: (payload) => ipcRenderer.invoke('uploadCiphertext', payload),
});
