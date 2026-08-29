const assert = require('assert');
const cpal = require('../..');

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
};

function closeAll(values) {
  let firstError;
  for (const value of values) {
    if (!value) continue;
    try {
      value.close();
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (firstError) throw firstError;
}

function preferredDevice(host, isInput) {
  const defaultDevice = isInput
    ? host.defaultInputDevice()
    : host.defaultOutputDevice();
  if (defaultDevice) return { device: defaultDevice, remaining: [] };

  const devices = [
    ...(isInput ? host.inputDevices() : host.outputDevices()),
  ];
  return { device: devices.shift(), remaining: devices };
}

function isTransientDeviceInvalidation(error) {
  if (!(error instanceof cpal.CpalError)) return false;
  if (['DEVICE_NOT_AVAILABLE', 'STREAM_INVALIDATED'].includes(error.code)) {
    return true;
  }
  return process.platform === 'darwin'
    && error.code === 'BACKEND_ERROR'
    && /OSStatus:\s*560947818\b/.test(error.message);
}

function sizedConfig(device, isInput) {
  const getDefault = isInput
    ? () => device.defaultInputConfig()
    : () => device.defaultOutputConfig();
  const getSupported = isInput
    ? () => device.supportedInputConfigs()
    : () => device.supportedOutputConfigs();
  const defaultConfig = getDefault();
  if (!defaultConfig.sampleFormat().isDsd()) return defaultConfig;

  const range = [...getSupported()].find(
    (candidate) => !candidate.sampleFormat().isDsd()
  );
  if (!range) return null;
  return range.tryWithStandardSampleRate() || range.withMaxSampleRate();
}

function callbackPromise(label) {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const timer = setTimeout(
    () => reject(new Error(`Timed out waiting for ${label}`)),
    3_000
  );
  return {
    promise,
    resolve,
    reject,
    clear: () => clearTimeout(timer),
  };
}

describe('Canonical CPAL hardware API', () => {
  it('opens the default Host and enumerates stable Device handles', function () {
    const available = cpal.availableHosts();
    assert(cpal.ALL_HOSTS.length > 0);
    assert(available.length > 0);
    assert.strictEqual(cpal.Host.isAvailable(), true);
    for (const id of available) {
      assert(id instanceof cpal.HostId);
      assert(cpal.ALL_HOSTS.some((compiled) => compiled.equals(id)));
    }

    const host = cpal.defaultHost();
    const devices = [];
    const filteredDevices = [];
    const extraHandles = [];
    try {
      assert(host instanceof cpal.Host);
      assert(available.some((id) => id.equals(host.id())));

      devices.push(...host.devices());
      const inputDevices = [...host.inputDevices()];
      const outputDevices = [...host.outputDevices()];
      filteredDevices.push(...inputDevices, ...outputDevices);

      let inspectedDevices = 0;
      let resolvedDevices = 0;
      for (const device of devices) {
        try {
          assert(device instanceof cpal.Device);
          const id = device.id();
          assert(id instanceof cpal.DeviceId);
          assert(id.host().equals(host.id()));
          assert.strictEqual(typeof device.supportsInput(), 'boolean');
          assert.strictEqual(typeof device.supportsOutput(), 'boolean');

          const description = device.description();
          assert(description instanceof cpal.DeviceDescription);
          assert(description.name().length > 0);
          assert(Array.isArray([...description.extended()]));
          inspectedDevices++;

          const resolved = host.deviceById(id);
          if (resolved) {
            assert(resolved instanceof cpal.Device);
            assert(resolved.equals(device));
            extraHandles.push(resolved);
            resolvedDevices++;
          }
        } catch (error) {
          // CoreAudio may briefly enumerate a process-tap aggregate immediately
          // after it has been destroyed. CPAL models this like any hot-unplug:
          // operations on that Device can fail while other handles remain valid.
          if (!isTransientDeviceInvalidation(error)) throw error;
        }
      }
      assert(inspectedDevices > 0);
      assert(resolvedDevices > 0);

      for (const device of inputDevices) {
        assert.strictEqual(device.supportsInput(), true);
      }
      for (const device of outputDevices) {
        assert.strictEqual(device.supportsOutput(), true);
      }
    } finally {
      closeAll(extraHandles);
      closeAll(filteredDevices);
      closeAll(devices);
      host.close();
    }
  });

  it('exposes canonical configuration value objects on real devices', function () {
    const host = cpal.defaultHost();
    const devices = [];
    try {
      devices.push(...host.devices());
      if (devices.length === 0) this.skip();

      let inspectedDirection = false;
      for (const device of devices) {
        for (const [isInput, supported] of [
          [true, device.supportsInput()],
          [false, device.supportsOutput()],
        ]) {
          if (!supported) continue;
          inspectedDirection = true;

          const ranges = [
            ...(isInput
              ? device.supportedInputConfigs()
              : device.supportedOutputConfigs()),
          ];
          for (const range of ranges) {
            assert(range instanceof cpal.SupportedStreamConfigRange);
            assert(range.channels() > 0);
            assert(range.minSampleRate() > 0);
            assert(range.maxSampleRate() >= range.minSampleRate());
            assert(range.bufferSize() instanceof cpal.SupportedBufferSize);
            assert(range.sampleFormat().sampleSize() > 0);
          }

          const config = isInput
            ? device.defaultInputConfig()
            : device.defaultOutputConfig();
          assert(config instanceof cpal.SupportedStreamConfig);
          assert(config.config() instanceof cpal.StreamConfig);
          assert(config.channels() > 0);
          assert(config.sampleRate() > 0);
        }
      }
      assert.strictEqual(inspectedDirection, true);
    } finally {
      closeAll(devices);
      host.close();
    }
  });

  it('runs a typed output Stream callback with the selected sample type', async function () {
    const host = cpal.defaultHost();
    const { device, remaining: devices } = preferredDevice(host, false);
    let stream;
    let callback;
    try {
      if (!device) this.skip();
      const supported = sizedConfig(device, false);
      if (!supported) this.skip();

      const format = supported.sampleFormat();
      const Constructor = SAMPLE_ARRAYS[format.value];
      callback = callbackPromise('a typed output callback');
      stream = device.buildOutputStream(
        supported.config(),
        format,
        (data, info) => {
          data.fill(format.equilibrium());
          callback.resolve({ data, info });
        },
        callback.reject
      );

      assert(stream instanceof cpal.Stream);
      assert.strictEqual(stream.state(), 'paused');
      stream.play();
      const { data, info } = await callback.promise;
      assert(data instanceof Constructor);
      assert(data.length > 0);
      assert(info instanceof cpal.OutputCallbackInfo);
      assert(info.timestamp().callback instanceof cpal.StreamInstant);
      assert(info.timestamp().playback instanceof cpal.StreamInstant);
      assert(stream.bufferSize() > 0);
      assert(stream.now() instanceof cpal.StreamInstant);
      stream.pause();
      assert.strictEqual(stream.state(), 'paused');
    } finally {
      if (callback) callback.clear();
      if (stream) stream.close();
      if (device) device.close();
      closeAll(devices);
      host.close();
    }
  }).timeout(5_000);

  it('runs a typed input Stream callback with CPAL timestamps', async function () {
    const host = cpal.defaultHost();
    const { device, remaining: devices } = preferredDevice(host, true);
    let stream;
    let callback;
    try {
      if (!device) this.skip();
      const supported = sizedConfig(device, true);
      if (!supported) this.skip();

      const format = supported.sampleFormat();
      const Constructor = SAMPLE_ARRAYS[format.value];
      callback = callbackPromise('a typed input callback');
      stream = device.buildInputStream(
        supported.config(),
        format,
        (data, info) => callback.resolve({ data, info }),
        callback.reject
      );
      stream.play();

      const { data, info } = await callback.promise;
      assert(data instanceof Constructor);
      assert(data.length > 0);
      assert(info instanceof cpal.InputCallbackInfo);
      assert(info.timestamp().callback instanceof cpal.StreamInstant);
      assert(info.timestamp().capture instanceof cpal.StreamInstant);
    } finally {
      if (callback) callback.clear();
      if (stream) stream.close();
      if (device) device.close();
      closeAll(devices);
      host.close();
    }
  }).timeout(5_000);

  it('wraps a real raw output callback in an ephemeral Data view', async function () {
    const host = cpal.defaultHost();
    const { device, remaining: devices } = preferredDevice(host, false);
    let stream;
    let callback;
    let retainedData;
    try {
      if (!device) this.skip();
      const supported = sizedConfig(device, false);
      if (!supported) this.skip();

      const format = supported.sampleFormat();
      callback = callbackPromise('a raw output callback');
      stream = device.buildOutputStreamRaw(
        supported.config(),
        format,
        (data, info) => {
          retainedData = data;
          const samples = data.asSliceMut(format);
          samples.fill(format.equilibrium());
          callback.resolve({
            isData: data instanceof cpal.Data,
            format: data.sampleFormat(),
            length: data.len(),
            byteLength: data.bytes().byteLength,
            samples,
            info,
          });
        },
        callback.reject
      );
      stream.play();

      const result = await callback.promise;
      assert.strictEqual(result.isData, true);
      assert.strictEqual(result.format, format);
      assert(result.samples instanceof SAMPLE_ARRAYS[format.value]);
      assert(result.length > 0);
      assert.strictEqual(result.byteLength, result.length * format.sampleSize());
      assert(result.info instanceof cpal.OutputCallbackInfo);
      assert.throws(() => retainedData.len(), /only valid during/);
    } finally {
      if (callback) callback.clear();
      if (stream) stream.close();
      if (device) device.close();
      closeAll(devices);
      host.close();
    }
  }).timeout(5_000);
});
