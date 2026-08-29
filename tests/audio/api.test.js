const assert = require('assert');
const cpal = require('../..').convenience;
const {
  generateSineWave,
  getTestConfig,
  getTestDevice,
} = require('../helpers/hardware');

const SAMPLE_FORMATS = new Set([
  'i8', 'i16', 'i24', 'i32', 'i64',
  'u8', 'u16', 'u24', 'u32', 'u64',
  'f32', 'f64', 'dsdu8', 'dsdu16', 'dsdu32',
]);

function assertDevice(device) {
  assert(device.name.length > 0);
  assert(device.deviceId.length > 0);
  assert(device.hostId.length > 0);
  assert.strictEqual(typeof device.supportsInput, 'boolean');
  assert.strictEqual(typeof device.supportsOutput, 'boolean');
  assert.strictEqual(typeof device.supportsLoopback, 'boolean');
  assert.strictEqual(typeof device.deviceType, 'string');
  assert.strictEqual(typeof device.interfaceType, 'string');
  assert(Array.isArray(device.extended));
}

function assertSupportedConfig(config) {
  assert(config.channels > 0);
  assert(config.minSampleRate > 0);
  assert(config.maxSampleRate >= config.minSampleRate);
  assert(SAMPLE_FORMATS.has(config.sampleFormat));
  assert(['range', 'unknown'].includes(config.bufferSize.type));
}

describe('Convenience audio API', () => {
  it('enumerates hosts, filters devices, and resolves stable IDs', function () {
    const hosts = cpal.getHosts();
    assert(hosts.length > 0);
    let count = 0;

    for (const host of hosts) {
      const devices = cpal.getDevices({ hostId: host.id });
      const inputs = cpal.getDevices({ hostId: host.id, direction: 'input' });
      const outputs = cpal.getDevices({ hostId: host.id, direction: 'output' });
      inputs.forEach((device) => assert(device.supportsInput));
      outputs.forEach((device) => assert(device.supportsOutput));
      for (const device of devices) {
        assertDevice(device);
        assert.strictEqual(device.hostId, host.id);
        assert.strictEqual(
          cpal.getDeviceById(device.deviceId).deviceId,
          device.deviceId
        );
        count++;
      }
    }

    if (count === 0) this.skip();
  });

  it('exposes complete input and output configuration metadata', function () {
    const input = getTestDevice(true);
    const output = getTestDevice(false);
    if (!input && !output) this.skip();

    for (const [device, direction] of [[input, 'input'], [output, 'output']]) {
      if (!device) continue;
      const configs = direction === 'input'
        ? cpal.getSupportedInputConfigs(device.deviceId)
        : cpal.getSupportedOutputConfigs(device.deviceId);
      configs.forEach(assertSupportedConfig);
      const defaultConfig = direction === 'input'
        ? cpal.getDefaultInputConfig(device.deviceId)
        : cpal.getDefaultOutputConfig(device.deviceId);
      assert(SAMPLE_FORMATS.has(defaultConfig.sampleFormat));
      assert.strictEqual(defaultConfig.bufferSize.type, 'default');
      assert(['range', 'unknown'].includes(defaultConfig.supportedBufferSize.type));
    }
  });

  it('creates a paused output object and exposes stream timing and sizing', async function () {
    const device = getTestDevice(false);
    const config = getTestConfig(device, false);
    if (!device || !config) this.skip();

    const errors = [];
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      onError: (error) => errors.push(error),
    });
    try {
      assert(stream instanceof cpal.PushOutputStream);
      assert.strictEqual(stream.state, 'paused');
      assert.strictEqual(typeof stream.now(), 'bigint');
      assert(stream.bufferSize() > 0);
      assert.strictEqual(
        stream.write(generateSineWave(440, config.sampleRate, config.channels, 0.02)),
        true
      );
      stream.play();
      assert.strictEqual(stream.state, 'playing');
      stream.pause();
      assert.strictEqual(stream.state, 'paused');
      assert(errors.every((error) => error instanceof cpal.CpalError));
    } finally {
      await stream.close();
    }
    assert.strictEqual(stream.state, 'closed');
  });

  it('delivers typed input buffers with exact timestamps', async function () {
    const device = getTestDevice(true);
    const config = getTestConfig(device, true);
    if (!device || !config) this.skip();

    let stream;
    let timeout;
    try {
      let resolveReceived;
      let rejectReceived;
      const received = new Promise((resolve, reject) => {
        resolveReceived = resolve;
        rejectReceived = reject;
      });
      timeout = setTimeout(
        () => rejectReceived(new Error('input timeout')),
        3000
      );
      stream = await cpal.createInputStream({
        deviceId: device.deviceId,
        config,
        onData(data, info) {
          resolveReceived({ data, info });
        },
        onError(error) {
          rejectReceived(error);
        },
      });
      stream.play();
      const { data, info } = await received;
      assert(data instanceof Float32Array);
      assert(data.length > 0);
      assert(info.frames > 0);
      assert.strictEqual(typeof info.callbackTimeNs, 'bigint');
      assert.strictEqual(typeof info.captureTimeNs, 'bigint');
    } finally {
      clearTimeout(timeout);
      if (stream) await stream.close();
    }
  }).timeout(5000);

  it('advertises and opens desktop loopback capture where supported', async function () {
    const device = getTestDevice(false);
    const config = getTestConfig(device, false);
    if (!device || !config || !device.supportsLoopback) this.skip();

    assert(cpal.getSupportedLoopbackConfigs(device.deviceId).length > 0);
    const stream = await cpal.createLoopbackStream({
      deviceId: device.deviceId,
      config,
      onData() {},
      onError() {},
    });
    assert.strictEqual(stream.direction, 'input');
    await stream.close();
  });
});
