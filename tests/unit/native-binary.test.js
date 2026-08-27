const assert = require('assert');
const {
  assertNativeBinary,
  detectNativeBinary,
} = require('../../scripts/verify-native-binary');

function createMachO(cpuType) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpuType, 4);
  return buffer;
}

function createElf(machine) {
  const buffer = Buffer.alloc(64);
  buffer.set([0x7f, 0x45, 0x4c, 0x46], 0);
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeUInt16LE(machine, 18);
  return buffer;
}

function createPe(machine) {
  const buffer = Buffer.alloc(128);
  buffer.set([0x4d, 0x5a], 0);
  buffer.writeUInt32LE(64, 0x3c);
  buffer.set([0x50, 0x45, 0, 0], 64);
  buffer.writeUInt16LE(machine, 68);
  return buffer;
}

describe('Native Binary Verification', () => {
  it('detects supported Mach-O architectures', () => {
    assert.strictEqual(detectNativeBinary(createMachO(0x01000007)), 'darwin-x64');
    assert.strictEqual(
      detectNativeBinary(createMachO(0x0100000c)),
      'darwin-arm64'
    );
  });

  it('detects supported ELF architectures', () => {
    assert.strictEqual(detectNativeBinary(createElf(62)), 'linux-x64');
    assert.strictEqual(detectNativeBinary(createElf(183)), 'linux-arm64');
  });

  it('detects the supported PE architecture', () => {
    assert.strictEqual(detectNativeBinary(createPe(0x8664)), 'win32-x64');
  });

  it('rejects a binary with the wrong architecture', () => {
    assert.throws(
      () => assertNativeBinary(createMachO(0x0100000c), 'darwin-x64'),
      /Expected darwin-x64 native binary, found darwin-arm64/
    );
  });

  it('rejects unsupported binary formats', () => {
    assert.throws(
      () => detectNativeBinary(Buffer.alloc(64)),
      /Unsupported native binary format/
    );
  });
});
