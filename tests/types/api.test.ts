import * as cpal from '../..';
import type {
  AudioDevice,
  AudioDeviceConfig,
  AudioHost,
  DefaultStreamConfig,
  SampleFormat,
  StreamConfig,
  StreamId,
} from '../..';

const hosts: AudioHost[] = cpal.getHosts();
const devices: AudioDevice[] = cpal.getDevices(hosts[0]?.id);
const inputDevice: AudioDevice = cpal.getDefaultInputDevice();
const outputDevice: AudioDevice = cpal.getDefaultOutputDevice();
const inputConfigs: AudioDeviceConfig[] = cpal.getSupportedInputConfigs(
  inputDevice.deviceId
);
const outputConfigs: AudioDeviceConfig[] = cpal.getSupportedOutputConfigs(
  outputDevice.deviceId
);
const inputConfig: DefaultStreamConfig = cpal.getDefaultInputConfig(
  inputDevice.deviceId
);
const outputConfig: DefaultStreamConfig = cpal.getDefaultOutputConfig(
  outputDevice.deviceId
);
const streamConfig: StreamConfig = outputConfig;
const formats: SampleFormat[] = cpal.getSupportedFormats(outputDevice.deviceId);
const rates: number[] = cpal.getSupportedSampleRates(outputDevice.deviceId);
const channels: number = cpal.getMaxChannels(outputDevice.deviceId);

const inputStream: StreamId = cpal.createStream(
  inputDevice.deviceId,
  true,
  inputConfig,
  (data) => {
    const inputData: Float32Array = data;
    void inputData;
  }
);
const outputStream: StreamId = cpal.createStream(
  outputDevice.deviceId,
  false,
  streamConfig,
  () => {}
);

cpal.writeToStream(outputStream, new Float32Array(128));
cpal.pauseStream(outputStream);
cpal.resumeStream(outputStream);
const active: boolean = cpal.isStreamActive(outputStream);
cpal.closeStream(inputStream);
cpal.closeStream(outputStream);

void inputConfigs;
void outputConfigs;
void formats;
void rates;
void channels;
void active;

// @ts-expect-error Device APIs accept a device ID, not a device object.
cpal.getSupportedOutputConfigs(outputDevice);

// @ts-expect-error Stream creation also accepts a device ID.
cpal.createStream(outputDevice, false, outputConfig, () => {});

// @ts-expect-error The native API requires a callback for every stream.
cpal.createStream(outputDevice.deviceId, false, outputConfig);

// @ts-expect-error Stream controls accept the returned string ID.
cpal.pauseStream({ deviceId: outputDevice.deviceId, streamId: outputStream });

// @ts-expect-error Stream writes only accept Float32Array data.
cpal.writeToStream(outputStream, new Int16Array(128));

const staleConfig: StreamConfig = {
  sampleRate: 48000,
  channels: 2,
  // @ts-expect-error Format belongs to capability metadata, not StreamConfig.
  format: 'f32',
};

// @ts-expect-error The runtime does not export createInputStream.
cpal.createInputStream({
  deviceId: inputDevice.deviceId,
  config: inputConfig,
});

// @ts-expect-error The runtime does not export createOutputStream.
cpal.createOutputStream({
  deviceId: outputDevice.deviceId,
  config: outputConfig,
});

void staleConfig;
