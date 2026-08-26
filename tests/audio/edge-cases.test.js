const assert = require('assert');
const cpal = require('../..');
const {
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('../helpers/hardware');

describe('Edge Cases', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    if (!device) {
      this.skip();
    }

    config = getTestConfig(device, false);
    if (!config) {
      this.skip();
    }
  });

  it('should handle zero-length audio buffers', async () => {
    const stream = cpal.createStream(
      device.deviceId,
      false,
      config,
      () => {}
    );
    try {
      const buffer = new Float32Array(0);
      assert.throws(() => {
        cpal.writeToStream(stream, buffer);
      }, /invalid buffer size/i);
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('should handle very small audio buffers', async () => {
    await withTestStream(device, false, config, async (stream) => {
      // Test with a tiny buffer (1ms of audio)
      const buffer = generateSineWave(
        440,
        config.sampleRate,
        config.channels,
        0.001
      );
      cpal.writeToStream(stream, buffer);
    });
  });

  it('should handle multiple supported f32 configurations', async function () {
    const configs = cpal
      .getSupportedOutputConfigs(device.deviceId)
      .filter((supportedConfig) => supportedConfig.format === 'f32');
    if (configs.length < 2) {
      this.skip();
    }

    for (let i = 0; i < 2; i++) {
      const testConfig = {
        channels: configs[i].channels,
        sampleRate: configs[i].minSampleRate,
        format: configs[i].format,
      };

      await withTestStream(device, false, testConfig, async (stream) => {
        const buffer = generateSineWave(
          440,
          testConfig.sampleRate,
          testConfig.channels,
          0.2
        );
        cpal.writeToStream(stream, buffer);
      });
    }
  });

  it('should handle maximum supported values', async () => {
    const configs = cpal
      .getSupportedOutputConfigs(device.deviceId)
      .filter((supportedConfig) => supportedConfig.format === 'f32');
    const maxRateConfig = configs.reduce((maximum, supportedConfig) =>
      supportedConfig.maxSampleRate > maximum.maxSampleRate
        ? supportedConfig
        : maximum
    );
    const maxChannelConfig = configs.reduce((maximum, supportedConfig) =>
      supportedConfig.channels > maximum.channels ? supportedConfig : maximum
    );
    const testConfigs = [
      {
        channels: maxRateConfig.channels,
        sampleRate: maxRateConfig.maxSampleRate,
        format: maxRateConfig.format,
      },
      {
        channels: maxChannelConfig.channels,
        sampleRate: maxChannelConfig.minSampleRate,
        format: maxChannelConfig.format,
      },
    ].filter(
      (testConfig, index, allConfigs) =>
        allConfigs.findIndex(
          (candidate) =>
            candidate.channels === testConfig.channels &&
            candidate.sampleRate === testConfig.sampleRate &&
            candidate.format === testConfig.format
        ) === index
    );

    for (const testConfig of testConfigs) {
      await withTestStream(device, false, testConfig, async (stream) => {
        const buffer = generateSineWave(
          440,
          testConfig.sampleRate,
          testConfig.channels,
          0.2
        );
        cpal.writeToStream(stream, buffer);
      });
    }
  });

  it('should handle rapid pause/resume cycles', async () => {
    const stream = cpal.createStream(
      device.deviceId,
      false,
      config,
      () => {}
    );
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    try {
      for (let i = 0; i < 10; i++) {
        cpal.writeToStream(stream, buffer);
        cpal.pauseStream(stream);
        assert.strictEqual(cpal.isStreamActive(stream), false);
        cpal.resumeStream(stream);
        assert.strictEqual(cpal.isStreamActive(stream), true);
      }
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('should handle multiple streams with different configurations', async function () {
    const configs = cpal
      .getSupportedOutputConfigs(device.deviceId)
      .filter((supportedConfig) => supportedConfig.format === 'f32');
    if (configs.length < 2) {
      this.skip();
    }

    const streams = [];

    try {
      // Create streams with different configurations
      for (const config of configs.slice(0, 3)) {
        // Test first 3 configs
        const testConfig = {
          channels: config.channels,
          sampleRate: config.minSampleRate,
          format: config.format,
        };
        const stream = cpal.createStream(
          device.deviceId,
          false,
          testConfig,
          () => {}
        );
        streams.push(stream);
      }

      // Write different audio to each stream
      streams.forEach((stream, index) => {
        const frequency = 440 * (index + 1);
        const buffer = generateSineWave(
          frequency,
          configs[index].minSampleRate,
          configs[index].channels,
          0.2
        );
        cpal.writeToStream(stream, buffer);
      });
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }

    streams.forEach((stream) => {
      assert.strictEqual(cpal.isStreamActive(stream), false);
    });
  });

  it('should handle stream closure during active playback', async () => {
    const stream = cpal.createStream(
      device.deviceId,
      false,
      config,
      () => {}
    );
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      1.0
    );

    try {
      cpal.writeToStream(stream, buffer);
      cpal.closeStream(stream);

      assert.throws(() => {
        cpal.writeToStream(stream, buffer);
      }, /Stream not found/);
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('should reject unsupported audio buffer types', async () => {
    await withTestStream(device, false, config, async (stream) => {
      const invalidBuffers = [
        new Float64Array(16),
        new Int16Array(16),
        new Uint8Array(16),
        Array(16).fill(0),
      ];

      invalidBuffers.forEach((buffer) => {
        assert.throws(
          () => cpal.writeToStream(stream, buffer),
          /failed to downcast|Float32Array/i
        );
      });
      assert(cpal.isStreamActive(stream));
    });
  });
});
