const cpal = require('../..').convenience;
const assert = require('assert');
const {
  sleep,
  generateSineWave,
  getDeviceId,
  selectF32Config,
  getMemoryUsage,
} = require('./audio');

async function createTestStream(device, isInput, config, callbacks = {}) {
  const options = {
    deviceId: getDeviceId(device),
    config: {
      channels: Number(config.channels),
      sampleRate: Number(config.sampleRate),
      sampleFormat: config.sampleFormat,
      bufferSize: config.bufferSize,
    },
    autoStart: true,
    onError: callbacks.onError || (() => {}),
  };
  if (isInput) {
    options.onData = callbacks.onData || (() => {});
    return cpal.createInputStream(options);
  }
  return cpal.createOutputStream(options);
}

function getTestConfig(device, isInput = false) {
  if (!device) {
    return null;
  }

  const deviceId = getDeviceId(device);
  let supportedConfigs;

  try {
    supportedConfigs = isInput
      ? cpal.getSupportedInputConfigs(deviceId)
      : cpal.getSupportedOutputConfigs(deviceId);
  } catch (error) {
    if (/does not support (input|output)/i.test(error.message)) {
      return null;
    }
    throw error;
  }

  const defaultConfig = isInput
    ? cpal.getDefaultInputConfig(deviceId)
    : cpal.getDefaultOutputConfig(deviceId);
  return selectF32Config(supportedConfigs, defaultConfig);
}

function getTestDevice(isInput = false) {
  try {
    return isInput
      ? cpal.getDefaultInputDevice()
      : cpal.getDefaultOutputDevice();
  } catch (error) {
    if (
      ['DEVICE_NOT_AVAILABLE', 'HOST_UNAVAILABLE'].includes(error.code) ||
      /No default (input|output) device found/i.test(error.message) ||
      (error.code === 'BACKEND_ERROR' && /get device name/i.test(error.message))
    ) {
      return null;
    }
    throw error;
  }
}

async function withTestStream(device, isInput, config, callback) {
  const stream = await createTestStream(device, isInput, config);
  try {
    await callback(stream);
  } finally {
    await stream.close();
  }
}

async function assertStreamCreationThrows(create, expected) {
  let unexpectedStream;

  try {
    await assert.rejects(async () => {
      unexpectedStream = await create();
    }, expected);
  } finally {
    if (unexpectedStream) {
      await unexpectedStream.close();
    }
  }
}

module.exports = {
  sleep,
  generateSineWave,
  getDeviceId,
  createTestStream,
  getTestConfig,
  getTestDevice,
  withTestStream,
  assertStreamCreationThrows,
  getMemoryUsage,
};
