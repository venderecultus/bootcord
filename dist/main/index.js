import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, desktopCapturer } from 'electron';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as bot from './bot.js';
import * as screenShare from './screenShareServer.js';
import { VelopackApp, UpdateManager } from 'velopack';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let tray = null;
let isQuitting = false;
const configPath = path.join(app.getPath('userData'), 'config.json');
// Error notification system
export function sendErrorNotification(message, details, type = 'general') {
    if (mainWindow) {
        mainWindow.webContents.send('app-error', { message, details, type });
    }
}
async function getSavedToken() {
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
            return data.token;
        }
    }
    catch (e) {
        console.error('Failed to read token:', e);
    }
    return null;
}
async function saveToken(token) {
    try {
        if (!token) {
            if (fs.existsSync(configPath))
                await fs.promises.unlink(configPath);
            return;
        }
        await fs.promises.writeFile(configPath, JSON.stringify({ token }));
    }
    catch (e) {
        console.error('Failed to save token:', e);
    }
}
function createWindow() {
    const rootIcon = path.join(__dirname, '../../icon.png');
    const srcIcon = path.join(__dirname, '../../src/icon.png');
    const iconPath = fs.existsSync(rootIcon) ? rootIcon : (fs.existsSync(srcIcon) ? srcIcon : null);
    mainWindow = new BrowserWindow({
        title: 'bootcord',
        icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
        width: 1200,
        height: 800,
        frame: false,
        backgroundColor: '#313338', // The gray you liked
        webPreferences: {
            preload: path.join(__dirname, '../../src/renderer/preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });
    const indexPath = path.join(__dirname, '../../src/renderer/index.html');
    mainWindow.loadFile(indexPath);
    mainWindow.removeMenu();
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
        return false;
    });
    mainWindow.on('maximize', () => mainWindow?.webContents.send('window-state-changed', true));
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-state-changed', false));
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
            mainWindow?.webContents.toggleDevTools();
        }
    });
}
function createTray() {
    const rootIcon = path.join(__dirname, '../../icon.png');
    const srcIcon = path.join(__dirname, '../../src/icon.png');
    const iconPath = fs.existsSync(rootIcon) ? rootIcon : (fs.existsSync(srcIcon) ? srcIcon : null);
    if (!iconPath) {
        console.error('[Tray] Icon not found! Searched in:', rootIcon, 'and', srcIcon);
        return;
    }
    console.log('[Tray] Creating tray with icon:', iconPath);
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open bootcord', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Exit', click: () => {
                isQuitting = true;
                app.quit();
            } }
    ]);
    tray.setToolTip('bootcord');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
}
// Velopack — must run before any other app code
VelopackApp.build().run();
const UPDATE_URL = 'https://github.com/venderecultus/bootcord';
app.whenReady().then(async () => {
    createWindow();
    createTray();
    // Silent check at startup
    try {
        const um = new UpdateManager(UPDATE_URL);
        const info = await um.checkForUpdatesAsync();
        if (info) {
            mainWindow?.webContents.send('update-available', String(info.TargetFullRelease?.Version || ''));
        }
        else {
            mainWindow?.webContents.send('update-not-available');
        }
    }
    catch {
        mainWindow?.webContents.send('update-not-available');
    }
    const showLogin = () => {
        console.log('[Main] Sending needs-login to renderer...');
        setTimeout(() => {
            console.log('[Main] needs-login sent!');
            mainWindow?.webContents.send('needs-login');
        }, 500);
    };
    try {
        const savedToken = await getSavedToken();
        if (savedToken) {
            const loginPromise = bot.loginBot(savedToken);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Login timeout (15s)')), 15000));
            await Promise.race([loginPromise, timeoutPromise]);
            initBotHandlers();
        }
        else {
            console.log('[Main] No saved token found.');
            showLogin();
        }
    }
    catch (e) {
        console.error('Initial login failed:', e);
        showLogin();
    }
});
function initBotHandlers() {
    bot.onMessage((msg) => {
        mainWindow?.webContents.send('discord-message', msg);
    });
    bot.onVoiceStateUpdate((data) => {
        mainWindow?.webContents.send('voice-state-update', data);
    });
    bot.onPresenceUpdate((data) => {
        mainWindow?.webContents.send('presence-update', data);
    });
    bot.onAudioData((data) => {
        mainWindow?.webContents.send('audio-from-discord', data);
    });
}
ipcMain.handle('get-servers', () => bot.getServers());
ipcMain.handle('get-channels', (_, guildId) => bot.getChannels(guildId));
ipcMain.handle('create-invite', (_, channelId) => bot.createInvite(channelId));
ipcMain.handle('get-pins', (_, channelId) => bot.getPins(channelId));
ipcMain.handle('submit-token', async (_, token) => {
    try {
        const loginPromise = bot.loginBot(token);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Login timeout (20s)')), 20000));
        await Promise.race([loginPromise, timeout]);
        await saveToken(token);
        initBotHandlers();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] Token submission failed:', error?.message || error);
        return { success: false, error: error?.message || 'Unknown error' };
    }
});
ipcMain.handle('logout', async () => {
    try {
        if (fs.existsSync(configPath)) {
            await fs.promises.unlink(configPath);
        }
        app.relaunch();
        app.exit(0);
    }
    catch (e) {
        console.error('Logout failed:', e);
    }
});
ipcMain.handle('change-token', () => {
    console.log('[Main] change-token called, sending needs-login...');
    mainWindow?.webContents.send('needs-login');
});
ipcMain.handle('get-messages', (_, channelId, before) => bot.getMessageHistory(channelId, before));
ipcMain.handle('get-members', (_, guildId) => bot.getGuildMembers(guildId));
ipcMain.handle('send-message', (_, channelId, content, filePath, replyToId) => bot.sendMessage(channelId, content, filePath, replyToId));
ipcMain.handle('delete-message', (_, channelId, messageId) => bot.deleteMessage(channelId, messageId));
ipcMain.handle('edit-message', (_, channelId, messageId, content) => bot.editMessage(channelId, messageId, content));
ipcMain.handle('get-guild-emojis', (_, guildId) => bot.getGuildEmojis(guildId));
ipcMain.handle('join-voice', (_, guildId, channelId) => bot.joinVoice(guildId, channelId));
ipcMain.handle('leave-voice', (_, guildId) => bot.leaveVoice(guildId));
ipcMain.handle('set-mute', (_, mute) => bot.setMute(mute));
ipcMain.handle('set-deafen', (_, deaf) => bot.setDeafen(deaf));
ipcMain.handle('update-mic-settings', (_, volume, deviceId) => bot.updateMicSettings(volume, deviceId));
ipcMain.handle('set-noise-suppression', (_, enabled) => bot.setNoiseSuppression(enabled));
ipcMain.handle('set-bot-status', (_, status) => bot.setNotificationStatus(status));
ipcMain.on('audio-to-discord', (_, buffer) => bot.injectAudioChunk(buffer));
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    const filePath = result.filePaths[0];
    if (!filePath)
        return null;
    try {
        const stats = await fs.promises.stat(filePath);
        if (stats.size > 10 * 1024 * 1024) {
            return { error: 'File size exceeds 10MB limit.' };
        }
        return { filePath };
    }
    catch (e) {
        return { error: 'Failed to read file.' };
    }
});
ipcMain.handle('save-temp-and-send', async (_, channelId, content, arrayBuffer) => {
    try {
        const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}.png`);
        await fs.promises.writeFile(tempPath, Buffer.from(arrayBuffer));
        await bot.sendMessage(channelId, content, tempPath);
        return true;
    }
    catch (e) {
        console.error('[Main] Temp file upload failed:', e);
        return false;
    }
});
ipcMain.handle('get-current-user-id', () => bot.getClient().user?.id || null);
ipcMain.handle('get-bot-status', () => bot.getBotData());
ipcMain.handle('get-env-token', () => {
    return process.env.DISCORD_TOKEN || null;
});
ipcMain.on('update-steam-status', (event, url) => bot.setSteamUrl(url));
ipcMain.handle('set-launch-on-startup', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
});
ipcMain.handle('set-game-detection', (_, enabled) => {
    if (enabled)
        bot.startPresenceScans();
    else
        bot.stopPresenceScans();
    return true;
});
ipcMain.handle('get-user-profile', (event, userId, guildId) => bot.getUserProfile(userId, guildId));
ipcMain.handle('toggle-reaction', (e, channelId, messageId, emoji) => bot.toggleReaction(channelId, messageId, emoji));
// Screen Share handlers
let screenShareMessageId = null;
let screenShareChannelId = null;
let activeRoomId = null;
ipcMain.handle('get-screen-sources', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 300, height: 200 }
        });
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL()
        }));
    }
    catch (error) {
        console.error('[ScreenShare] Failed to get sources:', error);
        return [];
    }
});
ipcMain.handle('start-screen-share', async (_, textChannelId, sourceId, sourceName) => {
    try {
        const result = await screenShare.startScreenShareServer(sourceId, sourceName);
        const { port, publicUrl } = result;
        const roomId = crypto.randomUUID();
        activeRoomId = roomId;
        const roomUrl = `${publicUrl}/room/${roomId}`;
        console.log(`[ScreenShare] Server started on port ${port}`);
        console.log(`[ScreenShare] Room URL: ${roomUrl}`);
        const voiceChannelId = bot.getCurrentVoiceChannelId();
        const username = bot.getClient().user?.username || 'Bootcord User';
        if (voiceChannelId) {
            try {
                const message = await bot.sendScreenShareLink(voiceChannelId, roomUrl, roomId, username);
                if (message) {
                    screenShareMessageId = message.id;
                    screenShareChannelId = message.channelId;
                }
            }
            catch (error) {
                console.error('[ScreenShare] Failed to send Discord message:', error);
            }
        }
        screenShare.onTunnelDisconnect(() => {
            if (mainWindow) {
                mainWindow.webContents.send('screenshare-disconnect');
            }
        });
        return { success: true, url: roomUrl, roomId, port };
    }
    catch (error) {
        console.error('[ScreenShare] Failed to start:', error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle('stop-screen-share', async () => {
    try {
        await screenShare.stopScreenShareServer();
        activeRoomId = null;
        if (screenShareMessageId && screenShareChannelId) {
            try {
                await bot.deleteMessage(screenShareChannelId, screenShareMessageId);
            }
            catch (error) {
                console.error('[ScreenShare] Failed to delete Discord message:', error);
            }
            screenShareMessageId = null;
            screenShareChannelId = null;
        }
        return { success: true };
    }
    catch (error) {
        console.error('[ScreenShare] Failed to stop:', error);
        return { success: false, error: error.message };
    }
});
let velopackUpdateInfo = null;
ipcMain.handle('check-for-updates', async () => {
    try {
        const um = new UpdateManager(UPDATE_URL);
        const info = await um.checkForUpdatesAsync();
        if (info) {
            velopackUpdateInfo = info;
            const ver = String(info.TargetFullRelease?.Version || '');
            mainWindow?.webContents.send('update-available', ver);
        }
        else {
            mainWindow?.webContents.send('update-not-available');
        }
    }
    catch {
        mainWindow?.webContents.send('update-not-available');
    }
    return true;
});
ipcMain.handle('download-update', async () => {
    if (!velopackUpdateInfo)
        return false;
    try {
        const um = new UpdateManager(UPDATE_URL);
        await um.downloadUpdateAsync(velopackUpdateInfo, (pct) => {
            mainWindow?.webContents.send('update-progress', pct);
        });
        mainWindow?.webContents.send('update-downloaded');
        return true;
    }
    catch (e) {
        console.error('[Update] Download failed:', e);
        return false;
    }
});
ipcMain.handle('install-update', async () => {
    if (!velopackUpdateInfo)
        return;
    try {
        const um = new UpdateManager(UPDATE_URL);
        await um.waitExitThenApplyUpdate(velopackUpdateInfo);
        app.quit();
    }
    catch (e) {
        console.error('[Update] Install failed:', e);
    }
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize-toggle', () => {
    if (mainWindow?.isMaximized())
        mainWindow?.unmaximize();
    else
        mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('open-external', (_, url) => shell.openExternal(url));
const gifsPath = path.join(app.getPath('userData'), 'gifs.json');
ipcMain.handle('get-saved-gifs', async () => {
    try {
        if (fs.existsSync(gifsPath)) {
            const data = await fs.promises.readFile(gifsPath, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch (e) {
        console.error('[Main] Failed to get gifs:', e);
    }
    return [];
});
ipcMain.handle('save-gifs', async (_, gifs) => {
    try {
        await fs.promises.writeFile(gifsPath, JSON.stringify(gifs));
        return true;
    }
    catch (e) {
        console.error('[Main] Failed to save gifs:', e);
        return false;
    }
});
// Resolve a Tenor media URL to the canonical shareable page URL
ipcMain.handle('resolve-tenor-url', async (_, mediaUrl) => {
    try {
        // Extract the Tenor GIF ID from URLs like:
        // https://media.tenor.com/XYZABCde/slug.mp4  <-- no ID embedded
        // https://tenor.com/view/slug-ID  <-- this is what we want
        // Tenor IDs are encoded in their base64 token. Use search API.
        // Strategy: extract the "token" from the CDN url (letters before the slash after /media.tenor.com/)
        // then call /posts?ids=<token> -> returns share_url
        const tokenMatch = mediaUrl.match(/media\.tenor\.com\/([A-Za-z0-9_-]{12,})/);
        if (!tokenMatch)
            return mediaUrl; // Can't extract, return as-is
        const token = tokenMatch[1];
        const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCPk'; // Tenor public demo key
        const result = await new Promise((resolve) => {
            https.get(`https://tenor.googleapis.com/v2/posts?ids=${token}&key=${apiKey}&limit=1`, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const shareUrl = json?.results?.[0]?.url;
                        resolve(shareUrl || mediaUrl);
                    }
                    catch {
                        resolve(mediaUrl);
                    }
                });
            }).on('error', () => resolve(mediaUrl));
        });
        return result;
    }
    catch (e) {
        console.error('[Main] Tenor resolve error:', e);
        return mediaUrl;
    }
});
//# sourceMappingURL=index.js.map