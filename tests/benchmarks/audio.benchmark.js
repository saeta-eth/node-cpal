const assert = require('assert');
const { performance } = require('perf_hooks');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  sleep,
  summarizeDurations,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

describe('Convenience audio benchmarks (report only)', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('reports object stream creation and teardown latency', async () => {
    const durations = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      const stream = await cpal.createOutputStream({
        deviceId: device.deviceId,
        config,
        onError() {},
      });
      await stream.close();
      durations.push(performance.now() - started);
    }
    console.log('stream lifecycle ms', summarizeDurations(durations));
  }).timeout(20_000);

  it('reports push write-call latency under backpressure', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      autoStart: true,
      onError() {},
    });
    const chunk = generateSineWave(440, config.sampleRate, config.channels, 0.01);
    const durations = [];
    try {
      for (let index = 0; index < 500; index++) {
        const started = performance.now();
        while (!stream.write(chunk)) await sleep(1);
        durations.push(performance.now() - started);
      }
    } finally {
      await stream.close();
    }
    const summary = summarizeDurations(durations);
    assert(summary.max >= summary.min);
    console.log('push write ms', summary);
  }).timeout(20_000);

  it('reports pull callback scheduling cadence', async () => {
    const callbackTimes = [];
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      mode: 'pull',
      autoStart: true,
      onData({ frames, channels }) {
        callbackTimes.push(performance.now());
        return new Float32Array(frames * channels);
      },
      onError() {},
    });
    try {
      await sleep(2000);
    } finally {
      await stream.close();
    }
    const intervals = callbackTimes.slice(1).map((time, index) =>
      time - callbackTimes[index]
    );
    assert(intervals.length > 0);
    console.log('pull callback interval ms', summarizeDurations(intervals));
  }).timeout(5000);
});
