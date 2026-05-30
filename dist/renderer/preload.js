import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
    onDiscordMessage: (callback) => ipcRenderer.on('discord-message', (_event, value) => callback(value)),
});
//# sourceMappingURL=preload.js.map