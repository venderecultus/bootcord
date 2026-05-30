export declare function startScreenShareServer(): Promise<{
    port: number;
    publicUrl: string;
}>;
export declare function stopScreenShareServer(): Promise<void>;
export declare function broadcastFrame(frameData: Buffer): void;
export declare function broadcastViewerCount(): void;
export declare function getViewerCount(): number;
export declare function getServerPort(): number;
export declare function isServerRunning(): boolean;
export declare function onViewerChange(callback: (count: number) => void): void;
//# sourceMappingURL=screenShareServer.d.ts.map