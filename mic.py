import sys
import time
import argparse
import numpy as np
import threading

try:
    import sounddevice as sd
except ImportError:
    sys.stderr.write("Error: 'sounddevice' or 'numpy' missing. Run: pip install sounddevice numpy\n")
    sys.stderr.flush()
    sys.exit(1)

# CLI Arguments
parser = argparse.ArgumentParser()
parser.add_argument("--device", type=str, default=None, help="Device name or index")
parser.add_argument("--volume", type=float, default=1.0, help="Mic gain multiplier")
parser.add_argument("--noise-suppression", type=int, default=0, choices=[0, 1], help="Enable noise suppression")
args = parser.parse_args()

# Global volume multiplier (can be updated via stdin)
vol_multiplier = args.volume
noise_suppression_enabled = bool(args.noise_suppression)

# Discord settings
CHUNK_SIZE = 960  # 20ms at 48kHz
RATE = 48000

class NoiseSuppressor:
    def __init__(self, rate=RATE):
        self.rate = rate
        self.fft_size = 1024
        self.hop_size = CHUNK_SIZE
        self.hann = np.hanning(self.fft_size)
        self.noise_floor = np.zeros(self.fft_size // 2 + 1)
        self.ring_buffer = np.zeros(self.fft_size)
        self.alpha = 0.90
        self.over_subtraction = 3.0
        self.spectral_floor = 0.03
        self.frame_count = 0
        self.noise_init_frames = 40

    def process(self, samples):
        output = np.zeros(self.hop_size)
        self.ring_buffer[:-self.hop_size] = self.ring_buffer[self.hop_size:]
        self.ring_buffer[-self.hop_size:] = samples
        windowed = self.ring_buffer * self.hann
        fft = np.fft.rfft(windowed)
        mag = np.abs(fft)
        phase = np.angle(fft)
        if self.frame_count < self.noise_init_frames:
            self.noise_floor = self.alpha * self.noise_floor + (1 - self.alpha) * mag
            self.frame_count += 1
            return samples
        speech_energy = np.sum(mag ** 2)
        noise_energy = np.sum(self.noise_floor ** 2)
        if speech_energy < noise_energy * 2.0:
            self.noise_floor = self.alpha * self.noise_floor + (1 - self.alpha) * mag
        mag_sq = mag ** 2
        noise_sq = self.noise_floor ** 2
        gain = np.maximum(0, (mag_sq - self.over_subtraction * noise_sq) / (mag_sq + 1e-10))
        gain = np.maximum(gain, self.spectral_floor)
        fft_filtered = fft * gain
        reconstructed = np.fft.irfft(fft_filtered)
        np.copyto(output, reconstructed[-self.hop_size:])
        return output

ns = NoiseSuppressor()

# Minimal processing: Just scale and convert
def process_audio(indata):
    global noise_suppression_enabled
    if noise_suppression_enabled:
        indata_float = indata.astype(np.float32) / 32768.0
        indata_float = ns.process(indata_float)
        indata = (indata_float * 32767.0).astype(np.int16)
    processed = (indata * vol_multiplier).astype(np.int16)
    stereo = np.repeat(processed, 2)
    return stereo.tobytes()

def stdin_listener():
    global vol_multiplier, noise_suppression_enabled
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if line.startswith("noise_suppression:"):
            try:
                val = int(line.split(":", 1)[1])
                noise_suppression_enabled = bool(val)
                if noise_suppression_enabled:
                    ns.__init__()
                sys.stderr.write(f"Python Mic: Noise suppression {'enabled' if noise_suppression_enabled else 'disabled'}\n")
                sys.stderr.flush()
            except:
                pass
        else:
            try:
                val = float(line)
                vol_multiplier = val
                sys.stderr.write(f"Python Mic: Volume updated to {vol_multiplier}\n")
                sys.stderr.flush()
            except:
                pass

def callback(indata, frames, time, status):
    if status:
        sys.stderr.write(f"Mic Status: {status}\n")
        sys.stderr.flush()
    
    try:
        output_bytes = process_audio(indata)
        sys.stdout.buffer.write(output_bytes)
        sys.stdout.buffer.flush()
    except Exception as e:
        sys.stderr.write(f"Processing error: {e}\n")

try:
    device = args.device
    if device:
        if device.isdigit():
            device = int(device)
        else:
            # Try to find device by name substring
            devices = sd.query_devices()
            for i, d in enumerate(devices):
                if device.lower() in d['name'].lower():
                    device = i
                    break
    
    # Start stdin listener thread
    threading.Thread(target=stdin_listener, daemon=True).start()

    with sd.InputStream(device=device, samplerate=RATE, channels=1, dtype='int16', 
                        callback=callback, blocksize=CHUNK_SIZE):
        sys.stderr.write(f"Python Pro Mic active. Device: {device}, Initial Vol: {vol_multiplier}\n")
        sys.stderr.flush()
        while True:
            time.sleep(1)
except Exception as e:
    sys.stderr.write(f"Python Mic Error: {e}\n")
    # If device failed, list available ones
    sys.stderr.write("\nAvailable devices:\n" + str(sd.query_devices()) + "\n")
    sys.stderr.flush()
    sys.exit(1)
