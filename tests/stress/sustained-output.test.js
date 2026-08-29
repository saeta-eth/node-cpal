const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  sleep,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience sustained output', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('queues an exact long-running frame count', async () => {
    const chunkCount = 100;
    const chunkDuration = 0.01;
    const chunk = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      chunkDuration
    );
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onError() {},
    });
    let frames = 0;
    try {
      for (let index = 0; index < chunkCount; index++) {
        while (!stream.write(chunk)) await sleep(1);
        frames += chunk.length / config.channels;
        await sleep(5);
      }
    } finally {
      await stream.close();
    }
    assert.strictEqual(
      frames,
      Math.floor(config.sampleRate * chunkDuration) * chunkCount
    );
  }).timeout(10_000);

  it('runs multiple pull streams independently when the backend permits it', async function () {
    const streams = [];
    try {
      for (let index = 0; index < 3; index++) {
        streams.push(await cpal.createOutputStream({
          deviceId: device.deviceId,
          config,
          mode: 'pull',
          autoStart: true,
          onData({ frames, channels }) {
            return new Float32Array(frames * channels);
          },
          onError() {},
        }));
      }
      await sleep(500);
      streams.forEach((stream) => assert.strictEqual(stream.state, 'playing'));
    } catch (error) {
      if (error.code === 'DEVICE_BUSY') this.skip();
      throw error;
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  }).timeout(5000);
});
