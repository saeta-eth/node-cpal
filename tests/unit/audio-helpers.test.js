const assert = require('assert');
const {
  generateSineWave,
  getDeviceId,
  selectF32Config,
  summarizeDurations,
} = require('../helpers/audio');
const { getF32StreamConfig } = require('../../examples/f32-config');

describe('Audio Test Helpers', () => {
  describe('generateSineWave', () => {
    it('generates interleaved samples for every channel', () => {
      const data = generateSineWave(1, 4, 2, 1, 0.5);
      const expected = [0, 0, 0.5, 0.5, 0, 0, -0.5, -0.5];

      assert.strictEqual(data.length, 8);
      data.forEach((sample, index) => {
        assert(Math.abs(sample - expected[index]) < 1e-6);
      });
    });

    it('rounds fractional frame counts down', () => {
      const data = generateSineWave(440, 44100, 1, 0.0015);

      assert.strictEqual(data.length, 66);
    });
  });

  describe('getDeviceId', () => {
    it('accepts a device ID or a device object', () => {
      assert.strictEqual(getDeviceId('device-1'), 'device-1');
      assert.strictEqual(getDeviceId({ deviceId: 'device-2' }), 'device-2');
    });

    it('rejects stale or missing device identifiers', () => {
      assert.throws(() => getDeviceId({ id: 'device-1' }), /deviceId/);
      assert.throws(() => getDeviceId(null), /deviceId/);
    });
  });

  describe('selectF32Config', () => {
    const supportedConfigs = [
      {
        channels: 1,
        minSampleRate: 22050,
        maxSampleRate: 24000,
        sampleFormat: 'i16',
      },
      {
        channels: 1,
        minSampleRate: 24000,
        maxSampleRate: 48000,
        sampleFormat: 'f32',
      },
      {
        channels: 2,
        minSampleRate: 44100,
        maxSampleRate: 96000,
        sampleFormat: 'f32',
      },
    ];

    it('prefers default channels and sample rate when supported', () => {
      assert.deepStrictEqual(
        selectF32Config(supportedConfigs, {
          channels: 2,
          sampleRate: 48000,
          sampleFormat: 'i16',
        }),
        {
          channels: 2,
          sampleRate: 48000,
          sampleFormat: 'f32',
          bufferSize: { type: 'default' },
        }
      );
    });

    it('falls back to the first f32 range and a valid boundary', () => {
      assert.deepStrictEqual(
        selectF32Config(supportedConfigs, {
          channels: 8,
          sampleRate: 192000,
          sampleFormat: 'f64',
        }),
        {
          channels: 1,
          sampleRate: 24000,
          sampleFormat: 'f32',
          bufferSize: { type: 'default' },
        }
      );
    });

    it('returns null when the device has no f32 capability', () => {
      assert.strictEqual(
        selectF32Config([supportedConfigs[0]], {
          channels: 1,
          sampleRate: 24000,
          sampleFormat: 'i16',
        }),
        null
      );
    });
  });

  describe('summarizeDurations', () => {
    it('reports nearest-rank duration statistics without mutating input', () => {
      const values = [5, 1, 4, 2, 3];

      assert.deepStrictEqual(summarizeDurations(values), {
        min: 1,
        median: 3,
        p95: 5,
        max: 5,
      });
      assert.deepStrictEqual(values, [5, 1, 4, 2, 3]);
    });

    it('requires at least one duration', () => {
      assert.throws(() => summarizeDurations([]), /at least one duration/);
    });
  });

  describe('getF32StreamConfig example helper', () => {
    const F32 = Object.freeze({ value: 'f32' });
    const I16 = Object.freeze({ value: 'i16' });
    const cpal = { SampleFormat: { F32 } };

    function config(channels, sampleRate, sampleFormat) {
      return {
        channels: () => channels,
        sampleRate: () => sampleRate,
        sampleFormat: () => sampleFormat,
      };
    }

    function range(channels, minSampleRate, maxSampleRate, sampleFormat) {
      return {
        channels: () => channels,
        sampleFormat: () => sampleFormat,
        containsRate: (rate) =>
          rate >= minSampleRate && rate <= maxSampleRate,
        tryWithSampleRate(rate) {
          return this.containsRate(rate)
            ? config(channels, rate, sampleFormat)
            : null;
        },
        tryWithStandardSampleRate() {
          return this.tryWithSampleRate(48000);
        },
        withMaxSampleRate: () =>
          config(channels, maxSampleRate, sampleFormat),
      };
    }

    it('selects a valid output configuration through canonical Device methods', () => {
      const device = {
        supportedOutputConfigs: () => [
          range(1, 24000, 48000, F32),
          range(2, 44100, 96000, F32),
        ],
        defaultOutputConfig: () => config(2, 48000, I16),
      };

      const selected = getF32StreamConfig(cpal, device, false);
      assert.strictEqual(selected.channels(), 2);
      assert.strictEqual(selected.sampleRate(), 48000);
      assert.strictEqual(selected.sampleFormat(), F32);
    });

    it('returns an f32 default configuration unchanged', () => {
      const defaultConfig = config(2, 48000, F32);
      const device = {
        supportedOutputConfigs: () => [],
        defaultOutputConfig: () => defaultConfig,
      };

      assert.strictEqual(
        getF32StreamConfig(cpal, device, false),
        defaultConfig
      );
    });

    it('rejects devices without f32 support', () => {
      const device = {
        supportedInputConfigs: () => [range(1, 24000, 24000, I16)],
        defaultInputConfig: () => config(1, 24000, I16),
      };

      assert.throws(
        () => getF32StreamConfig(cpal, device, true),
        /does not support f32/
      );
    });
  });
});
