const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  sleep,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience output buffer stress', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('accepts varying complete-frame buffer sizes', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onError() {},
    });
    try {
      for (const frames of [1, 32, 127, 256, 1024, 4096]) {
        const data = new Float32Array(frames * config.channels);
        while (!stream.write(data)) await sleep(2);
      }
    } finally {
      await stream.close();
    }
  });

  it('recovers repeatedly from bounded queue backpressure', async () => {
    let drainCount = 0;
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      queueCapacityBuffers: 2,
      autoStart: true,
      onDrain() {
        drainCount++;
      },
      onError() {},
    });
    const data = generateSineWave(330, config.sampleRate, config.channels, 0.02);
    try {
      let accepted = 0;
      while (accepted < 100) {
        if (stream.write(data)) accepted++;
        else await sleep(2);
      }
      assert.strictEqual(accepted, 100);
      assert(drainCount > 0);
    } finally {
      await stream.close();
    }
  }).timeout(10_000);

  it('keeps pull prefetch bounded during sustained playback', async () => {
    let requests = 0;
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      mode: 'pull',
      prefetchBuffers: 4,
      autoStart: true,
      onData({ frames, channels }) {
        requests++;
        return new Float32Array(frames * channels);
      },
      onError() {},
    });
    try {
      await sleep(1000);
      assert(requests > 4);
      assert(stream.bufferedFrames <= stream.bufferSize() * 6);
    } finally {
      await stream.close();
    }
  }).timeout(5000);
});
