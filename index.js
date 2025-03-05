const path = require('path');
const os = require('os');

/**
 * Dynamically loads the appropriate native binary for the current platform
 * @returns {Object} The loaded native module
 * @throws {Error} If no compatible binary is found
 */
function getBinding() {
  const platform = os.platform();
  const arch = os.arch();

  // Map of supported platforms and architectures
  const supportedPlatforms = ['darwin', 'linux', 'win32'];
  const supportedArchs = ['x64'];

  // Check if current platform and architecture are supported
  if (!supportedPlatforms.includes(platform)) {
    throw new Error(
      `Unsupported platform: ${platform}. node-cpal supports: ${supportedPlatforms.join(
        ', '
      )}`
    );
  }

  if (!supportedArchs.includes(arch)) {
    throw new Error(
      `Unsupported architecture: ${arch}. node-cpal supports: ${supportedArchs.join(
        ', '
      )}`
    );
  }

  try {
    // First try to load from the published package structure (bin directory)
    try {
      const binaryPath = path.join(
        __dirname,
        'bin',
        `${platform}-${arch}`,
        'index.node'
      );
      return require(binaryPath);
    } catch (err) {
      // If that fails, try to load from the development environment (root directory)
      // This allows the module to work during development and testing
      return require(path.join(__dirname, 'index.node'));
    }
  } catch (err) {
    throw new Error(
      `Failed to load node-cpal binary for ${platform}-${arch}: ${err.message}`
    );
  }
}

// Export the loaded module
module.exports = getBinding();
