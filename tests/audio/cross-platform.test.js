const assert = require('assert');
const os = require('os');
const cpal = require('../..').convenience;
const { getTestConfig, getTestDevice } = require('../helpers/hardware');

describe('Convenience desktop backend coverage', () => {
  it('includes the platform default backend', () => {
    const hostIds = cpal.getHosts().map((host) => host.id);
    const expected = {
      darwin: 'coreaudio',
      linux: 'alsa',
      win32: 'wasapi',
    }[os.platform()];
    assert(hostIds.includes(expected));
  });

  it('keeps format and sample-rate helpers consistent with config ranges', function () {
    const device = getTestDevice(false);
    if (!device) this.skip();

    const configs = cpal.getSupportedOutputConfigs(device.deviceId);
    const formats = cpal.getSupportedFormats(device.deviceId);
    const rates = cpal.getSupportedSampleRates(device.deviceId);
    const maxChannels = cpal.getMaxChannels(device.deviceId);

    configs.forEach((config) => {
      assert(formats.includes(config.sampleFormat));
      assert(rates.includes(config.minSampleRate));
      assert(rates.includes(config.maxSampleRate));
      assert(maxChannels >= config.channels);
    });
    assert.deepStrictEqual(rates, [...new Set(rates)].sort((a, b) => a - b));
  });

  it('returns structured errors for unavailable devices and bad configs', async function () {
    const device = getTestDevice(false);
    const config = getTestConfig(device, false);
    if (!device || !config) this.skip();

    await assert.rejects(
      cpal.createOutputStream({
        deviceId: `${device.hostId}:definitely-missing`,
        config,
        onError() {},
      }),
      (error) => error instanceof cpal.CpalError && typeof error.code === 'string'
    );

    await assert.rejects(
      cpal.createOutputStream({
        deviceId: device.deviceId,
        config: {
          channels: 65_535,
          sampleRate: 4_000_000_000,
          sampleFormat: 'f32',
        },
        onError() {},
      }),
      (error) => error instanceof cpal.CpalError && error.code === 'UNSUPPORTED_CONFIG'
    );
  });

  it('does not silently accept host options on backends without options', function () {
    const defaultHost = {
      darwin: 'coreaudio',
      linux: 'alsa',
      win32: 'wasapi',
    }[os.platform()];

    assert.throws(
      () => cpal.getDevices({
        hostId: defaultHost,
        hostOptions: { connectAutomatically: false },
      }),
      (error) => error instanceof cpal.CpalError && error.code === 'UNSUPPORTED_OPERATION'
    );
  });
});
