# node-cpal Examples

This directory contains examples demonstrating how to use the node-cpal library for audio operations in Node.js.

## Prerequisites

Before running these examples, make sure you have:

1. Node.js 14.0.0 or later installed
2. Installed node-cpal:
   ```bash
   npm install node-cpal
   ```

## Running the Examples

Each example is a standalone JavaScript file that can be run directly with Node.js:

```bash
node beep.js
node list-devices.js
node audio-visualizer.js
node record-and-playback.js
```

Alternatively, you can use the provided npm scripts:

```bash
# First install dependencies
npm install

# Then run any example
npm run beep
npm run list-devices
npm run audio-visualizer
npm run record-and-playback
```

## Examples Overview

### 1. Beep (`beep.js`)

This example demonstrates how to:

- Create a simple beep sound (440 Hz sine wave)
- Generate audio data in small chunks
- Write audio data to an output stream
- Play a tone for a specific duration
- Properly clean up audio resources

### 2. List Audio Devices (`list-devices.js`)

This example demonstrates how to:

- List all available audio hosts
- Enumerate all audio devices
- Get default input and output devices
- Display device capabilities

### 3. Audio Visualizer (`audio-visualizer.js`)

This example demonstrates how to:

- Create a real-time audio visualizer in the terminal
- Process audio input to calculate volume levels
- Display a dynamic visualization of audio input
- Handle continuous audio streams

### 4. Record and Playback (`record-and-playback.js`)

This example demonstrates how to:

- Record audio from the default microphone for a specific duration
- Store the recorded audio in memory
- Play back the recorded audio through the speakers
- Handle both input and output streams sequentially
- Process audio data in chunks for efficient memory usage

## Notes

- Some examples may require audio hardware (speakers, microphones) to work properly
- You may need to adjust parameters like sample rate or buffer size based on your system
- Error handling is included to demonstrate proper resource management
