const assert = require('assert');
const Module = require('module');

function createFakeNative() {
  let nextId = 1;
  const streams = new Map();
  const writes = [];
  const device = {
    name: 'Test Device',
    deviceId: 'coreaudio:test-device',
    hostId: 'coreaudio',
    isDefaultInput: true,
    isDefaultOutput: true,
    supportsInput: true,
    supportsOutput: true,
    supportsLoopback: true,
    deviceType: 'speaker',
    interfaceType: 'built-in',
    direction: 'duplex',
    manufacturer: null,
    driver: null,
    address: null,
    extended: [],
  };
  const supportedConfig = {
    channels: 2,
    minSampleRate: 44_100,
    maxSampleRate: 48_000,
    sampleFormat: 'f32',
    bufferSize: { type: 'range', minFrames: 64, maxFrames: 1024 },
  };
  const defaultConfig = {
    channels: 2,
    sampleRate: 48_000,
    sampleFormat: 'f32',
    bufferSize: { type: 'default' },
    supportedBufferSize: supportedConfig.bufferSize,
  };

  const native = {
    lastDeviceArguments: null,
    closeCount: 0,
    writes,
    getHosts: () => [{ id: 'coreaudio', name: 'CoreAudio' }],
    getDevices(...args) {
      native.lastDeviceArguments = args;
      return [device];
    },
    getDeviceById: () => device,
    getDefaultInputDevice: () => device,
    getDefaultOutputDevice: () => device,
    getSupportedInputConfigs: () => [supportedConfig],
    getSupportedOutputConfigs: () => [supportedConfig],
    getDefaultInputConfig: () => defaultConfig,
    getDefaultOutputConfig: () => defaultConfig,
    getSupportedFormats: () => ['f32'],
    getSupportedSampleRates: () => [44_100, 48_000],
    getMaxChannels: () => 2,
    _createStream(_deviceId, isInput, config, callback) {
      const id = `stream-${nextId++}`;
      streams.set(id, { callback, state: 'paused', config, isInput });
      return {
        id,
        direction: isInput ? 'input' : 'output',
        sampleFormat: config.sampleFormat,
        channels: config.channels,
        sampleRate: config.sampleRate,
        bufferSizeFrames: config.bufferSizeFrames || 128,
      };
    },
    _writeToStream(id, data) {
      writes.push({ id, data });
      return true;
    },
    _pauseStream(id) {
      streams.get(id).state = 'paused';
    },
    _playStream(id) {
      streams.get(id).state = 'playing';
    },
    _closeStream(id) {
      native.closeCount++;
      streams.delete(id);
    },
    _getStreamState: (id) => streams.get(id)?.state || 'closed',
    _getStreamBufferSize: () => 128,
    _getStreamNow: () => 1234n,
    _getBufferedFrames: () => 64,
    emit(id, event) {
      streams.get(id).callback(event);
    },
    latestId() {
      return `stream-${nextId - 1}`;
    },
  };
  return native;
}

function loadFacade(native) {
  const entry = require.resolve('../..');
  const facade = require.resolve('../../facade');
  const originalLoad = Module._load;
  delete require.cache[entry];
  delete require.cache[facade];
  Module._load = function load(request, parent, isMain) {
    if (typeof request === 'string' && request.endsWith('index.node')) {
      return native;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../..').convenience;
  } finally {
    Module._load = originalLoad;
    delete require.cache[entry];
    delete require.cache[facade];
  }
}

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

const SILENCE_VALUES = {
  i8: 0,
  i16: 0,
  i24: 0,
  i32: 0,
  i64: 0n,
  u8: 128,
  u16: 32768,
  u24: 8388608,
  u32: 2147483648,
  u64: 1n << 63n,
  f32: 0,
  f64: 0,
  dsdu8: 0x69,
  dsdu16: 0x6969,
  dsdu32: 0x69696969,
};

describe('1.0 JavaScript facade', () => {
  it('forwards host selection, direction filtering, and PipeWire options', () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);

    const devices = cpal.getDevices({
      hostId: 'pipewire',
      direction: 'output',
      hostOptions: { connectAutomatically: false },
    });

    assert.strictEqual(devices[0].supportsLoopback, true);
    assert.deepStrictEqual(native.lastDeviceArguments, [
      'pipewire',
      'output',
      { connectAutomatically: false },
    ]);
  });

  it('creates paused object streams with idempotent lifecycle methods', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const stream = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
      onError() {},
    });

    assert(stream instanceof cpal.PushOutputStream);
    assert.strictEqual(stream.state, 'paused');
    assert.strictEqual(stream.direction, 'output');
    assert.strictEqual(stream.bufferSize(), 128);
    assert.strictEqual(stream.now(), 1234n);
    assert.strictEqual(stream.bufferedFrames, 64);
    stream.play();
    assert.strictEqual(stream.state, 'playing');
    stream.pause();
    assert.strictEqual(stream.state, 'paused');
    await stream.close();
    await stream.close();
    assert.strictEqual(stream.state, 'closed');
    assert.strictEqual(native.closeCount, 1);
    assert.throws(() => stream.play(), (error) => {
      assert(error instanceof cpal.CpalError);
      return error.code === 'STREAM_CLOSED';
    });
    assert.throws(() => stream.bufferedFrames, (error) => {
      assert(error instanceof cpal.CpalError);
      return error.code === 'STREAM_CLOSED';
    });
  });

  it('enforces the native typed array for every CPAL sample format', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);

    for (const [sampleFormat, Constructor] of Object.entries(SAMPLE_ARRAYS)) {
      const stream = await cpal.createOutputStream({
        deviceId: 'coreaudio:test-device',
        config: { channels: 1, sampleRate: 48_000, sampleFormat },
        onError() {},
      });
      assert.strictEqual(stream.write(new Constructor(4)), true);
      if (Constructor !== Float32Array) {
        assert.throws(() => stream.write(new Float32Array(4)), TypeError);
      }
      await stream.close();
    }
  });

  it('rejects empty and partial-frame writes before the native boundary', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const stream = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
      onError() {},
    });

    for (const data of [new Float32Array(0), new Float32Array(1)]) {
      assert.throws(() => stream.write(data), (error) => {
        assert(error instanceof cpal.CpalError);
        assert.strictEqual(error.code, 'INVALID_BUFFER');
        assert.strictEqual(error.operation, 'write');
        return true;
      });
    }
    assert.deepStrictEqual(native.writes, []);
    assert.strictEqual(stream.write(new Float32Array(2)), true);

    await stream.close();
  });

  it('rejects samples outside the signed and unsigned 24-bit ranges', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const signed = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 1, sampleRate: 48_000, sampleFormat: 'i24' },
      onError() {},
    });
    const unsigned = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 1, sampleRate: 48_000, sampleFormat: 'u24' },
      onError() {},
    });

    assert.strictEqual(signed.write(new Int32Array([-0x800000, 0x7fffff])), true);
    assert.strictEqual(unsigned.write(new Uint32Array([0, 0xffffff])), true);
    assert.throws(() => signed.write(new Int32Array([-0x800001])), RangeError);
    assert.throws(() => signed.write(new Int32Array([0x800000])), RangeError);
    assert.throws(() => unsigned.write(new Uint32Array([0x1000000])), RangeError);

    await signed.close();
    await unsigned.close();
  });

  it('substitutes silence when a pull callback returns an out-of-range i24 sample', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const errors = [];
    const firstWrite = native.writes.length;
    const stream = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 1, sampleRate: 48_000, sampleFormat: 'i24' },
      mode: 'pull',
      onData({ frames }) {
        const data = new Int32Array(frames);
        data[0] = 0x800000;
        return data;
      },
      onError(error) {
        errors.push(error);
      },
    });

    const generated = native.writes.slice(firstWrite);
    assert.strictEqual(generated.length, 3);
    assert(generated.every(({ data }) => data.every((sample) => sample === 0)));
    assert.deepStrictEqual(errors.map((error) => error.code), [
      'CALLBACK_FAILED',
      'CALLBACK_FAILED',
      'CALLBACK_FAILED',
    ]);
    await stream.close();
  });

  it('delivers typed input data and nanosecond timestamps', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    let received;
    const stream = await cpal.createInputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 1, sampleRate: 48_000, sampleFormat: 'i16' },
      onData(data, info) {
        received = { data, info };
      },
      onError() {},
    });

    native.emit(native.latestId(), {
      type: 'data',
      data: new Int16Array([1, 2]),
      info: { frames: 2, callbackTimeNs: 10n, captureTimeNs: 8n },
    });

    assert(received.data instanceof Int16Array);
    assert.strictEqual(received.info.captureTimeNs, 8n);
    await stream.close();
  });

  it('prefetches pull buffers and requests replacements from output events', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    let requests = 0;
    const stream = await cpal.createOutputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
      mode: 'pull',
      onData({ frames, channels }) {
        requests++;
        return new Float32Array(frames * channels);
      },
      onError() {},
    });

    assert(stream instanceof cpal.PullOutputStream);
    assert.strictEqual(requests, 3);
    assert.strictEqual(native.writes.length, 3);
    native.emit(native.latestId(), {
      type: 'output',
      info: {
        frames: 128,
        callbackTimeNs: 20n,
        playbackTimeNs: 22n,
        underrunFrames: 0,
      },
    });
    assert.strictEqual(requests, 4);
    assert.strictEqual(native.writes.length, 4);
    await stream.close();
  });

  it('substitutes format-correct silence when a pull callback fails', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);

    for (const sampleFormat of Object.keys(SAMPLE_ARRAYS)) {
      const errors = [];
      const firstWrite = native.writes.length;
      const stream = await cpal.createOutputStream({
        deviceId: 'coreaudio:test-device',
        config: { channels: 1, sampleRate: 48_000, sampleFormat },
        mode: 'pull',
        onData() {
          throw new Error('generator failed');
        },
        onError(error) {
          errors.push(error);
        },
      });

      const generated = native.writes.slice(firstWrite);
      assert.strictEqual(generated.length, 3);
      for (const { data } of generated) {
        assert(data instanceof SAMPLE_ARRAYS[sampleFormat]);
        assert(data.every((value) => value === SILENCE_VALUES[sampleFormat]));
      }
      assert.deepStrictEqual(errors.map((error) => error.code), [
        'CALLBACK_FAILED',
        'CALLBACK_FAILED',
        'CALLBACK_FAILED',
      ]);
      await stream.close();
    }
  });

  it('routes callback failures and native stream errors through onError', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const errors = [];
    const stream = await cpal.createInputStream({
      deviceId: 'coreaudio:test-device',
      config: { channels: 1, sampleRate: 48_000, sampleFormat: 'f32' },
      onData() {
        throw new Error('consumer failed');
      },
      onError(error) {
        errors.push(error);
      },
    });

    native.emit(native.latestId(), {
      type: 'data',
      data: new Float32Array(1),
      info: { frames: 1, callbackTimeNs: 1n, captureTimeNs: 1n },
    });
    native.emit(native.latestId(), {
      type: 'error',
      error: { code: 'XRUN', message: 'backend xrun' },
    });

    assert(errors.every((error) => error instanceof cpal.CpalError));
    assert.deepStrictEqual(errors.map((error) => error.code), [
      'CALLBACK_FAILED',
      'XRUN',
    ]);
    await stream.close();
  });

  it('requires onError and rejects loopback on unsupported devices', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    await assert.rejects(
      cpal.createOutputStream({
        deviceId: 'coreaudio:test-device',
        config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
      }),
      /onError must be a function/
    );

    native.getDeviceById = () => ({
      ...native.getDefaultOutputDevice(),
      hostId: 'alsa',
      supportsLoopback: false,
    });
    await assert.rejects(
      cpal.createLoopbackStream({
        deviceId: 'alsa:test',
        config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
        onData() {},
        onError() {},
      }),
      (error) => error instanceof cpal.CpalError && error.code === 'UNSUPPORTED_OPERATION'
    );
  });

  it('validates lifecycle callbacks and pull queue bounds before native creation', async () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const options = {
      deviceId: 'coreaudio:test-device',
      config: { channels: 2, sampleRate: 48_000, sampleFormat: 'f32' },
      onError() {},
    };

    await assert.rejects(
      cpal.createOutputStream({ ...options, autoStart: 'yes' }),
      /autoStart must be a boolean/
    );
    await assert.rejects(
      cpal.createOutputStream({ ...options, onDrain: true }),
      /onDrain must be a function/
    );
    await assert.rejects(
      cpal.createOutputStream({
        ...options,
        mode: 'pull',
        queueCapacityBuffers: 0,
        onData: () => new Float32Array(256),
      }),
      /queueCapacityBuffers must be an integer/
    );
  });
});
