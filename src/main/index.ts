import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, desktopCapturer, Notification } from 'electron';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
type BotModule = typeof import('./bot.js');
type ScreenShareModule = typeof import('./screenShareServer.js');
let botModule: BotModule | null = null;
let botLoadPromise: Promise<BotModule> | null = null;
let screenShareModule: ScreenShareModule | null = null;
let screenShareLoadPromise: Promise<ScreenShareModule> | null = null;

function getBot(): Promise<BotModule> {
    if (botModule) return Promise.resolve(botModule);
    return botLoadPromise ??= import('./bot.js').then((module) => {
        botModule = module;
        return module;
    });
}

function getScreenShare(): Promise<ScreenShareModule> {
    if (screenShareModule) return Promise.resolve(screenShareModule);
    return screenShareLoadPromise ??= import('./screenShareServer.js').then((module) => {
        screenShareModule = module;
        return module;
    });
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
}

const configPath = path.join(app.getPath('userData'), 'config.json');

// Error notification system
export function sendErrorNotification(message: string, details: string, type: 'microphone' | 'network' | 'voice' | 'general' = 'general') {
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
    } catch (e) { console.error('Failed to read token:', e); }
    return null;
}

async function saveToken(token: string | null) {
    try {
        if (!token) {
            if (fs.existsSync(configPath)) await fs.promises.unlink(configPath);
            return;
        }
        await fs.promises.writeFile(configPath, JSON.stringify({ token }));
    } catch (e) { console.error('Failed to save token:', e); }
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
            void botModule?.leaveVoice('');
            setTimeout(() => app.quit(), 200);
        }}
    ]);

    tray.setToolTip('bootcord');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
}

const GITHUB_OWNER = 'venderecultus';
const GITHUB_REPO = 'bootcord';
const GITHUB_BRANCH = 'main';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
const UPDATE_ROOT = path.resolve(__dirname, '../..');
const UPDATE_EXCLUDES = new Set([
    '.git', 'node_modules', 'graphify-out', 'release', 'coverage', '.env', 'dist',
]);

type GitHubTreeEntry = { path: string; type: string; mode: string; sha: string; size?: number };
let availableUpdate: { version: string; files: GitHubTreeEntry[]; stagePath?: string } | null = null;

async function checkForGitHubUpdates(): Promise<boolean> {
    try {
        const remote = await getRemoteTree();
        const changed = await getChangedFiles(remote.files);
        availableUpdate = changed.length ? { version: remote.version, files: changed } : null;
        if (availableUpdate) mainWindow?.webContents.send('update-available', remote.version);
        else mainWindow?.webContents.send('update-not-available');
        return Boolean(availableUpdate);
    } catch (error) {
        console.error('[Update] Check failed:', error);
        mainWindow?.webContents.send('update-not-available');
        return false;
    }
}

function githubRequest(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'bootcord-updater', ...headers } }, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                githubRequest(response.headers.location, headers).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`GitHub returned HTTP ${response.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

function isUpdatePathAllowed(relativePath: string): boolean {
    const normalized = path.posix.normalize(relativePath);
    const parts = normalized.split('/');
    return normalized === relativePath
        && !parts.some((part) => UPDATE_EXCLUDES.has(part))
        && !['start_bootcord.bat', 'start_bootcord.vbs'].includes(normalized)
        && !normalized.startsWith('../')
        && !path.posix.isAbsolute(normalized);
}

function resolveUpdatePath(root: string, relativePath: string): string {
    if (!isUpdatePathAllowed(relativePath)) throw new Error(`Blocked update path: ${relativePath}`);
    const resolved = path.resolve(root, ...relativePath.split('/'));
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Update path escapes application folder: ${relativePath}`);
    return resolved;
}

function getLocalGitBlobSha(content: Buffer): string {
    const header = Buffer.from(`blob ${content.length}\0`);
    return crypto.createHash('sha1').update(Buffer.concat([header, content])).digest('hex');
}

async function getRemoteTree(): Promise<{ version: string; files: GitHubTreeEntry[] }> {
    const branch = JSON.parse((await githubRequest(`${GITHUB_API}/branches/${GITHUB_BRANCH}`, { Accept: 'application/vnd.github+json' })).toString('utf8'));
    const commit = branch.commit.sha as string;
    const tree = JSON.parse((await githubRequest(`${GITHUB_API}/git/trees/${commit}?recursive=1`, { Accept: 'application/vnd.github+json' })).toString('utf8'));
    if (tree.truncated) throw new Error('GitHub tree is too large to update safely');
    const files = (tree.tree as GitHubTreeEntry[]).filter((entry) => entry.type === 'blob' && entry.mode !== '120000' && isUpdatePathAllowed(entry.path));
    return { version: commit.slice(0, 7), files };
}

async function getChangedFiles(remoteFiles: GitHubTreeEntry[]): Promise<GitHubTreeEntry[]> {
    const changed: GitHubTreeEntry[] = [];
    for (const entry of remoteFiles) {
        const localPath = resolveUpdatePath(UPDATE_ROOT, entry.path);
        try {
            const local = await fs.promises.readFile(localPath);
            if (getLocalGitBlobSha(local) !== entry.sha) changed.push(entry);
        } catch {
            changed.push(entry);
        }
    }
    return changed;
}

function startUpdateApplier(stagePath: string): void {
    const updaterPath = path.join(os.tmpdir(), `bootcord-apply-update-${process.pid}.bat`);
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const script = [
        '@echo off',
        'setlocal',
        'timeout /t 2 /nobreak >nul',
        `robocopy ${quote(stagePath)} ${quote(UPDATE_ROOT)} /E /MOVE /R:5 /W:1 /NFL /NDL /NJH /NJS /NP`,
        'if %ERRORLEVEL% GEQ 8 exit /b %ERRORLEVEL%',
        `cd /d ${quote(UPDATE_ROOT)}`,
        'call npm install --no-audit --no-fund',
        'if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%',
        'call npm run build',
        'if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%',
        `del ${quote(updaterPath)}`,
        `start "" /d ${quote(UPDATE_ROOT)} cmd.exe /d /c npx electron .`,
    ].join('\r\n');
    fs.writeFileSync(updaterPath, script, 'utf8');
    const child = spawn('cmd.exe', ['/d', '/c', updaterPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
}

app.whenReady().then(async () => {
    if (!hasSingleInstanceLock) return;
    createWindow();
    createTray();

    void checkForGitHubUpdates();

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
            const bot = await getBot();
            const loginPromise = bot.loginBot(savedToken);
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Login timeout (15s)')), 15000)
            );
            await Promise.race([loginPromise, timeoutPromise]);
            initBotHandlers();
        } else {
            console.log('[Main] No saved token found.');
            showLogin();
        }
    } catch (e) {
        console.error('Initial login failed:', e);
        showLogin();
    }
});

function initBotHandlers() {
    if (!botModule) return;
    botModule.onMessage((msg: any) => {
        mainWindow?.webContents.send('discord-message', msg);
    });
    botModule.onVoiceStateUpdate((data: any) => {
        mainWindow?.webContents.send('voice-state-update', data);
    });
    botModule.onPresenceUpdate((data: any) => {
        mainWindow?.webContents.send('presence-update', data);
    });
    botModule.onAudioData((data) => {
        mainWindow?.webContents.send('audio-from-discord', data);
    });
}

ipcMain.handle('get-servers', async () => (await getBot()).getServers());
ipcMain.handle('get-channels', async (_, guildId) => (await getBot()).getChannels(guildId));
ipcMain.handle('create-invite', async (_, channelId) => (await getBot()).createInvite(channelId));
ipcMain.handle('get-pins', async (_, channelId) => (await getBot()).getPins(channelId));

ipcMain.handle('submit-token', async (_, token) => {
    try {
        const bot = await getBot();
        const loginPromise = bot.loginBot(token);
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Login timeout (20s)')), 20000)
        );
        await Promise.race([loginPromise, timeout]);
        await saveToken(token);
        initBotHandlers();
        return { success: true };
    } catch (error: any) {
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
    } catch (e) {
        console.error('Logout failed:', e);
    }
});

ipcMain.handle('change-token', () => {
    console.log('[Main] change-token called, sending needs-login...');
    mainWindow?.webContents.send('needs-login');
});

ipcMain.handle('get-messages', async (_, channelId, before) => (await getBot()).getMessageHistory(channelId, before));
ipcMain.handle('get-members', async (_, guildId) => (await getBot()).getGuildMembers(guildId));
ipcMain.handle('send-message', async (_, channelId, content, filePath, replyToId) => (await getBot()).sendMessage(channelId, content, filePath, replyToId));
ipcMain.handle('delete-message', async (_, channelId, messageId) => (await getBot()).deleteMessage(channelId, messageId));
ipcMain.handle('edit-message', async (_, channelId, messageId, content) => (await getBot()).editMessage(channelId, messageId, content));
ipcMain.handle('get-guild-emojis', async (_, guildId) => (await getBot()).getGuildEmojis(guildId));

ipcMain.handle('join-voice', async (_, guildId, channelId) => (await getBot()).joinVoice(guildId, channelId));
ipcMain.handle('leave-voice', async (_, guildId) => (await getBot()).leaveVoice(guildId));
ipcMain.handle('set-mute', async (_, mute) => (await getBot()).setMute(mute));
ipcMain.handle('set-deafen', async (_, deaf) => (await getBot()).setDeafen(deaf));
ipcMain.handle('update-mic-settings', async (_, volume, deviceId) => (await getBot()).updateMicSettings(volume, deviceId));
ipcMain.handle('set-noise-suppression', async (_, enabled) => (await getBot()).setNoiseSuppression(enabled));
ipcMain.handle('set-bot-status', async (_, status) => (await getBot()).setNotificationStatus(status));
ipcMain.on('audio-to-discord', (_, buffer) => { void getBot().then((bot) => bot.injectAudioChunk(buffer)); });


ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    const filePath = result.filePaths[0];
    if (!filePath) return null;

    try {
        const stats = await fs.promises.stat(filePath);
        if (stats.size > 10 * 1024 * 1024) {
            return { error: 'File size exceeds 10MB limit.' };
        }
        return { filePath };
    } catch (e) {
        return { error: 'Failed to read file.' };
    }
});

ipcMain.handle('select-image-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
        ]
    });
    
    const filePath = result.filePaths[0];
    if (!filePath) return null;
    
    return { filePath };
});

ipcMain.handle('save-profile-image', async (_, dataUrl: string, extension = 'png') => {
    try {
        const match = /^data:image\/[^;]+;base64,(.+)$/.exec(dataUrl);
        if (!match) return { error: 'Invalid image data.' };
        const safeExtension = extension === 'jpg' ? 'jpg' : 'png';
        const filePath = path.join(app.getPath('temp'), `bootcord-profile-${Date.now()}.${safeExtension}`);
        await fs.promises.writeFile(filePath, Buffer.from(match[1], 'base64'));
        return { filePath };
    } catch {
        return { error: 'Failed to prepare image.' };
    }
});

ipcMain.handle('save-temp-and-send', async (_, channelId, content, arrayBuffer) => {
    try {
        const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}.png`);
        await fs.promises.writeFile(tempPath, Buffer.from(arrayBuffer));
        await (await getBot()).sendMessage(channelId, content, tempPath);
        return true;
    } catch (e) {
        console.error('[Main] Temp file upload failed:', e);
        return false;
    }
});

ipcMain.handle('get-current-user-id', async () => (await getBot()).getClient().user?.id || null);

ipcMain.handle('get-bot-status', async () => (await getBot()).getBotData());
ipcMain.handle('get-env-token', () => {
    return process.env.DISCORD_TOKEN || null;
});

ipcMain.on('update-steam-status', (event, url) => { void getBot().then((bot) => bot.setSteamUrl(url)); });
ipcMain.handle('set-launch-on-startup', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
});
ipcMain.handle('set-game-detection', (_, enabled) => {
    void getBot().then((bot) => enabled ? bot.startPresenceScans() : bot.stopPresenceScans());
    return true;
});
ipcMain.handle('get-user-profile', async (event, userId, guildId) => (await getBot()).getUserProfile(userId, guildId));
ipcMain.handle('toggle-reaction', async (e, channelId, messageId, emoji) => (await getBot()).toggleReaction(channelId, messageId, emoji));

// Screen Share handlers
let screenShareMessageId: string | null = null;
let screenShareChannelId: string | null = null;
let activeRoomId: string | null = null;

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
    } catch (error) {
        console.error('[ScreenShare] Failed to get sources:', error);
        return [];
    }
});

ipcMain.handle('start-screen-share', async (_, textChannelId, sourceId, sourceName) => {
    try {
        const screenShare = await getScreenShare();
        const bot = await getBot();
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
            } catch (error) {
                console.error('[ScreenShare] Failed to send Discord message:', error);
            }
        }

        screenShare.onTunnelDisconnect(() => {
            if (mainWindow) {
                mainWindow.webContents.send('screenshare-disconnect');
            }
        });

        return { success: true, url: roomUrl, roomId, port };
    } catch (error: any) {
        console.error('[ScreenShare] Failed to start:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-screen-share', async () => {
    try {
        await (await getScreenShare()).stopScreenShareServer();
        activeRoomId = null;
        
        if (screenShareMessageId && screenShareChannelId) {
            try {
                await (await getBot()).deleteMessage(screenShareChannelId, screenShareMessageId);
            } catch (error) {
                console.error('[ScreenShare] Failed to delete Discord message:', error);
            }
            screenShareMessageId = null;
            screenShareChannelId = null;
        }
        
        return { success: true };
    } catch (error: any) {
        console.error('[ScreenShare] Failed to stop:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-for-updates', checkForGitHubUpdates);

ipcMain.handle('download-update', async () => {
    if (!availableUpdate) return false;
    const update = availableUpdate;
    const stagePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bootcord-update-'));
    const totalBytes = update.files.reduce((sum, file) => sum + (file.size || 0), 0);
    let downloadedBytes = 0;
    let nextFileIndex = 0;
    try {
        const downloadWorker = async () => {
            while (nextFileIndex < update.files.length) {
                const file = update.files[nextFileIndex++];
                const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
                const content = await githubRequest(url);
                if (getLocalGitBlobSha(content) !== file.sha) throw new Error(`Downloaded file failed SHA check: ${file.path}`);
                const destination = resolveUpdatePath(stagePath, file.path);
                await fs.promises.mkdir(path.dirname(destination), { recursive: true });
                await fs.promises.writeFile(destination, content);
                downloadedBytes += content.length;
                const percent = totalBytes ? Math.min(100, downloadedBytes / totalBytes * 100) : Math.min(100, nextFileIndex / update.files.length * 100);
                mainWindow?.webContents.send('update-progress', percent);
            }
        };
        const results = await Promise.allSettled(Array.from({ length: Math.min(5, update.files.length) }, downloadWorker));
        const failedDownload = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failedDownload) throw failedDownload.reason;
        availableUpdate = { ...update, stagePath };
        mainWindow?.webContents.send('update-downloaded');
        return true;
    } catch (error) {
        await fs.promises.rm(stagePath, { recursive: true, force: true });
        console.error('[Update] Download failed:', error);
        mainWindow?.webContents.send('update-error', error instanceof Error ? error.message : String(error));
        return false;
    }
});

ipcMain.handle('install-update', async () => {
    if (!availableUpdate?.stagePath) return false;
    const stagePath = availableUpdate.stagePath;
    if (!mainWindow) return false;
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Close and update', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: 'Update downloaded',
        detail: 'Close bootcord now to finish installing the update. The app will reopen when the update is applied.',
    });
    if (response !== 0) return false;

    isQuitting = true;
    app.once('will-quit', () => startUpdateApplier(stagePath));
    app.quit();
    return true;
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize-toggle', () => {
    if (mainWindow?.isMaximized()) mainWindow?.unmaximize();
    else mainWindow?.maximize();
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
    } catch (e) { console.error('[Main] Failed to get gifs:', e); }
    return [];
});

ipcMain.handle('save-gifs', async (_, gifs) => {
    try {
        await fs.promises.writeFile(gifsPath, JSON.stringify(gifs));
        return true;
    } catch (e) { console.error('[Main] Failed to save gifs:', e); return false; }
});

// Resolve a Tenor media URL to the canonical shareable page URL
ipcMain.handle('resolve-tenor-url', async (_, mediaUrl: string) => {
    try {
        // Extract the Tenor GIF ID from URLs like:
        // https://media.tenor.com/XYZABCde/slug.mp4  <-- no ID embedded
        // https://tenor.com/view/slug-ID  <-- this is what we want
        // Tenor IDs are encoded in their base64 token. Use search API.

        // Strategy: extract the "token" from the CDN url (letters before the slash after /media.tenor.com/)
        // then call /posts?ids=<token> -> returns share_url
        const tokenMatch = mediaUrl.match(/media\.tenor\.com\/([A-Za-z0-9_-]{12,})/);
        if (!tokenMatch) return mediaUrl; // Can't extract, return as-is
        
        const token = tokenMatch[1];
        const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCPk'; // Tenor public demo key
        
        const result = await new Promise<string>((resolve) => {
            https.get(`https://tenor.googleapis.com/v2/posts?ids=${token}&key=${apiKey}&limit=1`, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const shareUrl = json?.results?.[0]?.url;
                        resolve(shareUrl || mediaUrl);
                    } catch { resolve(mediaUrl); }
                });
            }).on('error', () => resolve(mediaUrl));
        });
        
        return result;
    } catch (e) {
        console.error('[Main] Tenor resolve error:', e);
        return mediaUrl;
    }
});

// System notifications
ipcMain.on('show-system-notification', (_, title, body) => {
    if (Notification.isSupported()) {
        new Notification({ title, body, icon: path.join(__dirname, '..', 'icon.png') }).show();
    }
});


// Profile editing
ipcMain.handle('set-username', async (_, username) => (await getBot()).setUsername(username));
ipcMain.handle('set-avatar', async (_, avatarPath) => (await getBot()).setAvatar(avatarPath));
ipcMain.handle('set-banner', async (_, bannerPath) => (await getBot()).setBanner(bannerPath));
ipcMain.handle('set-nickname', async (_, guildId, nickname) => (await getBot()).setNickname(guildId, nickname));
