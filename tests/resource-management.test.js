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

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
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
    const stream = cpal.createStream(device, false, config, () => {});
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    // Test normal write
    cpal.writeToStream(stream, buffer);
    await sleep(50);

    // Test pause/resume
    cpal.pauseStream(stream);
    await sleep(50);
    cpal.resumeStream(stream);
    await sleep(50);

    // Test write after pause/resume
    cpal.writeToStream(stream, buffer);
    await sleep(50);

    // Test close
    cpal.closeStream(stream);

    // Test operations on closed stream
    assert.throws(() => {
      cpal.writeToStream(stream, buffer);
    }, /stream not found|invalid stream|stream closed/i);

    assert.throws(() => {
      cpal.pauseStream(stream);
    }, /stream not found|invalid stream|stream closed/i);

    assert.throws(() => {
      cpal.resumeStream(stream);
    }, /stream not found|invalid stream|stream closed/i);
  });

  it('should handle device disconnection gracefully', async () => {
    // Create a stream with a device that will be "disconnected"
    const stream = cpal.createStream(device, false, config, () => {});
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    // Write some data
    cpal.writeToStream(stream, buffer);
    await sleep(50);

    // Simulate device disconnection by trying to use an invalid device
    const disconnectedDevice = { ...device, id: 'disconnected-device' };

    assert.throws(() => {
      cpal.createStream(disconnectedDevice, false, config, () => {});
    }, /device not found|invalid device|failed to downcast/i);

    // Verify that the original stream is still usable
    cpal.writeToStream(stream, buffer);
    await sleep(50);

    // Clean up
    cpal.closeStream(stream);
  }).timeout(5000);

  it('should handle resource limits gracefully', async () => {
    const maxStreams = 100; // Arbitrary limit for testing
    const streams = [];
    let lastSuccessfulStream = 0;

    try {
      for (let i = 0; i < maxStreams; i++) {
        try {
          const stream = cpal.createStream(device, false, config, () => {});
          streams.push(stream);
          lastSuccessfulStream = i + 1;
        } catch (e) {
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
      streams.forEach((stream) => {
        try {
          cpal.closeStream(stream);
        } catch (e) {
          console.error('Error closing stream:', e);
        }
      });
    }
  }).timeout(10000);

  it('should handle rapid stream state transitions', async () => {
    const stream = cpal.createStream(device, false, config, () => {});
    const iterations = 50;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.05
    );

    try {
      for (let i = 0; i < iterations; i++) {
        cpal.writeToStream(stream, buffer);
        assert(
          cpal.isStreamActive(stream),
          'Stream should be active after write'
        );

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

        await sleep(10);
      }
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(5000);
});
