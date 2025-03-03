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

function createTestStream(device, isInput, config) {
  return new Promise((resolve, reject) => {
    try {
      const stream = cpal.createStream(
        device,
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
  try {
    const config = isInput
      ? cpal.getDefaultInputConfig(device)
      : cpal.getDefaultOutputConfig(device);

    // Ensure all fields are numbers
    return {
      channels: Number(config.channels),
      sampleRate: Number(config.sampleRate),
      format: String(config.format),
    };
  } catch (e) {
    if (isInput) {
      console.log('No input config available, using output config');
      return getTestConfig(device, false);
    }
    throw e;
  }
}

function getTestDevice(isInput = false) {
  try {
    return isInput
      ? cpal.getDefaultInputDevice()
      : cpal.getDefaultOutputDevice();
  } catch (e) {
    if (isInput) {
      console.log('No input device available, using output device');
      return cpal.getDefaultOutputDevice();
    }
    throw e;
  }
}

async function withTestStream(device, isInput, config, callback) {
  const stream = await createTestStream(device, isInput, config);
  try {
    await callback(stream);
  } finally {
    try {
      cpal.closeStream(stream);
    } catch (e) {
      console.error('Error closing stream:', e);
    }
  }
}

// Memory usage helper
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    heapTotal: Math.round(usage.heapTotal / (1024 * 1024)),
    heapUsed: Math.round(usage.heapUsed / (1024 * 1024)),
    external: Math.round(usage.external / (1024 * 1024)),
    rss: Math.round(usage.rss / (1024 * 1024)),
  };
}

module.exports = {
  sleep,
  generateSineWave,
  createTestStream,
  getTestConfig,
  getTestDevice,
  withTestStream,
  getMemoryUsage,
};
