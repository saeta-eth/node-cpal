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

describe('Performance Tests', () => {
  let device;
  let config;
  const STREAM_COUNT = 5;
  const ITERATION_COUNT = 50;
  const TEST_DURATION = 5000; // 5 seconds

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
  });

  it('should handle rapid stream creation/destruction', async () => {
    const streams = [];
    const startTime = Date.now();

    try {
      for (let i = 0; i < ITERATION_COUNT; i++) {
        const stream = cpal.createStream(device, false, config, () => {});
        streams.push(stream);

        // Write a small buffer to ensure stream is active
        const buffer = generateSineWave(
          440,
          config.sampleRate,
          config.channels,
          0.01
        );
        cpal.writeToStream(stream, buffer);

        await sleep(10);
      }
    } finally {
      // Clean up all streams
      streams.forEach((stream) => {
        try {
          cpal.closeStream(stream);
        } catch (e) {
          console.warn('Error closing stream:', e);
        }
      });
    }

    const endTime = Date.now();
    const timePerStream = (endTime - startTime) / ITERATION_COUNT;
    console.log(`Average time per stream: ${timePerStream.toFixed(2)}ms`);
  });

  it('should handle large audio buffers', async () => {
    const duration = 30; // 30 seconds of audio
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      duration
    );

    const startTime = Date.now();

    await withTestStream(device, false, config, async (stream) => {
      cpal.writeToStream(stream, buffer);
      await sleep(100); // Wait for buffer to start processing
    });

    const endTime = Date.now();
    const processingTime = endTime - startTime;
    console.log(`Time to process ${duration}s buffer: ${processingTime}ms`);

    // Processing time should be reasonable (less than actual audio duration)
    assert(
      processingTime < duration * 1000,
      'Processing time exceeded audio duration'
    );
  });

  it('should handle concurrent streams', async () => {
    const streams = [];
    const startMemory = getMemoryUsage();

    try {
      // Create multiple streams with different frequencies
      for (let i = 0; i < STREAM_COUNT; i++) {
        const stream = cpal.createStream(device, false, config, () => {});
        streams.push(stream);
      }

      // Write different frequencies to each stream
      for (let i = 0; i < streams.length; i++) {
        const frequency = 440 * (i + 1);
        const buffer = generateSineWave(
          frequency,
          config.sampleRate,
          config.channels,
          0.5
        );
        cpal.writeToStream(streams[i], buffer);
      }

      await sleep(1000); // Let streams play for a second

      // Check memory usage
      const endMemory = getMemoryUsage();
      const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
      console.log(
        `Memory usage increase: ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`
      );

      // Memory usage should not grow excessively
      assert(memoryDiff < 50 * 1024 * 1024, 'Excessive memory usage detected');
    } finally {
      // Clean up all streams
      streams.forEach((stream) => {
        try {
          cpal.closeStream(stream);
        } catch (e) {
          console.warn('Error closing stream:', e);
        }
      });
    }
  });

  it('should handle rapid audio writes', async () => {
    const writeCount = 100;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.01
    );

    await withTestStream(device, false, config, async (stream) => {
      const startTime = Date.now();

      for (let i = 0; i < writeCount; i++) {
        cpal.writeToStream(stream, buffer);
        await sleep(1); // Small delay to prevent overwhelming the stream
      }

      const endTime = Date.now();
      const timePerWrite = (endTime - startTime) / writeCount;
      console.log(`Average time per write: ${timePerWrite.toFixed(2)}ms`);

      // Each write should be reasonably fast
      assert(timePerWrite < 50, 'Write operations too slow');
    });
  });

  it('should maintain stable memory usage', async () => {
    const iterations = 20;
    const initialMemory = getMemoryUsage();
    const memorySnapshots = [];

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

      const currentMemory = getMemoryUsage();
      memorySnapshots.push(currentMemory.heapUsed);
    }

    // Calculate memory growth rate
    const memoryGrowth =
      memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0];
    const growthRate = memoryGrowth / iterations;
    console.log(
      `Memory growth rate: ${(growthRate / 1024 / 1024).toFixed(
        2
      )}MB per iteration`
    );

    // Memory growth should be minimal
    assert(growthRate < 1024 * 1024, 'Excessive memory growth detected');
  });

  it('should handle continuous audio streaming', async () => {
    const startTime = Date.now();
    let samplesWritten = 0;
    const expectedSampleCount = (config.sampleRate * TEST_DURATION) / 1000;
    const chunkDuration = 0.1; // 100ms chunks
    const chunkSize = Math.floor(config.sampleRate * chunkDuration);

    await withTestStream(device, false, config, async (stream) => {
      while (Date.now() - startTime < TEST_DURATION) {
        const buffer = generateSineWave(
          440,
          config.sampleRate,
          config.channels,
          chunkDuration
        );
        cpal.writeToStream(stream, buffer);
        samplesWritten += buffer.length / config.channels;
        await sleep(Math.floor(chunkDuration * 1000 * 0.9)); // Sleep slightly less than chunk duration
      }
    });

    // Verify sample rate consistency
    const actualDuration = Date.now() - startTime;
    const actualSampleRate = (samplesWritten * 1000) / actualDuration;
    const sampleRateDeviation =
      Math.abs(actualSampleRate - config.sampleRate) / config.sampleRate;

    console.log(`Expected sample rate: ${config.sampleRate}Hz`);
    console.log(`Actual sample rate: ${actualSampleRate.toFixed(2)}Hz`);
    console.log(
      `Sample rate deviation: ${(sampleRateDeviation * 100).toFixed(2)}%`
    );

    // Allow for more deviation (up to 20%) since this is a high-level test
    assert(
      sampleRateDeviation < 0.2,
      'Sample rate significantly different from expected'
    );
  });
});
