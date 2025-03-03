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

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
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
        streams.push(cpal.createStream(device, false, config, () => {}));
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
      console.log('Memory usage during intensive operations (MB):');
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

  it('should handle rapid device switching', async () => {
    const devices = cpal.getDevices(cpal.getHosts()[0]);
    const outputDevices = devices.filter((d) => !d.isDefaultInput);

    if (outputDevices.length < 2) {
      console.log('Not enough output devices for switching test, skipping');
      return;
    }

    const streams = [];
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    try {
      // Create streams for each device
      for (const device of outputDevices.slice(0, 2)) {
        const deviceConfig = getTestConfig(device);
        const stream = cpal.createStream(device, false, deviceConfig, () => {});
        streams.push(stream);
      }

      // Alternate between devices
      for (let i = 0; i < 10; i++) {
        const stream = streams[i % streams.length];
        cpal.writeToStream(stream, buffer);
        await sleep(100);
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
  }).timeout(10000);

  it('should handle concurrent input/output streams', async () => {
    const inputDevice = getTestDevice(true);
    const outputDevice = getTestDevice(false);
    const inputConfig = getTestConfig(inputDevice, true);
    const outputConfig = getTestConfig(outputDevice, false);
    let receivedData = false;

    // Create input stream
    const inputStream = cpal.createStream(
      inputDevice,
      true,
      inputConfig,
      (data) => {
        receivedData = true;
        // Echo the input data to the output stream
        if (outputStream) {
          cpal.writeToStream(outputStream, data);
        }
      }
    );

    // Create output stream
    const outputStream = cpal.createStream(
      outputDevice,
      false,
      outputConfig,
      () => {}
    );

    try {
      // Let the audio loop run for a while
      await sleep(2000);

      assert(receivedData, 'Should have received input data');
    } finally {
      cpal.closeStream(inputStream);
      cpal.closeStream(outputStream);
    }
  }).timeout(5000);

  it('should handle high-frequency stream creation/destruction', async () => {
    const iterations = 100;
    const startMemory = getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const stream = cpal.createStream(device, false, config, () => {});
      const buffer = generateSineWave(
        440,
        config.sampleRate,
        config.channels,
        0.05
      );
      cpal.writeToStream(stream, buffer);
      await sleep(10);
      cpal.closeStream(stream);
    }

    const endMemory = getMemoryUsage();
    console.log('Memory usage during high-frequency operations (MB):');
    console.log('Start:', startMemory);
    console.log('End:', endMemory);

    // Check for memory leaks
    assert(
      endMemory.heapUsed < startMemory.heapUsed * 1.5,
      'Memory usage increased significantly during high-frequency operations'
    );
  }).timeout(15000);
});
