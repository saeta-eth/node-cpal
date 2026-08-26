const cpal = require('../..');
const assert = require('assert');
const {
  sleep,
  generateSineWave,
  getDeviceId,
  selectF32Config,
  getMemoryUsage,
} = require('./audio');

function createTestStream(device, isInput, config) {
  return cpal.createStream(
    getDeviceId(device),
    isInput,
    {
      channels: Number(config.channels),
      sampleRate: Number(config.sampleRate),
    },
    () => {}
  );
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
    if (/No default (input|output) device found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function withTestStream(device, isInput, config, callback) {
  const stream = createTestStream(device, isInput, config);
  try {
    await callback(stream);
  } finally {
    cpal.closeStream(stream);
  }
}

function assertStreamCreationThrows(create, expected) {
  let unexpectedStream;

  try {
    assert.throws(() => {
      unexpectedStream = create();
    }, expected);
  } finally {
    if (unexpectedStream) {
      cpal.closeStream(unexpectedStream);
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
