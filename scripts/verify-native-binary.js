const fs = require('fs');

const MACHO_MAGIC_64 = 0xfeedfacf;
const MACHO_CPU_TYPES = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
]);
const ELF_MACHINE_TYPES = new Map([
  [62, 'x64'],
  [183, 'arm64'],
]);
const PE_MACHINE_TYPES = new Map([
  [0x8664, 'x64'],
  [0xaa64, 'arm64'],
]);

function readMachOArchitecture(buffer) {
  if (buffer.length < 8) {
    return null;
  }

  const isLittleEndian = buffer.readUInt32LE(0) === MACHO_MAGIC_64;
  const isBigEndian = buffer.readUInt32BE(0) === MACHO_MAGIC_64;

  if (!isLittleEndian && !isBigEndian) {
    return null;
  }

  const cpuType = isLittleEndian
    ? buffer.readUInt32LE(4)
    : buffer.readUInt32BE(4);
  const arch = MACHO_CPU_TYPES.get(cpuType);

  if (!arch) {
    throw new Error(`Unsupported Mach-O CPU type: 0x${cpuType.toString(16)}`);
  }

  return `darwin-${arch}`;
}

function readElfArchitecture(buffer) {
  if (
    buffer.length < 20 ||
    buffer[0] !== 0x7f ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x4c ||
    buffer[3] !== 0x46
  ) {
    return null;
  }

  if (buffer[4] !== 2) {
    throw new Error(`Unsupported ELF class: ${buffer[4]}`);
  }

  let machine;
  if (buffer[5] === 1) {
    machine = buffer.readUInt16LE(18);
  } else if (buffer[5] === 2) {
    machine = buffer.readUInt16BE(18);
  } else {
    throw new Error(`Unsupported ELF byte order: ${buffer[5]}`);
  }

  const arch = ELF_MACHINE_TYPES.get(machine);
  if (!arch) {
    throw new Error(`Unsupported ELF machine type: ${machine}`);
  }

  return `linux-${arch}`;
}

function readPeArchitecture(buffer) {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    return null;
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (
    peOffset + 6 > buffer.length ||
    buffer[peOffset] !== 0x50 ||
    buffer[peOffset + 1] !== 0x45 ||
    buffer[peOffset + 2] !== 0 ||
    buffer[peOffset + 3] !== 0
  ) {
    throw new Error('Invalid PE header');
  }

  const machine = buffer.readUInt16LE(peOffset + 4);
  const arch = PE_MACHINE_TYPES.get(machine);
  if (!arch) {
    throw new Error(`Unsupported PE machine type: 0x${machine.toString(16)}`);
  }

  return `win32-${arch}`;
}

function detectNativeBinary(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Expected a Buffer');
  }

  const platform =
    readMachOArchitecture(buffer) ||
    readElfArchitecture(buffer) ||
    readPeArchitecture(buffer);

  if (!platform) {
    throw new Error('Unsupported native binary format');
  }

  return platform;
}

function assertNativeBinary(buffer, expectedPlatform) {
  const actualPlatform = detectNativeBinary(buffer);
  if (actualPlatform !== expectedPlatform) {
    throw new Error(
      `Expected ${expectedPlatform} native binary, found ${actualPlatform}`
    );
  }

  return actualPlatform;
}

function verifyNativeBinary(binaryPath, expectedPlatform) {
  const buffer = fs.readFileSync(binaryPath);
  return assertNativeBinary(buffer, expectedPlatform);
}

if (require.main === module) {
  const [binaryPath, expectedPlatform] = process.argv.slice(2);

  if (!binaryPath || !expectedPlatform) {
    console.error(
      'Usage: node scripts/verify-native-binary.js <binary> <platform-arch>'
    );
    process.exitCode = 1;
  } else {
    try {
      const actualPlatform = verifyNativeBinary(binaryPath, expectedPlatform);
      console.log(`Verified ${binaryPath}: ${actualPlatform}`);
    } catch (error) {
      console.error(`Binary verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  assertNativeBinary,
  detectNativeBinary,
  verifyNativeBinary,
};
