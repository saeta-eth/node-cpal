const assert = require('assert');
const cpal = require('../..');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('../helpers/hardware');

describe('Sustained Output Tests', () => {
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

  it('creates and closes repeated streams with unique IDs', async () => {
    const iterations = 20;
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
        assert.strictEqual(typeof stream, 'string');
        assert(!streamIds.has(stream), 'Stream IDs should be unique');
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
  }).timeout(10000);

  it('accepts a large Float32 buffer', async () => {
    const duration = 5;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      duration
    );

    assert.strictEqual(
      buffer.length,
      config.sampleRate * config.channels * duration
    );
    await withTestStream(device, false, config, async (stream) => {
      cpal.writeToStream(stream, buffer);
      assert(cpal.isStreamActive(stream));
    });
  });

  it('keeps concurrent streams independent', async () => {
    const streamCount = 5;
    const bufferDuration = 0.1;
    const streams = [];

    try {
      for (let i = 0; i < streamCount; i++) {
        const stream = cpal.createStream(
          device.deviceId,
          false,
          config,
          () => {}
        );
        streams.push(stream);
      }

      assert.strictEqual(new Set(streams).size, streamCount);
      for (let i = 0; i < streams.length; i++) {
        const buffer = generateSineWave(
          440 * (i + 1),
          config.sampleRate,
          config.channels,
          bufferDuration
        );
        cpal.writeToStream(streams[i], buffer);
        assert(cpal.isStreamActive(streams[i]));
      }
      await sleep(bufferDuration * 1000);
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }

    streams.forEach((stream) => {
      assert.strictEqual(cpal.isStreamActive(stream), false);
    });
  });

  it('handles sustained real-time writes', async () => {
    const writeCount = 100;
    const bufferDuration = 0.01;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      bufferDuration
    );
    let completedWrites = 0;

    await withTestStream(device, false, config, async (stream) => {
      for (let i = 0; i < writeCount; i++) {
        cpal.writeToStream(stream, buffer);
        completedWrites++;
        assert(cpal.isStreamActive(stream));
        await sleep(bufferDuration * 1000);
      }
    });

    assert.strictEqual(completedWrites, writeCount);
  });

  it('queues an exact number of continuous audio frames', async () => {
    const chunkCount = 50;
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
        await sleep(chunkDuration * 1000);
      }
      assert(cpal.isStreamActive(stream));
    });

    assert.strictEqual(
      framesWritten,
      Math.floor(config.sampleRate * chunkDuration) * chunkCount
    );
  }).timeout(10000);
});
