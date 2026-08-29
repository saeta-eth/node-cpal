import * as cpal from '../..';
import * as jack from 'node-cpal/backend-jack';
import * as pipewire from 'node-cpal/backend-pipewire';
import * as pulseaudio from 'node-cpal/backend-pulseaudio';
import * as asio from 'node-cpal/backend-asio';
import type {
  AudioDevice,
  AudioDeviceConfig,
  AudioHost,
  CpalError,
  DefaultStreamConfig,
  QueuedInputCallbackInfo,
  QueuedOutputCallbackInfo,
  QueuedStreamConfig,
  SampleArray,
  SampleFormatName,
} from '../..';

const convenience = cpal.convenience;
const jackHostConstructor: cpal.JackHostConstructor = jack.JackHost;
const pipeWireHostConstructor: cpal.PipeWireHostConstructor = pipewire.PipeWireHost;
const pulseHosts: readonly cpal.HostId[] = pulseaudio.ALL_HOSTS;
const asioHosts: readonly cpal.HostId[] = asio.ALL_HOSTS;
void jackHostConstructor;
void pipeWireHostConstructor;
void pulseHosts;
void asioHosts;
// @ts-expect-error queued discovery is intentionally not part of canonical CPAL.
cpal.getDevices();
const hosts: AudioHost[] = convenience.getHosts();
const devices: AudioDevice[] = convenience.getDevices({
  hostId: hosts[0]?.id,
  direction: 'output',
});
convenience.getDevices({
  hostId: 'pipewire',
  hostOptions: { connectAutomatically: false },
});
convenience.getDevices({
  hostId: 'jack',
  // @ts-expect-error JACK host options are rejected until CPAL can apply them before initialization.
  hostOptions: { clientName: 'typed-client' },
});
const inputDevice: AudioDevice = convenience.getDefaultInputDevice();
const outputDevice: AudioDevice = convenience.getDefaultOutputDevice({
  hostId: hosts[0]?.id,
});
const sameDevice: AudioDevice = convenience.getDeviceById(outputDevice.deviceId);
const inputConfigs: AudioDeviceConfig[] = convenience.getSupportedInputConfigs(
  inputDevice.deviceId
);
const outputConfigs: AudioDeviceConfig[] = convenience.getSupportedOutputConfigs(
  outputDevice.deviceId
);
const loopbackConfigs: AudioDeviceConfig[] = convenience.getSupportedLoopbackConfigs(
  outputDevice.deviceId
);
const inputConfig: DefaultStreamConfig = convenience.getDefaultInputConfig(
  inputDevice.deviceId
);
const outputConfig: DefaultStreamConfig = convenience.getDefaultOutputConfig(
  outputDevice.deviceId
);
const formats: SampleFormatName[] = convenience.getSupportedFormats(outputDevice.deviceId);
const rates: number[] = convenience.getSupportedSampleRates(outputDevice.deviceId);
const channels: number = convenience.getMaxChannels(outputDevice.deviceId);

const f32Config: QueuedStreamConfig<'f32'> = {
  sampleRate: 48_000,
  channels: 2,
  sampleFormat: 'f32',
  bufferSize: { type: 'fixed', frames: 256 },
};

const inputPromise = convenience.createInputStream({
  deviceId: inputDevice.deviceId,
  config: f32Config,
  onData(data, info) {
    const samples: Float32Array = data;
    const metadata: QueuedInputCallbackInfo = info;
    const timestamp: bigint = info.captureTimeNs;
    void samples;
    void metadata;
    void timestamp;
  },
  onError(error) {
    const typedError: CpalError = error;
    void typedError.code;
    void typedError.cause;
  },
});

const pushPromise = convenience.createOutputStream({
  deviceId: outputDevice.deviceId,
  config: f32Config,
  mode: 'push',
  autoStart: true,
  onDrain() {},
  onOutput(info) {
    const metadata: QueuedOutputCallbackInfo = info;
    const timestamp: bigint = info.playbackTimeNs;
    void metadata;
    void timestamp;
  },
  onError() {},
});

pushPromise.then(async (stream) => {
  const accepted: boolean = stream.write(new Float32Array(512));
  const state: cpal.StreamState = stream.state;
  const bufferedFrames: number = stream.bufferedFrames;
  const now: bigint = stream.now();
  stream.pause();
  stream.play();
  const bufferSize: number = stream.bufferSize();
  await stream.close();

  // @ts-expect-error f32 streams only accept Float32Array writes.
  stream.write(new Int16Array(512));
  void accepted;
  void state;
  void bufferedFrames;
  void now;
  void bufferSize;
});

const i24Config: QueuedStreamConfig<'i24'> = {
  sampleRate: 48_000,
  channels: 2,
  sampleFormat: 'i24',
};

const pullPromise = convenience.createOutputStream({
  deviceId: outputDevice.deviceId,
  config: i24Config,
  mode: 'pull',
  prefetchBuffers: 3,
  onData(request) {
    const format: 'i24' = request.sampleFormat;
    void format;
    return new Int32Array(request.frames * request.channels);
  },
  onError() {},
});

const u64Samples: SampleArray<'u64'> = new BigUint64Array(16);
void u64Samples;

const loopbackPromise = convenience.createLoopbackStream({
  deviceId: outputDevice.deviceId,
  config: f32Config,
  onData(data) {
    const samples: Float32Array = data;
    void samples;
  },
  onError() {},
});

// @ts-expect-error onError is required for every stream.
convenience.createInputStream({
  deviceId: inputDevice.deviceId,
  config: f32Config,
  onData() {},
});

convenience.createOutputStream({
  deviceId: outputDevice.deviceId,
  config: f32Config,
  // @ts-expect-error pull streams require a synchronous data callback.
  mode: 'pull',
  onError() {},
});

// @ts-expect-error device APIs accept a stable device ID, not a device object.
convenience.getSupportedOutputConfigs(outputDevice);

// @ts-expect-error the 1.0 API intentionally removed string stream handles.
convenience.createStream(outputDevice.deviceId, false, outputConfig, () => {});

// @ts-expect-error stream classes cannot be directly constructed.
new convenience.InputStream();

void devices;
void sameDevice;
void inputConfigs;
void outputConfigs;
void loopbackConfigs;
void inputConfig;
void outputConfig;
void formats;
void rates;
void channels;
void inputPromise;
void pullPromise;
void loopbackPromise;

const canonicalHosts: cpal.HostId[] = cpal.availableHosts();
const allHosts: readonly cpal.HostId[] = cpal.ALL_HOSTS;
const canonicalHost: cpal.Host = cpal.defaultHost();
const parsedHost: cpal.Host = cpal.hostFromId(canonicalHost.id());
const canonicalDevice = canonicalHost.defaultOutputDevice();
const canonicalConfig = new cpal.StreamConfig({
  channels: 2,
  sampleRate: cpal.SAMPLE_RATE_48K,
  bufferSize: cpal.BufferSize.Fixed(256),
});
const instant = cpal.StreamInstant.fromMillis(5n);
const nanos: bigint = instant.asNanos();
const i24 = cpal.I24.new(123);
const f32Size: number = cpal.SampleFormat.F32.sampleSize();

// Platform host constructors only exist in builds that include the matching CPAL host.
// @ts-expect-error JACK may not be compiled into the loaded package.
new cpal.JackHost();
if (cpal.JackHost) {
  const jack: cpal.JackHost = new cpal.JackHost();
  const available: boolean = cpal.JackHost.isAvailable();
  jack.setConnectAutomatically(false);
  void available;
}
if (cpal.PipeWireHost) {
  const pipeWire: cpal.PipeWireHost = new cpal.PipeWireHost();
  pipeWire.setConnectAutomatically(false);
}

if (canonicalDevice) {
  const id: cpal.DeviceId = canonicalDevice.id();
  const description: cpal.DeviceDescription = canonicalDevice.description();
  const ranges: Iterable<cpal.SupportedStreamConfigRange> =
    canonicalDevice.supportedOutputConfigs();
  const stream = canonicalDevice.buildOutputStream(
    canonicalConfig,
    cpal.SampleFormat.F32,
    (data, info) => {
      const samples: Float32Array = data;
      const timestamp: cpal.OutputStreamTimestamp = info.timestamp();
      samples.fill(0);
      void timestamp;
    },
    (error) => {
      const kind: cpal.ErrorKind = error.kind();
      void kind;
    },
    null
  );
  canonicalDevice.buildInputStreamRaw(
    canonicalConfig,
    cpal.SampleFormat.I16,
    (data, info) => {
      const samples: Int16Array | null = data.asSlice(cpal.SampleFormat.I16);
      const timestamp: cpal.InputStreamTimestamp = info.timestamp();
      void samples;
      void timestamp;
    },
    () => {},
    1_000_000n
  );
  stream.play();
  stream.pause();
  const streamInstant: cpal.StreamInstant = stream.now();
  stream.close();
  void id;
  void description;
  void ranges;
  void streamInstant;
}

void canonicalHosts;
void allHosts;
void parsedHost;
void nanos;
void i24;
void f32Size;
