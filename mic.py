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
args = parser.parse_args()

# Global volume multiplier (can be updated via stdin)
vol_multiplier = args.volume

# Discord settings
CHUNK_SIZE = 960  # 20ms at 48kHz
RATE = 48000

# Minimal processing: Just scale and convert
def process_audio(indata):
    # Apply gain & scale to Int16
    processed = (indata * vol_multiplier).astype(np.int16)
    # 3. Interleave Mono to Stereo (Discord Requirement)
    stereo = np.repeat(processed, 2)
    return stereo.tobytes()

def stdin_listener():
    global vol_multiplier
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            val = float(line.strip())
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
