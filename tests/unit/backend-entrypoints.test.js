const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FACADE = path.join(ROOT, 'facade.js');
const VALUES = path.join(ROOT, 'cpal-values.js');
const BACKENDS = {
  jack: { platform: 'darwin', arch: 'arm64', target: 'darwin-arm64' },
  pipewire: { platform: 'linux', arch: 'x64', target: 'linux-x64' },
  pulseaudio: { platform: 'linux', arch: 'arm64', target: 'linux-arm64' },
  asio: { platform: 'win32', arch: 'x64', target: 'win32-x64' },
};

function clearModules() {
  delete require.cache[FACADE];
  delete require.cache[VALUES];
  delete require.cache[path.join(ROOT, 'index.js')];
  for (const backend of Object.keys(BACKENDS)) {
    delete require.cache[path.join(ROOT, `backend-${backend}.js`)];
  }
}

function fakeNative(host) {
  return {
    getHosts: () => [{ id: host, name: host }],
    _cpalAllHosts: () => [{ id: host, name: host }],
  };
}

function withPlatform(platform, arch, callback) {
  const originalPlatform = os.platform;
  const originalArch = os.arch;
  os.platform = () => platform;
  os.arch = () => arch;
  try {
    return callback();
  } finally {
    os.platform = originalPlatform;
    os.arch = originalArch;
  }
}

describe('Optional backend package subpaths', () => {
  afterEach(clearModules);

  for (const [backend, target] of Object.entries(BACKENDS)) {
    it(`loads backend-${backend} from its feature-specific binary`, () => {
      clearModules();
      const requests = [];
      const originalLoad = Module._load;
      Module._load = function load(request, parent, isMain) {
        if (typeof request === 'string' && request.endsWith('index.node')) {
          requests.push(request);
          return fakeNative(backend);
        }
        return originalLoad.call(this, request, parent, isMain);
      };

      try {
        const cpal = withPlatform(target.platform, target.arch, () => (
          require(path.join(ROOT, `backend-${backend}.js`))
        ));
        assert(cpal.ALL_HOSTS.some((host) => host.toString() === backend));
        assert.strictEqual(
          requests[0],
          path.join(ROOT, 'bin', `backend-${backend}`, target.target, 'index.node')
        );
        if (backend === 'jack') assert.strictEqual(typeof cpal.JackHost, 'function');
        if (backend === 'pipewire') {
          assert.strictEqual(typeof cpal.PipeWireHost, 'function');
        }
      } finally {
        Module._load = originalLoad;
      }
    });
  }

  it('keeps host IDs usable when multiple Linux backend subpaths are loaded', () => {
    clearModules();
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (typeof request === 'string' && request.endsWith('index.node')) {
        const match = request.match(/backend-(jack|pipewire)/);
        return fakeNative(match ? match[1] : 'alsa');
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      withPlatform('linux', 'x64', () => {
        const jack = require(path.join(ROOT, 'backend-jack.js'));
        const pipewire = require(path.join(ROOT, 'backend-pipewire.js'));
        assert.strictEqual(jack.HostId.fromString('jack').toString(), 'jack');
        assert.strictEqual(pipewire.HostId.fromString('pipewire').toString(), 'pipewire');
      });
    } finally {
      Module._load = originalLoad;
    }
  });

  it('reports a packaged backend linkage failure instead of loading a local fallback', () => {
    clearModules();
    const originalExistsSync = fs.existsSync;
    const originalLoad = Module._load;
    let localFallbackRequested = false;
    const isPackagedJack = (file) => file.includes(`backend-jack${path.sep}`);
    fs.existsSync = (file) => isPackagedJack(file)
      || originalExistsSync(file);
    Module._load = function load(request, parent, isMain) {
      if (typeof request === 'string' && isPackagedJack(request)) {
        const error = new Error('libjack could not be loaded');
        error.code = 'ERR_DLOPEN_FAILED';
        throw error;
      }
      if (typeof request === 'string' && request.endsWith('index.node')) {
        localFallbackRequested = true;
        return fakeNative('jack');
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      assert.throws(
        () => withPlatform('darwin', 'arm64', () => require(path.join(ROOT, 'backend-jack.js'))),
        (error) => error.code === 'BINDING_LOAD_FAILED'
          && error.message.includes('libjack could not be loaded')
      );
      assert.strictEqual(localFallbackRequested, false);
    } finally {
      fs.existsSync = originalExistsSync;
      Module._load = originalLoad;
    }
  });
});
