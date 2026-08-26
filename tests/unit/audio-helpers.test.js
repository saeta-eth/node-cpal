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
        format: 'i16',
      },
      {
        channels: 1,
        minSampleRate: 24000,
        maxSampleRate: 48000,
        format: 'f32',
      },
      {
        channels: 2,
        minSampleRate: 44100,
        maxSampleRate: 96000,
        format: 'f32',
      },
    ];

    it('prefers default channels and sample rate when supported', () => {
      assert.deepStrictEqual(
        selectF32Config(supportedConfigs, {
          channels: 2,
          sampleRate: 48000,
          sampleFormat: 'i16',
        }),
        { channels: 2, sampleRate: 48000, format: 'f32' }
      );
    });

    it('falls back to the first f32 range and a valid boundary', () => {
      assert.deepStrictEqual(
        selectF32Config(supportedConfigs, {
          channels: 8,
          sampleRate: 192000,
          sampleFormat: 'f64',
        }),
        { channels: 1, sampleRate: 24000, format: 'f32' }
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
    it('selects a valid output configuration through the public API', () => {
      const cpal = {
        getSupportedOutputConfigs: () => [
          {
            channels: 2,
            minSampleRate: 44100,
            maxSampleRate: 96000,
            format: 'f32',
          },
        ],
        getDefaultOutputConfig: () => ({
          channels: 2,
          sampleRate: 48000,
          sampleFormat: 'i16',
        }),
      };

      assert.deepStrictEqual(
        getF32StreamConfig(cpal, 'output-device', false),
        { channels: 2, sampleRate: 48000 }
      );
    });

    it('rejects devices without f32 support', () => {
      const cpal = {
        getSupportedInputConfigs: () => [
          {
            channels: 1,
            minSampleRate: 24000,
            maxSampleRate: 24000,
            format: 'i16',
          },
        ],
        getDefaultInputConfig: () => ({
          channels: 1,
          sampleRate: 24000,
          sampleFormat: 'i16',
        }),
      };

      assert.throws(
        () => getF32StreamConfig(cpal, 'input-device', true),
        /does not support f32/
      );
    });
  });
});
