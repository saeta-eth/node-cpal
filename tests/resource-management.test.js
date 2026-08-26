const assert = require('assert');
const cpal = require('../');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
  getMemoryUsage,
} = require('./utils');

describe('Resource Management Tests', () => {
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

  it('should properly clean up resources after stream closure', async () => {
    const startMemory = getMemoryUsage();
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      await withTestStream(device, false, config, async (stream) => {
        const buffer = generateSineWave(
          440,
          config.sampleRate,
          config.channels,
          0.1
        );
        cpal.writeToStream(stream, buffer);
        await sleep(100);
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const currentMemory = getMemoryUsage();
      console.log(`Memory usage after iteration ${i + 1}:`, currentMemory);

      // Check that memory usage isn't growing significantly
      assert(
        currentMemory.heapUsed < startMemory.heapUsed * 1.5,
        `Memory leak detected at iteration ${i + 1}`
      );
    }
  }).timeout(10000);

  it('should handle multiple stream lifecycle events properly', async () => {
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
      cpal.writeToStream(stream, buffer);
      cpal.pauseStream(stream);
      cpal.resumeStream(stream);
      cpal.writeToStream(stream, buffer);
      cpal.closeStream(stream);

      assert.throws(() => {
        cpal.writeToStream(stream, buffer);
      }, /stream not found|invalid stream|stream closed/i);

      assert.throws(() => {
        cpal.pauseStream(stream);
      }, /stream not found|invalid stream|stream closed/i);

      assert.throws(() => {
        cpal.resumeStream(stream);
      }, /stream not found|invalid stream|stream closed/i);
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('should reject an invalid device without disrupting an open stream', async () => {
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
      cpal.writeToStream(stream, buffer);
      assert.throws(() => {
        cpal.createStream('disconnected-device', false, config, () => {});
      }, /Device not found/);
      cpal.writeToStream(stream, buffer);
      assert(cpal.isStreamActive(stream));
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(5000);

  it('should handle resource limits gracefully', async () => {
    const maxStreams = 100; // Arbitrary limit for testing
    const streams = [];
    let lastSuccessfulStream = 0;

    try {
      for (let i = 0; i < maxStreams; i++) {
        try {
          const stream = cpal.createStream(
            device.deviceId,
            false,
            config,
            () => {}
          );
          streams.push(stream);
          lastSuccessfulStream = i + 1;
        } catch (error) {
          assert.match(error.message, /Failed to build output stream/i);
          console.log(
            `Failed to create stream after ${lastSuccessfulStream} streams`
          );
          assert(
            lastSuccessfulStream > 0,
            'Should be able to create at least one stream'
          );
          break;
        }
      }

      // Verify all created streams are functional
      const buffer = generateSineWave(
        440,
        config.sampleRate,
        config.channels,
        0.1
      );
      for (const stream of streams) {
        cpal.writeToStream(stream, buffer);
        assert(
          cpal.isStreamActive(stream),
          'Stream should be active after write'
        );
      }
    } finally {
      // Clean up all streams
      streams.forEach((stream) => cpal.closeStream(stream));
    }
  }).timeout(10000);

  it('should handle rapid stream state transitions', () => {
    const stream = cpal.createStream(
      device.deviceId,
      false,
      config,
      () => {}
    );
    const iterations = 50;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.01
    );

    try {
      cpal.writeToStream(stream, buffer);

      for (let i = 0; i < iterations; i++) {
        cpal.pauseStream(stream);
        assert(
          !cpal.isStreamActive(stream),
          'Stream should be inactive after pause'
        );

        cpal.resumeStream(stream);
        assert(
          cpal.isStreamActive(stream),
          'Stream should be active after resume'
        );
      }

      cpal.writeToStream(stream, buffer);
      assert(cpal.isStreamActive(stream), 'Stream should accept a final write');
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(5000);
});
