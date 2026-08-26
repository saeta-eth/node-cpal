const cpal = require('../');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateSineWave(
  frequency,
  sampleRate,
  channels,
  duration = 1,
  volume = 0.5
) {
  const sampleCount = Math.floor(sampleRate * duration);
  const data = new Float32Array(sampleCount * channels);

  for (let i = 0; i < sampleCount; i++) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * volume;
    for (let channel = 0; channel < channels; channel++) {
      data[i * channels + channel] = value;
    }
  }

  return data;
}

function getDeviceId(device) {
  if (typeof device === 'string') {
    return device;
  }

  if (device && typeof device.deviceId === 'string') {
    return device.deviceId;
  }

  throw new TypeError('Expected an audio device with a deviceId');
}

function createTestStream(device, isInput, config) {
  return new Promise((resolve, reject) => {
    try {
      const stream = cpal.createStream(
        getDeviceId(device),
        isInput,
        {
          channels: Number(config.channels),
          sampleRate: Number(config.sampleRate),
          format: String(config.format),
        },
        (data) => {
          if (isInput && data) {
            // Handle input data if needed
          }
        }
      );
      resolve(stream);
    } catch (e) {
      reject(e);
    }
  });
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

  const floatConfigs = supportedConfigs.filter(
    (supportedConfig) => supportedConfig.format === 'f32'
  );
  if (floatConfigs.length === 0) {
    return null;
  }

  const defaultConfig = isInput
    ? cpal.getDefaultInputConfig(deviceId)
    : cpal.getDefaultOutputConfig(deviceId);
  const selectedConfig =
    floatConfigs.find(
      (supportedConfig) =>
        supportedConfig.channels === defaultConfig.channels &&
        defaultConfig.sampleRate >= supportedConfig.minSampleRate &&
        defaultConfig.sampleRate <= supportedConfig.maxSampleRate
    ) || floatConfigs[0];
  const sampleRate =
    defaultConfig.sampleRate >= selectedConfig.minSampleRate &&
    defaultConfig.sampleRate <= selectedConfig.maxSampleRate
      ? defaultConfig.sampleRate
      : selectedConfig.minSampleRate;

  return {
    channels: Number(selectedConfig.channels),
    sampleRate: Number(sampleRate),
    format: selectedConfig.format,
  };
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
  const stream = await createTestStream(device, isInput, config);
  try {
    await callback(stream);
  } finally {
    cpal.closeStream(stream);
  }
}

// Memory usage helper
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    rss: usage.rss,
  };
}

module.exports = {
  sleep,
  generateSineWave,
  getDeviceId,
  createTestStream,
  getTestConfig,
  getTestDevice,
  withTestStream,
  getMemoryUsage,
};
