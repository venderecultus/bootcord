import express from 'express';
import { spawn } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import ffmpegPathInitial from 'ffmpeg-static';
const ffmpegPath = ffmpegPathInitial;
import { pinggy } from '@pinggy/pinggy';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let httpServer = null;
let app = null;
let serverPort = 0;
let ffmpegProcess = null;
let tempDir = null;
let pinggyTunnel = null;
let tunnelHealthInterval = null;
let onTunnelDisconnectCallback = null;
const SCREENSHARE_DIR = path.join(__dirname, 'screen-share');
const viewerHtml = fs.readFileSync(path.join(SCREENSHARE_DIR, 'viewer.html'), 'utf-8');
export async function startScreenShareServer(sourceId, sourceName) {
    if (httpServer && pinggyTunnel) {
        const urls = await pinggyTunnel.urls();
        if (urls.length > 0) {
            return { port: serverPort, publicUrl: urls[0] };
        }
    }
    // Create temp dir for HLS segments
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootcord-screenshare-'));
    if (!ffmpegPath) {
        throw new Error('ffmpeg-static binary not found');
    }
    // Spawn FFmpeg with gdigrab → HLS
    const isScreen = sourceId && sourceId.startsWith('screen:');
    let inputArgs;
    if (!sourceId || isScreen) {
        inputArgs = ['-framerate', '30', '-f', 'gdigrab', '-i', 'desktop'];
    }
    else if (sourceName) {
        inputArgs = ['-framerate', '30', '-f', 'gdigrab', '-i', `title=${sourceName}`];
    }
    else {
        inputArgs = ['-framerate', '30', '-f', 'gdigrab', '-i', 'desktop'];
    }
    const proc = spawn(ffmpegPath, [
        ...inputArgs,
        '-s', '1066x600',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-g', '15',
        '-keyint_min', '15',
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-max_delay', '0',
        '-hls_time', '1',
        '-hls_list_size', '3',
        '-hls_flags', 'delete_segments+temp_file',
        '-hls_segment_filename', path.join(tempDir, 'segment_%d.ts'),
        path.join(tempDir, 'stream.m3u8')
    ]);
    ffmpegProcess = proc;
    proc.stderr?.on('data', (data) => {
        console.log('[FFmpeg]', data.toString().trimEnd());
    });
    proc.on('exit', (code) => {
        console.log(`[FFmpeg] Process exited with code ${code}`);
        ffmpegProcess = null;
        if (code !== 0 && tempDir) {
            const m3u8Path = path.join(tempDir, 'stream.m3u8');
            if (!fs.existsSync(m3u8Path)) {
                console.error('[ScreenShare] FFmpeg exited before creating stream.m3u8');
            }
        }
    });
    proc.on('error', (err) => {
        console.error('[FFmpeg] Failed to start:', err);
        ffmpegProcess = null;
    });
    // Set up Express
    app = express();
    app.use('/hls', express.static(tempDir, {
        setHeaders: (res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }));
    app.use(express.static(SCREENSHARE_DIR));
    app.get('/room/:roomId', (req, res) => {
        const ogHtml = `
<meta property="og:title" content="Bootcord Screen Share" />
<meta property="og:description" content="Live screen share stream" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Bootcord Screen Share" />
<meta name="twitter:description" content="Live screen share stream" />
`.trim();
        const html = viewerHtml.replace('</head>', ogHtml + '\n</head>');
        res.send(html);
    });
    httpServer = http.createServer(app);
    httpServer.on('error', (error) => {
        console.error('[ScreenShare] Server error:', error);
        throw error;
    });
    try {
        await new Promise((resolveListen) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address();
                if (addr && typeof addr !== 'string') {
                    serverPort = addr.port;
                }
                resolveListen();
            });
        });
        console.log('[ScreenShare] Starting Pinggy tunnel...');
        const tunnel = await pinggy.forward({ forwarding: `localhost:${serverPort}` });
        const urls = await tunnel.urls();
        const publicUrl = urls[0];
        console.log(`[ScreenShare] Pinggy tunnel created: ${publicUrl}`);
        pinggyTunnel = tunnel;
        tunnelHealthInterval = setInterval(async () => {
            if (!pinggyTunnel || !(await pinggyTunnel.isActive())) {
                if (tunnelHealthInterval) {
                    clearInterval(tunnelHealthInterval);
                    tunnelHealthInterval = null;
                }
                console.log('[ScreenShare] Pinggy tunnel disconnected');
                pinggyTunnel = null;
                if (onTunnelDisconnectCallback) {
                    onTunnelDisconnectCallback();
                }
            }
        }, 5000);
        return { port: serverPort, publicUrl };
    }
    catch (error) {
        console.error('[ScreenShare] Failed to start Pinggy tunnel:', error);
        throw new Error('Failed to create public URL');
    }
}
export async function stopScreenShareServer() {
    if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGTERM');
        setTimeout(() => {
            if (ffmpegProcess && !ffmpegProcess.killed) {
                ffmpegProcess.kill('SIGKILL');
            }
        }, 2000);
        ffmpegProcess = null;
    }
    if (tempDir) {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        catch (e) {
            console.error('[ScreenShare] Failed to clean temp dir:', e);
        }
        tempDir = null;
    }
    if (tunnelHealthInterval) {
        clearInterval(tunnelHealthInterval);
        tunnelHealthInterval = null;
    }
    if (pinggyTunnel) {
        try {
            pinggyTunnel.stop();
        }
        catch (e) {
            console.error('[ScreenShare] Failed to stop Pinggy tunnel:', e);
        }
        pinggyTunnel = null;
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
    app = null;
    serverPort = 0;
    console.log('[ScreenShare] Server stopped');
}
export function isServerRunning() {
    return httpServer !== null;
}
export function getServerPort() {
    return serverPort;
}
export function onTunnelDisconnect(callback) {
    onTunnelDisconnectCallback = callback;
}
//# sourceMappingURL=screenShareServer.js.map