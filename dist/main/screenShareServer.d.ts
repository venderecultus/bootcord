export declare function startScreenShareServer(sourceId?: string, sourceName?: string): Promise<{
    port: number;
    publicUrl: string;
}>;
export declare function stopScreenShareServer(): Promise<void>;
export declare function isServerRunning(): boolean;
export declare function getServerPort(): number;
export declare function onTunnelDisconnect(callback: () => void): void;
//# sourceMappingURL=screenShareServer.d.ts.map