const assert = require('assert');
const cpal = require('../..').convenience;
const { getTestConfig, getTestDevice } = require('../helpers/hardware');

const SAMPLE_ARRAYS = {
  i8: Int8Array,
  i16: Int16Array,
  i24: Int32Array,
  i32: Int32Array,
  i64: BigInt64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u24: Uint32Array,
  u32: Uint32Array,
  u64: BigUint64Array,
  f32: Float32Array,
  f64: Float64Array,
  dsdu8: Uint8Array,
  dsdu16: Uint16Array,
  dsdu32: Uint32Array,
};

describe('Convenience stream edge cases', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    config = getTestConfig(device, false);
    if (!device || !config) this.skip();
  });

  it('rejects empty, partial-frame, and wrongly typed buffers', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      onError() {},
    });
    try {
      assert.throws(
        () => stream.write(new Float32Array(0)),
        (error) => error instanceof cpal.CpalError && error.code === 'INVALID_BUFFER'
      );
      if (config.channels > 1) {
        assert.throws(
          () => stream.write(new Float32Array(config.channels - 1)),
          (error) => error instanceof cpal.CpalError && error.code === 'INVALID_BUFFER'
        );
      }
      assert.throws(() => stream.write(new Int16Array(config.channels)), TypeError);
    } finally {
      await stream.close();
    }
  });

  it('uses the correct typed array for every format exposed by the device', async function () {
    const configs = [...new Map(
      cpal.getSupportedOutputConfigs(device.deviceId)
        .map((capability) => [capability.sampleFormat, capability])
    ).values()];
    if (configs.length === 0) this.skip();

    for (const capability of configs) {
      const Constructor = SAMPLE_ARRAYS[capability.sampleFormat];
      const stream = await cpal.createOutputStream({
        deviceId: device.deviceId,
        config: {
          channels: capability.channels,
          sampleRate: capability.minSampleRate,
          sampleFormat: capability.sampleFormat,
        },
        onError() {},
      });
      try {
        assert.strictEqual(
          stream.write(new Constructor(capability.channels * 8)),
          true
        );
      } finally {
        await stream.close();
      }
    }
  }).timeout(20_000);

  it('validates the significant range of 24-bit typed-array samples', async function () {
    const capability = cpal
      .getSupportedOutputConfigs(device.deviceId)
      .find(({ sampleFormat }) => sampleFormat === 'i24' || sampleFormat === 'u24');
    if (!capability) this.skip();

    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config: {
        channels: capability.channels,
        sampleRate: capability.minSampleRate,
        sampleFormat: capability.sampleFormat,
      },
      onError() {},
    });
    try {
      const data = capability.sampleFormat === 'i24'
        ? new Int32Array(capability.channels)
        : new Uint32Array(capability.channels);
      data[0] = capability.sampleFormat === 'i24' ? 1 << 23 : 1 << 24;
      assert.throws(() => stream.write(data), RangeError);
    } finally {
      await stream.close();
    }
  });

  it('closes idempotently and rejects later operations', async () => {
    const stream = await cpal.createOutputStream({
      deviceId: device.deviceId,
      config,
      onError() {},
    });
    await stream.close();
    await stream.close();

    assert.strictEqual(stream.state, 'closed');
    assert.throws(
      () => stream.bufferedFrames,
      (error) => error instanceof cpal.CpalError && error.code === 'STREAM_CLOSED'
    );
    assert.throws(
      () => stream.write(new Float32Array(config.channels)),
      (error) => error instanceof cpal.CpalError && error.code === 'STREAM_CLOSED'
    );
  });
});
