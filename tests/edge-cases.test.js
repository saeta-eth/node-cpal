const assert = require('assert');
const cpal = require('../');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('./utils');

describe('Edge Cases', () => {
  let device;
  let config;

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
  });

  it('should handle zero-length audio buffers', async () => {
    const stream = cpal.createStream(device, false, config, () => {});
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
      await sleep(100);
    });
  });

  it('should handle multiple format changes', async () => {
    const configs = cpal.getSupportedOutputConfigs(device);
    if (configs.length < 2) {
      console.log(
        'Device only supports one format, skipping format change test'
      );
      return;
    }

    // Test first two supported configurations
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
        await sleep(300);
      });
    }
  });

  it('should handle maximum supported values', async () => {
    const configs = cpal.getSupportedOutputConfigs(device);
    let maxChannels = 0;
    let maxSampleRate = 0;

    // Find maximum supported values
    configs.forEach((config) => {
      maxChannels = Math.max(maxChannels, config.channels);
      maxSampleRate = Math.max(maxSampleRate, config.maxSampleRate);
    });

    const testConfig = {
      channels: maxChannels,
      sampleRate: maxSampleRate,
      format: configs[0].format,
    };

    await withTestStream(device, false, testConfig, async (stream) => {
      const buffer = generateSineWave(
        440,
        testConfig.sampleRate,
        testConfig.channels,
        0.2
      );
      cpal.writeToStream(stream, buffer);
      await sleep(300);
    });
  });

  it('should handle rapid pause/resume cycles', async () => {
    const stream = cpal.createStream(device, false, config, () => {});
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
        await sleep(50);
        cpal.resumeStream(stream);
        await sleep(50);
      }
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('should handle multiple streams with different configurations', async () => {
    const configs = cpal.getSupportedOutputConfigs(device);
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
        const stream = cpal.createStream(device, false, testConfig, () => {});
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

      await sleep(300);
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }
  });

  it('should handle stream closure during active playback', async () => {
    const stream = cpal.createStream(device, false, config, () => {});
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      1.0
    );

    cpal.writeToStream(stream, buffer);
    await sleep(100); // Let playback start
    cpal.closeStream(stream);

    // Verify stream is no longer valid
    assert.throws(() => {
      cpal.writeToStream(stream, buffer);
    }, /Stream not found/);
  });

  it('should handle invalid audio data values', async () => {
    await withTestStream(device, false, config, async (stream) => {
      const buffer = new Float32Array(
        config.sampleRate * config.channels * 0.1
      ); // 100ms

      // Test with invalid values
      buffer.fill(Number.POSITIVE_INFINITY);
      cpal.writeToStream(stream, buffer);

      buffer.fill(Number.NEGATIVE_INFINITY);
      cpal.writeToStream(stream, buffer);

      buffer.fill(Number.NaN);
      cpal.writeToStream(stream, buffer);

      await sleep(300);
    });
  });
});
