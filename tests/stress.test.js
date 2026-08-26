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

describe('Stress Tests', () => {
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

  it('should handle long-running audio streams', async () => {
    const duration = 10; // 10 seconds
    const chunkDuration = 0.1; // 100ms chunks
    const startTime = Date.now();
    let samplesWritten = 0;

    await withTestStream(device, false, config, async (stream) => {
      while (Date.now() - startTime < duration * 1000) {
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

      const endTime = Date.now();
      const actualDuration = (endTime - startTime) / 1000;
      const expectedSamples = config.sampleRate * actualDuration;
      const sampleRateDeviation =
        Math.abs(samplesWritten - expectedSamples) / expectedSamples;

      console.log(`Expected samples: ${expectedSamples}`);
      console.log(`Actual samples written: ${samplesWritten}`);
      console.log(
        `Sample rate deviation: ${(sampleRateDeviation * 100).toFixed(2)}%`
      );

      // Allow for up to 20% deviation in data rate
      assert(
        sampleRateDeviation < 0.2,
        'Audio stream data rate is outside acceptable range'
      );
    });
  }).timeout(15000);

  it('should handle intensive stream operations', async () => {
    const streamCount = 10;
    const streams = [];
    const operations = 50;
    const startMemory = getMemoryUsage();

    try {
      // Create multiple streams
      for (let i = 0; i < streamCount; i++) {
        streams.push(
          cpal.createStream(device.deviceId, false, config, () => {})
        );
      }

      // Perform intensive operations
      for (let i = 0; i < operations; i++) {
        const streamIndex = i % streams.length;
        const frequency = 440 * ((i % 4) + 1);
        const buffer = generateSineWave(
          frequency,
          config.sampleRate,
          config.channels,
          0.1
        );

        cpal.writeToStream(streams[streamIndex], buffer);

        if (i % 2 === 0) {
          cpal.pauseStream(streams[streamIndex]);
          await sleep(10);
          cpal.resumeStream(streams[streamIndex]);
        }

        await sleep(10);
      }

      const endMemory = getMemoryUsage();
      console.log('Memory usage during intensive operations:');
      console.log('Start:', startMemory);
      console.log('End:', endMemory);

      assert(
        endMemory.heapUsed < startMemory.heapUsed * 2,
        'Memory usage increased significantly during stress test'
      );
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }
  }).timeout(20000);

  it('should handle rapid device switching', async function () {
    const outputDevices = cpal
      .getHosts()
      .flatMap((host) => cpal.getDevices(host.id))
      .map((outputDevice) => ({
        device: outputDevice,
        config: getTestConfig(outputDevice, false),
      }))
      .filter((entry) => entry.config);

    if (outputDevices.length < 2) {
      this.skip();
    }

    const streams = [];

    try {
      for (const entry of outputDevices.slice(0, 2)) {
        const stream = cpal.createStream(
          entry.device.deviceId,
          false,
          entry.config,
          () => {}
        );
        streams.push({ ...entry, stream });
      }

      for (let i = 0; i < 10; i++) {
        const entry = streams[i % streams.length];
        const buffer = generateSineWave(
          440,
          entry.config.sampleRate,
          entry.config.channels,
          0.1
        );
        cpal.writeToStream(entry.stream, buffer);
        await sleep(100);
      }
    } finally {
      streams.forEach((entry) => cpal.closeStream(entry.stream));
    }
  }).timeout(10000);

  it('should handle concurrent input/output streams', async function () {
    const inputDevice = getTestDevice(true);
    const outputDevice = getTestDevice(false);
    const inputConfig = getTestConfig(inputDevice, true);
    const outputConfig = getTestConfig(outputDevice, false);

    if (!inputDevice || !outputDevice || !inputConfig || !outputConfig) {
      this.skip();
    }

    let inputStream;
    let outputStream;

    try {
      outputStream = cpal.createStream(
        outputDevice.deviceId,
        false,
        outputConfig,
        () => {}
      );

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for input audio data')),
          2000
        );

        try {
          inputStream = cpal.createStream(
            inputDevice.deviceId,
            true,
            inputConfig,
            (data) => {
              try {
                assert(data instanceof Float32Array);
                assert(data.length > 0);
                clearTimeout(timeout);
                resolve();
              } catch (error) {
                clearTimeout(timeout);
                reject(error);
              }
            }
          );
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });

      assert(cpal.isStreamActive(inputStream));
      assert(cpal.isStreamActive(outputStream));
    } finally {
      if (inputStream) {
        cpal.closeStream(inputStream);
      }
      if (outputStream) {
        cpal.closeStream(outputStream);
      }
    }
  }).timeout(5000);

  it('should handle high-frequency stream creation/destruction', async () => {
    const iterations = 100;
    const startMemory = getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const stream = cpal.createStream(
        device.deviceId,
        false,
        config,
        () => {}
      );
      try {
        const buffer = generateSineWave(
          440,
          config.sampleRate,
          config.channels,
          0.05
        );
        cpal.writeToStream(stream, buffer);
      } finally {
        cpal.closeStream(stream);
      }
    }

    const endMemory = getMemoryUsage();
    console.log('Memory usage during high-frequency operations:');
    console.log('Start:', startMemory);
    console.log('End:', endMemory);

    // Check for memory leaks
    assert(
      endMemory.heapUsed < startMemory.heapUsed * 1.5,
      'Memory usage increased significantly during high-frequency operations'
    );
  }).timeout(15000);
});
