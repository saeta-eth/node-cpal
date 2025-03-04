const assert = require('assert');
const cpal = require('../');
const os = require('os');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
} = require('./utils');

describe('Cross-Platform Tests', () => {
  let device;
  let config;

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
  });

  it('should identify correct host API for platform', () => {
    const hosts = cpal.getHosts();
    const platform = os.platform();

    switch (platform) {
      case 'darwin':
        assert(
          hosts.includes('CoreAudio'),
          'CoreAudio should be available on macOS'
        );
        break;
      case 'win32':
        assert(
          hosts.some((h) => ['WASAPI', 'DirectSound', 'ASIO'].includes(h)),
          'Windows should have WASAPI, DirectSound, or ASIO available'
        );
        break;
      case 'linux':
        assert(
          hosts.some((h) => ['ALSA', 'PulseAudio', 'JACK'].includes(h)),
          'Linux should have ALSA, PulseAudio, or JACK available'
        );
        break;
      default:
        console.log(`Untested platform: ${platform}`);
    }
  });

  it('should support platform-specific sample formats', async () => {
    const supportedFormats = cpal.getSupportedFormats(device);
    const platform = os.platform();

    // Test common formats across all platforms
    assert(supportedFormats.includes('f32'), 'f32 format should be supported');

    // Platform-specific format checks
    switch (platform) {
      case 'darwin':
        // macOS typically supports float formats
        assert(
          supportedFormats.includes('f32'),
          'f32 should be supported on macOS'
        );
        break;
      case 'win32':
        // Windows typically supports both integer and float formats
        assert(
          supportedFormats.some((f) => ['i16', 'f32'].includes(f)),
          'Windows should support i16 or f32'
        );
        break;
      case 'linux':
        // Linux support varies by sound system
        console.log('Supported formats on Linux:', supportedFormats);
        assert(
          supportedFormats.length > 0,
          'At least one format should be supported'
        );
        break;
    }
  });

  it('should handle platform-specific sample rates', async () => {
    const supportedRates = cpal.getSupportedSampleRates(device);
    const commonRates = [44100, 48000];

    // Common rates should be supported across platforms
    commonRates.forEach((rate) => {
      assert(
        supportedRates.includes(rate),
        `Sample rate ${rate} should be supported`
      );
    });

    // Platform-specific high sample rate support
    const platform = os.platform();
    const highRates = [88200, 96000, 192000];

    console.log(`Supported sample rates on ${platform}:`, supportedRates);
    console.log(
      'High sample rate support:',
      highRates.filter((r) => supportedRates.includes(r))
    );
  });

  it('should handle platform-specific channel configurations', async () => {
    const maxChannels = cpal.getMaxChannels(device);
    assert(maxChannels >= 2, 'Should support at least stereo output');

    // Test mono recording if input device available
    const inputDevice = getTestDevice(true);
    if (inputDevice) {
      const inputConfig = getTestConfig(inputDevice, true);
      assert(
        inputConfig.channels >= 1,
        'Input device should support at least mono recording'
      );
    }

    // Test multichannel output if supported
    if (maxChannels > 2) {
      const multiChannelConfig = {
        ...config,
        channels: Math.min(maxChannels, 6), // Test up to 5.1 if supported
      };

      await withTestStream(
        device,
        false,
        multiChannelConfig,
        async (stream) => {
          const buffer = generateSineWave(
            440,
            multiChannelConfig.sampleRate,
            multiChannelConfig.channels,
            0.1
          );
          cpal.writeToStream(stream, buffer);
          await sleep(100);
        }
      );
    }
  });

  it('should handle platform-specific error cases', () => {
    // Test invalid device ID
    assert.throws(() => {
      cpal.createStream({ id: 'invalid-device' }, false, config, () => {});
    }, /device not found|invalid device|failed to downcast/i);

    // Test invalid configuration
    const invalidConfig = {
      channels: 999, // Invalid channel count
      sampleRate: 999999999, // Invalid sample rate
      format: 'invalid-format',
    };

    assert.throws(() => {
      cpal.createStream(device, false, invalidConfig, () => {});
    }, /invalid configuration|unsupported format|not supported by the device/i);

    // Test invalid callback
    assert.throws(() => {
      cpal.createStream(device, true, config, 'not-a-function');
    }, /invalid callback|callback must be a function|failed to downcast/i);
  });

  it('should handle platform-specific device naming conventions', () => {
    const devices = cpal.getDevices(cpal.getHosts()[0]);
    const platform = os.platform();

    devices.forEach((device) => {
      assert(device.name, 'Device should have a name');
      assert(device.id, 'Device should have an ID');

      switch (platform) {
        case 'darwin':
          // macOS devices typically include manufacturer info
          assert(
            device.name.includes('Built-in') ||
              device.name.includes('MacBook') ||
              device.name.includes('External') ||
              device.name.includes('USB'),
            'macOS device names should follow platform conventions'
          );
          break;
        case 'win32':
          // Windows devices typically include driver info
          assert(
            device.name.includes('(') ||
              device.name.includes(')') ||
              device.name.includes('Device'),
            'Windows device names should follow platform conventions'
          );
          break;
        case 'linux':
          // Linux naming varies by sound system
          console.log('Linux device name format:', device.name);
          break;
      }
    });
  });
});
