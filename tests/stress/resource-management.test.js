const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  getMemoryUsage,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience resource management stress', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('creates and closes streams repeatedly without retaining live state', async () => {
    const streams = [];
    for (let index = 0; index < 50; index++) {
      const stream = await cpal.createOutputStream({
        deviceId: device.deviceId,
        config,
        onError() {},
      });
      streams.push(stream);
      await stream.close();
      assert.strictEqual(stream.state, 'closed');
    }
    assert.strictEqual(new Set(streams).size, streams.length);
  }).timeout(20_000);

  it('keeps concurrently open stream state independent', async () => {
    const streams = await Promise.all(
      Array.from({ length: 6 }, () => cpal.createOutputStream({
        deviceId: device.deviceId,
        config,
        onError() {},
      }))
    );
    try {
      streams.forEach((stream, index) => {
        if (index % 2 === 0) stream.play();
      });
      streams.forEach((stream, index) => {
        assert.strictEqual(stream.state, index % 2 === 0 ? 'playing' : 'paused');
      });
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  });

  it('does not leak unbounded memory during repeated queued writes', async () => {
    const before = getMemoryUsage().rss;
    const data = generateSineWave(440, config.sampleRate, config.channels, 0.01);

    for (let round = 0; round < 10; round++) {
      const stream = await cpal.createOutputStream({
        deviceId: device.deviceId,
        config,
        autoStart: true,
        onError() {},
      });
      for (let write = 0; write < 20; write++) {
        stream.write(data);
      }
      await stream.close();
    }

    const growth = getMemoryUsage().rss - before;
    assert(growth < 128 * 1024 * 1024, `RSS grew by ${growth} bytes`);
  }).timeout(20_000);
});
