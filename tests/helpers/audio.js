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

function selectF32Config(supportedConfigs, defaultConfig) {
  const floatConfigs = supportedConfigs.filter(
    (supportedConfig) => supportedConfig.sampleFormat === 'f32'
  );
  if (floatConfigs.length === 0) {
    return null;
  }

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
    sampleFormat: 'f32',
    bufferSize: { type: 'default' },
  };
}

function summarizeDurations(values) {
  if (values.length === 0) {
    throw new TypeError('Expected at least one duration');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (value) => {
    const index = Math.ceil((value / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  };

  return {
    min: sorted[0],
    median: percentile(50),
    p95: percentile(95),
    max: sorted[sorted.length - 1],
  };
}

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
  selectF32Config,
  summarizeDurations,
  getMemoryUsage,
};
