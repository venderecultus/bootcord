import { Client, Message, ChannelType, ActivityType, MessageType } from 'discord.js';
export declare function getClient(): Client<boolean>;
export declare function onMessage(handler: (msg: any) => void): void;
export declare function onVoiceStateUpdate(handler: (data: any) => void): void;
export declare function onAudioData(handler: (data: {
    userId: string;
    buffer: Buffer;
}) => void): void;
export declare function toggleReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
export declare function editMessage(channelId: string, messageId: string, content: string): Promise<boolean>;
export declare function onPresenceUpdate(handler: (data: any) => void): void;
export declare function setNotificationStatus(status: string): void;
export declare function setSteamUrl(url: string): void;
export declare function startPresenceScans(): void;
export declare function stopPresenceScans(): void;
export declare function getMessageHistory(channelId: string, before?: string): Promise<{
    id: string;
    channelId: string;
    guildId: string | null;
    author: string;
    authorId: string;
    isSelf: boolean;
    isMentioned: boolean;
    content: string;
    avatar: string;
    timestamp: string;
    rawTimestamp: string;
    referencedMessage: {
        id: string;
        author: any;
        authorId: any;
        avatar: any;
        isMentioned: boolean;
        content: any;
    } | null;
    attachments: string[];
    reactions: {
        emoji: string | null;
        name: string | null;
        id: string | null;
        count: number;
        me: boolean;
    }[];
    embeds: {
        type: import("discord.js").EmbedType | undefined;
        url: string | undefined;
        provider: string | null;
        title: string | null;
        description: string | null;
        color: string | null;
        author: {
            name: string;
            url: string | null;
            iconURL: string | null;
        } | null;
        footer: {
            text: string;
            iconURL: string | null;
        } | null;
        timestamp: string | null;
        image: string | null;
        thumbnail: string | null;
        video: string | null;
        fields: {
            name: string;
            value: string;
            inline: boolean;
        }[];
    }[];
    systemContent: string | null;
    type: MessageType;
    poll: {
        question: any;
        answers: any;
        isEnded: any;
    } | null;
}[]>;
export declare function sendMessage(channelId: string, content: string, filePath?: string, replyToId?: string): Promise<{
    id: string;
    channelId: string;
    guildId: string | null;
    author: string;
    authorId: string;
    isSelf: boolean;
    isMentioned: boolean;
    content: string;
    avatar: string;
    timestamp: string;
    rawTimestamp: string;
    referencedMessage: {
        id: string;
        author: any;
        authorId: any;
        avatar: any;
        isMentioned: boolean;
        content: any;
    } | null;
    attachments: string[];
    reactions: {
        emoji: string | null;
        name: string | null;
        id: string | null;
        count: number;
        me: boolean;
    }[];
    embeds: {
        type: import("discord.js").EmbedType | undefined;
        url: string | undefined;
        provider: string | null;
        title: string | null;
        description: string | null;
        color: string | null;
        author: {
            name: string;
            url: string | null;
            iconURL: string | null;
        } | null;
        footer: {
            text: string;
            iconURL: string | null;
        } | null;
        timestamp: string | null;
        image: string | null;
        thumbnail: string | null;
        video: string | null;
        fields: {
            name: string;
            value: string;
            inline: boolean;
        }[];
    }[];
    systemContent: string | null;
    type: MessageType;
    poll: {
        question: any;
        answers: any;
        isEnded: any;
    } | null;
} | null>;
export declare function deleteMessage(channelId: string, messageId: string): Promise<boolean>;
export declare function getServers(): Promise<{
    id: string;
    name: string;
    icon: string | null;
}[]>;
export declare function getPins(channelId: string): Promise<any>;
export declare function createInvite(channelId: string): Promise<any>;
export declare function getChannels(guildId: string): Promise<{
    id: string | undefined;
    name: string | undefined;
    type: ChannelType.GuildText | ChannelType.GuildVoice | ChannelType.GuildCategory | ChannelType.GuildAnnouncement | ChannelType.GuildStageVoice | ChannelType.GuildForum | ChannelType.GuildMedia | undefined;
    parentId: string | null;
    voiceMembers: any;
}[]>;
export declare function getGuildMembers(guildId: string): Promise<{
    members: {
        id: string;
        name: string;
        avatar: string;
        status: import("discord.js").PresenceStatus;
        activities: {
            name: string;
            type: ActivityType;
            state: string | null;
            details: string | null;
        }[];
        color: `#${string}`;
        hoistRoleId: string | null;
        hoistRoleName: string | null;
        hoistRolePosition: number;
    }[];
    roles: {
        id: string;
        name: string;
        position: number;
    }[];
}>;
export declare function getGuildEmojis(guildId: string): Promise<{
    id: string;
    name: string;
    animated: boolean;
    url: string;
}[]>;
export declare function updateVoiceConnection(): Promise<void>;
export declare function getUserProfile(userId: string, guildId?: string): Promise<{
    id: string;
    username: string;
    globalName: any;
    avatar: string;
    hexAccentColor: `#${string}` | null;
    banner: string | null;
    bot: boolean;
    status: import("discord.js").PresenceStatus;
    activities: {
        name: any;
        type: any;
        state: any;
        details: any;
        applicationId: any;
        applicationIcon: string | null;
        assets: {
            largeImage: any;
            smallImage: any;
            largeText: any;
            smallText: any;
        } | null;
        emoji: any;
    }[];
    roles: {
        name: any;
        color: any;
    }[];
} | {
    id: string;
    username: string;
    globalName: any;
    avatar: string;
    hexAccentColor: null;
    banner: null;
    bot: boolean;
    status: import("discord.js").PresenceStatus;
    activities: {
        name: any;
        type: any;
        state: any;
        details: any;
        assets: null;
        emoji: any;
    }[];
    roles: {
        name: any;
        color: any;
    }[];
} | null>;
export declare function injectAudioChunk(buffer: ArrayBuffer): void;
export declare function joinVoice(guildId: string, channelId: string): Promise<{
    status: string;
}>;
export declare function leaveVoice(guildId: string): {
    status: string;
};
export declare function setMute(mute: boolean): void;
export declare function setDeafen(deaf: boolean): void;
export declare function updateMicSettings(volume: number, deviceId: string): void;
export declare function setNoiseSuppression(enabled: boolean): void;
export declare function getBotData(): {
    tag: string;
    avatar: string;
    status: string;
    activities: any[];
} | null;
export declare function loginBot(manualToken?: string): Promise<void>;
export declare function getCurrentVoiceChannelId(): string | null;
export declare function sendScreenShareLink(channelId: string, url: string, roomId?: string, username?: string): Promise<Message<true> | null>;
export declare function sendScreenShareLinkToChannel(textChannelId: string, url: string): Promise<Message<true> | Message<false> | null>;
//# sourceMappingURL=bot.d.ts.map