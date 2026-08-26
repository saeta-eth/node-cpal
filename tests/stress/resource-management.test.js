const assert = require('assert');
const cpal = require('../..');
const {
  generateSineWave,
  assertStreamCreationThrows,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('../helpers/hardware');

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

  it('removes every repeatedly closed stream from the registry', async () => {
    const iterations = 10;
    const streamIds = new Set();

    for (let i = 0; i < iterations; i++) {
      let stream;
      await withTestStream(device, false, config, async (createdStream) => {
        stream = createdStream;
        assert(!streamIds.has(stream));
        streamIds.add(stream);
        cpal.writeToStream(
          stream,
          generateSineWave(440, config.sampleRate, config.channels, 0.01)
        );
        assert(cpal.isStreamActive(stream));
      });

      assert.strictEqual(cpal.isStreamActive(stream), false);
      assert.throws(
        () => cpal.pauseStream(stream),
        /stream not found|invalid stream|stream closed/i
      );
    }

    assert.strictEqual(streamIds.size, iterations);
  }).timeout(10000);

  it('supports a complete stream lifecycle', () => {
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
      0.01
    );

    try {
      cpal.writeToStream(stream, buffer);
      cpal.pauseStream(stream);
      assert.strictEqual(cpal.isStreamActive(stream), false);
      cpal.resumeStream(stream);
      assert.strictEqual(cpal.isStreamActive(stream), true);
      cpal.writeToStream(stream, buffer);
      cpal.closeStream(stream);

      assert.strictEqual(cpal.isStreamActive(stream), false);
      assert.throws(() => cpal.writeToStream(stream, buffer), /Stream not found/);
      assert.throws(() => cpal.pauseStream(stream), /Stream not found/);
      assert.throws(() => cpal.resumeStream(stream), /Stream not found/);
    } finally {
      cpal.closeStream(stream);
    }
  });

  it('rejects an invalid device without disrupting an open stream', () => {
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
      0.01
    );

    try {
      cpal.writeToStream(stream, buffer);
      assertStreamCreationThrows(
        () =>
          cpal.createStream('disconnected-device', false, config, () => {}),
        /Device not found/
      );
      cpal.writeToStream(stream, buffer);
      assert(cpal.isStreamActive(stream));
    } finally {
      cpal.closeStream(stream);
    }

    assert.strictEqual(cpal.isStreamActive(stream), false);
  });

  it('keeps every successfully allocated stream usable', () => {
    const maxAttempts = 32;
    const streams = [];
    let allocationError;

    try {
      for (let i = 0; i < maxAttempts; i++) {
        try {
          streams.push(
            cpal.createStream(device.deviceId, false, config, () => {})
          );
        } catch (error) {
          allocationError = error;
          break;
        }
      }

      assert(streams.length > 0, 'At least one stream should be available');
      assert.strictEqual(new Set(streams).size, streams.length);
      if (allocationError) {
        assert.match(allocationError.message, /Failed to build output stream/i);
      }

      const buffer = generateSineWave(
        440,
        config.sampleRate,
        config.channels,
        0.01
      );
      streams.forEach((stream) => {
        cpal.writeToStream(stream, buffer);
        assert(cpal.isStreamActive(stream));
      });
    } finally {
      streams.forEach((stream) => cpal.closeStream(stream));
    }

    streams.forEach((stream) => {
      assert.strictEqual(cpal.isStreamActive(stream), false);
    });
  }).timeout(10000);

  it('preserves state across rapid pause and resume cycles', () => {
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
        assert.strictEqual(cpal.isStreamActive(stream), false);
        cpal.resumeStream(stream);
        assert.strictEqual(cpal.isStreamActive(stream), true);
      }
      cpal.writeToStream(stream, buffer);
    } finally {
      cpal.closeStream(stream);
    }

    assert.strictEqual(cpal.isStreamActive(stream), false);
  }).timeout(10000);
});
