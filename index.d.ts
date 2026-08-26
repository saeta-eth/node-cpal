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

export interface AudioDeviceConfig {
  minSampleRate: number;
  maxSampleRate: number;
  channels: number;
  format: SampleFormat;
}

export interface StreamConfig {
  sampleRate: number;
  channels: number;
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

export interface StreamHandle {
  deviceId: string;
  streamId: string;
}

// Device and host enumeration
export function getHosts(): AudioHost[];
export function getDevices(hostId?: string): AudioDevice[];
export function getDefaultOutputDevice(): AudioDevice;
export function getDefaultInputDevice(): AudioDevice;

// Stream configuration
export function getSupportedInputConfigs(deviceId: string): AudioDeviceConfig[];
export function getSupportedOutputConfigs(
  deviceId: string
): AudioDeviceConfig[];
export function getDefaultInputConfig(deviceId: string): StreamConfig;
export function getDefaultOutputConfig(deviceId: string): StreamConfig;

// Stream control
export interface AudioStreamOptions {
  deviceId: string;
  config: StreamConfig;
  onData?: (data: Float32Array) => void; // For input streams
}

export function createInputStream(options: AudioStreamOptions): StreamHandle;
export function createOutputStream(options: AudioStreamOptions): StreamHandle;
export function writeToStream(
  streamHandle: StreamHandle,
  data: Float32Array
): void;
export function pauseStream(streamHandle: StreamHandle): void;
export function resumeStream(streamHandle: StreamHandle): void;
export function closeStream(streamHandle: StreamHandle): void;
