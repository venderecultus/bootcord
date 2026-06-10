const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getServers: () => ipcRenderer.invoke('get-servers'),
    getChannels: (guildId) => ipcRenderer.invoke('get-channels', guildId),
    createInvite: (channelId) => ipcRenderer.invoke('create-invite', channelId),
    getPins: (channelId) => ipcRenderer.invoke('get-pins', channelId),
    getMessages: (channelId, before) => ipcRenderer.invoke('get-messages', channelId, before),
    getMembers: (guildId) => ipcRenderer.invoke('get-members', guildId),
    sendMessage: (channelId, content, filePath, replyToId) => ipcRenderer.invoke('send-message', channelId, content, filePath, replyToId),
    saveTempAndSend: (channelId, content, arrayBuffer) => ipcRenderer.invoke('save-temp-and-send', channelId, content, arrayBuffer),
    deleteMessage: (channelId, messageId) => ipcRenderer.invoke('delete-message', channelId, messageId),
    editMessage: (channelId, messageId, content) => ipcRenderer.invoke('edit-message', channelId, messageId, content),
    getGuildEmojis: (guildId) => ipcRenderer.invoke('get-guild-emojis', guildId),
    selectFile: () => ipcRenderer.invoke('select-file'),
    
    joinVoice: (guildId, channelId) => ipcRenderer.invoke('join-voice', guildId, channelId),
    leaveVoice: (guildId) => ipcRenderer.invoke('leave-voice', guildId),
    setMute: (mute) => ipcRenderer.invoke('set-mute', mute),
    setDeafen: (deaf) => ipcRenderer.invoke('set-deafen', deaf),
    updateMicSettings: (volume, deviceId) => ipcRenderer.invoke('update-mic-settings', volume, deviceId),
    setNoiseSuppression: (enabled) => ipcRenderer.invoke('set-noise-suppression', enabled),
    setBotStatus: (status) => ipcRenderer.invoke('set-bot-status', status),

    
    getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
    getUserProfile: (userId, guildId) => ipcRenderer.invoke('get-user-profile', userId, guildId),
    toggleReaction: (channelId, messageId, emoji) => ipcRenderer.invoke('toggle-reaction', channelId, messageId, emoji),
    getCurrentUserId: () => ipcRenderer.invoke('get-current-user-id'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, version) => callback(version)),
    onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', () => callback()),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_event, percent) => callback(percent)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
    getSavedGifs: () => ipcRenderer.invoke('get-saved-gifs'),
    saveGifs: (gifs) => ipcRenderer.invoke('save-gifs', gifs),
    resolveTenorUrl: (url) => ipcRenderer.invoke('resolve-tenor-url', url),
    
    onDiscordMessage: (callback) => ipcRenderer.on('discord-message', (_event, value) => callback(value)),
    onVoiceStateUpdate: (callback) => ipcRenderer.on('voice-state-update', (_event, data) => callback(data)),
    onPresenceUpdate: (callback) => ipcRenderer.on('presence-update', (_event, data) => callback(data)),
    
    // Audio Streaming
    sendAudioData: (buffer) => ipcRenderer.send('audio-to-discord', buffer),
    onAudioData: (callback) => ipcRenderer.on('audio-from-discord', (_event, data) => callback(data)),

    setLaunchOnStartup: (enabled) => ipcRenderer.invoke('set-launch-on-startup', enabled),
    setGameDetection: (enabled) => ipcRenderer.invoke('set-game-detection', enabled),

    openExternal: (url) => ipcRenderer.send('open-external', url),
    updateSteamStatus: (url) => ipcRenderer.send('update-steam-status', url),
    
    submitToken: (token) => ipcRenderer.invoke('submit-token', token),
    getEnvToken: () => ipcRenderer.invoke('get-env-token'),
    changeToken: () => ipcRenderer.invoke('change-token'),
    logout: () => ipcRenderer.invoke('logout'),


    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    toggleMaximizeWindow: () => ipcRenderer.send('window-maximize-toggle'),
    closeWindow: () => ipcRenderer.send('window-close'),
    onWindowStateChanged: (callback) => ipcRenderer.on('window-state-changed', (_event, isMaximized) => callback(isMaximized)),

    onNeedsLogin: (callback) => ipcRenderer.on('needs-login', (_event) => callback()),
    
    // Error notifications
    onError: (callback) => ipcRenderer.on('app-error', (_event, data) => callback(data)),
    
    // Screen Share
    startScreenShare: (textChannelId, sourceId, sourceName) => ipcRenderer.invoke('start-screen-share', textChannelId, sourceId, sourceName),
    stopScreenShare: () => ipcRenderer.invoke('stop-screen-share'),
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
    onScreenShareDisconnect: (callback) => ipcRenderer.on('screenshare-disconnect', () => callback()),

    // System notifications
    showSystemNotification: (title, body) => ipcRenderer.send('show-system-notification', title, body),

    // Friend management
    addFriendByTag: (tag) => ipcRenderer.invoke('add-friend-by-tag', tag),
    searchUsersByName: (name) => ipcRenderer.invoke('search-users-by-name', name),
    removeFriendByTag: (tag) => ipcRenderer.invoke('remove-friend-by-tag', tag),
    removeFriend: (userId) => ipcRenderer.invoke('remove-friend', userId),
    blockUser: (userId) => ipcRenderer.invoke('block-user', userId),
    getFriendList: () => ipcRenderer.invoke('get-friend-list'),
    refreshFriendListCache: () => ipcRenderer.invoke('refresh-friend-list-cache'),
    isFriend: (userId) => ipcRenderer.invoke('is-friend', userId),
    acceptFriendRequest: (userId) => ipcRenderer.invoke('accept-friend-request', userId),
    rejectFriendRequest: (userId) => ipcRenderer.invoke('reject-friend-request', userId),
    getPendingFriendRequests: () => ipcRenderer.invoke('get-pending-friend-requests'),

    // Call management
    initiateCall: (userId) => ipcRenderer.invoke('initiate-call', userId),
    endCall: (channelId) => ipcRenderer.invoke('end-call', channelId),
    answerCall: (channelId) => ipcRenderer.invoke('answer-call', channelId),
    joinCallVoice: (channelId) => ipcRenderer.invoke('join-call-voice', channelId),
    getActiveCall: () => ipcRenderer.invoke('get-active-call'),

    // Friend & Call events
    onIncomingCall: (callback) => ipcRenderer.on('incoming-call', (_event, data) => callback(data)),
    onCallStateChange: (callback) => ipcRenderer.on('call-state-change', (_event, data) => callback(data)),
    onPendingFriendRequest: (callback) => ipcRenderer.on('pending-friend-request', (_event, data) => callback(data)),
    onFriendListUpdate: (callback) => ipcRenderer.on('friend-list-update', (_event, data) => callback(data)),
});
