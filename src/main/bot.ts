import { Client, GatewayIntentBits, Message, ChannelType, GuildMember, TextChannel, VoiceChannel, AttachmentBuilder, ActivityType, Partials, MessageReaction, User as DiscordUser, MessageType, PermissionFlagsBits, OverwriteType } from 'discord.js';
import https from 'https';
import { exec, spawn, ChildProcess } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import { app } from 'electron';
import { 
    joinVoiceChannel, 
    getVoiceConnection,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    EndBehaviorType,
    StreamType,
    entersState
} from '@discordjs/voice';
import { Readable } from 'stream';
import prism from 'prism-media';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { sendErrorNotification } from './notifications.js';

dotenv.config();

// Set FFMPEG path for prism-media
// In production, electron-builder unpacks binaries to app.asar.unpacked
let ffmpegPath = (ffmpeg as any) || '';
if (app.isPackaged && typeof ffmpegPath === 'string' && ffmpegPath.includes('app.asar')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
process.env.FFMPEG_PATH = ffmpegPath;
console.log('[Bot] FFMPEG Path:', ffmpegPath);

let clientIntents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
];

let clientPartials = [Partials.Message, Partials.Channel, Partials.Reaction];

let client = new Client({
    intents: clientIntents,
    partials: clientPartials,
});

export function getClient() {
    return client;
}

function attachClientHandlers(c: Client) {
    c.once('ready', () => {
        console.log(`[Bot] Logged in as ${c.user?.tag}! Ready to relay.`);
    });

    c.on('messageCreate', (message: Message) => {
        messageHandler(formatMessage(message));
    });

    c.on('messageUpdate', async (oldMsg, newMsg) => {
        if (newMsg.partial) {
            try { await newMsg.fetch(); } catch {}
        }
        messageHandler(formatMessage(newMsg as Message));
    });

    c.on('messageReactionAdd', async (reaction) => {
        try {
            const ch = reaction.message.channel as TextChannel;
            ch.messages.cache.delete(reaction.message.id);
            const msg = await ch.messages.fetch(reaction.message.id);
            messageHandler(formatMessage(msg as Message));
        } catch (e) {
            console.error('[Bot] Error handling messageReactionAdd:', e);
        }
    });

    c.on('messageReactionRemove', async (reaction) => {
        try {
            const ch = reaction.message.channel as TextChannel;
            ch.messages.cache.delete(reaction.message.id);
            const msg = await ch.messages.fetch(reaction.message.id);
            messageHandler(formatMessage(msg as Message));
        } catch (e) {
            console.error('[Bot] Error handling messageReactionRemove:', e);
        }
    });

    c.on('messageDelete', (message) => {
        messageHandler({ type: 'delete', id: message.id, channelId: message.channelId });
    });

    c.on('voiceStateUpdate', (oldState, newState) => {
        const guildId = newState.guild.id || oldState.guild.id;
        const updateData = {
            guildId,
            userId: newState.member?.id || oldState.member?.id,
            oldChannelId: oldState.channelId,
            newChannelId: newState.channelId,
            member: newState.member ? {
                id: newState.member.id,
                username: newState.member.displayName,
                avatar: newState.member.user.displayAvatarURL(),
                mute: newState.member.voice.selfMute || newState.member.voice.serverMute,
                deaf: newState.member.voice.selfDeaf || newState.member.voice.serverDeaf,
                status: newState.member.presence?.status || 'offline',
                activities: newState.member.presence?.activities.map(a => ({
                    name: a.name,
                    type: a.type,
                    state: a.state,
                    details: a.details
                })) || []
            } : null
        };
        voiceStateHandler(updateData);
    });

    c.on('presenceUpdate', (oldPresence, newPresence) => {
        if (!newPresence || !newPresence.guild) return;
        const member = newPresence.member;
        if (!member) return;

        const activities = newPresence.activities.map(a => ({
            name: a.name,
            type: a.type,
            state: a.state,
            details: a.details
        }));

        if (member.id === c.user?.id) {
            selfActivities = activities;
            selfStatus = newPresence.status || 'online';
            console.log('[Presence] Self activity updated:', selfActivities.map(a => a.name).join(', ') || 'none');
        }

        presenceHandler({
            guildId: newPresence.guild.id,
            userId: member.id,
            status: newPresence.status,
            activities
        });
    });
}

// Initial attach
attachClientHandlers(client);


let messageHandler: (msg: any) => void = () => {};
let voiceStateHandler: (data: any) => void = () => {};
let audioDataHandler: (data: { userId: string, buffer: Buffer }) => void = () => {};

let activeAudioStream: Readable | null = null;
let micProcess: ChildProcess | null = null;
const audioPlayer = createAudioPlayer();

const __filename_bot = fileURLToPath(import.meta.url);
const __dirname_bot = path.dirname(__filename_bot);

// Global catch to prevent app hang on stream errors
process.on('uncaughtException', (err) => {
    if (err.message.includes('Premature close')) return;
    console.error('Uncaught Exception:', err);
});

let connection: any = null; // Store current voice connection

let currentVoiceState = {
    guildId: null as string | null,
    channelId: null as string | null,
    selfMute: false,
    selfDeaf: false
};
let lastActiveChannelId: string | null = null;
let lastActiveTextChannelId: string | null = null; // Store last used text channel

let steamInterval: NodeJS.Timeout | null = null;
let gameInterval: NodeJS.Timeout | null = null;
let micRestartTimer: NodeJS.Timeout | null = null;
let micHealthTimer: NodeJS.Timeout | null = null;

let micSettings = {
    volume: 1.0,
    deviceId: 'default',
    noiseSuppression: false
};

export function onMessage(handler: (msg: any) => void) {
    messageHandler = handler;
}

export function onVoiceStateUpdate(handler: (data: any) => void) {
    voiceStateHandler = handler;
}

export function onAudioData(handler: (data: { userId: string, buffer: Buffer }) => void) {
    audioDataHandler = handler;
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}! Ready to relay.`);
});

// Track active streams per user to avoid duplicates
const userStreams = new Map<string, { receiver: any, decoder: any }>();

function formatReferencedMessage(message: Message) {
    let referencedMessage = null;
    if (message.reference && message.reference.messageId) {
        const refUser = message.mentions.repliedUser;
        const refMsg = (message as any).referencedMessage;
        referencedMessage = {
            id: message.reference.messageId,
            author: refUser?.displayName || refUser?.username || refMsg?.member?.displayName || refMsg?.author?.username || 'User',
            authorId: refUser?.id || refMsg?.author?.id,
            avatar: refUser?.displayAvatarURL?.() || refMsg?.author?.displayAvatarURL?.() || '',
            isMentioned: (refUser?.id || refMsg?.author?.id) === client.user?.id,
            content: refMsg?.content || ''
        };
    }

    return referencedMessage;
}

function formatSystemContent(message: Message): string | null {
    switch (message.type) {
        case MessageType.RecipientAdd: return `added <@${message.author.id}> to the join.`;
        case MessageType.RecipientRemove: return `removed <@${message.author.id}> from the join.`;
        case MessageType.ChannelNameChange: return `changed the channel name: **${message.content}**`;
        case MessageType.ChannelIconChange: return `changed the channel icon.`;
        case MessageType.ChannelPinnedMessage: return `pinned a message to this channel.`;
        case MessageType.UserJoin: return `joined the server.`;
        case MessageType.GuildBoost: return `boosted the server!`;
        case MessageType.GuildBoostTier1: return `boosted the server (Tier 1)!`;
        case MessageType.GuildBoostTier2: return `boosted the server (Tier 2)!`;
        case MessageType.GuildBoostTier3: return `boosted the server (Tier 3)!`;
        case MessageType.ThreadCreated: return `started a thread: **${message.content}**`;
        case MessageType.AutoModerationAction: return `AutoModeration block.`;
        default: return null;
    }
}

function formatMessageContent(message: Message): string {
    let content = message.content || '';
    content = content.replace(/<@!?(\d+)>/g, (match, id) => {
        const user = message.guild?.members.cache.get(id)?.displayName || message.client.users.cache.get(id)?.username;
        return user ? `[[@${user}]]` : match;
    });
    content = content.replace(/<#(\d+)>/g, (match, id) => {
        const channel = message.guild?.channels.cache.get(id)?.name;
        return channel ? `[[#${channel}]]` : match;
    });
    return content.replace(/<@&(\d+)>/g, (match, id) => {
        const role = message.guild?.roles.cache.get(id)?.name;
        return role ? `[[@${role}]]` : match;
    });
}

function formatMessage(message: Message) {

    return {
        id: message.id,
        channelId: message.channelId,
        channelName: message.channel && 'name' in message.channel ? (message.channel as any).name : null,
        guildId: message.guildId,
        guildName: message.guild?.name || null,
        author: message.member?.displayName || message.author.username,
        authorId: message.author.id,
        isSelf: message.author.id === client.user?.id,
        isMentioned: message.mentions.users.has(client.user?.id || '') || message.mentions.everyone,
        content: formatMessageContent(message),
        avatar: message.author.displayAvatarURL(),
        timestamp: message.createdAt.toLocaleTimeString(),
        rawTimestamp: message.createdAt.toISOString(),
        referencedMessage: formatReferencedMessage(message),
        attachments: message.attachments.map(a => a.url),
        reactions: Array.from(message.reactions.cache.values()).map(r => ({
            emoji: r.emoji.id ? `<${r.emoji.animated ? 'a' : ''}:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name,
            name: r.emoji.name,
            id: r.emoji.id,
            count: r.count,
            me: r.me
        })),
        embeds: message.embeds.map(e => ({
            type: e.data.type,
            url: e.url || e.data.url,
            provider: e.provider?.name || null,
            title: e.title || null,
            description: e.description || null,
            color: e.hexColor || null,
            author: e.author ? { name: e.author.name, url: e.author.url || null, iconURL: e.author.iconURL || null } : null,
            footer: e.footer ? { text: e.footer.text, iconURL: e.footer.iconURL || null } : null,
            timestamp: e.timestamp || null,
            image: e.image?.url || null,
            thumbnail: e.thumbnail?.url || null,
            video: e.video?.url || null,
            fields: e.fields?.map(f => ({ name: f.name, value: f.value, inline: f.inline || false })) || []
        })),
        systemContent: formatSystemContent(message),
        type: message.type,
        poll: (message as any).poll ? {
            question: (message as any).poll.question.text,
            answers: (message as any).poll.answers.map((a: any) => ({
                id: a.id,
                text: a.text,
                emoji: a.emoji?.name || a.emoji?.id,
                votes: a.voteCount
            })),
            isEnded: (message as any).poll.resultsFinalized
        } : null
    };
}

// Event listeners were moved to attachClientHandlers


export async function toggleReaction(channelId: string, messageId: string, emoji: string) {
    try {
        const channel = client.channels.cache.get(channelId);
        if (!channel?.isTextBased()) return;
        const message = await (channel as TextChannel).messages.fetch(messageId);
        if (!message) return;

        // Parse ID out of <a:name:id> or <:name:id> if present
        let searchId = emoji;
        let searchName = emoji;
        const customMatch = emoji.match(/<a?:(\w+):(\d+)>/);
        if (customMatch) {
            searchName = customMatch[1];
            searchId = customMatch[2];
        }

        const reaction = message.reactions.cache.find(r => r.emoji.id === searchId || r.emoji.name === searchName);
        
        if (reaction && reaction.me) {
            await reaction.users.remove(client.user?.id);
        } else {
            await message.react(emoji);
        }

        // Clear stale cache and force fresh fetch to ensure UI is in sync
        (channel as TextChannel).messages.cache.delete(messageId);
        const updated = await (channel as TextChannel).messages.fetch(messageId);
        if (updated) messageHandler(formatMessage(updated));
    } catch (e) {
        console.error('[Bot] Toggle reaction error:', e);
    }
}

export async function editMessage(channelId: string, messageId: string, content: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && (channel.isTextBased() || channel.isThread())) {
            const message = await channel.messages.fetch(messageId);
            await (message as Message).edit(content);
            return true;
        }
    } catch (e) {
        console.error('[Bot] Edit failed:', e);
    }
    return false;
}


let presenceHandler: (data: any) => void = () => {};
export function onPresenceUpdate(handler: (data: any) => void) {
    presenceHandler = handler;
}

// Store bot's own activities since discord.js doesn't reliably cache self-presence
let selfActivities: any[] = [];
let selfStatus: string = 'online';

let steamDetectedGame: string | null = null;
let steamUrl: string = '';
let localDetectedGame: string | null = null;
let currentBotStatus: string = 'online';


export function setNotificationStatus(status: string) {
    currentBotStatus = status;
    updateBotPresence();
}



export function setSteamUrl(url: string) {
    steamUrl = url;
    checkSteamStatus();
}

function checkSteamStatus() {
    if (!steamUrl || !steamUrl.startsWith('http')) {
        steamDetectedGame = null;
        updateBotPresence();
        return;
    }
    
    https.get(steamUrl, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
            const isIngame = data.includes('profile_in_game_header">Currently In-Game') || 
                             data.includes('profile_in_game_header">В игре') ||
                             data.includes('profile_in_game_header">Currently In-Game');
            
            if (isIngame) {
                const matchName = data.match(/profile_in_game_name">([^<]+)/);
                if (matchName) {
                    steamDetectedGame = matchName[1].trim();
                    console.log('[Steam] Detected game:', steamDetectedGame);
                } else {
                    steamDetectedGame = null;
                }
            } else {
                steamDetectedGame = null;
            }
            updateBotPresence();
        });
    }).on('error', (e: any) => {
        console.error('[Steam] Scrape error:', e.message);
        steamDetectedGame = null;
    });
}

const GAME_PROCESSES: Record<string, string> = {
    'cs2.exe': 'Counter-Strike 2',
    'dota2.exe': 'Dota 2',
    'tslgame.exe': 'PUBG: BATTLEGROUNDS',
    'r5apex.exe': 'Apex Legends',
    'gta5.exe': 'Grand Theft Auto V',
    'bg3.exe': 'Baldur\'s Gate 3',
    'eldenring.exe': 'ELDEN RING',
    'cyberpunk2077.exe': 'Cyberpunk 2077',
    'rustclient.exe': 'Rust',
    'terraria.exe': 'Terraria',
    'helldivers2.exe': 'Helldivers 2',
    'palword-win64-shipping.exe': 'Palworld',
    'warframe.x64.exe': 'Warframe',
    'destiny2.exe': 'Destiny 2',
    'rainbowsix.exe': 'Rainbow Six Siege',
    'stardew valley.exe': 'Stardew Valley',
    'factorio.exe': 'Factorio',
    'eurotrucks2.exe': 'Euro Truck Simulator 2',
    'phasmophobia.exe': 'Phasmophobia',
    'lethal company.exe': 'Lethal Company',
    'fallout4.exe': 'Fallout 4',
    'fallout76.exe': 'Fallout 76',
    'starfield.exe': 'Starfield',
    'civilizationvi.exe': 'Civilization VI',
    'hoi4.exe': 'Hearts of Iron IV',
    'eu4.exe': 'Europa Universalis IV',
    'stellaris.exe': 'Stellaris',
    'ck3.exe': 'Crusader Kings III',
    'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
    'vrchat.exe': 'VRChat',
    'rimworldwin64.exe': 'RimWorld',
    'witcher3.exe': 'The Witcher 3: Wild Hunt',
    'monsterhunterworld.exe': 'Monster Hunter: World',
    'monsterhunterrise.exe': 'Monster Hunter Rise',
    'valheim.exe': 'Valheim',
    'fsd-win64-shipping.exe': 'Deep Rock Galactic',
    '7daystodie.exe': '7 Days to Die',
    'dayz_x64.exe': 'DayZ',
    'left4dead2.exe': 'Left 4 Dead 2',
    'portal2.exe': 'Portal 2',
    'forzahorizon5.exe': 'Forza Horizon 5',
    'sotgame.exe': 'Sea of Thieves',
    'nms.exe': 'No Man\'s Sky',
    'subnautica.exe': 'Subnautica',
    'ts4_x64.exe': 'The Sims 4',
    'cities.exe': 'Cities: Skylines',
    'cities2.exe': 'Cities: Skylines II',
    'manorlords-win64-shipping.exe': 'Manor Lords',
    'hades.exe': 'Hades',
    'hades2.exe': 'Hades II',
    'hollow knight.exe': 'Hollow Knight',
    'slaythespire.exe': 'Slay the Spire',
    'isaac-ng.exe': 'The Binding of Isaac: Rebirth',
    'risk of rain 2.exe': 'Risk of Rain 2',
    'deadcells.exe': 'Dead Cells',
    'vampiresurvivors.exe': 'Vampire Survivors',
    'balatro.exe': 'Balatro',
    'content warning.exe': 'Content Warning',
    'buckshot roulette.exe': 'Buckshot Roulette',
    'readyornot-win64-shipping.exe': 'Ready or Not',
    'escapefromtarkov.exe': 'Escape from Tarkov',
    'leagueclient.exe': 'League of Legends',
    'valorant-win64-shipping.exe': 'VALORANT',
    'overwatch.exe': 'Overwatch 2',
    'diablo iv.exe': 'Diablo IV',
    'wow.exe': 'World of Warcraft',
    'genshinimpact.exe': 'Genshin Impact',
    'starrail.exe': 'Honkai: Star Rail',
    'robloxplayerbeta.exe': 'Roblox',
    'fortniteclient-win64-shipping.exe': 'Fortnite',
    'flightsimulator.exe': 'Microsoft Flight Simulator',
    'farmingsimulator2022.exe': 'Farming Simulator 22',
    'snowrunner.exe': 'SnowRunner',
    'factorygame-win64-shipping.exe': 'Satisfactory',
    'projectzomboid64.exe': 'Project Zomboid',
    'sonsoftheforest.exe': 'Sons of the Forest',
    'theforest.exe': 'The Forest',
    'gh.exe': 'Green Hell',
    'stranded deep.exe': 'Stranded Deep',
    'raft.exe': 'Raft',
    'main-win64-shipping.exe': 'Grounded',
    'arkascended.exe': 'ARK: Survival Ascended',
    'warhammer3.exe': 'Total War: Warhammer III',
    'taleworlds.mountandblade.launcher.exe': 'Mount & Blade II: Bannerlord',
    'bannerlord.exe': 'Mount & Blade II: Bannerlord',
    'victoria3.exe': 'Victoria 3',
    'aoe2de_s.exe': 'Age of Empires II: DE',
    'relicaoeiv.exe': 'Age of Empires IV',
    'reliccoh3.exe': 'Company of Heroes 3',
    'darktide.exe': 'Warhammer 40,000: Darktide',
    'payday2_win32_release.exe': 'PAYDAY 2',
    'payday3-win64-shipping.exe': 'PAYDAY 3',
    'streetfighter6.exe': 'Street Fighter 6',
    'tekken8-win64-shipping.exe': 'TEKKEN 8',
    'mk12.exe': 'Mortal Kombat 1',
    'dd2.exe': 'Dragon\'s Dogma 2',
    'undertale.exe': 'Undertale',
    'minecraft.exe': 'Minecraft',
    'javaw.exe': 'Minecraft',
    'hl2.exe': 'Half-Life 2'
};

function scanLocalGames() {
    if (process.platform !== 'win32') return;

    exec('tasklist /FI "STATUS eq RUNNING" /FO CSV', (err: any, stdout: any) => {
        if (err) return;
        const out = stdout.toLowerCase();
        
        let found = null;
        for (const [exe, name] of Object.entries(GAME_PROCESSES)) {
            if (out.includes(exe.toLowerCase())) {
                found = name;
                break;
            }
        }

        if (found !== localDetectedGame) {
            localDetectedGame = found;
            console.log('[Local] Game status changed:', localDetectedGame || 'none');
            updateBotPresence();
        }
    });
}

function updateBotPresence() {
    if (!client.user) return;
    const game = steamDetectedGame || localDetectedGame;
    const status = currentBotStatus as any; // online, idle, dnd, invisible
    
    selfStatus = status;

    if (game) {
        client.user.setPresence({
            activities: [{ name: game, type: ActivityType.Playing }],
            status: status
        });
    } else {
        client.user.setPresence({
            activities: [],
            status: status
        });
    }
}




export function startPresenceScans() {
    stopPresenceScans();
    steamInterval = setInterval(checkSteamStatus, 60000);
    gameInterval = setInterval(scanLocalGames, 20000);
    console.log('[Bot] Presence scans started.');
}

export function stopPresenceScans() {
    if (steamInterval) clearInterval(steamInterval);
    if (gameInterval) clearInterval(gameInterval);
    steamInterval = null;
    gameInterval = null;
    console.log('[Bot] Presence scans stopped.');
}

// Initial start (will be re-started on login)
startPresenceScans();

// Event listeners were moved to attachClientHandlers


export async function getMessageHistory(channelId: string, before?: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return [];
        const options: any = { limit: 100 };
        if (before) options.before = before;
        const messages = await (channel as TextChannel).messages.fetch(options) as any;
        return [...messages.values()].reverse().map(m => formatMessage(m));
    } catch (e) { 
        console.error('[Bot] Failed to get message history:', e);
        return []; 
    }
}

export async function sendMessage(channelId: string, content: string, filePath?: string, replyToId?: string) {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
        lastActiveTextChannelId = channelId; // Save last used text channel
        const options: any = {};
        if (content) {
            options.content = content;
        }
        if (filePath) {
            options.files = [new AttachmentBuilder(filePath)];
        }
        if (replyToId) {
            options.reply = { messageReference: replyToId, failIfNotExists: false };
        }
        const sent = await (channel as TextChannel).send(options);
        
        // For Klipy URLs, wait for embed to load then edit message to remove URL text
        if (content && content.includes('klipy.com') && !filePath) {
            console.log('[Bot] Klipy URL detected, will hide in 3s:', content);
            setTimeout(async () => {
                try {
                    // Fetch fresh message to check if embed loaded
                    const msg = await (channel as TextChannel).messages.fetch(sent.id);
                    console.log('[Bot] Fetched message, embeds:', msg.embeds.length);
                    if (msg && msg.embeds && msg.embeds.length > 0) {
                        // Embed loaded, remove the URL text
                        console.log('[Bot] Editing message to remove URL');
                        await msg.edit({ content: '' });
                        console.log('[Bot] URL hidden successfully');
                    } else {
                        console.log('[Bot] No embeds found yet, URL will stay visible');
                    }
                } catch (e) {
                    console.error('[Bot] Failed to hide Klipy URL:', e);
                }
            }, 3000); // Wait 3 seconds for embed to load
        }
        
        return formatMessage(sent);
    }
    return null;
}

export async function deleteMessage(channelId: string, messageId: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
            const message = await (channel as TextChannel).messages.fetch(messageId);
            if (message && message.deletable) {
                await message.delete();
                return true;
            }
        }
    } catch (e) {
        console.error('Failed to delete message:', e);
    }
    return false;
}

export async function getServers() {
    return client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL({ size: 128 })
    }));
}

export async function getPins(channelId: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const pins = await (channel as any).messages.fetchPinned();
            return pins.map((m: any) => formatMessage(m));
        }
    } catch (e) {
        console.error('[Bot] Failed to fetch pins:', e);
    }
    return [];
}

export async function createInvite(channelId: string) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && (channel.isTextBased() || (channel as any).type === ChannelType.GuildVoice)) {
            const invite = await (channel as any).createInvite({ 
                maxAge: 0, 
                maxUses: 0,
                unique: false
            });
            return invite.url;
        }
    } catch (e) {
        console.error('[Bot] Failed to create invite:', e);
    }
    return null;
}

export async function getChannels(guildId: string) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return [];
    try {
        const channels = await guild.channels.fetch();
        const sorted = [...channels.values()]
            .filter(c => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildCategory))
            .sort((a, b) => (a?.position || 0) - (b?.position || 0));

        return sorted.map(c => ({
            id: c?.id,
            name: c?.name,
            type: c?.type,
            parentId: c?.parentId || null,
            voiceMembers: c?.type === ChannelType.GuildVoice ? 
                (c as any).members.map((m: GuildMember) => ({
                    id: m.id,
                    name: m.displayName,
                    avatar: m.user.displayAvatarURL(),
                    mute: m.voice.selfMute || m.voice.serverMute,
                    deaf: m.voice.selfDeaf || m.voice.serverDeaf,
                    status: m.presence?.status || 'offline',
                    activities: m.presence?.activities.map((a: any) => ({
                        name: a.name,
                        type: a.type,
                        state: a.state,
                        details: a.details
                    })) || []
                })) : []
        }));
    } catch (e) {
        console.error('[Bot] Failed to get channels:', e);
        return [];
    }
}

export async function getGuildMembers(guildId: string) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const members = await guild.members.fetch();
        
        // Map members with roles and colors
        const memberList = Array.from(members.values()).map(m => {
            const hoistRole = m.roles.hoist;
            return {
                id: m.id,
                name: m.displayName,
                avatar: m.user.displayAvatarURL(),
                status: m.presence?.status || 'offline',
                activities: m.presence?.activities.map(a => ({ 
                    name: a.name, 
                    type: a.type,
                    state: a.state,
                    details: a.details
                })) || [],
                color: m.displayHexColor !== '#000000' ? m.displayHexColor : '#949ba4',
                hoistRoleId: hoistRole?.id || null,
                hoistRoleName: hoistRole?.name || null,
                hoistRolePosition: hoistRole?.position || 0
            };
        });

        // Also get roles info for sections
        const roles = Array.from(guild.roles.cache.values())
            .filter(r => r.hoist)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, position: r.position }));

        return { members: memberList, roles };
    } catch (e: any) {
        console.warn('[Bot] Failed to fetch guild members:', e.message);
        return { members: [], roles: [] };
    }
}

export async function getGuildEmojis(guildId: string) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return [];
    try {
        const emojis = await guild.emojis.fetch();
        return emojis.map(e => ({
            id: e.id,
            name: e.name,
            animated: e.animated,
            url: e.url
        }));
    } catch (e) {
        console.error('[Bot] Failed to fetch guild emojis:', e);
        return [];
    }
}

export async function updateVoiceConnection() {
    if (!currentVoiceState.guildId || !currentVoiceState.channelId) return;
    const guild = client.guilds.cache.get(currentVoiceState.guildId);
    if (!guild) return;

    const isChannelSwitch = lastActiveChannelId !== currentVoiceState.channelId;
    lastActiveChannelId = currentVoiceState.channelId;

    connection = joinVoiceChannel({
        channelId: currentVoiceState.channelId,
        guildId: currentVoiceState.guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: currentVoiceState.selfDeaf,
        selfMute: currentVoiceState.selfMute,
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 5000);
        if (isChannelSwitch) console.log(`Joined channel: ${currentVoiceState.channelId}`);
    } catch (e) {
        console.error('[Bot] Voice Connection failed to reach Ready state within 5s:', e);
    }

    const playerIdle = audioPlayer.state.status === AudioPlayerStatus.Idle || audioPlayer.state.status === 'autopaused';
    const needsOutgoingReset = isChannelSwitch || !activeAudioStream || activeAudioStream.destroyed || (playerIdle && !currentVoiceState.selfMute);

    if (needsOutgoingReset) {
        if (activeAudioStream) {
            try { activeAudioStream.destroy(); } catch(e) {}
            activeAudioStream = null;
        }

        activeAudioStream = new Readable({ 
            read() {
                // Keep the stream alive with minimal silence if muted to prevent Idle state
                if (currentVoiceState.selfMute) {
                    this.push(Buffer.alloc(960 * 2 * 2)); // 20ms of stereo 16-bit silence
                }
            } 
        });
        
        activeAudioStream.on('error', (err: any) => {
            if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
            console.warn('Audio stream error silenced:', err.message);
        });

        const resource = createAudioResource(activeAudioStream, {
            inputType: StreamType.Raw
        });
        
        audioPlayer.play(resource);
        connection.subscribe(audioPlayer);
    }

    // Rebind after every ready cycle: joinVoiceChannel may return a reused
    // connection when the client rejoins the same channel.
    connection.receiver.speaking.removeAllListeners('start');
    for (const userId of userStreams.keys()) {
        cleanupUserStream(userId);
    }

    const activeConnection = connection;
    activeConnection.receiver.speaking.on('start', (userId: string) => {
        if (userStreams.has(userId)) return;

        console.log(`User ${userId} started speaking, setting up stream...`);
        const receiverStream = activeConnection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
        });

        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });

        receiverStream.on('error', (err: Error) => {
            console.log(`Receiver Stream Error (${userId}):`, err.message);
            cleanupUserStream(userId);
        });
        decoder.on('error', (err: Error) => {
            console.log(`Decoder Stream Error (${userId}):`, err.message);
            cleanupUserStream(userId);
        });
        receiverStream.on('end', () => {
            cleanupUserStream(userId);
        });

        userStreams.set(userId, { receiver: receiverStream, decoder });

        receiverStream.pipe(decoder).on('data', (chunk: Buffer) => {
            audioDataHandler({ userId, buffer: chunk });
        });
    });

    // Always check mic process (it handles selfMute internally)
    startPythonMic();
}

function startPythonMic() {
    if (!currentVoiceState.channelId) {
        stopPythonMic();
        return;
    }

    if (micProcess) return; // already running!

    if (micRestartTimer) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    if (micHealthTimer) {
        clearTimeout(micHealthTimer);
        micHealthTimer = null;
    }

    console.log(`Spawning Python mic process (Vol: ${micSettings.volume}, Dev: ${micSettings.deviceId})...`);
    
    // In production, mic.py is an extraResource (placed in resources folder)
    const micScriptPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'mic.py')
        : path.join(__dirname_bot, '../../mic.py');
    
    // Pass volume, noise suppression flag, and device ID (if not default)
    const args = [micScriptPath, '--volume', micSettings.volume.toString(), '--noise-suppression', micSettings.noiseSuppression ? '1' : '0'];
    if (micSettings.deviceId && micSettings.deviceId !== 'default') {
        args.push('--device', micSettings.deviceId);
    }
    
    const proc = spawn('python', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    micProcess = proc;

    const armMicHealthCheck = () => {
        if (micHealthTimer) clearTimeout(micHealthTimer);
        micHealthTimer = setTimeout(() => {
            if (micProcess !== proc) return;
            if (!currentVoiceState.channelId) return;
            console.warn('[Python Mic] No audio output for 10s, restarting mic process...');
            stopPythonMic();
            micRestartTimer = setTimeout(() => startPythonMic(), 500);
        }, 10000);
    };

    armMicHealthCheck();

    proc.stdout?.on('data', (chunk) => {
        armMicHealthCheck();
        if (currentVoiceState.selfMute) return;
        
        if (activeAudioStream && !activeAudioStream.destroyed) {
            activeAudioStream.push(chunk);
        }
    });

    proc.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        console.log(`[Python Mic Log]: ${message}`);
        
        // Check for common microphone errors
        if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
            sendErrorNotification('Microphone Issues', message, 'microphone');
        }
    });

    proc.on('error', (error) => {
        console.error('[Python Mic Error]:', error);
        sendErrorNotification('Microphone Issues', error.message || String(error), 'microphone');
    });

    proc.on('close', (code) => {
        console.log(`Python mic process exited with code ${code}`);
        if (micProcess === proc) {
            micProcess = null;
            if (micHealthTimer) {
                clearTimeout(micHealthTimer);
                micHealthTimer = null;
            }
            if (currentVoiceState.channelId) {
                console.log('Restarting mic process in 2 seconds...');
                if (micRestartTimer) clearTimeout(micRestartTimer);
                micRestartTimer = setTimeout(() => {
                    micRestartTimer = null;
                    startPythonMic();
                }, 2000);
            }
        }
    });
}

function stopPythonMic() {
    if (micRestartTimer) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    if (micHealthTimer) {
        clearTimeout(micHealthTimer);
        micHealthTimer = null;
    }
    if (micProcess) {
        console.log('Stopping Python mic process...');
        micProcess.kill();
        micProcess = null;
    }
}

function cleanupUserStream(userId: string) {
    const streamInfo = userStreams.get(userId);
    if (streamInfo) {
        console.log(`Cleaning up stream for user ${userId}`);
        try {
            streamInfo.decoder.destroy();
            streamInfo.receiver.destroy();
        } catch (e) {}
        userStreams.delete(userId);
    }
}

const appIconCache = new Map<string, string | null>();

async function getApplicationIcon(appId: string): Promise<string | null> {
    if (!appId) return null;
    if (appIconCache.has(appId)) return appIconCache.get(appId)!;

    try {
        const res = await fetch(`https://discord.com/api/v10/applications/${appId}/rpc`);
        if (res.ok) {
            const data = await res.json();
            if (data.icon) {
                const url = `https://cdn.discordapp.com/app-icons/${appId}/${data.icon}.png`;
                appIconCache.set(appId, url);
                return url;
            }
        }
        appIconCache.set(appId, null);
    } catch {
        appIconCache.set(appId, null);
    }
    return null;
}

export async function getUserProfile(userId: string, guildId?: string) {
    try {
        const user = await client.users.fetch(userId, { force: true });
        let member = null;
        if (guildId) {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (guild) member = await guild.members.fetch(userId).catch(() => null);
        }

        // Safe banner: only valid power-of-2 sizes are accepted by discord.js
        let banner: string | null = null;
        try {
            if (typeof (user as any).bannerURL === 'function') {
                banner = (user as any).bannerURL({ size: 512 }) ?? null;
            }
        } catch { banner = null; }

        return {
            id: user.id,
            username: user.username,
            globalName: (user as any).globalName || user.username,
            avatar: user.displayAvatarURL({ size: 256 }),
            hexAccentColor: user.hexAccentColor ?? null,
            banner,
            bot: user.bot,
            status: member?.presence?.status || 'offline',
            activities: await Promise.all((member?.presence?.activities ?? []).map(async (a: any) => ({
                name: a.name,
                type: a.type,
                state: a.state,
                details: a.details,
                applicationId: a.applicationId,
                applicationIcon: a.applicationId ? await getApplicationIcon(a.applicationId) : null,
                assets: a.assets ? {
                   largeImage: (() => { try { return a.assets.largeImageURL({ size: 256 }) || a.assets.largeImageURL({ extension: 'png' }); } catch { return null; } })(),
                   smallImage: (() => { try { return a.assets.smallImageURL({ size: 128 }) || a.assets.smallImageURL({ extension: 'png' }); } catch { return null; } })(),
                   largeText: a.assets.largeText,
                   smallText: a.assets.smallText
                } : null,
                emoji: a.emoji
            }))),
            roles: Array.from((member?.roles.cache?.values() ?? []))
                .filter((r: any) => r.name !== '@everyone')
                .map((r: any) => ({ name: r.name, color: r.hexColor }))
        };
    } catch (e) {
        console.error('Fetch profile error:', e);
        // Return minimal profile using cached guild member data if available
        try {
            const allGuilds = client.guilds.cache;
            for (const guild of allGuilds.values()) {
                const m = guild.members.cache.get(userId);
                if (m) {
                    return {
                        id: m.id,
                        username: m.user.username,
                        globalName: (m.user as any).globalName || m.displayName,
                        avatar: m.user.displayAvatarURL({ size: 256 }),
                        hexAccentColor: null,
                        banner: null,
                        bot: m.user.bot,
                        status: m.presence?.status || 'offline',
                        activities: (m.presence?.activities ?? []).map((a: any) => ({
                            name: a.name, type: a.type, state: a.state, details: a.details, assets: null, emoji: a.emoji
                        })),
                        roles: Array.from(m.roles.cache.values())
                            .filter((r: any) => r.name !== '@everyone')
                            .map((r: any) => ({ name: r.name, color: r.hexColor }))
                    };
                }
            }
        } catch {}
        return null;
    }
}

export function injectAudioChunk(buffer: ArrayBuffer) {
    // We now use Python mic, so we ignore manual injections from renderer to avoid double audio
    // but we keep the function for backward compatibility if needed.
    /*
    if (activeAudioStream && !activeAudioStream.destroyed) {
        const nodeBuffer = Buffer.from(new Uint8Array(buffer));
        activeAudioStream.push(nodeBuffer);
    }
    */
}

export async function joinVoice(guildId: string, channelId: string) {
    try {
        // Leave existing voice connection if any
        if (connection) {
            console.log(`[Bot] Destroying existing connection before join.`);
            try {
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
            } catch (e) {
                console.error('[Bot] Error destroying connection:', e);
            }
            connection = null;
        }

        // Force cleanup of streams before switching
        for (const userId of userStreams.keys()) {
            cleanupUserStream(userId);
        }

        currentVoiceState.guildId = guildId;
        currentVoiceState.channelId = channelId;
        
        // Force outgoing stream reset on join
        if (activeAudioStream) {
            try { 
                activeAudioStream?.destroy(); 
            } catch(e) {}
            activeAudioStream = null;
        }
        
        await updateVoiceConnection();
        return { status: 'Connected' };
    } catch (error: any) {
        console.error('[Bot] Error joining voice:', error);
        sendErrorNotification('Voice Channel Issues', error.message || String(error), 'voice');
        throw error;
    }
}

export function leaveVoice(guildId: string) {
    const targetGuildId = guildId || currentVoiceState.guildId;
    
    if (activeAudioStream) {
        activeAudioStream.destroy();
        activeAudioStream = null;
    }
    stopPythonMic();

    if (targetGuildId) {
        const connection = getVoiceConnection(targetGuildId);
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
                connection.destroy();
            } catch (e) {
                console.error('[Bot] Error destroying connection:', e);
            }
            lastActiveChannelId = null;
            currentVoiceState.guildId = null;
            currentVoiceState.channelId = null;
            return { status: 'Disconnected' };
        }
    }
    
    // Fallback cleanup
    const allGuilds = client.guilds.cache.keys();
    for (const gid of allGuilds) {
        const conn = getVoiceConnection(gid);
        if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
                conn.destroy();
            } catch (e) {
                console.error('[Bot] Error destroying connection:', e);
            }
            lastActiveChannelId = null;
            currentVoiceState.guildId = null;
            currentVoiceState.channelId = null;
            stopPythonMic();
        }
    }

    return { status: 'Disconnected' };
}

export function setMute(mute: boolean) {
    currentVoiceState.selfMute = mute;
    updateVoiceConnection();
}

export function setDeafen(deaf: boolean) {
    currentVoiceState.selfDeaf = deaf;
    if (deaf) currentVoiceState.selfMute = true;
    updateVoiceConnection();
}

export function updateMicSettings(volume: number, deviceId: string) {
    const volChanged = micSettings.volume !== volume;
    const deviceChanged = micSettings.deviceId !== deviceId;

    micSettings.volume = volume;
    micSettings.deviceId = deviceId;

    if (micProcess) {
        if (deviceChanged) {
            stopPythonMic();
            startPythonMic();
        } else if (volChanged) {
            micProcess.stdin?.write(volume.toString() + '\n');
        }
    }
}

export function setNoiseSuppression(enabled: boolean) {
    const changed = micSettings.noiseSuppression !== enabled;
    micSettings.noiseSuppression = enabled;

    if (micProcess) {
        if (changed) {
            // Live toggle via stdin - resets noise floor on enable
            micProcess.stdin?.write(`noise_suppression:${enabled ? 1 : 0}\n`);
        }
    }
}

export async function getBotData() {
    if (!client.user) return null;

    // Refresh the user object so banner changes are visible immediately.
    const currentUser = client.user;
    const user = await currentUser.fetch(true).catch(() => currentUser);
    
    // Try to get presence from guild member cache
    let activities = [...selfActivities];
    let status = selfStatus;
    
    const externalGame = steamDetectedGame || localDetectedGame;
    if (externalGame && !activities.find(a => a.name === externalGame)) {
        activities.unshift({ name: externalGame, type: 0 });
    }

    let banner: string | null = null;
    try {
        if (typeof (user as any).bannerURL === 'function') {
            banner = (user as any).bannerURL({ size: 512 }) ?? null;
        }
    } catch { banner = null; }

    return {
        tag: user.tag,
        avatar: user.displayAvatarURL(),
        banner,
        status,
        activities
    };
}

export async function loginBot(manualToken?: string) {
    // Reload env just in case it changed while app was running
    dotenv.config({ override: true });
    
    const token = manualToken || process.env.DISCORD_TOKEN;
    if (!token) throw new Error('No token provided and DISCORD_TOKEN not found in .env');
    
    console.log('[Bot] Attempting login...');

    // Always destroy stale client before re-login (covers timeout + fresh login cases)
    if (client) {
        try { client.destroy(); } catch (_) { /* already destroyed */ }
        client = new Client({
            intents: clientIntents,
            partials: clientPartials,
        });
        attachClientHandlers(client);
    }
    
    try {
        stopPresenceScans();
        await client.login(token);
        
        // Once logged in, ensure we have initial state
        if (client.user) {
            selfStatus = 'online';
            selfActivities = [];
            console.log(`[Bot] Successfully logged in as ${client.user.tag}`);
            startPresenceScans();
        }
    } catch (e: any) {
        console.error('[Bot] Login failed:', e.message);
        throw e;
    }
}

// Profile editing functions
export async function setUsername(newUsername: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!client.user) return { success: false, error: 'Not logged in' };
        await client.user.setUsername(newUsername);
        console.log(`[Bot] Username changed to: ${newUsername}`);
        return { success: true };
    } catch (e: any) {
        console.error('[Bot] Failed to set username:', e.message);
        return { success: false, error: e.message };
    }
}

export async function setAvatar(avatarPath: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!client.user) return { success: false, error: 'Not logged in' };
        
        const buffer = fs.readFileSync(avatarPath);
        const base64 = buffer.toString('base64');
        const ext = path.extname(avatarPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
        
        await client.user.setAvatar(`data:${mimeType};base64,${base64}`);
        console.log(`[Bot] Avatar changed`);
        return { success: true };
    } catch (e: any) {
        console.error('[Bot] Failed to set avatar:', e.message);
        return { success: false, error: e.message };
    }
}

export async function setBanner(bannerPath: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!client.user) return { success: false, error: 'Not logged in' };
        
        const buffer = fs.readFileSync(bannerPath);
        const base64 = buffer.toString('base64');
        const ext = path.extname(bannerPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
        
        await client.user.setBanner(`data:${mimeType};base64,${base64}`);
        console.log(`[Bot] Banner changed`);
        return { success: true };
    } catch (e: any) {
        console.error('[Bot] Failed to set banner:', e.message);
        return { success: false, error: e.message };
    }
}

export async function setNickname(guildId: string, nickname: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!client.user) return { success: false, error: 'Not logged in' };
        
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(client.user.id);
        await member.setNickname(nickname || null);
        console.log(`[Bot] Nickname changed in guild ${guildId}`);
        return { success: true };
    } catch (e: any) {
        console.error('[Bot] Failed to set nickname:', e.message);
        return { success: false, error: e.message };
    }
}

// Screen Share functions
export function getCurrentVoiceChannelId(): string | null {
    return currentVoiceState.channelId;
}

export async function sendScreenShareLink(channelId: string, url: string, roomId?: string, username?: string) {
    try {
        console.log(`[Bot] sendScreenShareLink called with voice channelId: ${channelId}`);

        const voiceChannel = await client.channels.fetch(channelId);

        if (!voiceChannel || !voiceChannel.isVoiceBased()) {
            console.error('[Bot] Channel is not a voice channel');
            return null;
        }

        const channelName = 'name' in voiceChannel ? (voiceChannel.name ?? 'Unknown') : 'Unknown';

        const guild = voiceChannel.guild;
        if (!guild) {
            console.error('[Bot] No guild found');
            return null;
        }

        const textChannel = guild.channels.cache.find(ch => {
            if (!ch.isTextBased()) return false;
            const permissions = ch.permissionsFor(client.user!);
            return permissions && permissions.has('SendMessages');
        });

        if (textChannel && 'send' in textChannel && typeof textChannel.send === 'function') {
            const displayName = username || client.user?.username || 'Someone';
            const embed = {
                color: 0x5865f2,
                title: '🖥️ Screen Share Started',
                url: url,
                description: `${displayName} is sharing their screen!`,
                fields: [
                    { name: 'Channel', value: channelName, inline: true },
                    { name: 'Watching', value: '0 viewers', inline: true }
                ],
                image: roomId ? { url: `${url.replace(/\/room\//, '/api/preview/')}` } : undefined,
                timestamp: new Date().toISOString()
            };
            const message = await textChannel.send({ content: url, embeds: [embed] });
            console.log('[Bot] Screen share link sent successfully');
            return message;
        }

        console.error('[Bot] No suitable text channel found in guild');
        return null;
    } catch (error) {
        console.error('[Bot] Failed to send screen share link:', error);
        return null;
    }
}

export async function sendScreenShareLinkToChannel(textChannelId: string, url: string) {
    try {
        console.log(`[Bot] sendScreenShareLinkToChannel called with channelId: ${textChannelId}`);
        
        const channel = await client.channels.fetch(textChannelId);
        if (!channel) {
            console.error('[Bot] Channel not found');
            return null;
        }
        
        const channelName = 'name' in channel ? channel.name : 'Unknown';
        console.log(`[Bot] Fetched channel: ${channelName}, type: ${channel.type}`);
        
        if ('send' in channel && typeof channel.send === 'function') {
            console.log(`[Bot] Sending screen share link to ${channelName}`);
            const message = await channel.send(`🖥️ **Screen Share Started**\nWatch here: ${url}`);
            console.log('[Bot] Screen share link sent successfully');
            return message;
        }
        
        console.error('[Bot] Channel does not support sending messages');
        return null;
    } catch (error) {
        console.error('[Bot] Failed to send screen share link:', error);
        return null;
    }
}
