class AudioCaptureWorklet extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 1920; // 960 frames * 2 channels
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const left = input[0];
        const right = input[1] || input[0]; // Fallback to mono if needed

        for (let i = 0; i < left.length; i++) {
            if (this.bufferIndex < this.bufferSize) {
                // Interleave stereo explicitly to match PCMs expected by encoder
                this.buffer[this.bufferIndex++] = Math.max(-1, Math.min(1, left[i]));
                this.buffer[this.bufferIndex++] = Math.max(-1, Math.min(1, right[i]));
            }

            if (this.bufferIndex >= this.bufferSize) {
                // Convert to Int16 before sending to save memory & IPC overhead
                const pcmData = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    pcmData[j] = this.buffer[j] * 0x7FFF;
                }
                
                // Post buffer back to main thread
                this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
                this.bufferIndex = 0;
            }
        }

        return true;
    }
}

registerProcessor('audio-capture-worklet', AudioCaptureWorklet);
