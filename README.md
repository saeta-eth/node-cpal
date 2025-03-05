# node-cpal

Node.js bindings for CPAL (Cross-Platform Audio Library), providing low-level audio functionality for Node.js applications.

[![npm version](https://img.shields.io/npm/v/node-cpal.svg)](https://www.npmjs.com/package/node-cpal)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Build and Publish](https://github.com/yourusername/node-cpal/actions/workflows/build-and-publish.yml/badge.svg)](https://github.com/yourusername/node-cpal/actions/workflows/build-and-publish.yml)

## Overview

node-cpal provides native Node.js bindings to the [CPAL](https://github.com/RustAudio/cpal) Rust library, giving Node.js developers access to low-level, cross-platform audio capabilities. This library enables audio device enumeration, audio playback, and recording with minimal latency across Windows, macOS, and Linux.

## Features

- **Complete Audio Device Management**

  - Enumerate audio hosts and devices
  - Get default input/output devices
  - Query device capabilities (formats, sample rates, channels)

- **Audio Stream Control**

  - Create input (recording) streams
  - Create output (playback) streams
  - Write audio data to output streams
  - Read audio data from input streams
  - Pause, resume, and close streams

- **Developer-Friendly**

  - Comprehensive TypeScript definitions
  - Promise-based API (optional)
  - Detailed error messages

- **Cross-Platform**
  - Windows (WASAPI)
  - macOS (CoreAudio)
  - Linux (ALSA, JACK)

## Installation

```bash
npm install node-cpal
```

### Platform Support

node-cpal provides pre-built binaries for the following platforms:

- Windows (x64)
- macOS (x64 and ARM64/Apple Silicon)
- Linux (x64 and ARM64)

The package automatically detects your platform and loads the appropriate binary.

### Requirements

- Node.js 14.0.0 or later
- For building from source:
  - Rust toolchain (rustc, cargo)
  - Platform-specific audio development libraries:
    - **Windows**: No additional requirements
    - **macOS**: No additional requirements
    - **Linux**: ALSA development files (`libasound2-dev` on Debian/Ubuntu)

## Basic Usage

```javascript
const cpal = require('node-cpal');

// List all available audio hosts
const hosts = cpal.getHosts();
console.log('Available audio hosts:', hosts);

// Get the default output device
const outputDevice = cpal.getDefaultOutputDevice();
console.log('Default output device:', outputDevice);

// Create an output stream with default configuration
const config = cpal.getDefaultOutputConfig(outputDevice.deviceId);
const stream = cpal.createStream(
  outputDevice.deviceId,
  false, // false for output stream, true for input stream
  config,
  () => {} // Callback function (not needed for output streams)
);

// Close the stream when done
cpal.closeStream(stream);
```

## Examples

For more comprehensive examples, check out the [examples directory](./examples):

- **[list-devices.js](./examples/list-devices.js)**: Enumerate audio hosts and devices with their capabilities
- **[beep.js](./examples/beep.js)**: Generate and play a simple sine wave tone
- **[audio-visualizer.js](./examples/audio-visualizer.js)**: Create a real-time terminal audio visualizer from microphone input
- **[record-and-playback.js](./examples/record-and-playback.js)**: Record audio from the microphone and play it back

Each example includes detailed comments explaining how the code works.

## API Reference

### Host and Device Enumeration

#### `getHosts(): string[]`

Returns an array of available audio hosts on the system.

```javascript
const hosts = cpal.getHosts();
// Example: ['CoreAudio']
```

#### `getDevices(hostId?: string): string[]`

Returns an array of all available audio devices for the specified host, or all hosts if not specified. Defaults to default host.

```javascript
const devices = cpal.getDevices();
```

#### `getDefaultInputDevice(): string`

Returns the default input (recording) device ID.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
```

#### `getDefaultOutputDevice(): string`

Returns the default output (playback) device ID.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
```

### Device Configuration

#### `getSupportedInputConfigs(deviceId: string): AudioDeviceConfig[]`

Returns an array of supported input configurations for the specified device.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
const configs = cpal.getSupportedInputConfigs(inputDevice);
```

#### `getSupportedOutputConfigs(deviceId: string): AudioDeviceConfig[]`

Returns an array of supported output configurations for the specified device.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
const configs = cpal.getSupportedOutputConfigs(outputDevice);
```

#### `getDefaultInputConfig(deviceId: string): StreamConfig`

Returns the default input configuration for the specified device.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
const config = cpal.getDefaultInputConfig(inputDevice);
```

#### `getDefaultOutputConfig(deviceId: string): StreamConfig`

Returns the default output configuration for the specified device.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
const config = cpal.getDefaultOutputConfig(outputDevice);
```

### Stream Management

#### `createStream(deviceId: string, isInput: boolean, config: StreamConfig, callback?: (data: Float32Array) => void): StreamHandle`

Creates an audio stream. For input streams, the callback function will be called with audio data.

```javascript
// Creating an input stream
const inputDevice = cpal.getDefaultInputDevice();
const inputConfig = cpal.getDefaultInputConfig(inputDevice);

const inputStream = cpal.createStream(
  inputDevice,
  true, // true for input stream
  {
    sampleRate: inputConfig.sampleRate,
    channels: inputConfig.channels,
    format: 'f32',
  },
  (data) => {
    // Process incoming audio data
    console.log(`Received ${data.length} samples`);
  }
);

// Creating an output stream
const outputDevice = cpal.getDefaultOutputDevice();
const outputConfig = cpal.getDefaultOutputConfig(outputDevice);

const outputStream = cpal.createStream(
  outputDevice,
  false, // false for output stream
  {
    sampleRate: outputConfig.sampleRate,
    channels: outputConfig.channels,
    format: 'f32',
  },
  () => {} // No callback needed for output
);
```

#### `writeToStream(streamHandle: StreamHandle, data: Float32Array): void`

Writes audio data to an output stream.

```javascript
// Write a buffer of audio data to the stream
cpal.writeToStream(outputStream, audioBuffer);
```

#### `pauseStream(streamHandle: StreamHandle): void`

Pauses an active stream.

```javascript
cpal.pauseStream(stream);
```

#### `resumeStream(streamHandle: StreamHandle): void`

Resumes a paused stream.

```javascript
cpal.resumeStream(stream);
```

#### `closeStream(streamHandle: StreamHandle): void`

Closes and cleans up a stream.

```javascript
cpal.closeStream(stream);
```

#### `isStreamActive(streamHandle: StreamHandle): boolean`

Checks if a stream is currently active.

```javascript
const isActive = cpal.isStreamActive(stream);
console.log(`Stream is ${isActive ? 'active' : 'inactive'}`);
```

## Type Definitions

```typescript
interface AudioDeviceConfig {
  minSampleRate: number;
  maxSampleRate: number;
  channels: number;
  format: 'i16' | 'u16' | 'f32';
}

interface StreamConfig {
  sampleRate: number;
  channels: number;
  format: 'i16' | 'u16' | 'f32';
}

interface StreamHandle {
  deviceId: string;
  streamId: string;
}
```

## Building from Source

1. Ensure you have the Rust toolchain installed (https://rustup.rs/)
2. Clone the repository
3. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

## Testing

Run the test suite:

```bash
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

ISC License

## Acknowledgements

- [CPAL](https://github.com/RustAudio/cpal) - The Rust Cross-Platform Audio Library
- [Neon](https://neon-bindings.com/) - Rust bindings for writing safe and fast native Node.js modules

### Publishing New Versions

This package uses GitHub Actions to build platform-specific binaries and publish them to npm. See [PUBLISHING.md](PUBLISHING.md) for detailed instructions on how to publish new versions.
