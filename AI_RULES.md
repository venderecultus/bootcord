# AI Development Rules - AltDiscord Relay

## Tech Stack
- **Electron Framework**: Cross-platform desktop application using Main and Renderer processes.
- **TypeScript**: Used for the Main process (`src/main/`) to ensure type safety for bot logic and IPC.
- **Discord.js**: Primary library for interacting with the Discord Gateway and REST API.
- **@discordjs/voice**: Handles voice connections, audio resource creation, and UDP socket management.
- **Python Bridge**: External `mic.py` script using `sounddevice` and `numpy` for high-performance microphone capture and noise gating.
- **Prism-media**: Used for Opus decoding of incoming voice streams from Discord.
- **Web Audio API**: Used in the Renderer for low-latency playback and audio visualization.
- **IPC (Inter-Process Communication)**: Strict separation between Main (Node.js) and Renderer (Browser) via `preload.cjs`.

## Library & Implementation Rules

### 1. Discord Integration
- Use `discord.js` for all message, guild, and member management.
- Use `@discordjs/voice` for joining/leaving channels and subscribing to speaking users.
- **Never** attempt to use Discord's private API; stick to the official bot library.

### 2. Audio Processing
- **Microphone Input**: Always use the Python bridge (`mic.py`) for capturing local audio. Do not use `navigator.mediaDevices.getUserMedia` in the renderer for the primary voice stream to avoid browser-level processing overhead.
- **Audio Playback**: Use the `Web Audio API` in the renderer. Incoming audio chunks from the Main process should be scheduled using `AudioBufferSourceNode` with a jitter buffer.
- **Decoding**: Use `prism.opus.Decoder` in the Main process to convert Discord's Opus packets into Raw PCM before sending them to the Renderer.

### 3. Communication (IPC)
- All Discord actions (sending messages, joining voice) must be triggered via `ipcMain.handle` in `src/main/index.ts`.
- All UI updates from the bot (new messages, voice state changes) must be sent via `webContents.send`.
- Keep the `preload.cjs` file as the single source of truth for the `electronAPI` bridge.

### 4. State Management & Persistence
- Use `localStorage` in the Renderer for UI settings, message history caching, and user volume preferences.
- Use `.env` for the `DISCORD_TOKEN`. Never hardcode credentials.
- Maintain the `currentVoiceState` object in `src/main/bot.ts` to track the bot's connection status across the app.

### 5. UI & Styling
- Stick to the "Discord-dark" aesthetic defined in `src/renderer/styles/main.css`.
- Use standard HTML/JS in the renderer for simplicity and performance, avoiding heavy frameworks unless refactoring is requested.
- Ensure all media (images/GIFs) are handled with proper context menus for "Save to Favorites" functionality.