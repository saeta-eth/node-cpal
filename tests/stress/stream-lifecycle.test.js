const assert = require('assert');
const cpal = require('../..');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('../helpers/hardware');

describe('Stream Lifecycle Stress Tests', () => {
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

  it('keeps one stream active for an exact long-running workload', async () => {
    const chunkCount = 100;
    const chunkDuration = 0.1;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      chunkDuration
    );
    let framesWritten = 0;

    await withTestStream(device, false, config, async (stream) => {
      for (let i = 0; i < chunkCount; i++) {
        cpal.writeToStream(stream, buffer);
        framesWritten += buffer.length / config.channels;
        assert(cpal.isStreamActive(stream));
        await sleep(chunkDuration * 1000);
      }
    });

    assert.strictEqual(
      framesWritten,
      Math.floor(config.sampleRate * chunkDuration) * chunkCount
    );
  }).timeout(15000);

  it('preserves independent state during intensive operations', () => {
    const streamCount = 10;
    const operationCount = 50;
    const streams = [];
    let completedOperations = 0;

    try {
      for (let i = 0; i < streamCount; i++) {
        streams.push(
          cpal.createStream(device.deviceId, false, config, () => {})
        );
      }
      assert.strictEqual(new Set(streams).size, streamCount);

      for (let i = 0; i < operationCount; i++) {
        const stream = streams[i % streams.length];
        const buffer = generateSineWave(
          440 * ((i % 4) + 1),
          config.sampleRate,
          config.channels,
          0.01
        );
        cpal.writeToStream(stream, buffer);

        if (i % 2 === 0) {
          cpal.pauseStream(stream);
          assert.strictEqual(cpal.isStreamActive(stream), false);
          cpal.resumeStream(stream);
        }
        assert.strictEqual(cpal.isStreamActive(stream), true);
        completedOperations++;
      }
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }

    assert.strictEqual(completedOperations, operationCount);
    streams.forEach((stream) => {
      assert.strictEqual(cpal.isStreamActive(stream), false);
    });
  }).timeout(20000);

  it('switches between two output devices when available', async function () {
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
    let completedWrites = 0;
    const bufferDuration = 0.1;

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
      assert.strictEqual(new Set(streams.map((entry) => entry.stream)).size, 2);

      for (let i = 0; i < 10; i++) {
        const entry = streams[i % streams.length];
        const buffer = generateSineWave(
          440,
          entry.config.sampleRate,
          entry.config.channels,
          bufferDuration
        );
        cpal.writeToStream(entry.stream, buffer);
        assert(cpal.isStreamActive(entry.stream));
        completedWrites++;
        await sleep(bufferDuration * 1000);
      }
    } finally {
      streams.forEach((entry) => cpal.closeStream(entry.stream));
    }

    assert.strictEqual(completedWrites, 10);
    streams.forEach((entry) => {
      assert.strictEqual(cpal.isStreamActive(entry.stream), false);
    });
  }).timeout(10000);

  it('runs concurrent input and output streams when available', async function () {
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

      assert.notStrictEqual(inputStream, outputStream);
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

    assert.strictEqual(cpal.isStreamActive(inputStream), false);
    assert.strictEqual(cpal.isStreamActive(outputStream), false);
  }).timeout(5000);

  it('creates and destroys streams at high frequency', () => {
    const iterations = 100;
    const streamIds = new Set();
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.01
    );

    for (let i = 0; i < iterations; i++) {
      let stream;
      try {
        stream = cpal.createStream(
          device.deviceId,
          false,
          config,
          () => {}
        );
        assert(!streamIds.has(stream));
        streamIds.add(stream);
        assert(cpal.isStreamActive(stream));
        cpal.writeToStream(stream, buffer);
      } finally {
        if (stream) {
          cpal.closeStream(stream);
          assert.strictEqual(cpal.isStreamActive(stream), false);
        }
      }
    }

    assert.strictEqual(streamIds.size, iterations);
  }).timeout(15000);
});
