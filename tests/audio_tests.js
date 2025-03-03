const cpal = require('../');
const assert = require('assert');

// Utility function to sleep for a given duration
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test configuration
const TEST_DURATION = 2000; // 2 seconds for audio tests
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

describe('CPAL Audio Tests', () => {
  // Host enumeration tests
  describe('Host Management', () => {
    it('should list available hosts', () => {
      const hosts = cpal.getHosts();
      assert(Array.isArray(hosts), 'Hosts should be an array');
      assert(hosts.length > 0, 'Should have at least one host');
      assert.strictEqual(
        hosts[0],
        'CoreAudio',
        'Should have CoreAudio host on macOS'
      );
    });

    it('should list devices for each host', () => {
      const hosts = cpal.getHosts();
      for (const host of hosts) {
        const devices = cpal.getDevices(host);
        assert(Array.isArray(devices), 'Devices should be an array');
        assert(devices.length > 0, 'Should have at least one device');

        // Check device object structure
        const device = devices[0];
        assert(device.id, 'Device should have an ID');
        assert(device.name, 'Device should have a name');
        assert(
          typeof device.isDefaultInput === 'boolean',
          'Device should indicate if it is default input'
        );
        assert(
          typeof device.isDefaultOutput === 'boolean',
          'Device should indicate if it is default output'
        );
      }
    });
  });

  // Device management tests
  describe('Device Management', () => {
    let defaultInputDevice;
    let defaultOutputDevice;

    before(() => {
      try {
        defaultInputDevice = cpal.getDefaultInputDevice();
      } catch (e) {
        console.log('No input device available:', e.message);
      }
      defaultOutputDevice = cpal.getDefaultOutputDevice();
    });

    it('should get default output device', () => {
      assert(defaultOutputDevice, 'Should have a default output device');
    });

    it('should get default input device if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }
      assert(defaultInputDevice, 'Should have a default input device');
    });

    it('should get supported output configurations', () => {
      const configs = cpal.getSupportedOutputConfigs(defaultOutputDevice);
      assert(Array.isArray(configs), 'Configs should be an array');
      assert(configs.length > 0, 'Should have at least one config');

      const config = configs[0];
      assert(config.channels > 0, 'Should have valid channel count');
      assert(config.minSampleRate > 0, 'Should have valid minimum sample rate');
      assert(
        config.maxSampleRate >= config.minSampleRate,
        'Maximum sample rate should be >= minimum'
      );
      assert(
        ['f32', 'i16', 'u16'].includes(config.format),
        'Should have valid format'
      );
    });

    it('should get supported input configurations if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }
      const configs = cpal.getSupportedInputConfigs(defaultInputDevice);
      assert(Array.isArray(configs), 'Configs should be an array');
      assert(configs.length > 0, 'Should have at least one config');

      const config = configs[0];
      assert(config.channels > 0, 'Should have valid channel count');
      assert(config.minSampleRate > 0, 'Should have valid minimum sample rate');
      assert(
        config.maxSampleRate >= config.minSampleRate,
        'Maximum sample rate should be >= minimum'
      );
      assert(
        ['f32', 'i16', 'u16'].includes(config.format),
        'Should have valid format'
      );
    });

    it('should get default output configuration', () => {
      const config = cpal.getDefaultOutputConfig(defaultOutputDevice);
      assert(config.channels > 0, 'Should have valid channel count');
      assert(config.sampleRate > 0, 'Should have valid sample rate');
      assert(
        ['f32', 'i16', 'u16'].includes(config.format),
        'Should have valid format'
      );
    });

    it('should get default input configuration if available', function () {
      if (!defaultInputDevice) {
        this.skip();
      }
      const config = cpal.getDefaultInputConfig(defaultInputDevice);
      assert(config.channels > 0, 'Should have valid channel count');
      assert(config.sampleRate > 0, 'Should have valid sample rate');
      assert(
        ['f32', 'i16', 'u16'].includes(config.format),
        'Should have valid format'
      );
    });
  });

  // Stream management tests
  describe('Stream Management', () => {
    let inputDevice;
    let outputDevice;
    let inputStream;
    let outputStream;
    let receivedData = false;

    before(() => {
      try {
        inputDevice = cpal.getDefaultInputDevice();
      } catch (e) {
        console.log('No input device available:', e.message);
      }
      outputDevice = cpal.getDefaultOutputDevice();
    });

    after(async () => {
      // Clean up streams
      if (inputStream) cpal.closeStream(inputStream);
      if (outputStream) cpal.closeStream(outputStream);
    });

    it('should create input stream if available', function (done) {
      if (!inputDevice) {
        this.skip();
      }

      const config = {
        channels: CHANNELS,
        sampleRate: SAMPLE_RATE,
        format: 'f32',
      };

      inputStream = cpal.createStream(inputDevice, true, config, (data) => {
        assert(
          data instanceof Float32Array,
          'Should receive Float32Array data'
        );
        assert(data.length > 0, 'Should receive non-empty data');
        receivedData = true;
      });

      assert(inputStream, 'Should return stream ID');

      // Wait for some data
      setTimeout(() => {
        assert(receivedData, 'Should have received audio data');
        done();
      }, TEST_DURATION);
    });

    it('should create output stream', () => {
      const config = {
        channels: CHANNELS,
        sampleRate: SAMPLE_RATE,
        format: 'f32',
      };

      outputStream = cpal.createStream(outputDevice, false, config, () => {});
      assert(outputStream, 'Should return stream ID');
    });

    it('should write to output stream', () => {
      // Generate a simple sine wave
      const sampleCount = SAMPLE_RATE; // 1 second of audio
      const data = new Float32Array(sampleCount * CHANNELS);
      const frequency = 440; // A4 note

      for (let i = 0; i < sampleCount; i++) {
        const value = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
        for (let channel = 0; channel < CHANNELS; channel++) {
          data[i * CHANNELS + channel] = value * 0.5; // 50% volume
        }
      }

      cpal.writeToStream(outputStream, data);
    });

    it('should pause and resume streams', async () => {
      // Test output stream
      cpal.pauseStream(outputStream);
      await sleep(500);
      cpal.resumeStream(outputStream);

      // Test input stream if available
      if (inputStream) {
        cpal.pauseStream(inputStream);
        await sleep(500);
        cpal.resumeStream(inputStream);
      }
    });

    it('should close streams', () => {
      if (inputStream) {
        cpal.closeStream(inputStream);
        inputStream = null;
      }
      cpal.closeStream(outputStream);
      outputStream = null;
    });
  });

  // Error handling tests
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

    it('should handle invalid configurations', () => {
      const device = cpal.getDefaultOutputDevice();
      assert.throws(() => {
        cpal.createStream(
          device,
          false,
          {
            channels: 0,
            sampleRate: 0,
            format: 'invalid',
          },
          () => {}
        );
      });
    });
  });
});
