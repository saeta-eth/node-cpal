# node-cpal

Node.js bindings for CPAL (Cross-Platform Audio Library), providing low-level audio functionality for Node.js applications.

[![npm version](https://img.shields.io/npm/v/node-cpal.svg)](https://www.npmjs.com/package/node-cpal)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![CI](https://github.com/saeta-eth/node-cpal/actions/workflows/ci.yml/badge.svg)](https://github.com/saeta-eth/node-cpal/actions/workflows/ci.yml)
[![Build and Publish](https://github.com/saeta-eth/node-cpal/actions/workflows/build-and-publish.yml/badge.svg)](https://github.com/saeta-eth/node-cpal/actions/workflows/build-and-publish.yml)

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
  - Synchronous device and stream-control API
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

- Node.js 22.0.0 or later
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

// Select an f32 output capability, because stream data uses Float32Array
const defaultConfig = cpal.getDefaultOutputConfig(outputDevice.deviceId);
const supportedConfigs = cpal
  .getSupportedOutputConfigs(outputDevice.deviceId)
  .filter((config) => config.format === 'f32');
const supportedConfig =
  supportedConfigs.find(
    (config) =>
      config.channels === defaultConfig.channels &&
      defaultConfig.sampleRate >= config.minSampleRate &&
      defaultConfig.sampleRate <= config.maxSampleRate
  ) || supportedConfigs[0];
if (!supportedConfig) {
  throw new Error('Default output device does not support f32 audio');
}

const config = {
  sampleRate:
    defaultConfig.sampleRate >= supportedConfig.minSampleRate &&
    defaultConfig.sampleRate <= supportedConfig.maxSampleRate
      ? defaultConfig.sampleRate
      : supportedConfig.minSampleRate,
  channels: supportedConfig.channels,
};
const stream = cpal.createStream(
  outputDevice.deviceId,
  false,
  config,
  () => {} // The native API requires a callback; output does not invoke it
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

#### `getHosts(): AudioHost[]`

Returns an array of available audio hosts on the system.

```javascript
const hosts = cpal.getHosts();
// Example: [{ id: 'coreaudio', name: 'CoreAudio' }]
```

#### `getDevices(hostId?: string): AudioDevice[]`

Returns device objects for the specified host. When omitted, `hostId` defaults to the platform's default host.

```javascript
const host = cpal.getHosts()[0];
const devices = cpal.getDevices(host.id);
console.log(devices[0].deviceId, devices[0].name);
```

#### `getDefaultInputDevice(): AudioDevice`

Returns the default input device object, or throws when no default input device exists.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
```

#### `getDefaultOutputDevice(): AudioDevice`

Returns the default output device object, or throws when no default output device exists.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
```

### Device Configuration

#### `getSupportedInputConfigs(deviceId: string): AudioDeviceConfig[]`

Returns an array of supported input configurations for the specified device.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
const configs = cpal.getSupportedInputConfigs(inputDevice.deviceId);
```

#### `getSupportedOutputConfigs(deviceId: string): AudioDeviceConfig[]`

Returns an array of supported output configurations for the specified device.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
const configs = cpal.getSupportedOutputConfigs(outputDevice.deviceId);
```

Supported configurations contain `minSampleRate`, `maxSampleRate`, `channels`, and `format`.

#### `getDefaultInputConfig(deviceId: string): DefaultStreamConfig`

Returns the default input configuration for the specified device.

```javascript
const inputDevice = cpal.getDefaultInputDevice();
const config = cpal.getDefaultInputConfig(inputDevice.deviceId);
```

#### `getDefaultOutputConfig(deviceId: string): DefaultStreamConfig`

Returns the default output configuration for the specified device.

```javascript
const outputDevice = cpal.getDefaultOutputDevice();
const config = cpal.getDefaultOutputConfig(outputDevice.deviceId);
```

Default configurations contain `sampleRate`, `channels`, and `sampleFormat`.

#### `getSupportedFormats(deviceId: string): SampleFormat[]`

Returns the unique input and output formats exposed by the device.

#### `getSupportedSampleRates(deviceId: string): number[]`

Returns sorted, unique minimum and maximum sample-rate boundaries exposed by the device.

#### `getMaxChannels(deviceId: string): number`

Returns the largest input or output channel count exposed by the device.

### Stream Management

#### `createStream(deviceId: string, isInput: boolean, config: StreamConfig, callback: (data: Float32Array) => void): StreamId`

Creates a stream and returns its string ID. Input callbacks receive `Float32Array` data. The callback argument is also required for output streams, although output streams do not invoke it.

Streams currently use `f32` samples internally. Choose `sampleRate` and `channels` from a supported configuration whose `format` is `f32`; do not assume the default format is compatible.

```javascript
// Creating an input stream
const inputDevice = cpal.getDefaultInputDevice();
const inputCapability = cpal
  .getSupportedInputConfigs(inputDevice.deviceId)
  .find((config) => config.format === 'f32');
if (!inputCapability) throw new Error('Input device does not support f32');
const inputConfig = {
  sampleRate: inputCapability.minSampleRate,
  channels: inputCapability.channels,
};

const inputStream = cpal.createStream(
  inputDevice.deviceId,
  true,
  inputConfig,
  (data) => {
    // Process incoming audio data
    console.log(`Received ${data.length} samples`);
  }
);

// Creating an output stream
const outputDevice = cpal.getDefaultOutputDevice();
const outputCapability = cpal
  .getSupportedOutputConfigs(outputDevice.deviceId)
  .find((config) => config.format === 'f32');
if (!outputCapability) throw new Error('Output device does not support f32');
const outputConfig = {
  sampleRate: outputCapability.minSampleRate,
  channels: outputCapability.channels,
};

const outputStream = cpal.createStream(
  outputDevice.deviceId,
  false,
  outputConfig,
  () => {}
);
```

#### `writeToStream(streamId: StreamId, data: Float32Array): void`

Writes audio data to an output stream.

```javascript
// Write a buffer of audio data to the stream
cpal.writeToStream(outputStream, audioBuffer);
```

#### `pauseStream(streamId: StreamId): void`

Pauses an active stream.

```javascript
cpal.pauseStream(stream);
```

#### `resumeStream(streamId: StreamId): void`

Resumes a paused stream.

```javascript
cpal.resumeStream(stream);
```

#### `closeStream(streamId: StreamId): void`

Closes and cleans up a stream.

```javascript
cpal.closeStream(stream);
```

#### `isStreamActive(streamId: StreamId): boolean`

Checks if a stream is currently active.

```javascript
const isActive = cpal.isStreamActive(stream);
console.log(`Stream is ${isActive ? 'active' : 'inactive'}`);
```

## Type Definitions

```typescript
type SampleFormat =
  | 'i8'
  | 'i16'
  | 'i24'
  | 'i32'
  | 'i64'
  | 'u8'
  | 'u16'
  | 'u24'
  | 'u32'
  | 'u64'
  | 'f32'
  | 'f64'
  | 'dsdu8'
  | 'dsdu16'
  | 'dsdu32';

interface AudioDeviceConfig {
  minSampleRate: number;
  maxSampleRate: number;
  channels: number;
  format: SampleFormat;
}

interface AudioHost {
  id: string;
  name: string;
}

interface AudioDevice {
  name: string;
  hostId: string;
  deviceId: string;
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
}

interface StreamConfig {
  sampleRate: number;
  channels: number;
}

interface DefaultStreamConfig extends StreamConfig {
  sampleFormat: SampleFormat;
}

type StreamId = string;
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

Run deterministic JavaScript, TypeScript, and Rust unit tests without audio hardware:

```bash
npm test
```

Build the addon before running tests that use real devices:

```bash
npm run build
npm run test:audio
npm run test:stress
```

Run report-only audio benchmarks separately:

```bash
npm run benchmark:audio
```

Hardware tests skip only capabilities that are genuinely unavailable. Record the operating system, architecture, and input/output hardware when reporting results.

The manually triggered **Audio Hardware Tests** GitHub workflow targets a self-hosted runner with both `self-hosted` and `audio` labels. That runner must already have direct audio-device access and the platform development libraries listed above.

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
