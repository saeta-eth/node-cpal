const assert = require('assert');
const fs = require('fs');
const path = require('path');

const values = require('../../cpal-values');

describe('Canonical CPAL value types', () => {
  it('has no unaudited or missing CPAL 0.18.2 parity entries', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../docs/cpal-0.18.2-parity.json'),
      'utf8'
    ));
    assert.strictEqual(manifest.upstream.version, '0.18.2');
    assert.strictEqual(manifest.bindings.length > 30, true);
    assert.deepStrictEqual(
      manifest.bindings.filter(({ status }) => status === 'missing'),
      []
    );
  });

  it('represents every CPAL sample format and its storage properties', () => {
    assert.strictEqual(Object.keys(values.SampleFormat).length, 15);
    assert.strictEqual(values.SampleFormat.I24.sampleSize(), 4);
    assert.strictEqual(values.SampleFormat.I24.bitsPerSample(), 24);
    assert.strictEqual(values.SampleFormat.I24.isInt(), true);
    assert.strictEqual(values.SampleFormat.U24.isUint(), true);
    assert.strictEqual(values.SampleFormat.F32.isFloat(), true);
    assert.strictEqual(values.SampleFormat.DsdU32.isDsd(), true);
    assert.strictEqual(String(values.SampleFormat.F64), 'f64');
  });

  it('implements CPAL supported-config selection and comparison', () => {
    const range = new values.SupportedStreamConfigRange(
      2,
      44_100,
      96_000,
      values.SupportedBufferSize.Range(64, 1024),
      values.SampleFormat.F32
    );
    const mono = new values.SupportedStreamConfigRange(
      1,
      44_100,
      48_000,
      values.SupportedBufferSize.Unknown,
      values.SampleFormat.I16
    );

    assert.strictEqual(range.containsRate(48_000), true);
    assert.strictEqual(range.tryWithSampleRate(192_000), null);
    assert.strictEqual(range.withStandardSampleRate().sampleRate(), 48_000);
    assert.strictEqual(range.withMaxSampleRate().sampleRate(), 96_000);
    assert.strictEqual(range.cmpDefaultHeuristics(mono), 1);
    assert.deepStrictEqual(range.withSampleRate(44_100).config(), new values.StreamConfig(
      2,
      44_100,
      values.BufferSize.Default
    ));
  });

  it('preserves CPAL stream-instant arithmetic in bigint nanoseconds', () => {
    const first = new values.StreamInstant(2n, 500_000_000);
    const second = first.add(750_000_000n);

    assert.strictEqual(first.asNanos(), 2_500_000_000n);
    assert.strictEqual(second.asNanos(), 3_250_000_000n);
    assert.strictEqual(second.durationSince(first), 750_000_000n);
    assert.strictEqual(first.checkedDurationSince(second), null);
    assert.strictEqual(first.saturatingDurationSince(second), 0n);
    assert.strictEqual(first.checkedSub(3_000_000_000n), null);
  });

  it('builds structured device descriptions', () => {
    const description = new values.DeviceDescriptionBuilder('Interface')
      .manufacturer('Acme')
      .deviceType(values.DeviceType.Headset)
      .interfaceType(values.InterfaceType.Usb)
      .direction(values.DeviceDirection.Duplex)
      .addExtendedLine('clock: external')
      .build();

    assert.strictEqual(description.supportsInput(), true);
    assert.strictEqual(description.supportsOutput(), true);
    assert.deepStrictEqual([...description.extended()], ['clock: external']);
    assert.strictEqual(String(description), 'Interface (Acme) [Headset] via USB');
  });

  it('models CPAL I24 and U24 bounds', () => {
    assert.strictEqual(values.I24.new(-8_388_609), null);
    assert.strictEqual(values.I24.new(8_388_607).inner(), 8_388_607);
    assert.strictEqual(values.I24.from(8_388_608).inner(), -8_388_608);
    assert.strictEqual(values.I24.newUnchecked(8_388_608).inner(), 8_388_608);
    assert.throws(() => values.I24.newUnchecked(2 ** 40), RangeError);
    assert.strictEqual(values.U24.new(16_777_216), null);
    assert.strictEqual(values.U24.EQUILIBRIUM.inner(), 8_388_608);
  });

  it('translates CPAL Sample and FromSample conversions', () => {
    assert.strictEqual(
      values.Sample.toSample(0, values.SampleFormat.I16, values.SampleFormat.U16),
      32_768
    );
    assert.strictEqual(
      values.FromSample.fromSample(values.SampleFormat.I16, 128, values.SampleFormat.U8),
      0
    );
    assert.strictEqual(
      values.SampleFormat.F32.toSample(-1, values.SampleFormat.U8),
      0
    );
    assert.strictEqual(values.SampleFormat.U24.equilibrium(), values.U24.EQUILIBRIUM);
    assert.throws(
      () => values.Sample.equilibrium(values.SampleFormat.DsdU8),
      /do not implement CPAL Sample/
    );
  });

  it('provides typed and raw views over callback data', () => {
    const samples = new Int16Array([1, 2, 3]);
    const data = new values.Data(values.SampleFormat.I16, samples, true);

    assert.strictEqual(data.len(), 3);
    assert.strictEqual(data.asSlice(values.SampleFormat.I16), samples);
    assert.strictEqual(data.asSlice(values.SampleFormat.F32), null);
    assert.strictEqual(data.bytesMut().byteLength, 6);
    data._invalidate();
    assert.throws(() => data.len(), /only valid during/);
  });
});
