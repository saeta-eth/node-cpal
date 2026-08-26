export type SampleFormat =
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

export type StreamId = string;
export type StreamCallback = (data: Float32Array) => void;

export interface AudioDeviceConfig {
  minSampleRate: number;
  maxSampleRate: number;
  channels: number;
  format: SampleFormat;
}

export interface StreamConfig {
  sampleRate: number;
  channels: number;
}

export interface DefaultStreamConfig extends StreamConfig {
  sampleFormat: SampleFormat;
}

export interface AudioDevice {
  name: string;
  hostId: string;
  deviceId: string;
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
}

export interface AudioHost {
  id: string;
  name: string;
}

export function getHosts(): AudioHost[];
export function getDevices(hostId?: string): AudioDevice[];
export function getDefaultOutputDevice(): AudioDevice;
export function getDefaultInputDevice(): AudioDevice;

export function getSupportedInputConfigs(
  deviceId: string
): AudioDeviceConfig[];
export function getSupportedOutputConfigs(
  deviceId: string
): AudioDeviceConfig[];
export function getDefaultInputConfig(
  deviceId: string
): DefaultStreamConfig;
export function getDefaultOutputConfig(
  deviceId: string
): DefaultStreamConfig;
export function getSupportedFormats(deviceId: string): SampleFormat[];
export function getSupportedSampleRates(deviceId: string): number[];
export function getMaxChannels(deviceId: string): number;

export function createStream(
  deviceId: string,
  isInput: boolean,
  config: StreamConfig,
  callback: StreamCallback
): StreamId;
export function writeToStream(streamId: StreamId, data: Float32Array): void;
export function pauseStream(streamId: StreamId): void;
export function resumeStream(streamId: StreamId): void;
export function closeStream(streamId: StreamId): void;
export function isStreamActive(streamId: StreamId): boolean;
