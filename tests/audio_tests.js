const cpal = require('../');
const assert = require('assert');
const {
  generateSineWave,
  getTestConfig,
  getTestDevice,
} = require('./utils');

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

function assertDevice(device) {
  assert.strictEqual(typeof device.name, 'string');
  assert(device.name.length > 0, 'Device should have a name');
  assert.strictEqual(typeof device.deviceId, 'string');
  assert(device.deviceId.length > 0, 'Device should have an ID');
  assert.strictEqual(typeof device.hostId, 'string');
  assert.strictEqual(typeof device.isDefaultInput, 'boolean');
  assert.strictEqual(typeof device.isDefaultOutput, 'boolean');
}

function assertSupportedConfig(config) {
  assert(config.channels > 0, 'Should have a valid channel count');
  assert(config.minSampleRate > 0, 'Should have a valid minimum sample rate');
  assert(
    config.maxSampleRate >= config.minSampleRate,
    'Maximum sample rate should be >= minimum'
  );
  assert(
    SAMPLE_FORMATS.has(config.format),
    `Should expose a valid CPAL format, received ${config.format}`
  );
}

function assertDefaultConfig(config) {
  assert(config.channels > 0, 'Should have a valid channel count');
  assert(config.sampleRate > 0, 'Should have a valid sample rate');
  assert(
    SAMPLE_FORMATS.has(config.sampleFormat),
    `Should expose a valid CPAL format, received ${config.sampleFormat}`
  );
}

describe('CPAL Audio Tests', () => {
  describe('Host Management', () => {
    it('should list available hosts', () => {
      const hosts = cpal.getHosts();
      assert(Array.isArray(hosts), 'Hosts should be an array');
      assert(hosts.length > 0, 'Should have at least one host');

      for (const host of hosts) {
        assert.strictEqual(typeof host.id, 'string');
        assert(host.id.length > 0, 'Host should have an ID');
        assert.strictEqual(typeof host.name, 'string');
        assert(host.name.length > 0, 'Host should have a name');
      }
    });

    it('should list devices for each host', function () {
      const hosts = cpal.getHosts();
      let deviceCount = 0;

      for (const host of hosts) {
        const devices = cpal.getDevices(host.id);
        assert(Array.isArray(devices), 'Devices should be an array');

        for (const device of devices) {
          assertDevice(device);
          assert.strictEqual(device.hostId, host.id);
          deviceCount++;
        }
      }

      if (deviceCount === 0) {
        this.skip();
      }
    });
  });

  describe('Device Management', () => {
    let defaultInputDevice;
    let defaultOutputDevice;

    before(() => {
      defaultInputDevice = getTestDevice(true);
      defaultOutputDevice = getTestDevice(false);
    });

    it('should get default output device', function () {
      if (!defaultOutputDevice) {
        this.skip();
      }
      assertDevice(defaultOutputDevice);
      assert.strictEqual(defaultOutputDevice.isDefaultOutput, true);
    });

    it('should get default input device if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }
      assertDevice(defaultInputDevice);
      assert.strictEqual(defaultInputDevice.isDefaultInput, true);
    });

    it('should get supported output configurations', function () {
      if (!defaultOutputDevice) {
        this.skip();
      }

      const configs = cpal.getSupportedOutputConfigs(
        defaultOutputDevice.deviceId
      );
      assert(Array.isArray(configs), 'Configs should be an array');
      assert(configs.length > 0, 'Should have at least one config');
      configs.forEach(assertSupportedConfig);
    });

    it('should get supported input configurations if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }

      const configs = cpal.getSupportedInputConfigs(defaultInputDevice.deviceId);
      assert(Array.isArray(configs), 'Configs should be an array');
      assert(configs.length > 0, 'Should have at least one config');
      configs.forEach(assertSupportedConfig);
    });

    it('should get default output configuration', function () {
      if (!defaultOutputDevice) {
        this.skip();
      }

      const config = cpal.getDefaultOutputConfig(
        defaultOutputDevice.deviceId
      );
      assertDefaultConfig(config);
    });

    it('should get default input configuration if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }

      const config = cpal.getDefaultInputConfig(defaultInputDevice.deviceId);
      assertDefaultConfig(config);
    });
  });

  describe('Stream Management', () => {
    let inputDevice;
    let outputDevice;
    let inputConfig;
    let outputConfig;
    const streams = new Set();

    function trackStream(stream) {
      streams.add(stream);
      return stream;
    }

    before(() => {
      inputDevice = getTestDevice(true);
      outputDevice = getTestDevice(false);
      inputConfig = getTestConfig(inputDevice, true);
      outputConfig = getTestConfig(outputDevice, false);
    });

    afterEach(() => {
      for (const stream of streams) {
        cpal.closeStream(stream);
      }
      streams.clear();
    });

    it('should create an input stream if available', async function () {
      if (!inputDevice || !inputConfig) {
        this.skip();
      }

      let inputStream;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for input audio data')),
          2000
        );

        inputStream = trackStream(
          cpal.createStream(
            inputDevice.deviceId,
            true,
            inputConfig,
            (data) => {
              try {
                assert(
                  data instanceof Float32Array,
                  'Should receive Float32Array data'
                );
                assert(data.length > 0, 'Should receive non-empty data');
                clearTimeout(timeout);
                resolve();
              } catch (error) {
                clearTimeout(timeout);
                reject(error);
              }
            }
          )
        );
      });

      assert.strictEqual(typeof inputStream, 'string');
      assert(cpal.isStreamActive(inputStream));
    }).timeout(5000);

    it('should create an output stream', function () {
      if (!outputDevice || !outputConfig) {
        this.skip();
      }

      const outputStream = trackStream(
        cpal.createStream(
          outputDevice.deviceId,
          false,
          outputConfig,
          () => {}
        )
      );
      assert.strictEqual(typeof outputStream, 'string');
      assert(outputStream.length > 0, 'Should return a stream ID');
      assert(cpal.isStreamActive(outputStream));
    });

    it('should write to an output stream', function () {
      if (!outputDevice || !outputConfig) {
        this.skip();
      }

      const outputStream = trackStream(
        cpal.createStream(
          outputDevice.deviceId,
          false,
          outputConfig,
          () => {}
        )
      );
      const data = generateSineWave(
        440,
        outputConfig.sampleRate,
        outputConfig.channels,
        0.1
      );

      cpal.writeToStream(outputStream, data);
      assert(cpal.isStreamActive(outputStream));
    });

    it('should pause and resume a stream', function () {
      if (!outputDevice || !outputConfig) {
        this.skip();
      }

      const outputStream = trackStream(
        cpal.createStream(
          outputDevice.deviceId,
          false,
          outputConfig,
          () => {}
        )
      );
      cpal.pauseStream(outputStream);
      assert.strictEqual(cpal.isStreamActive(outputStream), false);
      cpal.resumeStream(outputStream);
      assert.strictEqual(cpal.isStreamActive(outputStream), true);
    });

    it('should close a stream', function () {
      if (!outputDevice || !outputConfig) {
        this.skip();
      }

      const outputStream = trackStream(
        cpal.createStream(
          outputDevice.deviceId,
          false,
          outputConfig,
          () => {}
        )
      );
      cpal.closeStream(outputStream);
      streams.delete(outputStream);
      assert.strictEqual(cpal.isStreamActive(outputStream), false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid device IDs', () => {
      assert.throws(() => {
        cpal.getSupportedInputConfigs('invalid-device-id');
      }, /Device not found/);
    });

    it('should handle invalid stream IDs', () => {
      assert.throws(() => {
        cpal.pauseStream('invalid-stream-id');
      }, /Stream not found/);
    });

    it('should handle invalid configurations', function () {
      const device = getTestDevice(false);
      if (!device) {
        this.skip();
      }

      assert.throws(() => {
        cpal.createStream(
          device.deviceId,
          false,
          {
            channels: 0,
            sampleRate: 0,
            format: 'invalid',
          },
          () => {}
        );
      }, /Failed to build output stream|invalid configuration/i);
    });
  });
});
