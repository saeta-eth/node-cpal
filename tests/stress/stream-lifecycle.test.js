const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  sleep,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience stream lifecycle stress', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('survives rapid play and pause transitions', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      onError() {},
    });
    try {
      for (let index = 0; index < 100; index++) {
        stream.play();
        assert.strictEqual(stream.state, 'playing');
        stream.pause();
        assert.strictEqual(stream.state, 'paused');
      }
    } finally {
      await stream.close();
    }
  }).timeout(10_000);

  it('supports sustained writes across state transitions', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onError() {},
    });
    const data = generateSineWave(440, config.sampleRate, config.channels, 0.01);
    try {
      for (let index = 0; index < 100; index++) {
        while (!stream.write(data)) await sleep(1);
        if (index % 10 === 0) {
          stream.pause();
          stream.play();
        }
        await sleep(5);
      }
      assert.strictEqual(stream.state, 'playing');
    } finally {
      await stream.close();
    }
  }).timeout(10_000);

  it('runs input and output stream objects concurrently', async function () {
    const inputDevice = getTestDevice(true);
    const inputConfig = getTestConfig(inputDevice, true);
    if (!inputDevice || !inputConfig) this.skip();

    const output = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onError() {},
    });
    let input;
    try {
      input = await cpal.createInputStream({
        deviceId: inputDevice.deviceId,
        config: inputConfig,
        autoStart: true,
        onData() {},
        onError() {},
      });
      assert.strictEqual(output.state, 'playing');
      assert.strictEqual(input.state, 'playing');
      assert.notStrictEqual(input, output);
    } finally {
      if (input) await input.close();
      await output.close();
    }
  });
});
