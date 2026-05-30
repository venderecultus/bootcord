"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
    getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
    onDiscordMessage: (callback) => ipcRenderer.on('discord-message', (_event, value) => callback(value)),
});
//# sourceMappingURL=preload.cjs.map