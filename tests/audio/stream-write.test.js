const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience stream output', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('writes complete frames and reports buffered frames', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      onError() {},
    });
    try {
      const data = generateSineWave(440, config.sampleRate, config.channels, 0.1);
      assert.strictEqual(stream.write(data), true);
      assert.strictEqual(stream.bufferedFrames, data.length / config.channels);
      stream.play();
    } finally {
      await stream.close();
    }
  });

  it('uses boolean backpressure and emits drain when writable again', async () => {
    let resolveDrain;
    const drained = new Promise((resolve) => {
      resolveDrain = resolve;
    });
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      queueCapacityBuffers: 2,
      onDrain: resolveDrain,
      onError() {},
    });
    try {
      const data = generateSineWave(220, config.sampleRate, config.channels, 0.05);
      assert.strictEqual(stream.write(data), true);
      assert.strictEqual(stream.write(data), true);
      assert.strictEqual(stream.write(data), false);
      stream.play();
      await Promise.race([
        drained,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('drain timeout')), 3000)
        ),
      ]);
      assert.strictEqual(stream.write(data), true);
    } finally {
      await stream.close();
    }
  }).timeout(5000);

  it('reports output timestamps and underrun frame counts', async () => {
    let resolveOutput;
    const output = new Promise((resolve) => {
      resolveOutput = resolve;
    });
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onOutput: resolveOutput,
      onError() {},
    });
    try {
      const info = await Promise.race([
        output,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('output callback timeout')), 3000)
        ),
      ]);
      assert(info.frames > 0);
      assert.strictEqual(typeof info.callbackTimeNs, 'bigint');
      assert.strictEqual(typeof info.playbackTimeNs, 'bigint');
      assert(Number.isInteger(info.underrunFrames));
    } finally {
      await stream.close();
    }
  }).timeout(5000);

  it('prefetches and sustains pull output without calling JS on the audio thread', async () => {
    let requestCount = 0;
    let resolveRequests;
    const requested = new Promise((resolve) => {
      resolveRequests = resolve;
    });
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      mode: 'pull',
      prefetchBuffers: 3,
      autoStart: true,
      onData({ frames, channels }) {
        requestCount++;
        if (requestCount >= 5) resolveRequests();
        return new Float32Array(frames * channels);
      },
      onError() {},
    });
    try {
      assert(requestCount >= 3);
      await Promise.race([
        requested,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('pull callback timeout')), 3000)
        ),
      ]);
    } finally {
      await stream.close();
    }
  }).timeout(5000);
});
