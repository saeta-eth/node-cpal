function getF32StreamConfig(cpal, deviceId, isInput) {
  const supportedConfigs = isInput
    ? cpal.getSupportedInputConfigs(deviceId)
    : cpal.getSupportedOutputConfigs(deviceId);
  const defaultConfig = isInput
    ? cpal.getDefaultInputConfig(deviceId)
    : cpal.getDefaultOutputConfig(deviceId);
  const floatConfigs = supportedConfigs.filter(
    (config) => config.format === 'f32'
  );

  if (floatConfigs.length === 0) {
    throw new Error('The selected device does not support f32 audio');
  }

  const selectedConfig =
    floatConfigs.find(
      (config) =>
        config.channels === defaultConfig.channels &&
        defaultConfig.sampleRate >= config.minSampleRate &&
        defaultConfig.sampleRate <= config.maxSampleRate
    ) || floatConfigs[0];

  return {
    sampleRate:
      defaultConfig.sampleRate >= selectedConfig.minSampleRate &&
      defaultConfig.sampleRate <= selectedConfig.maxSampleRate
        ? defaultConfig.sampleRate
        : selectedConfig.minSampleRate,
    channels: selectedConfig.channels,
  };
}

module.exports = { getF32StreamConfig };
