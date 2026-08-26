const assert = require('assert');
const cpal = require('../');
const os = require('os');
const { getTestConfig, getTestDevice } = require('./utils');

const SAMPLE_FORMATS = new Set([
  'i8',
  'i16',
  'i24',
  'i32',
  'i64',
  'u8',
  'u16',
  'u24',
  'u32',
  'u64',
  'f32',
  'f64',
  'dsdu8',
  'dsdu16',
  'dsdu32',
]);

describe('Cross-Platform Tests', () => {
  let device;
  let config;

  before(() => {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
  });

  it('should identify correct host API for platform', () => {
    const hostNames = cpal.getHosts().map((host) => host.name);

    switch (os.platform()) {
      case 'darwin':
        assert(hostNames.includes('CoreAudio'));
        break;
      case 'win32':
        assert(hostNames.some((name) => ['WASAPI', 'ASIO'].includes(name)));
        break;
      case 'linux':
        assert(hostNames.some((name) => ['ALSA', 'JACK'].includes(name)));
        break;
    }
  });

  it('should expose valid platform sample formats', function () {
    if (!device) {
      this.skip();
    }

    const supportedFormats = cpal.getSupportedFormats(device.deviceId);
    const outputConfigs = cpal.getSupportedOutputConfigs(device.deviceId);

    assert(supportedFormats.length > 0, 'Should expose at least one format');
    assert.strictEqual(
      new Set(supportedFormats).size,
      supportedFormats.length,
      'Supported formats should be unique'
    );
    supportedFormats.forEach((format) => {
      assert(SAMPLE_FORMATS.has(format), `Unexpected CPAL format: ${format}`);
    });
    outputConfigs.forEach((outputConfig) => {
      assert(
        supportedFormats.includes(outputConfig.format),
        `Missing output format: ${outputConfig.format}`
      );
    });
  });

  it('should expose sample-rate boundaries from device capabilities', function () {
    if (!device) {
      this.skip();
    }

    const supportedRates = cpal.getSupportedSampleRates(device.deviceId);
    const outputConfigs = cpal.getSupportedOutputConfigs(device.deviceId);
    const sortedRates = [...supportedRates].sort((a, b) => a - b);

    assert(supportedRates.length > 0, 'Should expose supported sample rates');
    assert.deepStrictEqual(supportedRates, sortedRates);
    assert.strictEqual(new Set(supportedRates).size, supportedRates.length);
    supportedRates.forEach((rate) => {
      assert(Number.isInteger(rate));
      assert(rate > 0);
    });
    outputConfigs.forEach((outputConfig) => {
      assert(supportedRates.includes(outputConfig.minSampleRate));
      assert(supportedRates.includes(outputConfig.maxSampleRate));
    });
  });

  it('should report the maximum available channel count', function () {
    if (!device) {
      this.skip();
    }

    const configs = cpal.getSupportedOutputConfigs(device.deviceId);
    try {
      configs.push(...cpal.getSupportedInputConfigs(device.deviceId));
    } catch (error) {
      if (!/does not support input/i.test(error.message)) {
        throw error;
      }
    }

    const expectedMaxChannels = Math.max(
      ...configs.map((supportedConfig) => supportedConfig.channels)
    );
    assert.strictEqual(cpal.getMaxChannels(device.deviceId), expectedMaxChannels);
  });

  it('should handle platform-specific error cases', function () {
    if (!device || !config) {
      this.skip();
    }

    assert.throws(() => {
      cpal.createStream('invalid-device', false, config, () => {});
    }, /Device not found/);

    const invalidConfig = {
      channels: 999,
      sampleRate: 999999999,
      format: 'invalid-format',
    };
    assert.throws(() => {
      cpal.createStream(device.deviceId, false, invalidConfig, () => {});
    }, /Failed to build output stream:.*not supported/i);

    assert.throws(() => {
      cpal.createStream(device.deviceId, true, config, 'not-a-function');
    }, /failed to downcast any to function/i);
  });

  it('should expose device identifiers for the selected host', function () {
    const hosts = cpal.getHosts();
    const host = hosts[0];
    const devices = cpal.getDevices(host.id);

    if (devices.length === 0) {
      this.skip();
    }

    devices.forEach((hostDevice) => {
      assert.strictEqual(typeof hostDevice.name, 'string');
      assert(hostDevice.name.length > 0);
      assert.strictEqual(typeof hostDevice.deviceId, 'string');
      assert(hostDevice.deviceId.length > 0);
      assert.strictEqual(hostDevice.hostId, host.id);
    });
  });
});
