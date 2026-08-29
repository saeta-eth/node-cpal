const assert = require('assert');
const Module = require('module');
const path = require('path');

const ENTRY = path.resolve(__dirname, '../..', 'index.js');
const FACADE = path.resolve(__dirname, '../..', 'facade.js');
const VALUES = path.resolve(__dirname, '../..', 'cpal-values.js');

function createFakeNative() {
  let nextHost = 0;
  let nextDevice = 0;
  let nextStream = 0;
  const streams = new Map();
  const native = {
    releasedHosts: [],
    releasedDevices: [],
    lastBuild: null,
    getHosts: () => [{ id: 'coreaudio', name: 'CoreAudio' }],
    _cpalAllHosts: () => [{ id: 'coreaudio', name: 'CoreAudio' }],
    _cpalAvailableHosts: () => [{ id: 'coreaudio', name: 'CoreAudio' }],
    _cpalDefaultHost: () => ({
      handle: `host-${++nextHost}`,
      id: 'coreaudio',
      name: 'CoreAudio',
      platformKind: 'dynamic',
    }),
    _cpalHostFromId: () => ({
      handle: `host-${++nextHost}`,
      id: 'coreaudio',
      name: 'CoreAudio',
      platformKind: 'dynamic',
    }),
    _cpalReleaseHost(handle) {
      native.releasedHosts.push(handle);
    },
    _cpalHostDevices: () => [{ handle: `device-${++nextDevice}` }],
    _cpalHostDeviceById: () => ({ handle: `device-${++nextDevice}` }),
    _cpalHostDefaultDevice: () => ({ handle: `device-${++nextDevice}` }),
    _cpalReleaseDevice(handle) {
      native.releasedDevices.push(handle);
    },
    _cpalCloneDevice: () => ({ handle: `device-${++nextDevice}` }),
    _cpalDeviceDescription: () => ({
      name: 'Test Device',
      manufacturer: 'Acme',
      driver: null,
      deviceType: 'speaker',
      interfaceType: 'built-in',
      direction: 'output',
      address: null,
      extended: ['test'],
    }),
    _cpalDeviceId: () => 'coreaudio:test-device',
    _cpalDeviceToString: () => 'Test Device',
    _cpalDeviceEquals: (left, right) => left === right,
    _cpalDeviceSupports: (_handle, input) => !input,
    _cpalDeviceSupportedConfigs: () => [{
      channels: 2,
      minSampleRate: 44_100,
      maxSampleRate: 48_000,
      bufferSize: { type: 'range', min: 64, max: 512 },
      sampleFormat: 'f32',
    }],
    _cpalDeviceDefaultConfig: () => ({
      channels: 2,
      sampleRate: 48_000,
      bufferSize: { type: 'unknown' },
      sampleFormat: 'f32',
    }),
    _cpalBuildStream(...args) {
      const id = `stream-${++nextStream}`;
      native.lastBuild = args;
      streams.set(id, { state: 'paused', now: 123n, bufferSize: 256 });
      return { id };
    },
    _cpalStreamPlay(id) {
      streams.get(id).state = 'playing';
    },
    _cpalStreamPause(id) {
      streams.get(id).state = 'paused';
    },
    _cpalStreamBufferSize: (id) => streams.get(id).bufferSize,
    _cpalStreamNow: (id) => streams.get(id).now,
    _cpalStreamState: (id) => streams.get(id).state,
    _cpalStreamClose(id) {
      streams.delete(id);
    },
  };
  return native;
}

function loadFacade(native) {
  delete require.cache[ENTRY];
  delete require.cache[FACADE];
  delete require.cache[VALUES];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request.endsWith('.node')) return native;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(ENTRY);
  } finally {
    Module._load = originalLoad;
  }
}

describe('Canonical CPAL facade', () => {
  it('owns Host and Device handles and exposes CPAL-shaped methods', () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const host = cpal.defaultHost();
    const [device] = host.outputDevices();

    assert.strictEqual(cpal.HostId.CoreAudio, cpal.ALL_HOSTS[0]);
    assert.strictEqual(String(host.id()), 'coreaudio');
    assert.strictEqual(cpal.Host.isAvailable(), true);
    assert.strictEqual(device.description().name(), 'Test Device');
    assert.strictEqual(String(device.id()), 'coreaudio:test-device');
    assert.strictEqual(device.supportsInput(), false);
    assert.strictEqual(device.supportsOutput(), true);
    assert.ok(device.clone() instanceof cpal.Device);
    assert.strictEqual(device.defaultOutputConfig().sampleFormat(), cpal.SampleFormat.F32);
    assert.strictEqual([...device.supportedOutputConfigs()][0].containsRate(48_000), true);

    device.close();
    host.close();
    assert.deepStrictEqual(native.releasedDevices, ['device-1']);
    assert.deepStrictEqual(native.releasedHosts, ['host-1']);
  });

  it('builds synchronous paused streams with typed callback semantics', () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const device = cpal.defaultHost().defaultOutputDevice();
    let receivedInfo;
    const errors = [];
    const stream = device.buildOutputStream(
      new cpal.StreamConfig(2, 48_000, cpal.BufferSize.Fixed(256)),
      cpal.SampleFormat.F32,
      (data, info) => {
        data.fill(0.25);
        receivedInfo = info;
      },
      (error) => errors.push(error)
    );

    assert.ok(stream instanceof cpal.Stream);
    assert.strictEqual(stream.state(), 'paused');
    assert.deepStrictEqual(native.lastBuild.slice(1, 4), [
      false,
      { channels: 2, sampleRate: 48_000, bufferSizeFrames: 256 },
      'f32',
    ]);

    const dataCallback = native.lastBuild[4];
    const samples = new Float32Array(8);
    dataCallback(samples, {
      kind: 'output',
      callbackTimeNs: 10n,
      playbackTimeNs: 20n,
    });
    assert.deepStrictEqual([...samples], new Array(8).fill(0.25));
    assert.ok(receivedInfo instanceof cpal.OutputCallbackInfo);
    assert.strictEqual(receivedInfo.timestamp().playback.asNanos(), 20n);
    assert.deepStrictEqual(errors, []);

    stream.play();
    assert.strictEqual(stream.state(), 'playing');
    assert.strictEqual(stream.bufferSize(), 256);
    assert.strictEqual(stream.now().asNanos(), 123n);
    stream.pause();
    stream.close();
    assert.strictEqual(stream.state(), 'closed');
    assert.throws(() => stream.play(), (error) => error.code === 'STREAM_CLOSED');
  });

  it('wraps raw Data for one callback and reports callback failures with silence', () => {
    const native = createFakeNative();
    const cpal = loadFacade(native);
    const device = cpal.defaultHost().defaultOutputDevice();
    const errors = [];
    let retained;
    device.buildOutputStreamRaw(
      new cpal.StreamConfig(1, 48_000),
      cpal.SampleFormat.U16,
      (data) => {
        retained = data;
        data.asSliceMut(cpal.SampleFormat.U16)[0] = 12;
        throw new Error('failure');
      },
      (error) => errors.push(error)
    );

    const samples = new Uint16Array([0, 0]);
    native.lastBuild[4](samples, {
      kind: 'output',
      callbackTimeNs: 1n,
      playbackTimeNs: 2n,
    });
    assert.deepStrictEqual([...samples], [32_768, 32_768]);
    assert.strictEqual(errors[0].code, 'CALLBACK_FAILED');
    assert.throws(() => retained.len(), /only valid during/);
  });

  it('keeps non-CPAL queued helpers exclusively under convenience', () => {
    const cpal = loadFacade(createFakeNative());
    assert.strictEqual(typeof cpal.convenience.createOutputStream, 'function');
    assert.strictEqual(typeof cpal.convenience.getDevices, 'function');
    assert.strictEqual(cpal.createOutputStream, undefined);
    assert.strictEqual(cpal.getDevices, undefined);
  });

  it('adapts custom raw devices through CPAL typed builders', () => {
    const native = createFakeNative();
    native._cpalAllHosts = () => [
      { id: 'coreaudio', name: 'CoreAudio' },
      { id: 'custom', name: 'Custom' },
    ];
    const cpal = loadFacade(native);
    const backing = new Float32Array(4);
    const callbackInfo = new cpal.OutputCallbackInfo(new cpal.OutputStreamTimestamp(
      cpal.StreamInstant.ZERO,
      cpal.StreamInstant.ZERO
    ));
    const adapter = {
      description: () => ({ name: 'Custom output', direction: 'output' }),
      id: () => 'custom:output',
      supportedInputConfigs: () => [],
      supportedOutputConfigs: () => [],
      defaultInputConfig: () => ({
        channels: 2,
        sampleRate: 48_000,
        bufferSize: { type: 'unknown' },
        sampleFormat: 'f32',
      }),
      defaultOutputConfig: () => ({
        channels: 2,
        sampleRate: 48_000,
        bufferSize: { type: 'unknown' },
        sampleFormat: 'f32',
      }),
      buildInputStreamRaw: () => { throw new Error('not used'); },
      buildOutputStreamRaw(config, format, callback) {
        assert.ok(config instanceof cpal.StreamConfig);
        callback(new cpal.Data(format, backing, true), callbackInfo);
        return {
          play() {},
          pause() {},
          bufferSize: () => 2,
          now: () => cpal.StreamInstant.ZERO,
        };
      },
    };
    const device = cpal.CustomDevice.fromDevice(adapter);
    const clone = device.clone();
    const stream = device.buildOutputStream(
      new cpal.StreamConfig(2, 48_000),
      cpal.SampleFormat.F32,
      (samples) => samples.fill(0.25),
      () => {}
    );

    assert.deepStrictEqual([...backing], [0.25, 0.25, 0.25, 0.25]);
    assert.ok(clone instanceof cpal.CustomDevice);
    assert.ok(stream instanceof cpal.CustomStream);
    assert.throws(() => device.buildOutputStream(
      new cpal.StreamConfig(2, 48_000),
      cpal.SampleFormat.DsdU8,
      () => {},
      () => {}
    ), (error) => error.code === 'UNSUPPORTED_OPERATION');
  });
});
