import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import localtunnel from 'localtunnel';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let httpServer = null;
let wss = null;
let app = null;
let serverPort = 0;
let viewers = new Set();
let onViewerChangeCallback = null;
let tunnel = null;
export function startScreenShareServer() {
    return new Promise(async (resolve, reject) => {
        if (httpServer && tunnel) {
            resolve({ port: serverPort, publicUrl: tunnel.url });
            return;
        }
        app = express();
        // Serve viewer page
        app.get('/', (req, res) => {
            res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Screen Share</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #1e1f22;
            color: #fff;
            font-family: 'Inter', 'Segoe UI', sans-serif;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #2b2d31 0%, #1e1f22 100%);
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .title {
            font-size: 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .live-badge {
            background: linear-gradient(135deg, #f23f43 0%, #d32f2f 100%);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        .viewer-count {
            background: rgba(88, 101, 242, 0.2);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            border: 1px solid rgba(88, 101, 242, 0.3);
        }
        .viewer-icon {
            width: 16px;
            height: 16px;
            fill: #5865f2;
        }
        .video-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #000;
            position: relative;
        }
        #video {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            object-fit: contain;
        }
        .status {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: #949ba4;
        }
        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid rgba(88, 101, 242, 0.2);
            border-top-color: #5865f2;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .controls {
            background: #2b2d31;
            padding: 12px 24px;
            display: flex;
            justify-content: center;
            gap: 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .quality-btn {
            background: rgba(88, 101, 242, 0.1);
            border: 1px solid rgba(88, 101, 242, 0.3);
            color: #5865f2;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .quality-btn:hover {
            background: rgba(88, 101, 242, 0.2);
        }
        .quality-btn.active {
            background: #5865f2;
            color: white;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">
            <span class="live-badge">● LIVE</span>
            Screen Share
        </div>
        <div class="viewer-count">
            <svg class="viewer-icon" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <span id="viewerCount">0</span> watching
        </div>
    </div>
    
    <div class="video-container">
        <video id="video" autoplay playsinline></video>
        <div class="status" id="status">
            <div class="spinner"></div>
            <div>Connecting to stream...</div>
        </div>
    </div>

    <script>
        const video = document.getElementById('video');
        const status = document.getElementById('status');
        const viewerCount = document.getElementById('viewerCount');
        
        let ws = null;
        let reconnectTimeout = null;
        let mediaSource = null;
        let sourceBuffer = null;
        let queue = [];

        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host);
            
            ws.binaryType = 'arraybuffer';
            
            ws.onopen = () => {
                console.log('Connected to stream');
                status.style.display = 'none';
                
                // Setup MediaSource for video playback
                if ('MediaSource' in window) {
                    mediaSource = new MediaSource();
                    video.src = URL.createObjectURL(mediaSource);
                    
                    mediaSource.addEventListener('sourceopen', () => {
                        try {
                            sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8,opus"');
                            sourceBuffer.mode = 'sequence';
                            
                            sourceBuffer.addEventListener('updateend', () => {
                                if (queue.length > 0 && !sourceBuffer.updating) {
                                    sourceBuffer.appendBuffer(queue.shift());
                                }
                            });
                        } catch (e) {
                            console.error('Failed to create SourceBuffer:', e);
                        }
                    });
                }
            };
            
            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    const data = JSON.parse(event.data);
                    if (data.type === 'viewerCount') {
                        viewerCount.textContent = data.count;
                    }
                } else {
                    // Binary video/audio data
                    if (sourceBuffer && !sourceBuffer.updating) {
                        try {
                            sourceBuffer.appendBuffer(event.data);
                        } catch (e) {
                            queue.push(event.data);
                        }
                    } else if (sourceBuffer) {
                        queue.push(event.data);
                    }
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            ws.onclose = () => {
                console.log('Disconnected from stream');
                status.style.display = 'block';
                status.innerHTML = '<div class="spinner"></div><div>Reconnecting...</div>';
                
                // Cleanup
                if (mediaSource && mediaSource.readyState === 'open') {
                    mediaSource.endOfStream();
                }
                queue = [];
                
                // Reconnect after 2 seconds
                reconnectTimeout = setTimeout(connect, 2000);
            };
        }
        
        connect();
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (ws) ws.close();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        });
    </script>
</body>
</html>
            `);
        });
        httpServer = http.createServer(app);
        // WebSocket server
        wss = new WebSocketServer({ server: httpServer });
        wss.on('connection', (ws) => {
            console.log('[ScreenShare] New viewer connected');
            viewers.add(ws);
            broadcastViewerCount();
            if (onViewerChangeCallback) {
                onViewerChangeCallback(viewers.size);
            }
            ws.on('close', () => {
                console.log('[ScreenShare] Viewer disconnected');
                viewers.delete(ws);
                broadcastViewerCount();
                if (onViewerChangeCallback) {
                    onViewerChangeCallback(viewers.size);
                }
            });
            ws.on('error', (error) => {
                console.error('[ScreenShare] WebSocket error:', error);
                viewers.delete(ws);
            });
        });
        // Find available port
        httpServer.listen(0, async () => {
            const address = httpServer.address();
            if (address && typeof address !== 'string') {
                serverPort = address.port;
                console.log(`[ScreenShare] Server started on port ${serverPort}`);
                try {
                    // Start localtunnel
                    console.log('[ScreenShare] Starting localtunnel...');
                    tunnel = await localtunnel({ port: serverPort });
                    console.log(`[ScreenShare] Tunnel created: ${tunnel.url}`);
                    tunnel.on('close', () => {
                        console.log('[ScreenShare] Tunnel closed');
                    });
                    resolve({ port: serverPort, publicUrl: tunnel.url });
                }
                catch (error) {
                    console.error('[ScreenShare] Failed to start localtunnel:', error);
                    reject(new Error('Failed to create public URL'));
                }
            }
            else {
                reject(new Error('Failed to get server port'));
            }
        });
        httpServer.on('error', (error) => {
            console.error('[ScreenShare] Server error:', error);
            reject(error);
        });
    });
}
export async function stopScreenShareServer() {
    // Close tunnel first
    if (tunnel) {
        try {
            tunnel.close();
            console.log('[ScreenShare] Tunnel closed');
            tunnel = null;
        }
        catch (error) {
            console.error('[ScreenShare] Failed to close tunnel:', error);
        }
    }
    if (wss) {
        viewers.forEach(ws => ws.close());
        viewers.clear();
        wss.close();
        wss = null;
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
    serverPort = 0;
    console.log('[ScreenShare] Server stopped');
}
export function broadcastFrame(frameData) {
    if (viewers.size === 0)
        return;
    viewers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(frameData);
        }
    });
}
export function broadcastViewerCount() {
    const message = JSON.stringify({
        type: 'viewerCount',
        count: viewers.size
    });
    viewers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}
export function getViewerCount() {
    return viewers.size;
}
export function getServerPort() {
    return serverPort;
}
export function isServerRunning() {
    return httpServer !== null;
}
export function onViewerChange(callback) {
    onViewerChangeCallback = callback;
}
//# sourceMappingURL=screenShareServer.js.map